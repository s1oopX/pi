import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { CustomModelApi } from "../../ipc/types";
import { useStore } from "../../store";
import { showToast } from "../Toast";
import { buildCustomModelInput, getConnectionTestFailure } from "./settingsLogic";

type AuthKind = "api_key" | "none";

interface ModelDraft {
  id: string;
  name: string;
  reasoning: boolean;
  imageInput: boolean;
  contextWindow: number;
  maxTokens: number;
}

interface ExistingProviderConfig {
  baseUrl?: string;
  headers?: Record<string, string>;
  api?: string;
  authKind?: AuthKind;
  hasStoredAuth?: boolean;
  proxyUrl?: string;
  models?: ExistingModelConfig[];
}

interface ExistingModelConfig {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
}

const API_OPTIONS: CustomModelApi[] = ["openai-completions", "anthropic-messages"];

const EMPTY_MODEL: ModelDraft = {
  id: "",
  name: "",
  reasoning: false,
  imageInput: false,
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

function isCustomModelApi(value: string | undefined): value is CustomModelApi {
  return value === "openai-completions" || value === "anthropic-messages";
}

function modelConfigToDraft(model: ExistingModelConfig): ModelDraft {
  return {
    id: model.id,
    name: model.name ?? "",
    reasoning: Boolean(model.reasoning),
    imageInput: Boolean(model.input?.includes("image")),
    contextWindow: model.contextWindow && model.contextWindow > 0 ? model.contextWindow : EMPTY_MODEL.contextWindow,
    maxTokens: model.maxTokens && model.maxTokens > 0 ? model.maxTokens : EMPTY_MODEL.maxTokens,
  };
}

function formatHeaders(headers: Record<string, string> | undefined): string {
  if (!headers || Object.keys(headers).length === 0) return "";
  return JSON.stringify(headers, null, 2);
}

function parseHeaders(text: string): Record<string, string> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Custom headers must be a JSON object");
  }
  const headers = Object.fromEntries(
    Object.entries(parsed).map(([name, value]) => {
      if (!name.trim()) throw new Error("Custom header names cannot be empty");
      if (typeof value !== "string") throw new Error(`Header "${name}" must be a string`);
      return [name, value];
    }),
  );
  return Object.keys(headers).length > 0 ? headers : undefined;
}

// Some Anthropic-compatible gateways block requests whose User-Agent identifies
// the official Anthropic SDK (returns 403 "Your request was blocked"). The chat
// path uses the Anthropic SDK, which sets a "Anthropic/JS x.x" UA. Overriding it
// via provider headers lets the request through. Only injected when the caller
// has not already supplied a user-agent header.
function withAnthropicUaHeader(
  modelApi: CustomModelApi,
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  if (modelApi !== "anthropic-messages") return headers;
  const hasUa = headers && Object.keys(headers).some((key) => key.toLowerCase() === "user-agent");
  if (hasUa) return headers;
  return { ...(headers ?? {}), "user-agent": "Mozilla/5.0" };
}

function getApiLabel(modelApi: CustomModelApi): string {
  return modelApi === "anthropic-messages" ? "ANTHROPIC" : "OPENAI";
}

