import type { MouseEvent } from "react";
import { useI18n } from "../../i18n";
import * as ipcApi from "../../ipc/api";
import { Icon } from "../Icon";
import { showToast } from "../Toast";
import {
  pathActionCopyLabel,
  pathActionRevealLabel,
  pathCopiedToast,
  pathRevealFailedToast,
} from "./pathActionLabels";

interface PathActionsProps {
  path: string;
}

export function PathActions({ path }: PathActionsProps) {
  const { resolvedLanguage, t } = useI18n();
  const language = resolvedLanguage === "zh-CN" ? "zh-CN" : "en";

  async function handleCopy(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await ipcApi.writeClipboardText(path);
      showToast(pathCopiedToast(language), "success");
    } catch {
      showToast(t("Could not copy path", "无法复制路径"), "error");
    }
  }

  async function handleReveal(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await ipcApi.revealWorkspacePath(path);
    } catch (error) {
      // Electron invoke errors carry a "Error invoking remote method ..." prefix;
      // keep only the underlying reason for the toast.
      const raw = error instanceof Error ? error.message : String(error);
      const reason = raw.split("Error: ").pop()?.trim() ?? "";
      showToast(reason ? `${pathRevealFailedToast(language)}: ${reason}` : pathRevealFailedToast(language), "error");
    }
  }

  return (
    <span className="path-actions" role="group" aria-label={t("Path actions", "路径操作")}>
      <button
        className="path-action-btn"
        type="button"
        title={pathActionCopyLabel(language)}
        aria-label={pathActionCopyLabel(language)}
        onClick={(event) => {
          void handleCopy(event);
        }}
      >
        <Icon name="copy" size={12} />
      </button>
      <button
        className="path-action-btn"
        type="button"
        title={pathActionRevealLabel(language)}
        aria-label={pathActionRevealLabel(language)}
        onClick={(event) => {
          void handleReveal(event);
        }}
      >
        <Icon name="folder-open" size={12} />
      </button>
    </span>
  );
}
