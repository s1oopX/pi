import { useState } from "react";
import { useI18n } from "../../i18n";
import { useStore } from "../../store";
import * as api from "../../ipc/api";
import { showToast } from "../Toast";
import type { AuthStatus, Model } from "../../ipc/types";
import { SettingsSectionIcon } from "./SettingsSectionIcon";
import {
  createModelConfigBackup,
  getConnectionTestFailure,
  readModelConfigBackupProviders,
} from "./settingsLogic";

export function ModelSettings() {
  const models = useStore((s) => s.models);
  const session = useStore((s) => s.session);
  const authStatuses = useStore((s) => s.authStatuses);
  const customModelsConfig = useStore((s) => s.customModelsConfig);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImportProviders, setPendingImportProviders] = useState<Record<string, unknown> | null>(null);
  const [removeOrphanStoredAuth, setRemoveOrphanStoredAuth] = useState(false);
  const { resolvedLanguage, t } = useI18n();
  const currentModel = session?.model;

  const grouped = groupByProvider(models);

  async function handleSelectModel(provider: string, modelId: string) {
    try {
      await api.setModel(provider, modelId);
      useStore.getState().refresh();
      showToast(t("Switched to {model}", "已切换到 {model}", { model: modelId }), "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showToast(t("Failed to switch model: {message}", "切换模型失败：{message}", { message }), "error");
    }
  }

  async function handleTestModel(provider: string, modelId: string) {
    try {
      const result = await api.testModel(provider, modelId);
      const failure = getConnectionTestFailure(result, resolvedLanguage);
      if (failure) {
        showToast(t("Test failed: {message}", "测试失败：{message}", { message: failure }), "error");
        return;
      }
      showToast(t("{model} is reachable", "{model} 可连接", { model: modelId }), "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showToast(t("Test failed: {message}", "测试失败：{message}", { message }), "error");
    }
  }

  async function handleExportConfig() {
    if (!customModelsConfig || exporting) return;
    setExporting(true);
    try {
      const result = await api.saveModelBackup(createModelConfigBackup(customModelsConfig.providers));
      if (result.saved) {
        showToast(t(
          "Model configuration exported to {path}",
          "模型配置已导出到 {path}",
          { path: result.path ?? t("the selected file", "所选文件") },
        ), "success");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Export failed: {message}", "导出失败：{message}", { message }), "error");
    } finally {
      setExporting(false);
    }
  }

  async function handleChooseImport() {
    if (importing) return;
    try {
      const result = await api.openModelBackup();
      if (!result.opened) return;
      const providers = readModelConfigBackupProviders(result.backup);
      if (!providers) {
        showToast(t("Import failed: unsupported model configuration backup", "导入失败：不支持的模型配置备份"), "error");
        return;
      }
      setPendingImportProviders(providers);
      setRemoveOrphanStoredAuth(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Import failed: {message}", "导入失败：{message}", { message }), "error");
    }
  }

  async function handleConfirmImport() {
    if (!pendingImportProviders || importing) return;
    setImporting(true);
    try {
      await api.replaceCustomModels(pendingImportProviders, { removeOrphanStoredAuth });
      setPendingImportProviders(null);
      useStore.getState().refresh();
      showToast(t("Model configuration imported", "模型配置已导入"), "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Import failed: {message}", "导入失败：{message}", { message }), "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">
        <SettingsSectionIcon route="models-providers" />
        {t("Models & Providers", "模型与提供商")}
      </h3>
      <p className="settings-section-desc">
        {t("Select the active model or manage provider authentication.", "选择当前模型或管理提供商认证。")}
      </p>

      {Object.entries(grouped).map(([provider, providerModels]) => (
        <div key={provider} className="model-provider-group">
          <div className="model-provider-header">
            <span className="model-provider-name">{provider}</span>
            <AuthBadge status={authStatuses[provider]} />
          </div>
          <div className="model-provider-list">
            {providerModels.map((m) => {
              const isActive = m.provider === currentModel?.provider && m.id === currentModel?.id;
              return (
                <div key={m.id} className={`model-settings-row ${isActive ? "active" : ""}`}>
                  <div className="model-settings-info">
                    <span className="model-settings-name">{m.name ?? m.id}</span>
                    {m.reasoning && <span className="model-tag">{t("reasoning", "推理")}</span>}
                    {m.contextWindow && (
                      <span className="model-tag">{Math.round(m.contextWindow / 1000)}k ctx</span>
                    )}
                  </div>
                  <div className="model-settings-actions">
                    <button
                      className="settings-btn-sm"
                      type="button"
                      onClick={() => handleTestModel(m.provider, m.id)}
                    >
                      {t("Test", "测试")}
                    </button>
                    <button
                      className="settings-btn-sm settings-btn-primary"
                      type="button"
                      disabled={isActive}
                      onClick={() => handleSelectModel(m.provider, m.id)}
                    >
                      {isActive ? t("Active", "当前") : t("Use", "使用")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {models.length === 0 && (
        <div className="settings-empty">
          {t("No models available. Configure a provider API key in the Account tab.", "没有可用模型。请在“账户”页配置提供商 API 密钥。")}
        </div>
      )}

      <div className="settings-group">
        <span className="settings-group-label">{t("Model Configuration Backup", "模型配置备份")}</span>
        <p className="settings-group-desc">
          {t("Export or replace custom provider and model definitions. API keys are not included.", "导出或替换自定义提供商与模型定义，不包含 API 密钥。")}
        </p>
        <div className="about-actions">
          <button
            className="settings-btn"
            type="button"
            disabled={importing}
            onClick={handleChooseImport}
          >
            {t("Import…", "导入…")}
          </button>
          <button
            className="settings-btn"
            type="button"
            disabled={exporting || customModelsConfig === null}
            onClick={handleExportConfig}
          >
            {exporting ? t("Exporting…", "导出中…") : t("Export…", "导出…")}
          </button>
        </div>

        {pendingImportProviders && (
          <div className="settings-empty">
            <p>
              {t(
                "Replace the current custom model configuration with {count} provider(s)? Existing custom providers not in the backup will be removed.",
                "要用 {count} 个提供商替换当前自定义模型配置吗？备份中不存在的现有自定义提供商将被移除。",
                { count: Object.keys(pendingImportProviders).length },
              )}
            </p>
            <label className="settings-toggle" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={removeOrphanStoredAuth}
                disabled={importing}
                onChange={(event) => setRemoveOrphanStoredAuth(event.target.checked)}
              />
              <span>
                {t(
                  "Also remove stored API keys for providers that disappear after import",
                  "同时移除导入后不再存在的提供商所存储的 API 密钥",
                )}
              </span>
            </label>
            <div className="about-actions">
              <button
                className="settings-btn"
                type="button"
                disabled={importing}
                onClick={() => {
                  setPendingImportProviders(null);
                  setRemoveOrphanStoredAuth(false);
                }}
              >
                {t("Cancel", "取消")}
              </button>
              <button
                className="settings-btn settings-btn-danger"
                type="button"
                disabled={importing}
                onClick={handleConfirmImport}
              >
                {importing ? t("Importing…", "导入中…") : t("Replace and Import", "替换并导入")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AuthBadge({ status }: { status: AuthStatus | undefined }) {
  const { t } = useI18n();
  if (!status) return null;
  const available = status.configured || status.source !== undefined;
  let configuredLabel = t("configured", "已配置");
  if (status.source === "stored") configuredLabel = t("stored", "本地存储");
  else if (status.source === "runtime") configuredLabel = t("runtime", "运行时");
  else if (status.source === "environment") configuredLabel = t("environment", "环境变量");
  else if (status.source === "fallback") configuredLabel = t("fallback", "后备配置");
  else if (status.source === "models_json_key") configuredLabel = t("models.json key", "models.json 密钥");
  else if (status.source === "models_json_command") configuredLabel = t("models.json command", "models.json 命令");
  return (
    <span className={`auth-badge ${available ? "configured" : "not-configured"}`}>
      {available
        ? `✓ ${configuredLabel}`
        : t("Not configured", "未配置")}
    </span>
  );
}

function groupByProvider(models: Model[]): Record<string, Model[]> {
  const groups: Record<string, Model[]> = {};
  for (const m of models) {
    (groups[m.provider] ??= []).push(m);
  }
  return groups;
}
