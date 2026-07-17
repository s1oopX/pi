import type { MouseEvent } from "react";
import { useI18n } from "../../i18n";
import * as ipcApi from "../../ipc/api";
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
    } catch {
      showToast(pathRevealFailedToast(language), "error");
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
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <rect x="5" y="5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M3 10V3.5A1.5 1.5 0 0 1 4.5 2H10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
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
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M2 4.5h4l1.2 1.5H14v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </button>
    </span>
  );
}
