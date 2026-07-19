import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BranchNavigatorContent } from "../BranchNavigator";
import { appendFileReference } from "../Composer/workspaceDrafts";
import { TerminalPanel, type TerminalPanelHandle } from "../Terminal";
import { showToast } from "../Toast";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";

export type WorkbenchView = "launcher" | "review" | "terminal" | "browser" | "files" | "side-task";

export type WorkbenchKeybindingLabels = Partial<Record<WorkbenchView | "toggle", string>>;

interface WorkbenchPanelProps {
  activeView: WorkbenchView;
  keybindingLabels: WorkbenchKeybindingLabels;
  onClose: () => void;
  onSelectView: (view: WorkbenchView) => void;
}

interface WorkbenchEntry {
  view: WorkbenchView;
  label: string;
  shortcut?: string;
  icon: "review" | "terminal" | "browser" | "files" | "task";
}

interface BashResult {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}

export function WorkbenchPanel({ activeView, keybindingLabels, onClose, onSelectView }: WorkbenchPanelProps) {
  const { t } = useI18n();
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveViewRef = useRef(activeView);
  const title = getWorkbenchTitle(activeView, t);
  const entries = useMemo<WorkbenchEntry[]>(() => [
    {
      view: "review",
      label: t("Review", "审阅"),
      shortcut: keybindingLabels.review,
      icon: "review",
    },
    {
      view: "terminal",
      label: t("Shell command", "Shell 命令"),
      shortcut: keybindingLabels.terminal,
      icon: "terminal",
    },
    {
      view: "browser",
      label: t("System browser", "系统浏览器"),
      shortcut: keybindingLabels.browser,
      icon: "browser",
    },
    {
      view: "files",
      label: t("Files", "文件"),
      shortcut: keybindingLabels.files,
      icon: "files",
    },
    {
      view: "side-task",
      label: t("Side task", "侧边任务"),
      shortcut: keybindingLabels["side-task"],
      icon: "task",
    },
  ], [keybindingLabels, t]);

  useEffect(() => {
    const previousActiveView = previousActiveViewRef.current;
    previousActiveViewRef.current = activeView;
    if (activeView !== "review" || previousActiveView === "review") return;
    const focusFrame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) backButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [activeView]);

  return (
    <aside
      className="workbench-panel"
      aria-label={t("Workbench", "工作台")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="workbench-header">
        <button
          ref={backButtonRef}
          className="icon-button workbench-back"
          type="button"
          autoFocus={activeView !== "launcher"}
          disabled={activeView === "launcher"}
          onClick={() => onSelectView("launcher")}
          aria-label={t("Back to workbench", "返回工作台")}
          title={t("Back to workbench", "返回工作台")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2>{title}</h2>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label={t("Close workbench", "关闭工作台")}
          title={t("Close workbench", "关闭工作台")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="workbench-body">
        {activeView === "launcher" ? (
          <WorkbenchLauncher entries={entries} onSelectView={onSelectView} />
        ) : activeView === "review" ? (
          <WorkbenchReview />
        ) : activeView === "terminal" ? (
          <WorkbenchTerminal />
        ) : activeView === "browser" ? (
          <WorkbenchBrowser />
        ) : activeView === "files" ? (
          <WorkbenchFiles />
        ) : (
          <WorkbenchSideTask />
        )}
      </div>
    </aside>
  );
}

function WorkbenchLauncher({
  entries,
  onSelectView,
}: {
  entries: readonly WorkbenchEntry[];
  onSelectView: (view: WorkbenchView) => void;
}) {
  return (
    <div className="workbench-launcher">
      {entries.map((entry, index) => (
        <button
          className="workbench-launcher-item"
          type="button"
          key={entry.view}
          autoFocus={index === 0}
          onClick={() => onSelectView(entry.view)}
        >
          <WorkbenchIcon icon={entry.icon} />
          <span>{entry.label}</span>
          {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}

function WorkbenchReview() {
  const refreshAsync = useStore((state) => state.refreshAsync);
  return (
    <div className="workbench-scroll">
      <BranchNavigatorContent onSessionChanged={refreshAsync} />
    </div>
  );
}

function WorkbenchTerminal() {
  const { t } = useI18n();
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    terminalRef.current?.writeln("Pi Studio");
    terminalRef.current?.writeln("");
  }, []);

  async function runCommand(event: FormEvent) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || running) return;
    setCommand("");
    setRunning(true);
    terminalRef.current?.writeln(`$ ${trimmed}`);
    try {
      const result = parseBashResult(await api.bash(trimmed, true));
      terminalRef.current?.write(result.output);
      if (result.output && !result.output.endsWith("\n")) terminalRef.current?.writeln("");
      const suffix = result.cancelled
        ? t("cancelled", "已取消")
        : t("exit {code}", "退出码 {code}", { code: result.exitCode ?? 0 });
      terminalRef.current?.writeln(`[${suffix}]`);
      if (result.truncated && result.fullOutputPath) {
        terminalRef.current?.writeln(t("[output truncated: {path}]", "[输出已截断：{path}]", {
          path: result.fullOutputPath,
        }));
      }
    } catch (error) {
      terminalRef.current?.writeln(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      terminalRef.current?.focus();
    }
  }

  async function abortCommand() {
    if (!running) return;
    try {
      await api.abortBash();
    } catch (error) {
      showToast(t("Failed to stop terminal command: {error}", "停止终端命令失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    }
  }

  return (
    <div className="workbench-terminal">
      <TerminalPanel ref={terminalRef} className="workbench-terminal-output" />
      <form className="workbench-command-row" onSubmit={runCommand}>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={t("Command", "命令")}
          disabled={running}
          autoFocus
        />
        {running ? (
          <button className="workbench-primary secondary" type="button" onClick={abortCommand}>
            {t("Stop", "停止")}
          </button>
        ) : (
          <button className="workbench-primary" type="submit" disabled={!command.trim()}>
            {t("Run", "运行")}
          </button>
        )}
      </form>
    </div>
  );
}

function WorkbenchBrowser() {
  const { t } = useI18n();
  const [url, setUrl] = useState("");

  async function openBrowser(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeBrowserUrl(url);
    if (!normalized) {
      showToast(t("Enter a valid URL", "请输入有效 URL"), "error");
      return;
    }
    await api.openExternal(normalized);
  }

  return (
    <form
      className="workbench-form"
      onSubmit={openBrowser}
      aria-label={t("Open URL in system browser", "在系统浏览器中打开 URL")}
    >
      <label>
        <span>{t("URL", "URL")}</span>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
      </label>
      <button className="workbench-primary" type="submit">{t("Open", "打开")}</button>
    </form>
  );
}

function WorkbenchFiles() {
  const { t } = useI18n();
  const setComposerDraft = useStore((state) => state.setComposerDraft);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    api.listWorkspaceFiles(query)
      .then((nextFiles) => {
        if (requestId !== requestIdRef.current) return;
        setFiles(nextFiles.slice(0, 120));
      })
      .catch((loadError) => {
        if (requestId !== requestIdRef.current) return;
        setFiles([]);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [query]);

  return (
    <div className="workbench-files">
      <input
        className="workbench-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("Search files", "搜索文件")}
        autoFocus
      />
      {loading && <div className="workbench-state" role="status">{t("Loading...", "正在加载...")}</div>}
      {!loading && error && <div className="workbench-state error" role="alert">{error}</div>}
      {!loading && !error && files.length === 0 && (
        <div className="workbench-state">{t("No files found", "未找到文件")}</div>
      )}
      <div className="workbench-file-list">
        {files.map((file) => (
          <button
            className="workbench-file-item"
            type="button"
            key={file}
            title={file}
            onClick={() => setComposerDraft((input) => appendFileReference(input, file))}
          >
            <WorkbenchIcon icon="files" />
            <span>{file}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkbenchSideTask() {
  const { t } = useI18n();
  const taskCwd = useStore((state) => state.taskCwd);
  const isStreaming = useStore((state) => state.isStreaming);
  const setComposerDraft = useStore((state) => state.setComposerDraft);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (creating || isStreaming) return;
    setCreating(true);
    try {
      const result = await api.newSession(taskCwd || undefined);
      if (result.cancelled) return;
      await useStore.getState().resetForWorkspace(result.cwd);
      setComposerDraft(prompt.trim());
      setPrompt("");
      showToast(t("Created side task", "已创建侧边任务"), "success");
    } catch (error) {
      showToast(t("Failed to create side task: {error}", "创建侧边任务失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <form className="workbench-form side-task" onSubmit={createTask}>
      <label>
        <span>{t("Prompt", "提示词")}</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t("Ask Pi to do a side task", "让 Pi 执行一个侧边任务")}
          rows={6}
          autoFocus
        />
      </label>
      <button className="workbench-primary" type="submit" disabled={creating || isStreaming}>
        {creating ? t("Creating...", "正在创建...") : t("Create", "创建")}
      </button>
    </form>
  );
}

function WorkbenchIcon({ icon }: { icon: WorkbenchEntry["icon"] }) {
  const path = icon === "review"
    ? "M8 7h8M8 12h8M8 17h5M5 7h.01M5 12h.01M5 17h.01"
    : icon === "terminal"
      ? "m5 7 5 5-5 5M12 17h7"
      : icon === "browser"
        ? "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-8-9h16M12 3c2.2 2.4 3.2 5.4 3.2 9S14.2 18.6 12 21c-2.2-2.4-3.2-5.4-3.2-9S9.8 5.4 12 3Z"
        : icon === "files"
          ? "M4 6.5A2.5 2.5 0 0 1 6.5 4H10l2 2h5.5A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-9Z"
          : "M12 5v14M5 12h14";
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getWorkbenchTitle(view: WorkbenchView, t: (en: string, zhCN: string, values?: Record<string, string | number>) => string): string {
  if (view === "review") return t("Review", "审阅");
  if (view === "terminal") return t("Shell (one-shot)", "Shell（单次命令）");
  if (view === "browser") return t("System browser", "系统浏览器");
  if (view === "files") return t("Files", "文件");
  if (view === "side-task") return t("Side task", "侧边任务");
  return t("Workbench", "工作台");
}

function parseBashResult(value: unknown): BashResult {
  if (typeof value !== "object" || value === null) {
    return { output: String(value), exitCode: undefined, cancelled: false, truncated: false };
  }
  const record = value as Record<string, unknown>;
  return {
    output: typeof record.output === "string" ? record.output : "",
    exitCode: typeof record.exitCode === "number" ? record.exitCode : undefined,
    cancelled: record.cancelled === true,
    truncated: record.truncated === true,
    fullOutputPath: typeof record.fullOutputPath === "string" ? record.fullOutputPath : undefined,
  };
}

function normalizeBrowserUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`).toString();
  } catch {
    return null;
  }
}
