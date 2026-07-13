import { useState } from "react";
import * as api from "../../ipc/api";
import { showToast } from "../Toast";
import { useStore } from "../../store";
import type { CustomModelApi } from "../../ipc/types";

interface ModelDraft {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

const API_OPTIONS: { value: CustomModelApi; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Completions (compatible)" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
];

const EMPTY_MODEL: ModelDraft = {
  id: "",
  name: "",
  reasoning: false,
  contextWindow: 128000,
  maxTokens: 16384,
};

export function CustomProviderSettings() {
  const customModelsConfig = useStore((s) => s.customModelsConfig);
  const [providerId, setProviderId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiType, setApiType] = useState<CustomModelApi>("openai-completions");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelDraft[]>([{ ...EMPTY_MODEL }]);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  function addModel() {
    setModels((prev) => [...prev, { ...EMPTY_MODEL }]);
  }

  function removeModel(index: number) {
    setModels((prev) => prev.filter((_, i) => i !== index));
  }

  function updateModel(index: number, field: keyof ModelDraft, value: string | number | boolean) {
    setModels((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  }

  async function handleTest() {
    if (!baseUrl.trim() || models.length === 0 || !models[0].id.trim()) {
      showToast("Fill in Base URL and at least one Model ID to test", "error");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      await api.testCustomModel({
        provider: providerId.trim() || "custom",
        baseUrl: baseUrl.trim(),
        api: apiType,
        apiKey: apiKey.trim() || undefined,
        modelId: models[0].id.trim(),
      });
      setTestResult("success");
      showToast("Connection successful!", "success");
    } catch (e) {
      setTestResult("error");
      showToast(`Test failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!providerId.trim()) {
      showToast("Provider ID is required", "error");
      return;
    }
    if (!baseUrl.trim()) {
      showToast("Base URL is required", "error");
      return;
    }
    const validModels = models.filter((m) => m.id.trim());
    if (validModels.length === 0) {
      showToast("At least one model with an ID is required", "error");
      return;
    }

    setSaving(true);
    try {
      for (const model of validModels) {
        await api.upsertCustomModel({
          provider: providerId.trim(),
          baseUrl: baseUrl.trim(),
          api: apiType,
          apiKey: apiKey.trim() || undefined,
          model: {
            id: model.id.trim(),
            name: model.name.trim() || undefined,
            reasoning: model.reasoning || undefined,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
          },
        });
      }
      showToast(`Provider "${providerId}" saved with ${validModels.length} model(s)`, "success");
      useStore.getState().refresh();
      resetForm();
    } catch (e) {
      showToast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setProviderId("");
    setBaseUrl("");
    setApiType("openai-completions");
    setApiKey("");
    setModels([{ ...EMPTY_MODEL }]);
    setTestResult(null);
  }

  async function handleRemoveProvider(provider: string, modelId: string) {
    try {
      await api.removeCustomModel(provider, modelId, true);
      showToast(`Removed ${modelId} from ${provider}`, "success");
      useStore.getState().refresh();
    } catch (e) {
      showToast(`Remove failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  const existingProviders = customModelsConfig?.providers ?? {};

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Custom Providers</h3>
      <p className="settings-section-desc">
        Connect third-party OpenAI-compatible or Anthropic-compatible API endpoints.
      </p>

      <div className="custom-provider-form">
        <div className="form-row">
          <label className="form-label" htmlFor="cp-provider-id">Provider ID</label>
          <input
            id="cp-provider-id"
            className="form-input"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            placeholder="e.g. ollama, my-proxy, azure-custom"
          />
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="cp-base-url">Base URL</label>
          <input
            id="cp-base-url"
            className="form-input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="e.g. http://localhost:11434/v1"
          />
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="cp-api-type">API Type</label>
          <select
            id="cp-api-type"
            className="form-select"
            value={apiType}
            onChange={(e) => setApiType(e.target.value as CustomModelApi)}
          >
            {API_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="cp-api-key">API Key (optional)</label>
          <input
            id="cp-api-key"
            className="form-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-... or $ENV_VAR or !command"
            autoComplete="off"
          />
          <span className="form-hint">
            Supports: literal key, $ENV_VAR, or !shell-command
          </span>
        </div>

        <div className="custom-provider-models">
          <div className="custom-provider-models-header">
            <label className="form-label">Models</label>
            <button className="settings-btn-sm" type="button" onClick={addModel}>
              + Add Model
            </button>
          </div>

          {models.map((model, i) => (
            <div key={i} className="custom-model-row">
              <div className="custom-model-fields">
                <input
                  className="form-input form-input-sm"
                  value={model.id}
                  onChange={(e) => updateModel(i, "id", e.target.value)}
                  placeholder="Model ID (required)"
                />
                <input
                  className="form-input form-input-sm"
                  value={model.name}
                  onChange={(e) => updateModel(i, "name", e.target.value)}
                  placeholder="Display name (optional)"
                />
                <div className="custom-model-options">
                  <label className="settings-toggle-inline">
                    <input
                      type="checkbox"
                      checked={model.reasoning}
                      onChange={(e) => updateModel(i, "reasoning", e.target.checked)}
                    />
                    <span>Reasoning</span>
                  </label>
                  <input
                    className="form-input form-input-num"
                    type="number"
                    value={model.contextWindow}
                    onChange={(e) => updateModel(i, "contextWindow", Number(e.target.value))}
                    title="Context window"
                  />
                  <input
                    className="form-input form-input-num"
                    type="number"
                    value={model.maxTokens}
                    onChange={(e) => updateModel(i, "maxTokens", Number(e.target.value))}
                    title="Max output tokens"
                  />
                </div>
              </div>
              {models.length > 1 && (
                <button
                  className="settings-btn-sm settings-btn-danger"
                  type="button"
                  onClick={() => removeModel(i)}
                  aria-label="Remove model"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="custom-provider-actions">
          <button
            className="settings-btn"
            type="button"
            onClick={handleTest}
            disabled={testing || !baseUrl.trim()}
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
          {testResult && (
            <span className={`test-result test-result-${testResult}`}>
              {testResult === "success" ? "Reachable" : "Failed"}
            </span>
          )}
          <button
            className="settings-btn settings-btn-primary"
            type="button"
            onClick={handleSave}
            disabled={saving || !providerId.trim() || !baseUrl.trim()}
          >
            {saving ? "Saving..." : "Save Provider"}
          </button>
        </div>
      </div>

      {Object.keys(existingProviders).length > 0 && (
        <div className="existing-custom-providers">
          <h4 className="settings-subsection-title">Existing Custom Providers</h4>
          {Object.entries(existingProviders).map(([name, config]) => {
            const providerConfig = config as {
              baseUrl?: string;
              api?: string;
              models?: Array<{ id: string; name?: string }>;
            };
            return (
              <div key={name} className="existing-provider-card">
                <div className="existing-provider-header">
                  <span className="existing-provider-name">{name}</span>
                  <span className="existing-provider-meta">
                    {providerConfig.api ?? "unknown"} &middot; {providerConfig.baseUrl ?? "no url"}
                  </span>
                </div>
                {providerConfig.models && providerConfig.models.length > 0 && (
                  <div className="existing-provider-models">
                    {providerConfig.models.map((m) => (
                      <div key={m.id} className="existing-model-chip">
                        <span>{m.name ?? m.id}</span>
                        <button
                          className="chip-remove"
                          type="button"
                          onClick={() => handleRemoveProvider(name, m.id)}
                          aria-label={`Remove ${m.id}`}
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
