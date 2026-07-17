import type { AuthStatus, CustomModelsConfig, Model } from "../../ipc/types";

export function canRemoveProviderAuth(status: AuthStatus): boolean {
  return status.configured && status.source === "stored";
}

export function normalizeProviderId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveProviderId(value: string, knownProviders: readonly string[]): string {
  const trimmed = value.trim();
  const known = knownProviders.find((provider) => provider.toLocaleLowerCase("en") === trimmed.toLocaleLowerCase("en"));
  return known ?? normalizeProviderId(trimmed);
}

export function deriveProviderIds(
  models: readonly Pick<Model, "provider">[],
  authStatuses: Readonly<Record<string, AuthStatus>>,
  customModelsConfig: CustomModelsConfig | null,
): string[] {
  const providers = new Map<string, string>();
  const addProvider = (provider: string): void => {
    const normalized = provider.trim();
    if (!normalized) return;
    const key = normalized.toLocaleLowerCase("en");
    if (!providers.has(key)) providers.set(key, normalized);
  };
  for (const model of models) {
    addProvider(model.provider);
  }
  for (const provider of Object.keys(authStatuses)) {
    addProvider(provider);
  }
  for (const provider of Object.keys(customModelsConfig?.providers ?? {})) {
    addProvider(provider);
  }
  return [...providers.values()].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
}
