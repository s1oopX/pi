import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { ForkMessage, SessionInfo, SessionTreeData } from "../../ipc/types";
import { useStore } from "../../store";
import { Dialog } from "../Dialog";
import { showToast } from "../Toast";
import { isBranchLoadCurrent } from "./branchLoadGuard";
import { buildBranchTreeRows } from "./branchTree";
import { buildSessionLineageRows, type SessionLineageRow } from "./sessionLineage";
import "./BranchNavigator.css";

interface BranchNavigatorProps {
  open: boolean;
  onClose: () => void;
  onSessionChanged: () => Promise<void> | void;
}

interface BranchNavigatorContentProps {
  onClose?: () => void;
  onSessionChanged: () => Promise<void> | void;
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  let offset = 0;
  for (;;) {
    const page = await api.getSessions({ all: true, offset, limit: 200 });
    sessions.push(...page.sessions);
    if (!page.hasMore || page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  return sessions;
}

export function BranchNavigatorContent({ onClose, onSessionChanged }: BranchNavigatorContentProps) {
  const { t } = useI18n();
  const sessionId = useStore((state) => state.session?.sessionId ?? null);
  const isStreaming = useStore((state) => state.isStreaming);
  const [tree, setTree] = useState<SessionTreeData | null>(null);
  const [forkMessages, setForkMessages] = useState<ForkMessage[]>([]);
  const [sessionRows, setSessionRows] = useState<SessionLineageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [openingSessionPath, setOpeningSessionPath] = useState<string | null>(null);
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    const requestedSessionId = sessionId;
    setLoading(true);
    setError(null);
    setTree(null);
    setForkMessages([]);
    setSessionRows([]);
    setLoadedSessionId(null);
    if (!requestedSessionId) {
      setLoading(false);
      return;
    }
    try {
      const [nextTree, nextMessages, nextSessions] = await Promise.all([
        api.getSessionTree(),
        api.getForkMessages(),
        loadAllSessions(),
      ]);
      if (!isBranchLoadCurrent(
        requestId,
        loadRequestIdRef.current,
        requestedSessionId,
        useStore.getState().session?.sessionId ?? null,
      )) return;
      setTree(nextTree);
      setForkMessages(nextMessages);
      setSessionRows(buildSessionLineageRows(nextSessions, requestedSessionId, t("Untitled", "未命名")));
      setLoadedSessionId(requestedSessionId);
    } catch (loadError) {
      if (!isBranchLoadCurrent(
        requestId,
        loadRequestIdRef.current,
        requestedSessionId,
        useStore.getState().session?.sessionId ?? null,
      )) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (isBranchLoadCurrent(
        requestId,
        loadRequestIdRef.current,
        requestedSessionId,
        useStore.getState().session?.sessionId ?? null,
      )) {
        setLoading(false);
      }
    }
  }, [sessionId, t]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [load]);

  async function handleFork(entryId: string) {
    if (
      forkingEntryId ||
      openingSessionPath ||
      useStore.getState().isStreaming ||
      !loadedSessionId ||
      loadedSessionId !== useStore.getState().session?.sessionId
    ) return;
    setForkingEntryId(entryId);
    try {
      const result = await api.forkSession(entryId);
      if (result.cancelled) return;
      await onSessionChanged();
      useStore.getState().setComposerDraft(result.text);
      onClose?.();
      showToast(t("Created a branch from the selected message", "已从所选消息创建分支"), "success");
    } catch (forkError) {
      showToast(
        t("Failed to create branch: {error}", "创建分支失败：{error}", {
          error: forkError instanceof Error ? forkError.message : String(forkError),
        }),
        "error",
      );
    } finally {
      setForkingEntryId(null);
    }
  }

  async function handleOpenSession(row: SessionLineageRow) {
    if (
      row.current ||
      openingSessionPath ||
      forkingEntryId ||
      loadedSessionId !== useStore.getState().session?.sessionId
    ) return;
    if (useStore.getState().isStreaming) {
      showToast(t("Finish or stop the current run before switching branches.", "请先完成或停止当前运行，再切换分支。"), "warning");
      return;
    }
    setOpeningSessionPath(row.path);
    try {
      const result = await api.switchSession(row.path);
      if (result.cancelled) return;
      await onSessionChanged();
      onClose?.();
      showToast(t("Opened branch", "已打开分支"), "success");
    } catch (switchError) {
      showToast(
        t("Failed to open branch: {error}", "打开分支失败：{error}", {
          error: switchError instanceof Error ? switchError.message : String(switchError),
        }),
        "error",
      );
    } finally {
      setOpeningSessionPath(null);
    }
  }

  const forkRows = tree ? buildBranchTreeRows(tree, forkMessages) : [];

