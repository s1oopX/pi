import { afterEach, describe, expect, it } from "vitest";
import type { ComposerAttachment } from "./attachments";
import {
  appendFileReference,
  clearComposerWorkspaceDraft,
  getComposerWorkspaceDraftKey,
  getComposerWorkspaceDraft,
  setComposerWorkspaceDraft,
} from "./workspaceDrafts";

const image: ComposerAttachment = {
  id: "image-1",
  name: "diagram.png",
  type: "image",
  data: "AQID",
  mimeType: "image/png",
};

afterEach(() => {
  clearComposerWorkspaceDraft("C:\\workspace-a", "session-a");
  clearComposerWorkspaceDraft("C:\\workspace-a", "session-b");
  clearComposerWorkspaceDraft("C:\\workspace-b", "session-a");
});

describe("workspace composer drafts", () => {
  it("uses one stable identity for composer state and stored drafts", () => {
    expect(getComposerWorkspaceDraftKey("  C:\\workspace-a  ", "session-a")).toBe(
      getComposerWorkspaceDraftKey("C:\\workspace-a", "session-a"),
    );
    expect(getComposerWorkspaceDraftKey("C:\\workspace-a", "session-a")).not.toBe(
      getComposerWorkspaceDraftKey("C:\\workspace-a", "session-b"),
    );
  });

  it("appends file references without replacing the existing prompt", () => {
    expect(appendFileReference("", "src/app.ts")).toBe("@src/app.ts ");
    expect(appendFileReference("Review the auth flow", "src/app.ts")).toBe("Review the auth flow @src/app.ts ");
    expect(appendFileReference("Review the auth flow ", "src/app.ts")).toBe("Review the auth flow @src/app.ts ");
  });

  it("keeps text and attachments isolated by workspace", () => {
    setComposerWorkspaceDraft("C:\\workspace-a", "session-a", "Continue A", [image]);
    setComposerWorkspaceDraft("C:\\workspace-b", "session-a", "Continue B", []);

    expect(getComposerWorkspaceDraft("C:\\workspace-a", "session-a")).toEqual({
      input: "Continue A",
      attachments: [image],
    });
    expect(getComposerWorkspaceDraft("C:\\workspace-b", "session-a")).toEqual({
      input: "Continue B",
      attachments: [],
    });
  });

  it("keeps drafts isolated by session within the same workspace", () => {
    setComposerWorkspaceDraft("C:\\workspace-a", "session-a", "Continue A", [image]);
    setComposerWorkspaceDraft("C:\\workspace-a", "session-b", "Continue B", []);

    expect(getComposerWorkspaceDraft("C:\\workspace-a", "session-a")).toEqual({
      input: "Continue A",
      attachments: [image],
    });
    expect(getComposerWorkspaceDraft("C:\\workspace-a", "session-b")).toEqual({
      input: "Continue B",
      attachments: [],
    });
  });

  it("returns copies and clears empty drafts", () => {
    setComposerWorkspaceDraft("C:\\workspace-a", "session-a", "Continue", [image]);
    const loaded = getComposerWorkspaceDraft("C:\\workspace-a", "session-a");
    loaded.attachments[0].name = "changed.png";

    expect(getComposerWorkspaceDraft("C:\\workspace-a", "session-a").attachments[0].name).toBe("diagram.png");
    setComposerWorkspaceDraft("C:\\workspace-a", "session-a", "", []);
    expect(getComposerWorkspaceDraft("C:\\workspace-a", "session-a")).toEqual({ input: "", attachments: [] });
  });

});
