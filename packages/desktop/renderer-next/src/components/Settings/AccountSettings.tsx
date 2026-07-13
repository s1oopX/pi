import { useState } from "react";
import * as api from "../../ipc/api";
import { showToast } from "../Toast";
import { useStore } from "../../store";

const COMMON_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "openrouter",
  "groq",
  "xai",
  "mistral",
];

export function AccountSettings() {
  const authStatuses = useStore((s) => s.authStatuses);
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSaveKey(e: React.FormEvent) {
    e.preventDefault();
    if (!provider.trim() || !apiKey.trim()) return;
    setSaving(true);
    try {
      await api.setApiKey(provider.trim(), apiKey.trim());
      showToast(`API key saved for ${provider}`, "success");
      setApiKey("");
      useStore.getState().refresh();
    } catch (err) {
      showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveKey(providerName: string) {
    try {
      await api.removeApiKey(providerName);
      showToast(`API key removed for ${providerName}`, "success");
      useStore.getState().refresh();
    } catch (err) {
      showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Account & API Keys</h3>
      <p className="settings-section-desc">
        Configure API keys for model providers. Keys are stored locally.
      </p>

      <form className="api-key-form" onSubmit={handleSaveKey}>
        <div className="form-row">
          <label className="form-label" htmlFor="provider-select">Provider</label>
          <select
            id="provider-select"
            className="form-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="">Select provider...</option>
            {COMMON_PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="api-key-input">API Key</label>
          <input
            id="api-key-input"
            className="form-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
          />
        </div>
        <button
          className="settings-btn settings-btn-primary"
          type="submit"
          disabled={!provider || !apiKey.trim() || saving}
        >
          {saving ? "Saving..." : "Save Key"}
        </button>
      </form>

      <div className="configured-providers">
        <h4 className="settings-subsection-title">Configured Providers</h4>
        {Object.entries(authStatuses).filter(([, s]) => (s as { configured?: boolean })?.configured).length === 0 && (
          <div className="settings-empty">No providers configured yet.</div>
        )}
        {Object.entries(authStatuses)
          .filter(([, s]) => (s as { configured?: boolean })?.configured)
          .map(([name, status]) => {
            const s = status as { configured: boolean; source?: string };
            return (
              <div key={name} className="configured-provider-row">
                <div className="configured-provider-info">
                  <span className="configured-provider-name">{name}</span>
                  <span className="configured-provider-source">{s.source ?? "stored"}</span>
                </div>
                <button
                  className="settings-btn-sm settings-btn-danger"
                  type="button"
                  onClick={() => handleRemoveKey(name)}
                >
                  Remove
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
}