  return (
    <div className="branch-navigator">
        <p className="branch-navigator-description">
          {t(
            "Review cloned and forked threads, open an existing branch, or create a new branch from a user message.",
            "查看已克隆和分叉的会话，打开已有分支，或从用户消息创建新分支。",
          )}
        </p>
        {loading && <div className="branch-navigator-state" role="status">{t("Loading branches...", "正在加载分支...")}</div>}
        {!loading && error && (
          <div className="branch-navigator-state error" role="alert">
            <span>{t("Could not load branches: {error}", "无法加载分支：{error}", { error })}</span>
            <button className="settings-btn-sm" type="button" onClick={() => void load()}>{t("Retry", "重试")}</button>
          </div>
        )}
        {!loading && !error && sessionRows.length === 0 && forkRows.length === 0 && (
          <div className="branch-navigator-state">{t("No user messages are available to fork yet.", "还没有可用于创建分支的用户消息。")}</div>
        )}
        {!loading && !error && sessionRows.length > 0 && (
          <section className="branch-navigator-section" aria-labelledby="branch-lineage-title">
            <h3 id="branch-lineage-title">{t("Thread lineage", "会话谱系")}</h3>
            <ol className="branch-tree" aria-label={t("Thread lineage", "会话谱系")}>
              {sessionRows.map((row) => (
                <li
                  className={`branch-tree-row ${row.current ? "current" : ""}`}
                  style={{ "--branch-depth": Math.min(row.depth, 8) } as CSSProperties}
                  key={row.path}
                >
                  <span className="branch-tree-guide" aria-hidden="true" />
                  <span className="branch-tree-copy">
                    <span className="branch-tree-text" title={row.title}>{row.title}</span>
                    <span className="branch-tree-meta">
                      {row.current && <span>{t("Current thread", "当前会话")}</span>}
                      {row.childCount > 0 && (
                        <span>{t("{count} branches", "{count} 个分支", { count: row.childCount })}</span>
                      )}
                      <span title={row.detail}>{row.detail}</span>
                    </span>
                  </span>
                  <button
                    className="settings-btn-sm"
                    type="button"
                    disabled={
                      row.current ||
                      openingSessionPath !== null ||
                      forkingEntryId !== null ||
                      loadedSessionId !== sessionId ||
                      isStreaming
                    }
                    title={isStreaming
                      ? t("Finish or stop the current run before switching branches.", "请先完成或停止当前运行，再切换分支。")
                      : undefined}
                    onClick={() => void handleOpenSession(row)}
                  >
                    {row.current
                      ? t("Current", "当前")
                      : openingSessionPath === row.path
                        ? t("Opening...", "正在打开...")
                        : t("Open", "打开")}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
        {!loading && !error && forkRows.length > 0 && (
          <section className="branch-navigator-section" aria-labelledby="branch-fork-points-title">
            <h3 id="branch-fork-points-title">{t("Fork from message", "从消息分支")}</h3>
            <ol className="branch-tree" aria-label={t("Session branch points", "会话分叉点")}>
            {forkRows.map((row) => (
              <li
                className={`branch-tree-row ${row.current ? "current" : ""}`}
                style={{ "--branch-depth": Math.min(row.depth, 8) } as CSSProperties}
                key={row.entryId}
              >
                <span className="branch-tree-guide" aria-hidden="true" />
                <span className="branch-tree-copy">
                  <span className="branch-tree-text" title={row.text}>{row.text}</span>
                  <span className="branch-tree-meta">
                    {row.current && <span>{t("Current path", "当前路径")}</span>}
                    {row.branchCount > 1 && (
                      <span>{t("{count} branches", "{count} 个分支", { count: row.branchCount })}</span>
                    )}
                  </span>
                </span>
                <button
                  className="settings-btn-sm"
                  type="button"
                  disabled={forkingEntryId !== null || loadedSessionId !== sessionId || isStreaming}
                  title={isStreaming
                    ? t("Finish or stop the current run before creating a branch.", "请先完成或停止当前运行，再创建分支。")
                    : undefined}
                  onClick={() => void handleFork(row.entryId)}
                >
                  {forkingEntryId === row.entryId ? t("Forking...", "正在创建...") : t("Fork here", "从此处分支")}
                </button>
              </li>
            ))}
            </ol>
          </section>
        )}
    </div>
  );
}

export function BranchNavigator({ open, onClose, onSessionChanged }: BranchNavigatorProps) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <Dialog
      open={open}
      title={t("Session branches", "会话分支")}
      className="branch-navigator-dialog"
      onClose={onClose}
    >
      <BranchNavigatorContent onClose={onClose} onSessionChanged={onSessionChanged} />
    </Dialog>
  );
}
