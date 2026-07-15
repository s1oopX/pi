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

// Mirrors the backend's normalizeProviderId: only lowercase latin letters,
// digits, dot, underscore and hyphen survive. Non-ASCII input (e.g. Chinese)
// collapses to an empty string, which the backend rejects as "required".
function normalizeProviderId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Some Anthropic-compatible gateways block requests whose User-Agent identifies
// the official Anthropic SDK (returns 403 "Your request was blocked"). The chat
// path uses the Anthropic SDK, which sets a "Anthropic/JS x.x" UA. Overriding it
// via provider headers lets the request through. Only injected when the caller
// has not already supplied a user-agent header.
function withAnthropicUaHeader(
  api: CustomModelApi,
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  if (api !== "anthropic-messages") return headers;
  const hasUa = headers && Object.keys(headers).some((k) => k.toLowerCase() === "user-agent");
  if (hasUa) return headers;
  return { ...(headers ?? {}), "user-agent": "Mozilla/5.0" };
}

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
  const [fetching, setFetching] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<{ id: string; name?: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showKey, setShowKey] = useState(false);

  async function handleFetchModels() {
    if (!baseUrl.trim()) {
      showToast("Enter a Base URL first", "error");
      return;
    }
    setFetching(true);
    setFetchedModels([]);
    setSelectedIds(new Set());
    try {
      const result = await api.fetchProviderModels({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        api: apiType,
      });
      if (result.models.length === 0) {
        showToast("Endpoint returned no models", "error");
      } else {
        setFetchedModels(result.models);
        setSelectedIds(new Set(result.models.map((m) => m.id)));
        showToast(`Found ${result.models.length} model(s)`, "success");
      }
    } catch (e) {
      showToast(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setFetching(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSaveFetched() {
    const provider = normalizeProviderId(providerId);
    if (!provider) {
      showToast(
        "Provider ID must contain latin letters or digits (e.g. baibei). Chinese-only names become empty after normalization.",
        "error",
      );
      return;
    }
    const chosen = fetchedModels.filter((m) => selectedIds.has(m.id));
    if (chosen.length === 0) {
      showToast("Select at least one model", "error");
      return;
    }
    setSaving(true);
    try {
      for (const model of chosen) {
        await api.upsertCustomModel({
          provider,
          baseUrl: baseUrl.trim(),
          api: apiType,
          apiKey: apiKey.trim() || undefined,
          headers: withAnthropicUaHeader(apiType),
          model: {
            id: model.id,
            name: model.name,
            reasoning: apiType === "anthropic-messages" || undefined,
            contextWindow: 200000,
            maxTokens: 16384,
          },
        });
      }
      showToast(`Saved ${chosen.length} model(s) to "${provider}"`, "success");
      useStore.getState().refresh();
      setFetchedModels([]);
      setSelectedIds(new Set());
      resetForm();
    } catch (e) {
      showToast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setSaving(false);
    }
  }

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
    const provider = normalizeProviderId(providerId);
    if (!provider) {
      showToast(
        "Provider ID must contain latin letters or digits (e.g. baibei). Chinese-only names become empty after normalization.",
        "error",
      );
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
          provider,
          baseUrl: baseUrl.trim(),
          api: apiType,
          apiKey: apiKey.trim() || undefined,
          headers: withAnthropicUaHeader(apiType),
          model: {
            id: model.id.trim(),
            name: model.name.trim() || undefined,
            reasoning: model.reasoning || undefined,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
          },
        });
      }
      showToast(`Provider "${provider}" saved with ${validModels.length} model(s)`, "success");
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
          {providerId.trim() && normalizeProviderId(providerId) !== providerId.trim() && (
            <span className={`form-hint ${normalizeProviderId(providerId) ? "" : "form-hint-error"}`}>
              {normalizeProviderId(providerId)
                ? `Will be saved as "${normalizeProviderId(providerId)}"`
                : "This name has no latin letters or digits, so it becomes empty. Use something like baibei."}
            </span>
          )}
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
          <div className="input-with-toggle">
            <input
              id="cp-api-key"
              className="form-input"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-... or $ENV_VAR or !command"
              autoComplete="off"
            />
            <button
              className="input-toggle-btn"
              type="button"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? "Hide API key" : "Show API key"}
              title={showKey ? "Hide" : "Show"}
            >
              {showKey ? (
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="m2 2 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              )}
            </button>
          </div>
          <span className="form-hint">
            Supports: literal key, $ENV_VAR, or !shell-command
          </span>
        </div>

        <div className="form-row">
          <button
            className="settings-btn settings-btn-primary"
            type="button"
            onClick={handleFetchModels}
            disabled={fetching || !baseUrl.trim()}
          >
            {fetching ? "Fetching..." : "Fetch Models from Endpoint"}
          </button>
          <span className="form-hint">
            Loads the model list from the endpoint so you can pick which ones to add.
          </span>
        </div>

        {fetchedModels.length > 0 && (
          <div className="fetched-models">
            <div className="fetched-models-header">
              <label className="form-label">
                Available Models ({selectedIds.size}/{fetchedModels.length} selected)
              </label>
              <div className="fetched-models-bulk">
                <button
                  className="settings-btn-sm"
                  type="button"
                  onClick={() => setSelectedIds(new Set(fetchedModels.map((m) => m.id)))}
                >
                  Select all
                </button>
                <button
                  className="settings-btn-sm"
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="fetched-models-list">
              {fetchedModels.map((m) => (
                <label key={m.id} className="fetched-model-item">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(m.id)}
                    onChange={() => toggleSelected(m.id)}
                  />
                  <span className="fetched-model-id">{m.name ?? m.id}</span>
                  {m.name && m.name !== m.id && <span className="fetched-model-sub">{m.id}</span>}
                </label>
              ))}
            </div>
            <div className="custom-provider-actions">
              <button
                className="settings-btn settings-btn-primary"
                type="button"
                onClick={handleSaveFetched}
                disabled={saving || selectedIds.size === 0 || !providerId.trim()}
              >
                {saving ? "Saving..." : `Add ${selectedIds.size} Selected Model(s)`}
              </button>
            </div>
          </div>
        )}

        <details className="custom-provider-manual">
          <summary className="custom-provider-manual-summary">Or add models manually</summary>

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
        </details>
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
