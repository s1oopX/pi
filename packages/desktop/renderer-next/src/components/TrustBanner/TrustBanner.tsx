import { useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { Icon } from "../Icon";
import { showToast } from "../Toast";
import { shouldShowTrustBanner } from "./trustBannerState";

export function TrustBanner() {
  const { t } = useI18n();
  const session = useStore((s) => s.session);
  const refresh = useStore((s) => s.refresh);
  const [trusting, setTrusting] = useState(false);

  if (!shouldShowTrustBanner(session)) return null;

  const workspaceName = session?.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? "";

  async function handleTrust() {
    if (trusting) return;
    setTrusting(true);
    try {
      await api.setProjectTrust(true);
      refresh();
      showToast(t("Project trusted", "已信任此项目"), "success");
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      showToast(t("Could not trust project: {message}", "信任项目失败：{message}", {
        message: raw.split("Error: ").pop()?.trim() || raw,
      }), "error");
    } finally {
      setTrusting(false);
    }
  }

  return (
    <div className="trust-banner" role="alert">
      <span className="trust-banner-icon" aria-hidden="true">
        <Icon name="alert-triangle" size={16} />
      </span>
      <div className="trust-banner-copy">
        <strong className="trust-banner-title">{t("This folder is not trusted", "此文件夹尚未受信任")}</strong>
        <span className="trust-banner-detail">
          {t(
            "{name} defines project extensions or settings that run with full access. They stay disabled until you trust this folder.",
            "{name} 定义了以完整权限运行的项目扩展或设置。在你信任此文件夹之前，它们保持禁用。",
            { name: workspaceName },
          )}
        </span>
      </div>
      <button
        className="trust-banner-btn"
        type="button"
        disabled={trusting}
        onClick={() => void handleTrust()}
      >
        {trusting ? t("Trusting...", "正在信任...") : t("Trust folder", "信任此文件夹")}
      </button>
    </div>
  );
}
