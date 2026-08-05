import { MAX_ATTACHMENT_COUNT, type ComposerAttachment } from "./attachments";

export interface ComposerWorkspaceDraft {
  input: string;
  attachments: ComposerAttachment[];
}

const drafts = new Map<string, ComposerWorkspaceDraft>();
const DATABASE_NAME = "pi-studio-renderer";
const DATABASE_VERSION = 1;
const STORE_NAME = "composer-drafts";
let databasePromise: Promise<IDBDatabase | null> | undefined;

function copyDraft(draft: ComposerWorkspaceDraft): ComposerWorkspaceDraft {
  return { input: draft.input, attachments: draft.attachments.map((attachment) => ({ ...attachment })) };
}

function getComposerWorkspaceLatestDraftKey(cwd: string): string {
  return `latest\u0000${cwd.trim() || "__no_workspace__"}`;
}

function parseDraft(value: unknown): ComposerWorkspaceDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.input !== "string" || !Array.isArray(record.attachments)) return undefined;
  if (record.attachments.length > MAX_ATTACHMENT_COUNT) return undefined;

  const attachments: ComposerAttachment[] = [];
  for (const value of record.attachments) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const attachment = value as Record<string, unknown>;
    if (typeof attachment.id !== "string" || typeof attachment.name !== "string") return undefined;
    if (
      attachment.type === "image" &&
      typeof attachment.data === "string" &&
      ["image/gif", "image/jpeg", "image/png", "image/webp"].includes(String(attachment.mimeType))
    ) {
      attachments.push({
        id: attachment.id,
        name: attachment.name,
        type: "image",
        data: attachment.data,
        mimeType: attachment.mimeType as "image/gif" | "image/jpeg" | "image/png" | "image/webp",
      });
      continue;
    }
    if (attachment.type === "file" && typeof attachment.path === "string") {
      attachments.push({ id: attachment.id, name: attachment.name, type: "file", path: attachment.path });
      continue;
    }
    return undefined;
  }
  return { input: record.input, attachments };
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  databasePromise ??= new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
  });
  return databasePromise;
}

function readRequest(request: IDBRequest<unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    request.onerror = () => resolve(undefined);
    request.onsuccess = () => resolve(request.result);
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    transaction.onabort = () => resolve();
    transaction.onerror = () => resolve();
    transaction.oncomplete = () => resolve();
  });
}

export function getComposerWorkspaceDraftKey(cwd: string, sessionId?: string | null): string {
  const workspace = cwd.trim() || "__no_workspace__";
  return `${workspace}\u0000${sessionId ?? "__no_session__"}`;
}

export function getComposerWorkspaceDraft(cwd: string, sessionId?: string | null): ComposerWorkspaceDraft {
  const draft = drafts.get(getComposerWorkspaceDraftKey(cwd, sessionId));
  return draft ? copyDraft(draft) : { input: "", attachments: [] };
}

export async function loadPersistedComposerWorkspaceDraft(
  cwd: string,
  sessionId: string | null,
  includeLatest = false,
): Promise<ComposerWorkspaceDraft | undefined> {
  const database = await openDatabase();
  if (!database) return undefined;
  try {
    const store = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    const exact = readRequest(store.get(getComposerWorkspaceDraftKey(cwd, sessionId)));
    const latest = includeLatest ? readRequest(store.get(getComposerWorkspaceLatestDraftKey(cwd))) : undefined;
    return parseDraft((await exact) ?? (latest ? await latest : undefined));
  } catch {
    return undefined;
  }
}

export async function saveComposerWorkspaceDraft(
  cwd: string,
  sessionId: string | null,
  input: string,
  attachments: readonly ComposerAttachment[],
): Promise<void> {
  const key = getComposerWorkspaceDraftKey(cwd, sessionId);
  if (!input && attachments.length === 0) {
    drafts.delete(key);
    await deleteComposerWorkspaceDraft(cwd, sessionId);
    return;
  }
  const draft = {
    input,
    attachments: attachments.map((attachment) => ({ ...attachment })),
  };
  drafts.set(key, draft);
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(draft, key);
    store.put(draft, getComposerWorkspaceLatestDraftKey(cwd));
    await waitForTransaction(transaction);
  } catch {
    // The in-memory draft remains available when persistent storage is unavailable.
  }
}

export function setComposerWorkspaceDraft(
  cwd: string,
  sessionId: string | null,
  input: string,
  attachments: readonly ComposerAttachment[],
): void {
  void saveComposerWorkspaceDraft(cwd, sessionId, input, attachments);
}

export async function deleteComposerWorkspaceDraft(cwd: string, sessionId?: string | null): Promise<void> {
  drafts.delete(getComposerWorkspaceDraftKey(cwd, sessionId));
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.delete(getComposerWorkspaceDraftKey(cwd, sessionId));
    store.delete(getComposerWorkspaceLatestDraftKey(cwd));
    await waitForTransaction(transaction);
  } catch {
    // The memory cache was still cleared.
  }
}

export function clearComposerWorkspaceDraft(cwd: string, sessionId?: string | null): void {
  void deleteComposerWorkspaceDraft(cwd, sessionId);
}

export function appendFileReference(input: string, file: string): string {
  return `${input}${input && !/\s$/.test(input) ? " " : ""}@${file} `;
}
