import { useStore } from "../../store";
import * as api from "../../ipc/api";
import { showToast } from "../Toast";

export function AboutSettings() {
  const appInfo = useStore((s) => s.appInfo);
  const backendStatus = useStore((s) => s.backendStatus);
  const workspaceCwd = useStore((s) => s.workspaceCwd);

  async function handleCheckUpdates() {
    try {
      const result = await api.checkForUpdates();
      if (result && typeof result === "object" && "update" in result) {
        showToast("Update available!", "info");
      } else {
        showToast("You're on the latest version.", "success");
      }
    } catch (e) {
      showToast(`Update check failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async function handleExportDiagnostics() {
    try {
      const result = await api.saveDiagnostics({
        timestamp: new Date().toISOString(),
      });
      if (result.saved) {
        showToast(`Diagnostics saved to ${result.path}`, "success");
      }
    } catch (e) {
      showToast(`Export failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async function handleRestartBackend() {
    try {
      await api.restartBackend();
      showToast("Backend restarting...", "info");
    } catch (e) {
      showToast(`Restart failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">About</h3>

      <div className="about-info">
        <div className="about-row">
          <span className="about-label">App</span>
          <span className="about-value">{appInfo?.name ?? "Pi Studio"} v{appInfo?.version ?? "?"}</span>
        </div>
        <div className="about-row">
          <span className="about-label">Backend</span>
          <span className="about-value">{backendStatus.ready ? "Running" : "Offline"}</span>
        </div>
        <div className="about-row">
          <span className="about-label">Backend path</span>
          <span className="about-value about-path">{backendStatus.backendPath || "N/A"}</span>
        </div>
        <div className="about-row">
          <span className="about-label">Workspace</span>
          <span className="about-value about-path">{workspaceCwd || "None"}</span>
        </div>
      </div>

      <div className="about-actions">
        <button className="settings-btn" type="button" onClick={handleCheckUpdates}>
          Check for Updates
        </button>
        <button className="settings-btn" type="button" onClick={handleExportDiagnostics}>
          Export Diagnostics
        </button>
        <button className="settings-btn settings-btn-danger" type="button" onClick={handleRestartBackend}>
          Restart Backend
        </button>
      </div>
    </div>
  );
}
