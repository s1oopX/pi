import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { BranchNavigatorContent } from "../BranchNavigator";
import { Icon } from "../Icon";
import { appendFileReference } from "../Composer/workspaceDrafts";
import { TerminalPanel, type TerminalPanelHandle } from "../Terminal";
import { showToast } from "../Toast";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import { createBashExecutionId, subscribeBashExecution } from "../../ipc/bashExecutionStream";
import { useStore } from "../../store";
import { createCommandHistoryState, pushCommand, recallNext, recallPrevious } from "./commandHistory";
import { findLatestTaskPlan } from "./planState";

export type WorkbenchView = "launcher" | "plan" | "review" | "terminal" | "browser" | "files" | "side-task";

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
  icon: "plan" | "review" | "terminal" | "browser" | "files" | "task";
}

interface BashResult {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}

interface WorkbenchTerminalTab {
  id: number;
  running: boolean;
}

export function WorkbenchPanel({ activeView, keybindingLabels, onClose, onSelectView }: WorkbenchPanelProps) {
  const { t } = useI18n();
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveViewRef = useRef(activeView);
  const title = getWorkbenchTitle(activeView, t);
  const entries = useMemo<WorkbenchEntry[]>(() => [
    {
      view: "plan",
      label: t("Plan", "计划"),
      icon: "plan",
    },
    {
      view: "review",
      label: t("Review", "审阅"),
      shortcut: keybindingLabels.review,
      icon: "review",
    },
    {
      view: "terminal",
      label: t("Terminals", "终端"),
      shortcut: keybindingLabels.terminal,
      icon: "terminal",
    },
    {
      view: "browser",
      label: t("Browser", "浏览器"),
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
          <Icon name="chevron-left" size={20} strokeWidth={1.8} />
        </button>
        <h2>{title}</h2>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label={t("Close workbench", "关闭工作台")}
          title={t("Close workbench", "关闭工作台")}
        >
          <Icon name="close" size={20} strokeWidth={1.8} />
        </button>
      </div>

      <div className="workbench-body">
        {activeView === "launcher" ? (
          <WorkbenchLauncher entries={entries} onSelectView={onSelectView} />
        ) : activeView === "plan" ? (
          <WorkbenchPlan />
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

function WorkbenchPlan() {
  const { t } = useI18n();
  const messages = useStore((state) => state.messages);
  const taskPlan = useMemo(() => findLatestTaskPlan(messages), [messages]);

  if (!taskPlan || taskPlan.steps.length === 0) {
    return (
      <div className="workbench-state workbench-plan-empty" role="status">
        {t("No active plan. Pi will create one for multi-step tasks.", "暂无活动计划。Pi 会为多步骤任务创建计划。")}
      </div>
    );
  }

  const completed = taskPlan.steps.filter((step) => step.status === "completed").length;
  const progressLabel = t("{completed} of {total} completed", "已完成 {completed}/{total}", {
    completed,
    total: taskPlan.steps.length,
  });

  return (
    <div className="workbench-plan workbench-scroll">
      <div className="workbench-plan-summary" aria-live="polite">
        {taskPlan.explanation && <p className="workbench-plan-explanation">{taskPlan.explanation}</p>}
        <div className="workbench-plan-progress-row">
          <strong>{t("Progress", "进度")}</strong>
          <span>{progressLabel}</span>
        </div>
        <progress
          className="workbench-plan-progress"
          max={taskPlan.steps.length}
          value={completed}
          aria-label={progressLabel}
        />
      </div>
      <ol className="workbench-plan-list">
        {taskPlan.steps.map((step, index) => {
          const statusLabel = step.status === "completed"
            ? t("Completed", "已完成")
            : step.status === "in_progress"
              ? t("In progress", "进行中")
              : t("Pending", "待处理");
          return (
            <li
              className={`workbench-plan-step ${step.status}`}
              aria-current={step.status === "in_progress" ? "step" : undefined}
              key={`${index}:${step.step}`}
            >
              <span className="workbench-plan-marker" aria-hidden="true" />
              <span className="workbench-plan-step-text">{step.step}</span>
              <span className="workbench-plan-step-status">{statusLabel}</span>
            </li>
          );
        })}
      </ol>
    </div>
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
          data-workbench-view={entry.view}
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
  const [tabs, setTabs] = useState<WorkbenchTerminalTab[]>([{ id: 1, running: false }]);
  const [activeTabId, setActiveTabId] = useState(1);
  const nextTabIdRef = useRef(2);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  function addTerminal() {
    const id = nextTabIdRef.current++;
    setTabs((current) => [...current, { id, running: false }]);
    setActiveTabId(id);
  }

  function closeActiveTerminal() {
    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    if (index < 0 || tabs.length === 1 || tabs[index].running) return;
    const nextTabs = tabs.filter((tab) => tab.id !== activeTabId);
    const nextActiveId = nextTabs[Math.min(index, nextTabs.length - 1)].id;
    setTabs(nextTabs);
    setActiveTabId(nextActiveId);
    requestAnimationFrame(() => document.getElementById(`workbench-terminal-tab-${nextActiveId}`)?.focus());
  }

  function setTabRunning(id: number, running: boolean) {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, running } : tab));
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const id = tabs[nextIndex].id;
    setActiveTabId(id);
    requestAnimationFrame(() => document.getElementById(`workbench-terminal-tab-${id}`)?.focus());
  }

  return (
    <div className="workbench-terminal">
      <div className="workbench-terminal-toolbar">
        <div className="workbench-terminal-tabs" role="tablist" aria-label={t("Terminals", "终端")}>
          {tabs.map((tab, index) => {
            const active = tab.id === activeTabId;
            const label = t("Terminal {number}", "终端 {number}", { number: tab.id });
            return (
              <button
                id={`workbench-terminal-tab-${tab.id}`}
                className={`workbench-terminal-tab${active ? " active" : ""}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`workbench-terminal-panel-${tab.id}`}
                aria-label={tab.running ? t("{label}, running", "{label}，运行中", { label }) : label}
                tabIndex={active ? 0 : -1}
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {tab.running && <span className="workbench-terminal-running" aria-hidden="true" />}
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        <button
          className="icon-button workbench-terminal-action"
          type="button"
          disabled={tabs.length === 1 || activeTab.running}
          onClick={closeActiveTerminal}
          aria-label={t("Close current terminal", "关闭当前终端")}
          title={activeTab.running
            ? t("Stop the command before closing", "停止命令后才能关闭")
            : t("Close current terminal", "关闭当前终端")}
        >
          <Icon name="close" size={16} />
        </button>
        <button
          className="icon-button workbench-terminal-action"
          type="button"
          onClick={addTerminal}
          aria-label={t("New terminal", "新建终端")}
          title={t("New terminal", "新建终端")}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
      <div className="workbench-terminal-panels">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              id={`workbench-terminal-panel-${tab.id}`}
              className="workbench-terminal-session"
              role="tabpanel"
              aria-labelledby={`workbench-terminal-tab-${tab.id}`}
              hidden={!active}
              key={tab.id}
            >
              <WorkbenchTerminalSession active={active} onRunningChange={(running) => setTabRunning(tab.id, running)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkbenchTerminalSession({
  active,
  onRunningChange,
}: {
  active: boolean;
  onRunningChange: (running: boolean) => void;
}) {
  const { t } = useI18n();
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const executionIdRef = useRef<string | null>(null);
  const activeRef = useRef(active);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const historyRef = useRef(createCommandHistoryState());
  activeRef.current = active;

  useEffect(() => {
    terminalRef.current?.writeln("Pi Studio");
    terminalRef.current?.writeln("");
  }, []);

  function handleCommandKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (running) return;
    if (event.key === "ArrowUp") {
      const recall = recallPrevious(historyRef.current, command);
      historyRef.current = recall.state;
      if (recall.value !== null) {
        event.preventDefault();
        setCommand(recall.value);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      const recall = recallNext(historyRef.current);
      historyRef.current = recall.state;
      if (recall.value !== null) {
        event.preventDefault();
        setCommand(recall.value);
      }
    }
  }

  async function runCommand(event: FormEvent) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || running) return;
    historyRef.current = pushCommand(historyRef.current, trimmed);
    setCommand("");
    setRunning(true);
    onRunningChange(true);
    terminalRef.current?.writeln(`$ ${trimmed}`);
    // Stream output live via bash_execution_update events correlated by the
    // request id; the final response only fills in what was not streamed.
    const executionId = createBashExecutionId();
    executionIdRef.current = executionId;
    let streamed = "";
    const unsubscribe = subscribeBashExecution(executionId, (delta) => {
      streamed += delta;
      terminalRef.current?.write(delta);
    });
    try {
      const result = parseBashResult(await api.bash(trimmed, true, executionId));
      if (!streamed && result.output) terminalRef.current?.write(result.output);
      const finalOutput = streamed || result.output;
      if (finalOutput && !finalOutput.endsWith("\n")) terminalRef.current?.writeln("");
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
      unsubscribe();
      if (executionIdRef.current === executionId) executionIdRef.current = null;
      setRunning(false);
      onRunningChange(false);
      if (activeRef.current) requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function abortCommand() {
    const executionId = executionIdRef.current;
    if (!running || !executionId) return;
    try {
      await api.abortBash(executionId);
    } catch (error) {
      showToast(t("Failed to stop terminal command: {error}", "停止终端命令失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    }
  }

  return (
    <>
      <TerminalPanel ref={terminalRef} className="workbench-terminal-output" />
      <form className="workbench-command-row" onSubmit={runCommand}>
        <input
          ref={inputRef}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={handleCommandKeyDown}
          placeholder={t("Command", "命令")}
          disabled={running}
          autoFocus={active}
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
    </>
  );
}

function WorkbenchBrowser() {
  const { t } = useI18n();
  const [address, setAddress] = useState("");
  const [history, setHistory] = useState<{ urls: string[]; index: number }>({ urls: [], index: -1 });
  const [frameVersion, setFrameVersion] = useState(0);
  const currentUrl = history.urls[history.index];

  function navigate(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeBrowserUrl(address);
    if (!normalized) {
      showToast(t("Enter a valid URL", "请输入有效 URL"), "error");
      return;
    }
    setAddress(normalized);
    setHistory((current) => {
      const urls = [...current.urls.slice(0, current.index + 1), normalized];
      return { urls, index: urls.length - 1 };
    });
  }

  function moveHistory(offset: -1 | 1) {
    const index = history.index + offset;
    const nextUrl = history.urls[index];
    if (!nextUrl) return;
    setHistory({ ...history, index });
    setAddress(nextUrl);
  }

  async function openExternal() {
    if (!currentUrl) return;
    try {
      await api.openExternal(currentUrl);
    } catch (error) {
      showToast(t("Could not open URL: {error}", "无法打开 URL：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    }
  }

  return (
    <div className="workbench-browser">
      <form className="workbench-browser-toolbar" onSubmit={navigate} aria-label={t("Browser navigation", "浏览器导航")}>
        <button
          className="icon-button workbench-browser-action"
          type="button"
          disabled={history.index <= 0}
          onClick={() => moveHistory(-1)}
          aria-label={t("Back", "后退")}
          title={t("Back", "后退")}
        >
          <Icon name="chevron-left" size={17} />
        </button>
        <button
          className="icon-button workbench-browser-action"
          type="button"
          disabled={history.index >= history.urls.length - 1}
          onClick={() => moveHistory(1)}
          aria-label={t("Forward", "前进")}
          title={t("Forward", "前进")}
        >
          <Icon name="chevron-right" size={17} />
        </button>
        <button
          className="icon-button workbench-browser-action"
          type="button"
          disabled={!currentUrl}
          onClick={() => setFrameVersion((version) => version + 1)}
          aria-label={t("Reload", "刷新")}
          title={t("Reload", "刷新")}
        >
          <Icon name="rotate-cw" size={16} />
        </button>
        <input
          className="workbench-search workbench-browser-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="http://localhost:3000"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          aria-label={t("URL", "URL")}
        />
        <button className="workbench-primary workbench-browser-go" type="submit">
          {t("Go", "前往")}
        </button>
        <button
          className="icon-button workbench-browser-action"
          type="button"
          disabled={!currentUrl}
          onClick={() => void openExternal()}
          aria-label={t("Open externally", "在外部浏览器中打开")}
          title={t("Open externally", "在外部浏览器中打开")}
        >
          <Icon name="monitor" size={16} />
        </button>
      </form>
      {currentUrl ? (
        <iframe
          key={`${history.index}:${frameVersion}`}
          className="workbench-browser-frame"
          src={currentUrl}
          title={t("Embedded browser", "内嵌浏览器")}
          sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="workbench-browser-empty">
          {t("Enter an HTTP(S) URL to preview it here.", "输入 HTTP(S) URL 在此预览。")}
        </div>
      )}
      <p className="workbench-browser-hint">
        {t(
          "Some sites block embedding; use Open externally when needed.",
          "部分网站禁止内嵌；需要时请在外部浏览器中打开。",
        )}
      </p>
    </div>
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
  const path = icon === "plan"
    ? "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"
    : icon === "review"
      ? "M8 7h8M8 12h8M8 17h5M5 7h.01M5 12h.01M5 17h.01"
    : icon === "terminal"
      ? "m5 7 5 5-5 5M12 17h7"
      : icon === "browser"
        ? "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-8-9h16M12 3c2.2 2.4 3.2 5.4 3.2 9S14.2 18.6 12 21c-2.2-2.4-3.2-5.4-3.2-9S9.8 5.4 12 3Z"
        : icon === "files"
          ? "M4 6.5A2.5 2.5 0 0 1 6.5 4H10l2 2h5.5A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-9Z"
          : "M12 5v14M5 12h14";
  return <Icon path={path} size={18} strokeWidth={1.55} />;
}

function getWorkbenchTitle(view: WorkbenchView, t: (en: string, zhCN: string, values?: Record<string, string | number>) => string): string {
  if (view === "plan") return t("Plan", "计划");
  if (view === "review") return t("Review", "审阅");
  if (view === "terminal") return t("Terminals", "终端");
  if (view === "browser") return t("Browser", "浏览器");
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
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
