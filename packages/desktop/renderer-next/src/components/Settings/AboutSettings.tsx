import { useStore } from "../../store";
import * as api from "../../ipc/api";
import { useI18n } from "../../i18n";
import { showToast } from "../Toast";

export function AboutSettings() {
  const appInfo = useStore((s) => s.appInfo);
  const backendStatus = useStore((s) => s.backendStatus);
  const workspaceCwd = useStore((s) => s.workspaceCwd);
  const logs = useStore((s) => s.logs);
  const session = useStore((s) => s.session);
  const { t } = useI18n();

  async function handleCheckUpdates() {
    try {
      const result = await api.checkForUpdates();
      if (result && typeof result === "object" && "available" in result && result.available === true) {
        const latestVersion = "latestVersion" in result && typeof result.latestVersion === "string"
          ? ` v${result.latestVersion}`
          : "";
        showToast(t("Update{version} available", "有可用更新{version}", { version: latestVersion }), "info");
      } else {
        showToast(t("You're on the latest version.", "当前已是最新版本。"), "success");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showToast(t("Update check failed: {message}", "检查更新失败：{message}", { message }), "error");
    }
  }

  async function handleExportDiagnostics() {
    try {
      const result = await api.saveDiagnostics({
        timestamp: new Date().toISOString(),
        app: appInfo,
        backend: backendStatus,
        workspace: workspaceCwd,
        session: session
          ? {
              id: session.sessionId,
              name: session.sessionName,
              model: session.model ? { provider: session.model.provider, id: session.model.id } : undefined,
              messageCount: session.messageCount,
              isStreaming: session.isStreaming,
            }
          : null,
        logs,
      });
      if (result.saved) {
        showToast(t("Diagnostics saved to {path}", "诊断信息已保存到 {path}", { path: result.path ?? "" }), "success");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showToast(t("Export failed: {message}", "导出失败：{message}", { message }), "error");
    }
  }

  async function handleRestartBackend() {
    try {
      await api.restartBackend();
      showToast(t("Backend restarting…", "后端正在重启…"), "info");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showToast(t("Restart failed: {message}", "重启失败：{message}", { message }), "error");
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("About", "关于")}</h3>

      <div className="about-info">
        <div className="about-row">
          <span className="about-label">{t("App", "应用")}</span>
          <span className="about-value">{appInfo?.name ?? "Pi Studio"} v{appInfo?.version ?? "?"}</span>
        </div>
        <div className="about-row">
          <span className="about-label">{t("Backend", "后端")}</span>
          <span className="about-value">{backendStatus.ready ? t("Running", "运行中") : t("Offline", "离线")}</span>
        </div>
        <div className="about-row">
          <span className="about-label">{t("Backend path", "后端路径")}</span>
          <span className="about-value about-path">{backendStatus.backendPath || t("N/A", "无")}</span>
        </div>
        <div className="about-row">
          <span className="about-label">{t("Workspace", "工作区")}</span>
          <span className="about-value about-path">{workspaceCwd || t("None", "无")}</span>
        </div>
      </div>

      <div className="about-actions">
        <button className="settings-btn" type="button" onClick={handleCheckUpdates}>
          {t("Check for Updates", "检查更新")}
        </button>
        <button className="settings-btn" type="button" onClick={handleExportDiagnostics}>
          {t("Export Diagnostics", "导出诊断信息")}
        </button>
        <button className="settings-btn settings-btn-danger" type="button" onClick={handleRestartBackend}>
          {t("Restart Backend", "重启后端")}
        </button>
      </div>
    </div>
  );
}
