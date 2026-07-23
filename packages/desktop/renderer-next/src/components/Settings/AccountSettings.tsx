import { useMemo, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { showToast } from "../Toast";
import { canRemoveProviderAuth, deriveProviderIds, resolveProviderId } from "./providerOptions";
import { SettingsSectionIcon } from "./SettingsSectionIcon";

export function AccountSettings() {
  const authStatuses = useStore((state) => state.authStatuses);
  const models = useStore((state) => state.models);
  const customModelsConfig = useStore((state) => state.customModelsConfig);
  const { t } = useI18n();
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const providerIds = useMemo(
    () => deriveProviderIds(models, authStatuses, customModelsConfig),
    [authStatuses, customModelsConfig, models],
  );
  const configuredProviders = Object.entries(authStatuses).filter(([, status]) => status.configured || status.source !== undefined);
  const normalizedProvider = resolveProviderId(provider, providerIds);

  function authSourceLabel(source: (typeof authStatuses)[string]["source"]): string {
    if (!source || source === "stored") return t("stored", "本地存储");
    if (source === "runtime") return t("runtime", "运行时");
    if (source === "environment") return t("environment", "环境变量");
    if (source === "fallback") return t("fallback", "后备配置");
    if (source === "models_json_key") return t("models.json key", "models.json 密钥");
    return t("models.json command", "models.json 命令");
  }

  async function handleSaveKey(event: FormEvent) {
    event.preventDefault();
    const providerId = normalizedProvider;
    if (!providerId || !apiKey.trim()) return;
    setSaving(true);
    try {
      await api.setApiKey(providerId, apiKey.trim());
      showToast(t("API key saved for {provider}", "已保存 {provider} 的 API 密钥", { provider: providerId }), "success");
      setApiKey("");
      useStore.getState().refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveKey(providerName: string) {
    try {
      await api.removeApiKey(providerName);
      showToast(t("API key removed for {provider}", "已移除 {provider} 的 API 密钥", { provider: providerName }), "success");
      useStore.getState().refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">
        <SettingsSectionIcon route="account" />
        {t("Account & API Keys", "账户与 API 密钥")}
      </h3>
      <p className="settings-section-desc">
        {t("Configure model provider API keys. Keys are stored locally.", "配置模型提供商 API 密钥。密钥仅存储在本机。")}
      </p>

      <form className="api-key-form" onSubmit={handleSaveKey}>
        <div className="form-row">
          <label className="form-label" htmlFor="provider-input">{t("Provider", "提供商")}</label>
          <input
            id="provider-input"
            className="form-input"
            list="provider-options"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            placeholder={t("Select or enter a provider ID", "选择或输入提供商 ID")}
            autoComplete="off"
          />
          <datalist id="provider-options">
            {providerIds.map((providerId) => <option key={providerId} value={providerId} />)}
          </datalist>
          <span className="form-hint">
            {t(
              "Providers are derived from available models and local configuration. You can also enter another provider ID.",
              "提供商列表来自可用模型和本地配置，也可以手动输入其他提供商 ID。",
            )}
          </span>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="api-key-input">{t("API Key", "API 密钥")}</label>
          <input
            id="api-key-input"
            className="form-input"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-..."
            autoComplete="off"
          />
        </div>
        <button
          className="settings-btn settings-btn-primary"
          type="submit"
          disabled={!normalizedProvider || !apiKey.trim() || saving}
        >
          {saving ? t("Saving…", "保存中…") : t("Save Key", "保存密钥")}
        </button>
      </form>

      <div className="configured-providers">
        <h4 className="settings-subsection-title">{t("Configured Providers", "已配置的提供商")}</h4>
        {configuredProviders.length === 0 && (
          <div className="settings-empty">{t("No providers configured yet.", "尚未配置提供商。")}</div>
        )}
        {configuredProviders.map(([name, status]) => (
          <div key={name} className="configured-provider-row">
            <div className="configured-provider-info">
              <span className="configured-provider-name">{name}</span>
              <span className="configured-provider-source">{authSourceLabel(status.source)}</span>
            </div>
            {canRemoveProviderAuth(status) ? (
              <button
                className="settings-btn-sm settings-btn-danger"
                type="button"
                onClick={() => handleRemoveKey(name)}
              >
                {t("Remove", "移除")}
              </button>
            ) : (
              <span className="configured-provider-source">{t("Read only", "只读")}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
