export interface ModelConfigBackup {
  format: "pi-studio-models";
  version: 1;
  providers: Record<string, unknown>;
}

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
import { translateText, type ResolvedLanguage } from "../../i18n";
