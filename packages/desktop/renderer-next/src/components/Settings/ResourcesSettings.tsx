import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { ResourcesData } from "../../ipc/types";
import { useStore } from "../../store";
import { getResourceSourceLabel } from "./resourceLabels";

interface ResourceGroupProps {
  title: string;
  emptyText: string;
  items: ResourcesData["extensions"];
}

function ResourceGroup({ title, emptyText, items }: ResourceGroupProps) {
  const { resolvedLanguage, t } = useI18n();

  function scopeLabel(scope: ResourcesData["extensions"][number]["sourceInfo"]["scope"]): string {
    if (scope === "user") return t("user", "用户");
    if (scope === "project") return t("project", "项目");
    return t("temporary", "临时");
  }

  return (
    <section className="resource-group">
      <div className="resource-group-heading">
        <h4 className="settings-subsection-title">{title}</h4>
        <span className="resource-count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="settings-empty">{emptyText}</div>
      ) : (
        <div className="resource-list">
          {items.map((item) => (
            <div className="resource-row" key={`${item.sourceInfo.source}:${item.path}:${item.name}`}>
              <div className="resource-copy">
                <span className="resource-name">{item.name}</span>
                {item.description && <span className="resource-description">{item.description}</span>}
                <span className="resource-path" title={item.path}>{item.path}</span>
              </div>
              <span className="resource-source">
                {scopeLabel(item.sourceInfo.scope)} · {getResourceSourceLabel(item.sourceInfo.source, resolvedLanguage)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ResourcesSettings() {
  const workspaceCwd = useStore((state) => state.workspaceCwd);
  const backendReady = useStore((state) => state.backendStatus.ready);
  const isStreaming = useStore((state) => state.isStreaming);
  const isCompacting = useStore((state) => Boolean(state.session?.isCompacting || state.compactionActivity));
  const { t } = useI18n();
  const [resources, setResources] = useState<ResourcesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadResources = useCallback(async (reload: boolean, clearExisting: boolean) => {
    const requestId = ++requestIdRef.current;
    if (clearExisting) {
      setResources(null);
      setStale(false);
    } else if (reload) {
      setStale(true);
    }
    if (!backendReady) {
      setLoading(false);
      if (clearExisting) setResources(null);
      setError(t("The agent backend is offline.", "智能体后端当前离线。"));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextResources = await api.getResources({ reload });
      if (requestId === requestIdRef.current) {
        setResources(nextResources);
        setStale(false);
        if (reload) await useStore.getState().refreshAsync();
      }
    } catch (loadError: unknown) {
      if (requestId === requestIdRef.current) {
        if (clearExisting) setResources(null);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [backendReady, t]);

  function resourceKindLabel(resource: ResourcesData["diagnostics"][number]["resource"]): string {
    if (resource === "extension") return t("extension", "扩展");
    if (resource === "skill") return t("skill", "技能");
    return t("prompt", "提示词");
  }

  useEffect(() => {
    void loadResources(false, true);
    return () => {
      requestIdRef.current++;
    };
  }, [loadResources, workspaceCwd]);

  const resourceReloadDisabled = loading || !backendReady || isStreaming || isCompacting;
  const reloadUnavailableTitle = isStreaming
    ? t("Wait for the current response to finish before reloading resources.", "请等待当前响应完成后再重新加载资源。")
    : isCompacting
      ? t("Wait for compaction to finish before reloading resources.", "请等待压缩完成后再重新加载资源。")
      : !backendReady
        ? t("The agent backend is offline.", "智能体后端当前离线。")
        : undefined;

  return (
    <div className="settings-section">
      <div className="resources-heading">
        <div>
          <h3 className="settings-section-title">
            <SettingsSectionIcon route="resources" />
            {t("Resources", "资源")}
          </h3>
          <p className="settings-section-desc">
            {t(
              "Read-only resources loaded for the current workspace.",
              "当前工作区已加载资源的只读视图。",
            )}
          </p>
        </div>
        <button
          className="settings-btn-sm"
          type="button"
          disabled={resourceReloadDisabled}
          title={reloadUnavailableTitle}
          onClick={() => void loadResources(true, false)}
        >
          {loading ? t("Loading…", "加载中…") : t("Refresh", "刷新")}
        </button>
      </div>

      {loading && !resources && (
        <div className="resource-loading" role="status">
          {t("Loading resources for this workspace...", "正在加载此工作区的资源...")}
        </div>
      )}

      {stale && resources && (
        <div className="resource-stale" role="status">
          {t("Refreshing resources. Current data may be stale.", "正在刷新资源。当前数据可能已过期。")}
        </div>
      )}

      {error && (
        <div className="resource-load-error" role="alert">
          <strong>{t("Could not load resources", "无法加载资源")}</strong>
          <span>{error}</span>
          <button
            className="settings-btn-sm"
            type="button"
            disabled={resourceReloadDisabled}
            title={reloadUnavailableTitle}
            onClick={() => void loadResources(true, false)}
          >
            {t("Retry", "重试")}
          </button>
        </div>
      )}

      {resources && (
        <>
          {resources.diagnostics.length > 0 && (
            <section className="resource-diagnostics" aria-label={t("Resource diagnostics", "资源诊断")}>
              <h4 className="settings-subsection-title">{t("Load diagnostics", "加载诊断")}</h4>
              {resources.diagnostics.map((diagnostic, index) => (
                <div className={`resource-diagnostic ${diagnostic.type}`} key={`${diagnostic.resource}:${diagnostic.path ?? index}:${diagnostic.message}`}>
                  <span className="resource-diagnostic-kind">{resourceKindLabel(diagnostic.resource)}</span>
                  <span>{diagnostic.message}</span>
                  {diagnostic.path && <span className="resource-path">{diagnostic.path}</span>}
                </div>
              ))}
            </section>
          )}

          <ResourceGroup
            title={t("Extensions", "扩展")}
            emptyText={t("No extensions loaded.", "未加载扩展。")}
            items={resources.extensions}
          />
          <ResourceGroup
            title={t("Skills", "技能")}
            emptyText={t("No skills loaded.", "未加载技能。")}
            items={resources.skills}
          />
          <ResourceGroup
            title={t("Prompt templates", "提示词模板")}
            emptyText={t("No prompt templates loaded.", "未加载提示词模板。")}
            items={resources.prompts}
          />
        </>
      )}
    </div>
  );
}
