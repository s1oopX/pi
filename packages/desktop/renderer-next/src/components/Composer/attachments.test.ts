import { describe, expect, it } from "vitest";
import {
  appendAttachments,
  bytesToBase64,
  getTransferredFiles,
  getPromptText,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_BYTES,
  readComposerAttachment,
  resolveImageMimeType,
  toImageContent,
  type ComposerAttachment,
} from "./attachments";

function attachment(id: string): ComposerAttachment {
  return { id, name: `${id}.png`, type: "image", data: id, mimeType: "image/png" };
}

const fileAttachment: ComposerAttachment = {
  id: "notes",
  name: "notes.txt",
  type: "file",
  path: "C:\\workspace\\notes.txt",
};

describe("composer attachments", () => {
  it("normalizes supported declared types and file extensions", () => {
    expect(resolveImageMimeType({ name: "photo.bin", type: "IMAGE/JPEG" })).toBe("image/jpeg");
    expect(resolveImageMimeType({ name: "screenshot.PNG", type: "" })).toBe("image/png");
    expect(resolveImageMimeType({ name: "notes.txt", type: "text/plain" })).toBeNull();
  });

  it("encodes bytes without relying on Node Buffer", () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 253, 254, 255]))).toBe("AAEC/f7/");
  });

  it("uses transfer items when the browser does not populate files", () => {
    const image = new File([new Uint8Array([1, 2, 3])], "clipboard.png", { type: "image/png" });
    expect(
      getTransferredFiles({
        files: [],
        items: [
          { kind: "string", getAsFile: () => null },
          { kind: "file", getAsFile: () => image },
        ],
      }),
    ).toEqual([image]);
  });

  it("uses file references for non-image attachments", async () => {
    await expect(
      readComposerAttachment(new File(["notes"], "notes.txt", { type: "text/plain" }), () => fileAttachment.path),
    ).resolves.toMatchObject({ name: "notes.txt", path: fileAttachment.path, type: "file" });
    await expect(
      readComposerAttachment(new File(["notes"], "notes.txt", { type: "text/plain" }), () => null),
    ).rejects.toThrow("Could not access the path for notes.txt");
  });

  it("applies size validation to transferred images", async () => {
    await expect(
      readComposerAttachment(
        new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "large.png", { type: "image/png" }),
        () => null,
      ),
    ).rejects.toThrow("large.png exceeds the 3 MB attachment limit");
  });

  it("caps the combined attachment list", () => {
    const current = Array.from({ length: MAX_ATTACHMENT_COUNT - 1 }, (_, index) => attachment(`old-${index}`));
    const result = appendAttachments(current, [attachment("new-1"), attachment("new-2")]);
    expect(result.attachments).toHaveLength(MAX_ATTACHMENT_COUNT);
    expect(result.attachments.at(-1)?.id).toBe("new-1");
    expect(result.dropped).toBe(1);
  });

  it("strips composer-only metadata from RPC image content", () => {
    expect(toImageContent([attachment("preview"), fileAttachment])).toEqual([
      { type: "image", data: "preview", mimeType: "image/png" },
    ]);
  });

  it("adds file references and valid text for image-only provider requests", () => {
    expect(getPromptText("", [attachment("preview")])).toBe("(see attached image)");
    expect(getPromptText("Explain this", [attachment("preview")])).toBe("Explain this");
    expect(getPromptText("Review this", [fileAttachment])).toBe("Review this\n\n@C:\\workspace\\notes.txt");
    expect(getPromptText("", [])).toBe("");
  });
});
