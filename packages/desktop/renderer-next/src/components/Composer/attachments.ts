import type { ImageContent } from "../../ipc/types";

export const IMAGE_ONLY_PROMPT = "(see attached image)";
export const MAX_ATTACHMENT_COUNT = 4;
export const MAX_ATTACHMENT_MEGABYTES = 3;
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MEGABYTES * 1024 * 1024;

const MIME_TYPE_BY_EXTENSION: Readonly<Record<string, ImageContent["mimeType"]>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const SUPPORTED_IMAGE_MIME_TYPES = new Set(Object.values(MIME_TYPE_BY_EXTENSION));

export interface ComposerImageAttachment extends ImageContent {
  id: string;
  name: string;
}

export interface ComposerFileAttachment {
  id: string;
  name: string;
  type: "file";
  path: string;
}

export type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment;

export type AttachmentErrorReason = "image-unsupported" | "path-unavailable" | "too-large";

export class AttachmentError extends Error {
  readonly attachmentName: string;
  readonly reason: AttachmentErrorReason;

  constructor(reason: AttachmentErrorReason, attachmentName: string) {
    const message = reason === "image-unsupported"
      ? `The current model does not support ${attachmentName}`
      : reason === "path-unavailable"
        ? `Could not access the path for ${attachmentName}`
        : `${attachmentName} exceeds the ${MAX_ATTACHMENT_MEGABYTES} MB attachment limit`;
    super(message);
    this.name = "AttachmentError";
    this.attachmentName = attachmentName;
    this.reason = reason;
  }
}

interface TransferFiles {
  files: ArrayLike<File>;
  items: ArrayLike<Pick<DataTransferItem, "getAsFile" | "kind">>;
}

export function getTransferredFiles(transfer: TransferFiles): File[] {
  const files = Array.from(transfer.files);
  if (files.length > 0) return files;

  return Array.from(transfer.items).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}

export function resolveImageMimeType(file: Pick<File, "name" | "type">): ImageContent["mimeType"] | null {
  const declaredType = file.type.trim().toLowerCase();
  if (SUPPORTED_IMAGE_MIME_TYPES.has(declaredType)) return declaredType;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension ? (MIME_TYPE_BY_EXTENSION[extension] ?? null) : null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

export async function readComposerAttachment(
  file: File,
  getFilePath: (file: File) => string | null,
): Promise<ComposerAttachment> {
  const mimeType = resolveImageMimeType(file);
  const name = file.name.trim() || "attachment";
  if (!mimeType) {
    const path = getFilePath(file)?.trim();
    if (!path) throw new AttachmentError("path-unavailable", name);
    return { id: crypto.randomUUID(), type: "file", path, name };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError("too-large", name);
  }

  return {
    id: crypto.randomUUID(),
    type: "image",
    data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
    mimeType,
    name,
  };
}

export function appendAttachments(
  current: readonly ComposerAttachment[],
  incoming: readonly ComposerAttachment[],
): { attachments: ComposerAttachment[]; dropped: number } {
  const available = Math.max(0, MAX_ATTACHMENT_COUNT - current.length);
  return {
    attachments: [...current, ...incoming.slice(0, available)],
    dropped: Math.max(0, incoming.length - available),
  };
}

export function toImageContent(attachments: readonly ComposerAttachment[]): ImageContent[] {
  return attachments.flatMap((attachment) =>
    attachment.type === "image"
      ? [{ type: attachment.type, data: attachment.data, mimeType: attachment.mimeType }]
      : [],
  );
}

export function getPromptText(message: string, attachments: readonly ComposerAttachment[]): string {
  const fileReferences = attachments.flatMap((attachment) =>
    attachment.type === "file" ? [`@${attachment.path}`] : [],
  );
  const text = [message, ...fileReferences].filter(Boolean).join("\n\n");
  return text || (attachments.some((attachment) => attachment.type === "image") ? IMAGE_ONLY_PROMPT : "");
}
