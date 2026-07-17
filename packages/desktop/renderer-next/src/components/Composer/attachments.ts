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

export interface ComposerAttachment extends ImageContent {
  id: string;
  name: string;
}

export type ImageAttachmentErrorReason = "unsupported" | "too-large";

export class ImageAttachmentError extends Error {
  readonly attachmentName: string;
  readonly reason: ImageAttachmentErrorReason;

  constructor(reason: ImageAttachmentErrorReason, attachmentName: string) {
    const message = reason === "unsupported"
      ? `${attachmentName} is not a supported image`
      : `${attachmentName} exceeds the ${MAX_ATTACHMENT_MEGABYTES} MB attachment limit`;
    super(message);
    this.name = "ImageAttachmentError";
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

export async function readImageAttachment(file: File): Promise<ComposerAttachment> {
  const mimeType = resolveImageMimeType(file);
  const name = file.name.trim() || "pasted image";
  if (!mimeType) throw new ImageAttachmentError("unsupported", name);
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ImageAttachmentError("too-large", name);
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
  return attachments.map(({ type, data, mimeType }) => ({ type, data, mimeType }));
}

export function getPromptText(message: string, attachmentCount: number): string {
  return message || (attachmentCount > 0 ? IMAGE_ONLY_PROMPT : "");
}
