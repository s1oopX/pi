import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { GitBranches, GitChanges } from "../../ipc/types";
import { useStore } from "../../store";
import { Icon } from "../Icon";
import { showToast } from "../Toast";
import { summarizeGitSync } from "./gitPanelState";

function ipcErrorReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split("Error: ").pop()?.trim() || raw;
}

interface GitPanelProps {
  onClose: () => void;
}

export function GitPanel({ onClose }: GitPanelProps) {
  const { t } = useI18n();
  const workspaceGitStatus = useStore((s) => s.workspaceGitStatus);
  const refreshWorkspaceGitStatus = useStore((s) => s.refreshWorkspaceGitStatus);
  const isStreaming = useStore((s) => s.isStreaming);

  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [branchData, setBranchData] = useState<GitBranches | null>(null);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);

  const sync = summarizeGitSync(workspaceGitStatus);
  const busy = committing || pushing || Boolean(switchingBranch) || creatingBranch;

  async function loadChanges() {
    setChangesLoading(true);
    try {
      setChanges(await api.getGitChanges());
    } catch (error) {
      setChanges(null);
      showToast(t("Could not list changes: {message}", "无法获取变更列表：{message}", {
        message: ipcErrorReason(error),
      }), "error");
    } finally {
      setChangesLoading(false);
    }
  }

  async function loadBranches() {
    try {
      setBranchData(await api.getGitBranches());
    } catch (error) {
      setBranchData(null);
      showToast(t("Could not list branches: {message}", "无法获取分支列表：{message}", {
        message: ipcErrorReason(error),
      }), "error");
    }
  }

  useEffect(() => {
    refreshWorkspaceGitStatus();
    void loadChanges();
    void loadBranches();
    // Mount-time load only; refresh actions re-fetch explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCommitAll() {
    const message = commitMessage.trim();
    if (!message || busy) return;
    setCommitting(true);
    try {
      const result = await api.commitAllGitChanges(message);
      showToast(result.summary, "success");
      setCommitMessage("");
      refreshWorkspaceGitStatus();
      await loadChanges();
    } catch (error) {
      showToast(t("Commit failed: {message}", "提交失败：{message}", { message: ipcErrorReason(error) }), "error");
    } finally {
      setCommitting(false);
    }
  }

  async function handlePush() {
    if (busy || !sync.canPush) return;
    setPushing(true);
    try {
      const result = await api.pushGitBranch();
      showToast(
        result.setUpstream
          ? t("Pushed {branch} and set upstream", "已推送 {branch} 并设置上游", { branch: result.branch })
          : t("Pushed {branch}", "已推送 {branch}", { branch: result.branch }),
        "success",
      );
      refreshWorkspaceGitStatus();
    } catch (error) {
      showToast(t("Push failed: {message}", "推送失败：{message}", { message: ipcErrorReason(error) }), "error");
    } finally {
      setPushing(false);
    }
  }

  async function handleSwitchBranch(name: string) {
    if (busy) return;
    if (isStreaming) {
      showToast(t("Finish or stop the current run before switching branches.", "请先完成或停止当前运行，再切换分支。"), "warning");
      return;
    }
    setSwitchingBranch(name);
    try {
      await api.switchGitBranch(name);
      showToast(t("Switched to {branch}", "已切换到 {branch}", { branch: name }), "success");
      setBranchesOpen(false);
      refreshWorkspaceGitStatus();
      await Promise.all([loadChanges(), loadBranches()]);
    } catch (error) {
      showToast(t("Could not switch branch: {message}", "切换分支失败：{message}", {
        message: ipcErrorReason(error),
      }), "error");
    } finally {
      setSwitchingBranch(null);
    }
  }

  async function handleCreateBranch() {
    const name = newBranchName.trim();
    if (!name || busy) return;
    if (isStreaming) {
      showToast(t("Finish or stop the current run before creating a branch.", "请先完成或停止当前运行，再新建分支。"), "warning");
      return;
    }
    setCreatingBranch(true);
    try {
      await api.switchGitBranch(name, { create: true });
      showToast(t("Created and switched to {branch}", "已新建并切换到 {branch}", { branch: name }), "success");
      setNewBranchName("");
      setBranchesOpen(false);
      refreshWorkspaceGitStatus();
      await Promise.all([loadChanges(), loadBranches()]);
    } catch (error) {
      showToast(t("Could not create branch: {message}", "新建分支失败：{message}", {
        message: ipcErrorReason(error),
      }), "error");
    } finally {
      setCreatingBranch(false);
    }
  }

  const currentBranch = branchData?.current ?? workspaceGitStatus?.branch ?? null;
  const otherBranches = (branchData?.branches ?? []).filter((branch) => !branch.current);

  return (
    <div className="git-panel" role="dialog" aria-label={t("Git", "Git")}>
      <div className="git-panel-branchbar">
        <button
          className="git-panel-branch-toggle"
          type="button"
          aria-expanded={branchesOpen}
          onClick={() => {
            const next = !branchesOpen;
            setBranchesOpen(next);
            if (next) void loadBranches();
          }}
          title={t("Switch or create a branch", "切换或新建分支")}
        >
          <Icon name="git-branch" size={15} />
          <span className="git-panel-branch-name">{currentBranch ?? t("Detached HEAD", "游离 HEAD")}</span>
          <Icon className={branchesOpen ? "expanded" : ""} name="chevron-down" size={14} />
        </button>
        <div className="git-panel-sync">
          {sync.show && (
            <span className="git-panel-sync-counts" role="img" aria-label={t("{ahead} ahead, {behind} behind", "领先 {ahead}，落后 {behind}", { ahead: sync.ahead, behind: sync.behind })}>
              {sync.ahead > 0 && <span className="git-panel-ahead">↑{sync.ahead}</span>}
              {sync.behind > 0 && <span className="git-panel-behind">↓{sync.behind}</span>}
            </span>
          )}
          <button
            className="git-panel-push-btn"
            type="button"
            disabled={busy || !sync.canPush}
            title={sync.hasUpstream
              ? t("Push to the tracked upstream", "推送到跟踪的上游")
              : t("Push and set the upstream", "推送并设置上游")}
            onClick={() => void handlePush()}
          >
            <Icon name="upload" size={14} />
            <span>{pushing ? t("Pushing...", "正在推送...") : t("Push", "推送")}</span>
          </button>
        </div>
      </div>

      {branchesOpen && (
        <div className="git-panel-branches">
          {otherBranches.length === 0 ? (
            <div className="git-panel-note">{t("No other branches", "没有其他分支")}</div>
          ) : (
            <div className="git-panel-branch-list" role="group" aria-label={t("Switch branch", "切换分支")}>
              {otherBranches.map((branch) => (
                <button
                  className="git-panel-branch-item"
                  type="button"
                  key={branch.name}
                  disabled={busy || isStreaming}
                  onClick={() => void handleSwitchBranch(branch.name)}
                  title={t("Switch to {branch}", "切换到 {branch}", { branch: branch.name })}
                >
                  <Icon name="git-branch" size={14} />
                  <span className="git-panel-branch-item-name">{branch.name}</span>
                  {switchingBranch === branch.name && <span className="git-panel-branch-item-status">…</span>}
                </button>
              ))}
            </div>
          )}
          <div className="git-panel-new-branch">
            <input
              className="git-panel-new-branch-input"
              value={newBranchName}
              placeholder={t("New branch name", "新分支名称")}
              disabled={creatingBranch || isStreaming}
              maxLength={240}
              onChange={(event) => setNewBranchName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreateBranch();
                }
              }}
            />
            <button
              className="git-panel-new-branch-btn"
              type="button"
              disabled={creatingBranch || isStreaming || !newBranchName.trim()}
              onClick={() => void handleCreateBranch()}
            >
              {creatingBranch ? t("Creating...", "正在创建...") : t("Create", "创建")}
            </button>
          </div>
        </div>
      )}

      <div className="git-panel-header">
        <span className="git-panel-title">{t("Changes", "变更")}</span>
        <button
          className="git-panel-refresh"
          type="button"
          disabled={changesLoading}
          onClick={() => {
            refreshWorkspaceGitStatus();
            void loadChanges();
          }}
          aria-label={t("Refresh change list", "刷新变更列表")}
        >
          <Icon name="rotate-cw" size={14} />
        </button>
      </div>
      <div className="git-panel-file-list" role="list">
        {changesLoading && <div className="git-panel-note">{t("Loading...", "正在加载...")}</div>}
        {!changesLoading && changes && changes.files.length === 0 && (
          <div className="git-panel-note">{t("Working tree clean", "工作树干净")}</div>
        )}
        {!changesLoading &&
          changes?.files.map((file) => (
            <div className="git-panel-file" role="listitem" key={`${file.status}:${file.path}`}>
              <span
                className={`git-panel-file-status status-${
                  file.status === "??" ? "untracked" : file.status.replace(/[^A-Za-z]/g, "") || "modified"
                }`}
              >
                {file.status}
              </span>
              <span className="git-panel-file-path" title={file.path}>{file.path}</span>
            </div>
          ))}
        {!changesLoading && changes?.truncated && (
          <div className="git-panel-note">{t("Showing the first 200 files", "仅显示前 200 个文件")}</div>
        )}
      </div>
      <textarea
        className="git-panel-message"
        value={commitMessage}
        rows={2}
        placeholder={t("Commit message", "提交信息")}
        disabled={committing}
        onChange={(event) => setCommitMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void handleCommitAll();
          }
        }}
      />
      <div className="git-panel-actions">
        <button className="git-panel-cancel" type="button" onClick={onClose}>
          {t("Close", "关闭")}
        </button>
        <button
          className="git-panel-commit-btn"
          type="button"
          disabled={busy || isStreaming || !commitMessage.trim() || !changes || changes.files.length === 0}
          title={isStreaming
            ? t("Finish or stop the current run before committing", "请先完成或停止当前运行，再提交")
            : t("Stage all changes and commit (Ctrl+Enter)", "暂存全部更改并提交（Ctrl+Enter）")}
          onClick={() => void handleCommitAll()}
        >
          {committing ? t("Committing...", "正在提交...") : t("Commit all changes", "提交全部更改")}
        </button>
      </div>
    </div>
  );
}