export function CustomProviderSettings() {
  const customModelsConfig = useStore((s) => s.customModelsConfig);
  const { resolvedLanguage, t } = useI18n();
  const [providerId, setProviderId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiType, setApiType] = useState<CustomModelApi>("openai-completions");
  const [authKind, setAuthKind] = useState<AuthKind>("api_key");
  const [apiKey, setApiKey] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [customHeadersText, setCustomHeadersText] = useState("");
  const [models, setModels] = useState<ModelDraft[]>([{ ...EMPTY_MODEL }]);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<{ id: string; name?: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fetchedImageInput, setFetchedImageInput] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingOriginalModelIds, setEditingOriginalModelIds] = useState<string[]>([]);

  const existingProviders = customModelsConfig?.providers ?? {};
  const normalizedProviderId = normalizeProviderId(providerId);
  const editingProviderConfig = editingProviderId
    ? (existingProviders[editingProviderId] as ExistingProviderConfig | undefined)
    : undefined;
  const editingHasStoredAuth = Boolean(editingProviderConfig?.hasStoredAuth);
  const isDuplicateProvider = Boolean(
    normalizedProviderId && !editingProviderId && existingProviders[normalizedProviderId],
  );
  const filledModelCount = useMemo(() => models.filter((model) => model.id.trim()).length, [models]);

  function getCustomHeadersOrToast(): Record<string, string> | undefined | null {
    try {
      return withAnthropicUaHeader(apiType, parseHeaders(customHeadersText));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Invalid custom headers: {message}", "自定义请求头无效：{message}", { message }), "error");
      return null;
    }
  }

  function getProviderOrToast(): string | undefined {
    if (!normalizedProviderId) {
      showToast(
        t(
          "Provider name must contain latin letters or digits (e.g. baibei). Chinese-only names become empty after normalization.",
          "提供商名称必须包含拉丁字母或数字（例如 baibei）。纯中文名称规范化后会变为空。",
        ),
        "error",
      );
      return undefined;
    }
    if (isDuplicateProvider) {
      showToast(t("Duplicate provider name", "提供商名称重复"), "error");
      return undefined;
    }
    return normalizedProviderId;
  }

  function validateEndpointFields(): boolean {
    if (!baseUrl.trim()) {
      showToast(t("Base URL is required", "必须填写基础 URL"), "error");
      return false;
    }
    if (authKind === "api_key" && !apiKey.trim() && !editingHasStoredAuth) {
      showToast(t("Auth value is required", "必须填写认证值"), "error");
      return false;
    }
    return true;
  }

  function getStoredAuthProvider(provider: string): string | undefined {
    return editingProviderId === provider && !apiKey.trim() && editingHasStoredAuth ? provider : undefined;
  }

  async function handleFetchModels() {
    const provider = getProviderOrToast();
    const headers = getCustomHeadersOrToast();
    if (!provider || !validateEndpointFields() || headers === null) return;

    setFetching(true);
    setFetchedModels([]);
    setSelectedIds(new Set());
    setFetchedImageInput(false);
    try {
      const result = await api.fetchProviderModels({
        provider,
        baseUrl: baseUrl.trim(),
        api: apiType,
        apiKey: authKind === "api_key" ? apiKey.trim() || undefined : undefined,
        headers,
        useStoredAuthProvider: getStoredAuthProvider(provider),
        preserveHeadersFromProvider: editingProviderId ?? undefined,
        proxyUrl: proxyUrl.trim() || undefined,
      });
      if (result.models.length === 0) {
        showToast(t("Endpoint returned no models", "端点未返回任何模型"), "error");
      } else {
        setFetchedModels(result.models);
        setSelectedIds(new Set(result.models.map((model) => model.id)));
        showToast(t("Found {count} model(s)", "找到 {count} 个模型", { count: result.models.length }), "success");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Fetch failed: {message}", "获取失败：{message}", { message }), "error");
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
    const provider = getProviderOrToast();
    const headers = getCustomHeadersOrToast();
    if (!provider || !validateEndpointFields() || headers === null) return;

    const chosen = fetchedModels.filter((model) => selectedIds.has(model.id));
    if (chosen.length === 0) {
      showToast(t("Select at least one model", "请至少选择一个模型"), "error");
      return;
    }
    setSaving(true);
    try {
      for (const model of chosen) {
        await api.upsertCustomModel({
          provider,
          baseUrl: baseUrl.trim(),
          api: apiType,
          authKind,
          apiKey: authKind === "api_key" ? apiKey.trim() || undefined : undefined,
          headers,
          proxyUrl: proxyUrl.trim(),
          model: {
            id: model.id,
            name: model.name,
            reasoning: apiType === "anthropic-messages" || undefined,
            input: buildCustomModelInput(fetchedImageInput),
            contextWindow: 200000,
            maxTokens: 16384,
          },
        });
      }
      showToast(
        t("Saved {count} model(s) to \"{provider}\"", "已将 {count} 个模型保存到“{provider}”", {
          count: chosen.length,
          provider,
        }),
        "success",
      );
      useStore.getState().refresh();
      setFetchedModels([]);
      setSelectedIds(new Set());
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Save failed: {message}", "保存失败：{message}", { message }), "error");
    } finally {
      setSaving(false);
    }
  }

  function addModel() {
    setModels((prev) => [...prev, { ...EMPTY_MODEL }]);
  }

  function removeModel(index: number) {
    setModels((prev) => {
      const next = prev.filter((_, modelIndex) => modelIndex !== index);
      return next.length > 0 ? next : [{ ...EMPTY_MODEL }];
    });
  }

  function updateModel<Field extends keyof ModelDraft>(index: number, field: Field, value: ModelDraft[Field]) {
    setModels((prev) => prev.map((model, modelIndex) => (modelIndex === index ? { ...model, [field]: value } : model)));
  }

  async function handleTest() {
    const provider = getProviderOrToast();
    const headers = getCustomHeadersOrToast();
    if (!provider || !validateEndpointFields() || headers === null) return;

    const firstModel = models.find((model) => model.id.trim());
    if (!firstModel) {
      showToast(t("Fill in at least one Model ID to test", "请填写至少一个模型 ID 后再测试"), "error");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testCustomModel({
        provider,
        baseUrl: baseUrl.trim(),
        api: apiType,
        apiKey: authKind === "api_key" ? apiKey.trim() || undefined : undefined,
        headers,
        modelId: firstModel.id.trim(),
        useStoredAuthProvider: getStoredAuthProvider(provider),
        preserveHeadersFromProvider: editingProviderId ?? undefined,
        proxyUrl: proxyUrl.trim() || undefined,
      });
      const failure = getConnectionTestFailure(result, resolvedLanguage);
      if (failure) {
        setTestResult("error");
        showToast(t("Test failed: {message}", "测试失败：{message}", { message: failure }), "error");
        return;
      }
      setTestResult("success");
      showToast(t("Connection successful!", "连接成功！"), "success");
    } catch (error) {
      setTestResult("error");
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Test failed: {message}", "测试失败：{message}", { message }), "error");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    const provider = getProviderOrToast();
    const headers = getCustomHeadersOrToast();
    if (!provider || !validateEndpointFields() || headers === null) return;

    const validModels = models
      .map((model, index) => ({ model, index }))
      .filter(({ model }) => model.id.trim());
    if (validModels.length === 0) {
      showToast(t("At least one model with an ID is required", "至少需要一个带 ID 的模型"), "error");
      return;
    }

    setSaving(true);
    try {
      const savedModelIds = new Set<string>();
      const replacedOriginalModelIds = new Set<string>();
      for (const { model, index } of validModels) {
        const modelId = model.id.trim();
        const replaceModelId = editingProviderId === provider ? editingOriginalModelIds[index]?.trim() : undefined;
        savedModelIds.add(modelId);
        if (replaceModelId && replaceModelId !== modelId) {
          replacedOriginalModelIds.add(replaceModelId);
        }
        await api.upsertCustomModel({
          provider,
          baseUrl: baseUrl.trim(),
          api: apiType,
          authKind,
          apiKey: authKind === "api_key" ? apiKey.trim() || undefined : undefined,
          headers,
          proxyUrl: proxyUrl.trim(),
          replaceModelId,
          model: {
            id: modelId,
            name: model.name.trim() || undefined,
            reasoning: model.reasoning || undefined,
            input: buildCustomModelInput(model.imageInput),
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
          },
        });
      }
      if (editingProviderId === provider) {
        const removedModelIds = editingOriginalModelIds.filter(
          (modelId) => modelId && !savedModelIds.has(modelId) && !replacedOriginalModelIds.has(modelId),
        );
        for (const modelId of removedModelIds) {
          await api.removeCustomModel(provider, modelId, false);
        }
      }
      showToast(
        t(
          editingProviderId === provider
            ? "Provider \"{provider}\" updated with {count} model(s)"
            : "Provider \"{provider}\" saved with {count} model(s)",
          editingProviderId === provider
            ? "提供商“{provider}”已更新，共 {count} 个模型"
            : "提供商“{provider}”已保存，共 {count} 个模型",
          { provider, count: validModels.length },
        ),
        "success",
      );
      useStore.getState().refresh();
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Save failed: {message}", "保存失败：{message}", { message }), "error");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setEditingProviderId(null);
    setEditingOriginalModelIds([]);
    setProviderId("");
    setBaseUrl("");
    setApiType("openai-completions");
    setAuthKind("api_key");
    setApiKey("");
    setProxyUrl("");
    setCustomHeadersText("");
    setModels([{ ...EMPTY_MODEL }]);
    setTestResult(null);
    setFetchedModels([]);
    setSelectedIds(new Set());
    setFetchedImageInput(false);
  }

  function editProvider(name: string, config: ExistingProviderConfig) {
    const existingModels = config.models ?? [];
    setEditingProviderId(name);
    setEditingOriginalModelIds(existingModels.map((model) => model.id));
    setProviderId(name);
    setBaseUrl(config.baseUrl ?? "");
    setApiType(isCustomModelApi(config.api) ? config.api : "openai-completions");
    setAuthKind(config.authKind ?? (config.hasStoredAuth ? "api_key" : "none"));
    setApiKey("");
    setProxyUrl(config.proxyUrl ?? "");
    setCustomHeadersText(formatHeaders(config.headers));
    setModels(existingModels.length > 0 ? existingModels.map(modelConfigToDraft) : [{ ...EMPTY_MODEL }]);
    setFetchedModels([]);
    setSelectedIds(new Set());
    setFetchedImageInput(false);
    setTestResult(null);
    showToast(
      t("Editing {provider}. Existing API key is preserved unless replaced.", "正在编辑 {provider}。不填写新密钥则保留原密钥。", {
        provider: name,
      }),
      "info",
    );
  }

  async function handleDeleteProvider() {
    if (!editingProviderId) return;
    const confirmed = window.confirm(
      t(
        "Delete provider \"{provider}\" and all of its models?",
        "删除提供商“{provider}”及其所有模型？",
        { provider: editingProviderId },
      ),
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      await api.removeCustomProvider(editingProviderId, true);
      showToast(t("Deleted provider {provider}", "已删除提供商 {provider}", { provider: editingProviderId }), "success");
      useStore.getState().refresh();
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Delete failed: {message}", "删除失败：{message}", { message }), "error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRemoveProviderModel(provider: string, modelId: string) {
    try {
      await api.removeCustomModel(provider, modelId, true);
      showToast(t("Removed {model} from {provider}", "已从 {provider} 移除 {model}", { model: modelId, provider }), "success");
      useStore.getState().refresh();
      if (editingProviderId === provider) {
        setModels((prev) => {
          const next = prev.filter((model) => model.id !== modelId);
          return next.length > 0 ? next : [{ ...EMPTY_MODEL }];
        });
        setEditingOriginalModelIds((prev) => prev.filter((id) => id !== modelId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Remove failed: {message}", "移除失败：{message}", { message }), "error");
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("Custom Providers", "自定义提供商")}</h3>
      <p className="settings-section-desc">
        {t(
          "Connect third-party OpenAI-compatible or Anthropic-compatible API endpoints.",
          "连接第三方 OpenAI 兼容或 Anthropic 兼容 API 端点。",
        )}
      </p>

      <div className="custom-provider-editor">
        <div className="custom-provider-editor-header">
          <div className="custom-provider-title-group">
            <span className="custom-provider-disclosure" aria-hidden="true">
              ▾
            </span>
            <span className="custom-provider-editor-title">
              {editingProviderId
                ? t("Edit {provider}", "编辑 {provider}", { provider: editingProviderId })
                : t("New Provider", "新建提供商")}
            </span>
            <span className="custom-provider-api-badge">{getApiLabel(apiType)}</span>
            <span className="custom-provider-model-count">
              {t("{count} models", "{count} 个模型", { count: filledModelCount })}
            </span>
          </div>
          {(isDuplicateProvider || (authKind === "api_key" && !apiKey.trim() && !editingHasStoredAuth)) && (
            <span className="custom-provider-warning-dot" aria-label={t("Needs attention", "需要处理")} />
          )}
        </div>

        <div className="custom-provider-editor-body">
          <div className="form-row">
            <label className="form-label" htmlFor="cp-provider-id">
              {t("Name", "名称")}
            </label>
            <input
              id="cp-provider-id"
              className="form-input"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              disabled={editingProviderId !== null}
              placeholder={t("New Provider", "New Provider")}
            />
            {isDuplicateProvider && <span className="form-hint form-hint-error">{t("Duplicate provider name", "提供商名称重复")}</span>}
            {editingProviderId && (
              <span className="form-hint">
                {t(
                  "Provider name is locked while editing. Delete this provider and create a new one to rename it.",
                  "编辑时提供商名称已锁定。如需改名，请删除后新建。",
                )}
              </span>
            )}
            {providerId.trim() && normalizedProviderId !== providerId.trim() && (
              <span className={`form-hint ${normalizedProviderId ? "" : "form-hint-error"}`}>
                {normalizedProviderId
                  ? t("Will be saved as \"{provider}\"", "将保存为“{provider}”", { provider: normalizedProviderId })
                  : t(
                      "This name has no latin letters or digits, so it becomes empty. Use something like baibei.",
                      "此名称不含拉丁字母或数字，规范化后会变为空。请使用类似 baibei 的名称。",
                    )}
              </span>
            )}
          </div>

          <div className="custom-provider-grid-2">
            <div className="form-row">
              <label className="form-label" htmlFor="cp-api-type">
                {t("Type", "类型")}
              </label>
              <select
                id="cp-api-type"
                className="form-select"
                value={apiType}
                onChange={(event) => setApiType(event.target.value as CustomModelApi)}
              >
                {API_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === "openai-completions" ? "openai" : "anthropic"}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <label className="form-label" htmlFor="cp-auth-kind">
                {t("Auth Kind", "认证方式")}
              </label>
              <select
                id="cp-auth-kind"
                className="form-select"
                value={authKind}
                onChange={(event) => setAuthKind(event.target.value as AuthKind)}
              >
                <option value="api_key">{t("API Key", "API Key")}</option>
                <option value="none">{t("None", "无")}</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="cp-base-url">
              {t("Base URL", "基础 URL")}
            </label>
            <input
              id="cp-base-url"
              className="form-input"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={t("https://api.example.com", "https://api.example.com")}
            />
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="cp-api-key">
              {t("Auth Value", "认证值")}
            </label>
            <div className="input-with-toggle">
              <input
                id="cp-api-key"
                className="form-input"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={authKind === "api_key" ? t("sk-... or $ENV_VAR or !command", "sk-... 或 $ENV_VAR 或 !command") : ""}
                autoComplete="off"
                disabled={authKind === "none"}
              />
              <button
                className="input-toggle-btn"
                type="button"
                onClick={() => setShowKey((value) => !value)}
                disabled={authKind === "none"}
                aria-label={showKey ? t("Hide API key", "隐藏 API 密钥") : t("Show API key", "显示 API 密钥")}
                title={showKey ? t("Hide", "隐藏") : t("Show", "显示")}
              >
                {showKey ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
                    <path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
                    <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
                    <path d="m2 2 20 20" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
                    <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                )}
              </button>
            </div>
            {authKind === "api_key" && !apiKey.trim() && !editingHasStoredAuth && (
              <span className="form-hint form-hint-error">{t("Auth value is required", "必须填写认证值")}</span>
            )}
            {authKind === "api_key" && editingHasStoredAuth && !apiKey.trim() && (
              <span className="form-hint">
                {t("Leave empty to keep the existing saved key.", "留空则保留现有已保存密钥。")}
              </span>
            )}
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="cp-proxy-url">
              {t("Proxy URL (optional)", "代理 URL（可选）")}
            </label>
            <input
              id="cp-proxy-url"
              className="form-input"
              value={proxyUrl}
              onChange={(event) => setProxyUrl(event.target.value)}
              placeholder="http://127.0.0.1:8080"
            />
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="cp-custom-headers">
              {t("Custom Headers (optional, JSON)", "自定义请求头（可选，JSON）")}
            </label>
            <textarea
              id="cp-custom-headers"
              className="form-input custom-headers-input"
              value={customHeadersText}
              onChange={(event) => setCustomHeadersText(event.target.value)}
              placeholder='{"anthropic-beta": "interleaved-thinking-2025-05-14"}'
              spellCheck={false}
            />
          </div>

          <div className="custom-provider-models">
            <div className="custom-provider-models-header">
              <span className="form-label">{t("Models ({count})", "模型（{count}）", { count: filledModelCount })}</span>
              <div className="custom-provider-model-actions">
                <button className="settings-btn-sm" type="button" onClick={handleFetchModels} disabled={fetching || saving}>
                  {fetching ? t("Fetching…", "获取中…") : t("↧ Fetch", "↧ 获取")}
                </button>
                <button className="settings-btn-sm" type="button" onClick={addModel} disabled={saving}>
                  {t("+ Add Model", "+ 添加模型")}
                </button>
              </div>
            </div>

            {models.map((model, index) => (
              <div key={index} className="custom-model-row">
                <div className="custom-model-fields">
                  <input
                    className="form-input form-input-sm"
                    value={model.id}
                    onChange={(event) => updateModel(index, "id", event.target.value)}
                    placeholder={t("Model ID (required)", "模型 ID（必填）")}
                  />
                  <input
                    className="form-input form-input-sm"
                    value={model.name}
                    onChange={(event) => updateModel(index, "name", event.target.value)}
                    placeholder={t("Display name (optional)", "显示名称（可选）")}
                  />
                  <div className="custom-model-options">
                    <label className="settings-toggle-inline">
                      <input
                        type="checkbox"
                        checked={model.reasoning}
                        onChange={(event) => updateModel(index, "reasoning", event.target.checked)}
                      />
                      <span>{t("Reasoning", "推理")}</span>
                    </label>
                    <label className="settings-toggle-inline">
                      <input
                        type="checkbox"
                        checked={model.imageInput}
                        onChange={(event) => updateModel(index, "imageInput", event.target.checked)}
                      />
                      <span>{t("Image input", "图片输入")}</span>
                    </label>
                    <input
                      className="form-input form-input-num"
                      type="number"
                      value={model.contextWindow}
                      onChange={(event) => updateModel(index, "contextWindow", Number(event.target.value))}
                      title={t("Context window", "上下文窗口")}
                    />
                    <input
                      className="form-input form-input-num"
                      type="number"
                      value={model.maxTokens}
                      onChange={(event) => updateModel(index, "maxTokens", Number(event.target.value))}
                      title={t("Max output tokens", "最大输出 token 数")}
                    />
                  </div>
                </div>
                <button
                  className="settings-btn-sm settings-btn-danger"
                  type="button"
                  onClick={() => removeModel(index)}
                  disabled={saving || models.length === 1}
                  aria-label={t("Remove model", "移除模型")}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          {fetchedModels.length > 0 && (
            <div className="fetched-models">
              <div className="fetched-models-header">
                <label className="form-label">
                  {t("Available Models ({selected}/{total} selected)", "可用模型（已选 {selected}/{total}）", {
                    selected: selectedIds.size,
                    total: fetchedModels.length,
                  })}
                </label>
                <div className="fetched-models-bulk">
                  <button className="settings-btn-sm" type="button" onClick={() => setSelectedIds(new Set(fetchedModels.map((model) => model.id)))}>
                    {t("Select all", "全选")}
                  </button>
                  <button className="settings-btn-sm" type="button" onClick={() => setSelectedIds(new Set())}>
                    {t("Clear", "清除")}
                  </button>
                </div>
              </div>
              <div className="fetched-models-list">
                {fetchedModels.map((model) => (
                  <label key={model.id} className="fetched-model-item">
                    <input type="checkbox" checked={selectedIds.has(model.id)} onChange={() => toggleSelected(model.id)} />
                    <span className="fetched-model-id">{model.name ?? model.id}</span>
                    {model.name && model.name !== model.id && <span className="fetched-model-sub">{model.id}</span>}
                  </label>
                ))}
              </div>
              <div className="custom-provider-actions">
                <label className="settings-toggle-inline">
                  <input
                    type="checkbox"
                    checked={fetchedImageInput}
                    onChange={(event) => setFetchedImageInput(event.target.checked)}
                  />
                  <span>{t("Selected models support image input", "所选模型支持图片输入")}</span>
                </label>
                <button
                  className="settings-btn settings-btn-primary"
                  type="button"
                  onClick={handleSaveFetched}
                  disabled={saving || selectedIds.size === 0}
                >
                  {saving
                    ? t("Saving…", "保存中…")
                    : t("Add {count} Selected Model(s)", "添加所选的 {count} 个模型", { count: selectedIds.size })}
                </button>
              </div>
            </div>
          )}

          <div className="custom-provider-footer">
            <div className="custom-provider-footer-left">
              {editingProviderId && (
                <button className="settings-btn settings-btn-danger-link" type="button" onClick={handleDeleteProvider} disabled={saving || deleting}>
                  {deleting ? t("Deleting…", "删除中…") : t("Delete", "删除")}
                </button>
              )}
            </div>
            <div className="custom-provider-footer-right">
              <button className="settings-btn" type="button" onClick={handleTest} disabled={testing || saving}>
                {testing ? t("Testing…", "测试中…") : t("Test", "测试")}
              </button>
              {testResult && (
                <span className={`test-result test-result-${testResult}`}>
                  {testResult === "success" ? t("Reachable", "可连接") : t("Failed", "失败")}
                </span>
              )}
              <button className="settings-btn" type="button" onClick={resetForm} disabled={saving || deleting}>
                {t("Reset", "重置")}
              </button>
              <button className="settings-btn settings-btn-primary" type="button" onClick={handleSave} disabled={saving || deleting}>
                {saving ? t("Saving…", "保存中…") : t("Save", "保存")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {Object.keys(existingProviders).length > 0 && (
        <div className="existing-custom-providers">
          <h4 className="settings-subsection-title">{t("Existing Custom Providers", "现有自定义提供商")}</h4>
          {Object.entries(existingProviders).map(([name, config]) => {
            const providerConfig = config as ExistingProviderConfig;
            return (
              <div key={name} className="existing-provider-card">
                <div className="existing-provider-header">
                  <span className="existing-provider-copy">
                    <span className="existing-provider-name">{name}</span>
                    <span className="existing-provider-meta">
                      {providerConfig.api ?? t("unknown", "未知")} &middot; {providerConfig.baseUrl ?? t("no url", "无 URL")}
                    </span>
                  </span>
                  <button className="settings-btn-sm" type="button" disabled={saving} onClick={() => editProvider(name, providerConfig)}>
                    {editingProviderId === name ? t("Editing", "编辑中") : t("Edit", "编辑")}
                  </button>
                </div>
                {providerConfig.models && providerConfig.models.length > 0 && (
                  <div className="existing-provider-models">
                    {providerConfig.models.map((model) => (
                      <div key={model.id} className="existing-model-chip">
                        <span>{model.name ?? model.id}</span>
                        <button
                          className="chip-remove"
                          type="button"
                          onClick={() => handleRemoveProviderModel(name, model.id)}
                          aria-label={t("Remove {model}", "移除 {model}", { model: model.id })}
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
