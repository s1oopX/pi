import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { ProjectTrustEntries } from "../../ipc/types";
import { useStore } from "../../store";
import { showToast } from "../Toast";
import { toTrustedFolderRows } from "./trustedFolders";

export function TrustedFoldersSettings() {
  const { t } = useI18n();
  const backendReady = useStore((state) => state.backendStatus.ready);
  const isStreaming = useStore((state) => state.isStreaming);
  const isCompacting = useStore((state) => Boolean(state.session?.isCompacting || state.compactionActivity));
  const [data, setData] = useState<ProjectTrustEntries | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatingPath, setUpdatingPath] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    if (!backendReady) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      setData(await api.getProjectTrustEntries());
    } catch (error) {
      setData(null);
      showToast(t("Could not load trusted folders: {message}", "无法加载受信任文件夹：{message}", {
        message: error instanceof Error ? error.message : String(error),
      }), "error");
    } finally {
      setLoading(false);
    }
  }, [backendReady, t]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  async function handleForget(path: string) {
    if (updatingPath) return;
    setUpdatingPath(path);
    try {
      const result = await api.setProjectTrustEntry(path, null);
      setData((previous) => previous && {
        ...previous,
        entries: result.entries,
        currentEntryPath: result.currentEntryPath,
        currentTrusted: result.trusted,
      });
      if (result.reloaded) {
        // The change covered the open workspace; sync banner and session state.
        await useStore.getState().refreshAsync();
      }
      showToast(t("Removed the trust decision for {path}", "已移除 {path} 的信任决定", { path }), "success");
    } catch (error) {
      showToast(t("Could not update trust: {message}", "更新信任失败：{message}", {
        message: error instanceof Error ? error.message : String(error),
      }), "error");
    } finally {
      setUpdatingPath(null);
    }
  }

  const rows = toTrustedFolderRows(data);
  const busyTitle = isStreaming
    ? t("Wait for the current response to finish before changing trust.", "请等待当前响应完成后再更改信任。")
    : isCompacting
      ? t("Wait for compaction to finish before changing trust.", "请等待压缩完成后再更改信任。")
      : undefined;
  const mutationDisabled = Boolean(updatingPath) || isStreaming || isCompacting || !backendReady;

  return (
    <section className="resource-group trust-folders" aria-label={t("Trusted folders", "受信任文件夹")}>
      <div className="resource-group-heading">
        <h4 className="settings-subsection-title">{t("Trusted folders", "受信任文件夹")}</h4>
        <span className="resource-count">{rows.length}</span>
      </div>
      <p className="settings-section-desc">
        {t(
          "Folders you have trusted (or refused) to run project extensions and settings from. Removing a decision returns the folder to untrusted-by-default the next time it is opened.",
          "你已信任（或拒绝）运行其项目扩展与设置的文件夹。移除决定后，下次打开该文件夹时将恢复默认不信任。",
        )}
      </p>
      {loading && !data && <div className="settings-empty">{t("Loading...", "正在加载...")}</div>}
      {!loading && rows.length === 0 && (
        <div className="settings-empty">{t("No trust decisions saved.", "尚无已保存的信任决定。")}</div>
      )}
      {rows.length > 0 && (
        <div className="resource-list">
          {rows.map((row) => (
            <div className="resource-row trust-folder-row" key={row.path}>
              <div className="resource-copy">
                <span className="resource-name trust-folder-path" title={row.path}>{row.path}</span>
                <span className="resource-description">
                  <span className={row.decision ? "trust-folder-state trusted" : "trust-folder-state blocked"}>
                    {row.decision ? t("Trusted", "已信任") : t("Not trusted", "已拒绝")}
                  </span>
                  {row.coversCurrent && (
                    <span className="trust-folder-current">
                      {" · "}
                      {t("covers the current workspace", "覆盖当前工作区")}
                    </span>
                  )}
                </span>
              </div>
              <button
                className="settings-btn-sm trust-folder-forget"
                type="button"
                disabled={mutationDisabled}
                title={busyTitle}
                onClick={() => void handleForget(row.path)}
              >
                {updatingPath === row.path ? t("Removing...", "正在移除...") : t("Remove", "移除")}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
