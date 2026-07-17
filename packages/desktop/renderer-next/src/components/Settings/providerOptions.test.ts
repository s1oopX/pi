import { describe, expect, it } from "vitest";
import type { AuthStatus, CustomModelsConfig } from "../../ipc/types";
import { canRemoveProviderAuth, deriveProviderIds, normalizeProviderId, resolveProviderId } from "./providerOptions";

describe("provider options", () => {
  it("derives a sorted union from models, auth status, and custom config", () => {
    const authStatuses: Record<string, AuthStatus> = {
      anthropic: { configured: true, source: "stored" },
      openai: { configured: false },
    };
    const customModelsConfig: CustomModelsConfig = {
      path: "models.json",
      providers: { local: { baseUrl: "http://localhost:11434/v1" } },
    };

    expect(deriveProviderIds(
      [{ provider: "openai" }, { provider: "google" }],
      authStatuses,
      customModelsConfig,
    )).toEqual(["anthropic", "google", "local", "openai"]);
  });

  it("only allows stored credentials to be removed", () => {
    expect(canRemoveProviderAuth({ configured: true, source: "stored" })).toBe(true);
    expect(canRemoveProviderAuth({ configured: true, source: "environment" })).toBe(false);
    expect(canRemoveProviderAuth({ configured: true, source: "runtime" })).toBe(false);
    expect(canRemoveProviderAuth({ configured: false })).toBe(false);
  });

  it("normalizes manually entered provider IDs and reuses a known canonical ID", () => {
    expect(normalizeProviderId(" Open AI ")).toBe("open-ai");
    expect(resolveProviderId(" OPENAI ", ["openai", "anthropic"])).toBe("openai");
    expect(resolveProviderId("New Provider", ["openai", "anthropic"])).toBe("new-provider");
  });
});
