import { translateText, type ResolvedLanguage } from "../../i18n";

export interface ModelConfigBackup {
  format: "pi-studio-models";
  version: 1;
  providers: Record<string, unknown>;
}

export const PERMISSION_MODE_EXTENSION_FLAG = "permission-mode";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildCustomModelInput(supportsImages: boolean): ("text" | "image")[] {
  return supportsImages ? ["text", "image"] : ["text"];
}

export function getConnectionTestFailure(result: unknown, language: ResolvedLanguage = "en"): string | null {
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    return translateText(language, "The backend returned an invalid connection test response", "后端返回了无效的连接测试响应");
  }
  if (result.ok) return null;

  const message = typeof result.message === "string" && result.message.trim()
    ? result.message.trim()
    : translateText(language, "Connection test failed", "连接测试失败");
  const category = typeof result.category === "string" && result.category.trim()
    ? result.category.trim()
    : null;
  return category ? `${message} (${category})` : message;
}

export function createModelConfigBackup(providers: Record<string, unknown>): ModelConfigBackup {
  return {
    format: "pi-studio-models",
    version: 1,
    providers,
  };
}

export function readModelConfigBackupProviders(backup: unknown): Record<string, unknown> | null {
  if (!isRecord(backup)) return null;
  if (backup.format !== "pi-studio-models" || backup.version !== 1 || !isRecord(backup.providers)) {
    return null;
  }
  return backup.providers;
}
function extensionPathName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return (segments[segments.length - 1] ?? path).toLocaleLowerCase("en");
}

function hasPermissionModeExtensionByPath(
  extensions: readonly { name?: string; path?: string }[],
): boolean {
  return extensions.some((extension) => {
    const candidates = [extension.name, extension.path]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => extensionPathName(value));
    return candidates.some(
      (name) =>
        name === "tool-approval.ts" ||
        name === "tool-approval.js" ||
        name.includes("tool-approval") ||
        name.includes(PERMISSION_MODE_EXTENSION_FLAG),
    );
  });
}

/** Detect whether the runtime registered the permission-mode extension flag. */
export function hasPermissionModeExtension(
  resources:
    | {
        extensionFlags?: readonly { name?: string }[];
        extensions?: readonly { name?: string; path?: string }[];
      }
    | null
    | undefined,
): boolean {
  const flags = resources?.extensionFlags ?? [];
  if (flags.some((flag) => flag.name === PERMISSION_MODE_EXTENSION_FLAG)) {
    return true;
  }
  // Fallback for older backends that only return extension file paths.
  return hasPermissionModeExtensionByPath(resources?.extensions ?? []);
}
