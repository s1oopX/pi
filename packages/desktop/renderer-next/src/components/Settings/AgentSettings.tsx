import { useStore } from "../../store";
import * as api from "../../ipc/api";
import { showToast } from "../Toast";
import type { ThinkingLevel, QueueMode } from "../../ipc/types";

const THINKING_LEVELS: { value: ThinkingLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Maximum" },
];

const QUEUE_MODES: { value: QueueMode; label: string }[] = [
  { value: "all", label: "Process all at once" },
  { value: "one-at-a-time", label: "One at a time" },
];

export function AgentSettings() {
  const session = useStore((s) => s.session);
  const thinkingLevel = (session?.thinkingLevel ?? "medium") as ThinkingLevel;
  const steeringMode = (session?.steeringMode ?? "all") as QueueMode;
  const followUpMode = (session?.followUpMode ?? "all") as QueueMode;
  const autoCompaction = session?.autoCompactionEnabled ?? true;

  async function handleThinking(level: ThinkingLevel) {
    try {
      await api.setThinkingLevel(level);
      useStore.getState().refresh();
    } catch (e) {
      showToast(`Failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async function handleSteeringMode(mode: QueueMode) {
    try {
      await api.setSteeringMode(mode);
      useStore.getState().refresh();
    } catch (e) {
      showToast(`Failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async function handleFollowUpMode(mode: QueueMode) {
    try {
      await api.setFollowUpMode(mode);
      useStore.getState().refresh();
    } catch (e) {
      showToast(`Failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async function handleAutoCompaction(enabled: boolean) {
    try {
      await api.setAutoCompaction(enabled);
      useStore.getState().refresh();
    } catch (e) {
      showToast(`Failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Agent Settings</h3>

      <div className="settings-group">
        <label className="settings-group-label">Thinking Level</label>
        <p className="settings-group-desc">Controls how much reasoning the model uses.</p>
        <div className="settings-radio-group">
          {THINKING_LEVELS.map((opt) => (
            <label key={opt.value} className="settings-radio-option">
              <input
                type="radio"
                name="thinking-level"
                value={opt.value}
                checked={thinkingLevel === opt.value}
                onChange={() => handleThinking(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-group-label">Steering Mode</label>
        <p className="settings-group-desc">How steering messages are processed while the agent runs.</p>
        <select
          className="form-select"
          value={steeringMode}
          onChange={(e) => handleSteeringMode(e.target.value as QueueMode)}
        >
          {QUEUE_MODES.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="settings-group">
        <label className="settings-group-label">Follow-up Mode</label>
        <p className="settings-group-desc">How follow-up messages are dispatched after a turn completes.</p>
        <select
          className="form-select"
          value={followUpMode}
          onChange={(e) => handleFollowUpMode(e.target.value as QueueMode)}
        >
          {QUEUE_MODES.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="settings-group">
        <label className="settings-group-label">Auto Compaction</label>
        <p className="settings-group-desc">Automatically compact context when approaching the limit.</p>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={autoCompaction}
            onChange={(e) => handleAutoCompaction(e.target.checked)}
          />
          <span>{autoCompaction ? "Enabled" : "Disabled"}</span>
        </label>
      </div>
    </div>
  );
}
