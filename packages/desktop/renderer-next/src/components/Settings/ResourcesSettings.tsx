import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { SettingsSectionIcon } from "./SettingsSectionIcon";
import * as api from "../../ipc/api";
import type { ResourcesData } from "../../ipc/types";
import { useStore } from "../../store";
import { showToast } from "../Toast";
import { getResourceSourceLabel } from "./resourceLabels";
import { TrustedFoldersSettings } from "./TrustedFoldersSettings";

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
  const [packageSource, setPackageSource] = useState("");
  const [packageScope, setPackageScope] = useState<"user" | "project">("user");
  const [packageOperation, setPackageOperation] = useState<{ action: "install" | "remove"; source: string } | null>(null);
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

  async function handlePackageAction(
    action: "install" | "remove",
    source: string,
    scope: "user" | "project",
    updating = false,
  ) {
    const normalizedSource = source.trim();
    if (!normalizedSource) return;
    const confirmed = window.confirm(
      action === "remove"
        ? t(
            "Remove package \"{source}\" from {scope} settings?",
            "从{scope}设置中移除包“{source}”？",
            { source: normalizedSource, scope: scope === "project" ? t("project", "项目") : t("user", "用户") },
          )
        : t(
            "{action} package \"{source}\"? Packages can execute arbitrary code with full system access. Review the source first.",
            "{action}包“{source}”？包可通过完整系统权限执行任意代码，请先审查来源。",
            {
              action: updating ? t("Update", "更新") : t("Install", "安装"),
              source: normalizedSource,
            },
          ),
    );
    if (!confirmed) return;

    setPackageOperation({ action, source: normalizedSource });
    try {
      await api.managePackage(action, normalizedSource, scope === "project");
      if (action === "install" && !updating) setPackageSource("");
      showToast(
        action === "remove"
          ? t("Removed package {source}", "已移除包 {source}", { source: normalizedSource })
          : updating
            ? t("Updated package {source}", "已更新包 {source}", { source: normalizedSource })
            : t("Installed package {source}", "已安装包 {source}", { source: normalizedSource }),
        "success",
      );
      await loadResources(false, false);
    } catch (packageError: unknown) {
      const message = packageError instanceof Error ? packageError.message : String(packageError);
      showToast(t("Package operation failed: {message}", "包操作失败：{message}", { message }), "error");
    } finally {
      setPackageOperation(null);
    }
  }

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
          <section className="resource-group" data-resource-group="packages">
            <div className="resource-group-heading">
              <h4 className="settings-subsection-title">{t("Plugin packages", "插件包")}</h4>
              <span className="resource-count">{resources.packages?.length ?? 0}</span>
            </div>
            <form
              className="resource-list"
              onSubmit={(event) => {
                event.preventDefault();
                void handlePackageAction("install", packageSource, packageScope);
              }}
            >
              <div className="resource-row">
                <div className="resource-copy">
                  <label className="resource-name" htmlFor="resource-package-source">
                    {t("Install from npm, Git, or a local path", "从 npm、Git 或本地路径安装")}
                  </label>
                  <input
                    id="resource-package-source"
                    className="form-input form-input-sm"
                    value={packageSource}
                    maxLength={2048}
                    onChange={(event) => setPackageSource(event.target.value)}
                    placeholder="npm:@scope/package, git:github.com/user/repo, C:\\path\\to\\package"
                    disabled={resourceReloadDisabled || packageOperation !== null}
                  />
                  <span className="resource-description">
                    {t(
                      "Packages bundle extensions, skills, prompts, and themes. They run with full system access.",
                      "包可捆绑扩展、技能、提示词和主题，并以完整系统权限运行。",
                    )}
                  </span>
                </div>
                <select
                  id="resource-package-scope"
                  className="form-select form-input-num"
                  value={packageScope}
                  onChange={(event) => setPackageScope(event.target.value as "user" | "project")}
                  disabled={resourceReloadDisabled || packageOperation !== null}
                  aria-label={t("Package scope", "包作用域")}
                >
                  <option value="user">{t("User", "用户")}</option>
                  <option value="project">{t("Project", "项目")}</option>
                </select>
                <button
                  className="settings-btn-sm resource-package-install"
                  type="submit"
                  disabled={resourceReloadDisabled || packageOperation !== null || !packageSource.trim()}
                >
                  {packageOperation?.action === "install"
                    ? t("Installing…", "安装中…")
                    : t("Install", "安装")}
                </button>
              </div>
            </form>

            {(resources.packages?.length ?? 0) === 0 ? (
              <div className="settings-empty">{t("No plugin packages configured.", "未配置插件包。")}</div>
            ) : (
              <div className="resource-list">
                {resources.packages.map((pkg) => {
                  const busy = packageOperation?.source === pkg.source;
                  return (
                    <div
                      className="resource-row resource-package-row"
                      data-package-scope={pkg.scope}
                      data-package-source={pkg.source}
                      key={`${pkg.scope}:${pkg.source}`}
                    >
                      <div className="resource-copy">
                        <span className="resource-name" title={pkg.source}>{pkg.source}</span>
                        <span className="resource-path">
                          {pkg.installedPath ?? t("Package files are missing", "包文件缺失")}
                        </span>
                      </div>
                      <span className="resource-source">
                        {pkg.scope === "project" ? t("project", "项目") : t("user", "用户")}
                        {pkg.filtered ? ` · ${t("filtered", "已筛选")}` : ""}
                      </span>
                      <div className="fetched-models-bulk">
                        <button
                          className="settings-btn-sm"
                          type="button"
                          disabled={resourceReloadDisabled || packageOperation !== null}
                          onClick={() => void handlePackageAction("install", pkg.source, pkg.scope, true)}
                        >
                          {busy && packageOperation?.action === "install"
                            ? t("Updating…", "更新中…")
                            : t("Update", "更新")}
                        </button>
                        <button
                          className="settings-btn-sm settings-btn-danger"
                          type="button"
                          disabled={resourceReloadDisabled || packageOperation !== null}
                          onClick={() => void handlePackageAction("remove", pkg.source, pkg.scope)}
                        >
                          {busy && packageOperation?.action === "remove"
                            ? t("Removing…", "移除中…")
                            : t("Remove", "移除")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

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

      <TrustedFoldersSettings />
    </div>
  );
}
