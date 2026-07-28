import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type {
  AutomationDestination,
  AutomationInput,
  AutomationKind,
  AutomationModel,
  AutomationNotificationPolicy,
  AutomationRecord,
  AutomationRun,
  AutomationRunAction,
  AutomationRunStatus,
} from "../../ipc/api";
import type { ThinkingLevel } from "../../ipc/types";
import { useStore } from "../../store";
import { PRIMARY_TASK_ID } from "../../store/taskRegistry";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { showToast } from "../Toast";

interface AutomationsProps {
  onClose: () => void;
}

interface AutomationDraft {
  name: string;
  prompt: string;
  cwd: string;
  rrule: string;
  kind: AutomationKind;
  destination: AutomationDestination;
  notificationPolicy: AutomationNotificationPolicy;
  model?: AutomationModel;
  reasoningEffort?: ThinkingLevel;
}

type RunFilter = "current" | "unread" | "archived";

const SCHEDULE_PRESETS = [
  { id: "hourly", rrule: "FREQ=HOURLY;INTERVAL=1;BYMINUTE=0" },
  { id: "daily", rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0" },
  { id: "weekdays", rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0" },
  { id: "weekly", rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;BYHOUR=9;BYMINUTE=0" },
] as const;
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split("Error: ").pop()?.trim() || raw;
}

function presetId(rrule: string): string {
  return SCHEDULE_PRESETS.find((preset) => preset.rrule === rrule)?.id ?? "custom";
}

function hasRunningRun(automation: AutomationRecord): boolean {
  return automation.runs.some((run) => run.status === "running");
}

function isUnreadRun(run: AutomationRun): boolean {
  return run.status !== "running" && !run.readAt && !run.archivedAt;
}

function modelValue(model: { provider: string; id: string }): string {
  return `${encodeURIComponent(model.provider)}:${encodeURIComponent(model.id)}`;
}

export function Automations({ onClose }: AutomationsProps) {
  const { resolvedLanguage, t } = useI18n();
  const workspaceCwd = useStore((state) => state.workspaceCwd);
  const commands = useStore((state) => state.commands);
  const models = useStore((state) => state.models);
  const session = useStore((state) => state.session);
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [runFilter, setRunFilter] = useState<RunFilter>("current");
  const [editorId, setEditorId] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<AutomationDraft>({
    name: "",
    prompt: "",
    cwd: workspaceCwd,
    rrule: SCHEDULE_PRESETS[1].rrule,
    kind: "cron",
    destination: "local",
    notificationPolicy: "all",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRecord | null>(null);

  function replaceAutomation(updated: AutomationRecord): void {
    setAutomations((current) => current.some((automation) => automation.id === updated.id)
      ? current.map((automation) => automation.id === updated.id ? updated : automation)
      : [updated, ...current]);
  }

  async function load(): Promise<void> {
    setLoading(true);
    setLoadError(null);
    try {
      setAutomations(await api.listAutomations());
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return api.onAutomationsChanged((payload) => setAutomations(payload.automations));
  }, []);

  const promptTemplates = useMemo(() => commands.filter((command) =>
    command.source === "prompt" && (command.sourceInfo.scope !== "project" || draft.cwd === workspaceCwd)),
  [commands, draft.cwd, workspaceCwd]);
  const selectedModel = useMemo(() => draft.model
    ? models.find((model) => model.provider === draft.model?.provider && model.id === draft.model?.id)
    : undefined,
  [draft.model, models]);
  const availableThinkingLevels = useMemo(() => selectedModel?.reasoning
    ? THINKING_LEVELS.filter((level) => selectedModel.thinkingLevelMap?.[level] !== null)
    : [],
  [selectedModel]);

  const unreadCount = useMemo(() => automations.reduce(
    (count, automation) => count + automation.runs.filter(isUnreadRun).length,
    0,
  ), [automations]);
  const archivedCount = useMemo(() => automations.reduce(
    (count, automation) => count + automation.runs.filter((run) => Boolean(run.archivedAt)).length,
    0,
  ), [automations]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return automations.filter((automation) => {
      if (filter !== "all" && automation.status !== filter) return false;
      if (runFilter === "unread" && !automation.runs.some(isUnreadRun)) return false;
      if (runFilter === "archived" && !automation.runs.some((run) => run.archivedAt)) return false;
      if (!normalized) return true;
      return [
        automation.name,
        automation.prompt,
        automation.cwd,
        automation.rrule,
        automation.kind,
        automation.destination,
        automation.model?.provider ?? "",
        automation.model?.id ?? "",
        automation.thread?.sessionName ?? "",
      ]
        .some((value) => value.toLowerCase().includes(normalized));
    });
  }, [automations, filter, query, runFilter]);

  const locale = resolvedLanguage === "zh-CN" ? "zh-CN" : "en-US";
  function formatDate(value: string | null | undefined): string {
    if (!value) return t("Not scheduled", "未计划");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function scheduleLabel(rrule: string): string {
    switch (presetId(rrule)) {
      case "hourly": return t("Every hour at :00", "每小时整点");
      case "daily": return t("Every day at 09:00", "每天 09:00");
      case "weekdays": return t("Weekdays at 09:00", "工作日 09:00");
      case "weekly": return t("Mondays at 09:00", "每周一 09:00");
      default: return rrule;
    }
  }

  function runStatusLabel(status: AutomationRunStatus): string {
    if (status === "running") return t("Running", "运行中");
    if (status === "success") return t("Completed", "已完成");
    return t("Failed", "失败");
  }

  function thinkingLabel(level: ThinkingLevel | undefined): string {
    if (!level) return t("Provider default", "提供商默认");
    if (level === "off") return t("Off", "关闭");
    if (level === "minimal") return t("Minimal", "最少");
    if (level === "low") return t("Low", "低");
    if (level === "medium") return t("Medium", "中");
    if (level === "high") return t("High", "高");
    return t("Maximum", "最高");
  }

  function automationModelLabel(automation: AutomationRecord): string {
    if (!automation.model) return t("Backend default", "后端默认");
    const model = models.find((candidate) =>
      candidate.provider === automation.model?.provider && candidate.id === automation.model?.id);
    return `${model?.name ?? automation.model.id} · ${thinkingLabel(automation.reasoningEffort)}`;
  }

  function openNew(): void {
    const currentModel = session?.model ? { provider: session.model.provider, id: session.model.id } : undefined;
    setDraft({
      name: "",
      prompt: "",
      cwd: workspaceCwd,
      rrule: SCHEDULE_PRESETS[1].rrule,
      kind: "cron",
      destination: "local",
      notificationPolicy: "all",
      ...(currentModel ? { model: currentModel } : {}),
      ...(currentModel && session?.model?.reasoning ? { reasoningEffort: session.thinkingLevel as ThinkingLevel } : {}),
    });
    setFormError(null);
    setEditorId("new");
  }

  function openEdit(automation: AutomationRecord): void {
    setDraft({
      name: automation.name,
      prompt: automation.prompt,
      cwd: automation.cwd,
      rrule: automation.rrule,
      kind: automation.kind,
      destination: automation.destination,
      notificationPolicy: automation.notificationPolicy,
      ...(automation.model ? { model: automation.model } : {}),
      ...(automation.reasoningEffort ? { reasoningEffort: automation.reasoningEffort } : {}),
    });
    setFormError(null);
    setEditorId(automation.id);
  }

  async function saveAutomation(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!editorId || saving) return;
    setSaving(true);
    setFormError(null);
    const input: AutomationInput = { ...draft };
    try {
      const saved = editorId === "new"
        ? await api.createAutomation(input)
        : await api.updateAutomation(editorId, input);
      replaceAutomation(saved);
      setEditorId(null);
      showToast(editorId === "new" ? t("Automation created", "自动任务已创建") : t("Automation updated", "自动任务已更新"), "success");
    } catch (error) {
      setFormError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function chooseAutomationWorkspace(): Promise<void> {
    try {
      const result = await api.pickTaskFolder();
      if (!result.canceled && result.cwd) setDraft((current) => ({ ...current, cwd: result.cwd ?? current.cwd }));
    } catch (error) {
      setFormError(errorText(error));
    }
  }

  async function runNow(automation: AutomationRecord): Promise<void> {
    if (busyId || hasRunningRun(automation)) return;
    setBusyId(automation.id);
    try {
      replaceAutomation(await api.runAutomationNow(automation.id));
      showToast(t("Automation started", "自动任务已启动"), "success");
    } catch (error) {
      showToast(t("Could not run automation: {error}", "运行自动任务失败：{error}", { error: errorText(error) }), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleStatus(automation: AutomationRecord): Promise<void> {
    if (busyId) return;
    setBusyId(automation.id);
    const status = automation.status === "active" ? "paused" : "active";
    try {
      replaceAutomation(await api.setAutomationStatus(automation.id, status));
    } catch (error) {
      showToast(t("Could not update automation: {error}", "更新自动任务失败：{error}", { error: errorText(error) }), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteAutomation(): Promise<void> {
    if (!deleteTarget || busyId) return;
    const target = deleteTarget;
    setBusyId(target.id);
    try {
      const deleted = await api.deleteAutomation(target.id);
      setAutomations((current) => current.filter((automation) => automation.id !== target.id));
      setDeleteTarget(null);
      if (deleted.worktreeCleanup?.removed === false) {
        showToast(t(
          "Automation deleted; its worktree was kept: {reason}",
          "自动任务已删除；工作树已保留：{reason}",
          { reason: deleted.worktreeCleanup.reason ?? t("local changes remain", "仍有本地更改") },
        ), "warning", 7000);
      } else {
        showToast(t("Automation deleted", "自动任务已删除"), "success");
      }
    } catch (error) {
      showToast(t("Could not delete automation: {error}", "删除自动任务失败：{error}", { error: errorText(error) }), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function updateRun(automation: AutomationRecord, run: AutomationRun, action: AutomationRunAction): Promise<void> {
    if (busyId || run.status === "running") return;
    setBusyId(automation.id);
    try {
      replaceAutomation(await api.updateAutomationRun(automation.id, run.id, action));
    } catch (error) {
      showToast(t("Could not update automation run: {error}", "更新自动任务运行记录失败：{error}", { error: errorText(error) }), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function openRun(automation: AutomationRecord, run: AutomationRun): Promise<void> {
    if (!run.sessionFile || busyId) return;
    setBusyId(automation.id);
    try {
      const result = await api.openAutomationRun(automation.id, run.id);
      if (result.cancelled) return;
      const targetTaskId = result.taskId ?? PRIMARY_TASK_ID;
      if (useStore.getState().taskRegistry.activeTaskId !== targetTaskId) {
        await useStore.getState().switchActiveTask(targetTaskId);
      } else if (targetTaskId === PRIMARY_TASK_ID) {
        await useStore.getState().resetForWorkspace(result.cwd);
      }
      onClose();
    } catch (error) {
      showToast(t("Could not open automation run: {error}", "打开自动任务记录失败：{error}", { error: errorText(error) }), "error");
    } finally {
      setBusyId(null);
    }
  }

  const editorAutomation = editorId && editorId !== "new"
    ? automations.find((automation) => automation.id === editorId)
    : undefined;
  const heartbeatTargetLabel = editorAutomation?.thread?.sessionName
    ?? editorAutomation?.thread?.sessionId
    ?? session?.sessionName
    ?? session?.sessionId;

  return (
    <section className="automations-page" aria-labelledby="automations-title">
      <header className="automations-header">
        <button className="icon-button automations-back" type="button" onClick={onClose} aria-label={t("Back to conversation", "返回对话")}>
          <Icon name="arrow-left" size={18} />
        </button>
        <div className="automations-heading">
          <h1 id="automations-title">{t("Scheduled tasks", "定时任务")}</h1>
          <p>{t("Run independent tasks or continue a bound conversation on a schedule.", "按计划运行独立任务，或继续指定的现有会话。")}</p>
        </div>
        <button className="dialog-btn dialog-btn-primary automations-new" type="button" onClick={openNew}>
          <Icon name="plus" size={15} />
          {t("New automation", "新建自动任务")}
        </button>
      </header>

      <div className="automations-toolbar">
        <label className="automations-search">
          <Icon name="search" size={17} />
          <span className="sr-only">{t("Search automations", "搜索自动任务")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search scheduled tasks", "搜索定时任务")}
          />
        </label>
        <div className="automations-filters" role="group" aria-label={t("Automation status", "自动任务状态")}>
          {(["all", "active", "paused"] as const).map((value) => (
            <button
              className={filter === value ? "active" : ""}
              type="button"
              aria-pressed={filter === value}
              key={value}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? t("All", "全部") : value === "active" ? t("Active", "启用") : t("Paused", "暂停")}
            </button>
          ))}
        </div>
        <div className="automations-filters automations-run-filters" role="group" aria-label={t("Automation runs", "自动任务运行记录")}>
          <button
            className={`automations-run-filter-current ${runFilter === "current" ? "active" : ""}`}
            type="button"
            aria-pressed={runFilter === "current"}
            onClick={() => setRunFilter("current")}
          >
            {t("Current", "当前")}
          </button>
          <button
            className={`automations-run-filter-unread ${runFilter === "unread" ? "active" : ""}`}
            type="button"
            aria-pressed={runFilter === "unread"}
            onClick={() => setRunFilter("unread")}
          >
            {t("Unread ({count})", "未读（{count}）", { count: unreadCount })}
          </button>
          <button
            className={`automations-run-filter-archived ${runFilter === "archived" ? "active" : ""}`}
            type="button"
            aria-pressed={runFilter === "archived"}
            onClick={() => setRunFilter("archived")}
          >
            {t("Archived ({count})", "已归档（{count}）", { count: archivedCount })}
          </button>
        </div>
      </div>

      <div className="automations-content">
        {loadError && (
          <div className="automations-error" role="alert">
            <span>{loadError}</span>
            <button className="dialog-btn dialog-btn-secondary" type="button" onClick={() => void load()}>{t("Retry", "重试")}</button>
          </div>
        )}
        {loading && automations.length === 0 && <p className="automations-empty">{t("Loading scheduled tasks…", "正在加载定时任务…")}</p>}
        {!loading && !loadError && filtered.length === 0 && (
          <div className="automations-empty">
            <Icon name="calendar" size={24} />
            <strong>{query || filter !== "all" || runFilter !== "current" ? t("No matching automations", "没有匹配的自动任务") : t("No scheduled tasks yet", "尚无定时任务")}</strong>
            {!query && filter === "all" && runFilter === "current" && <button className="dialog-btn dialog-btn-primary" type="button" onClick={openNew}>{t("Create one", "创建一个")}</button>}
          </div>
        )}
        <div className="automations-list">
          {filtered.map((automation) => {
            const running = hasRunningRun(automation);
            const busy = busyId === automation.id;
            const unread = automation.runs.filter(isUnreadRun).length;
            const visibleRuns = automation.runs.filter((run) =>
              runFilter === "archived" ? Boolean(run.archivedAt) : runFilter === "unread" ? isUnreadRun(run) : !run.archivedAt,
            );
            return (
              <article className="automation-card" key={automation.id}>
                <div className="automation-card-header">
                  <div>
                    <div className="automation-title-row">
                      <h2>{automation.name}</h2>
                      <span className={`automation-status ${automation.status}`}>{automation.status === "active" ? t("Active", "启用") : t("Paused", "暂停")}</span>
                      {automation.lastRunStatus && (
                        <span className={`automation-run-status ${automation.lastRunStatus}`}>
                          {runStatusLabel(automation.lastRunStatus)}
                        </span>
                      )}
                      {unread > 0 && <span className="automation-unread-count">{t("{count} unread", "{count} 条未读", { count: unread })}</span>}
                    </div>
                    <p className="automation-prompt">{automation.prompt}</p>
                  </div>
                  <div className="automation-actions">
                    <button className="dialog-btn dialog-btn-secondary automation-run-now" type="button" disabled={busy || running} onClick={() => void runNow(automation)}>
                      {running ? t("Running…", "运行中…") : t("Run now", "立即运行")}
                    </button>
                    <button className="dialog-btn dialog-btn-secondary" type="button" disabled={busy} onClick={() => void toggleStatus(automation)}>
                      {automation.status === "active" ? t("Pause", "暂停") : t("Resume", "恢复")}
                    </button>
                    <button className="icon-button" type="button" disabled={busy || running} onClick={() => openEdit(automation)} aria-label={t("Edit {name}", "编辑 {name}", { name: automation.name })}>
                      <Icon name="pencil" size={16} />
                    </button>
                    <button className="icon-button automation-delete" type="button" disabled={busy || running} onClick={() => setDeleteTarget(automation)} aria-label={t("Delete {name}", "删除 {name}", { name: automation.name })}>
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
                <dl className="automation-meta">
                  <div><dt>{t("Schedule", "计划")}</dt><dd title={automation.rrule}>{scheduleLabel(automation.rrule)}</dd></div>
                  <div><dt>{t("Next run", "下次运行")}</dt><dd>{automation.status === "active" ? formatDate(automation.nextRunAt) : t("Paused", "已暂停")}</dd></div>
                  <div><dt>{t("Mode", "模式")}</dt><dd>{automation.kind === "heartbeat"
                    ? t("Conversation heartbeat", "会话心跳")
                    : automation.destination === "worktree"
                      ? t("Independent · worktree", "独立任务 · 工作树")
                      : t("Independent · local", "独立任务 · 本地")}</dd></div>
                  <div><dt>{t("Workspace", "工作区")}</dt><dd title={automation.cwd}>{automation.cwd}</dd></div>
                  <div><dt>{t("Model", "模型")}</dt><dd title={automation.model ? `${automation.model.provider}/${automation.model.id}` : undefined}>{automationModelLabel(automation)}</dd></div>
                  <div><dt>{t("Notifications", "通知")}</dt><dd>{automation.notificationPolicy === "failures" ? t("Failures only", "仅失败") : t("All runs", "全部运行")}</dd></div>
                </dl>
                {automation.lastError && <p className="automation-last-error" role="status">{automation.lastError}</p>}
                <details className="automation-history">
                  <summary>{runFilter === "archived"
                    ? t("Archived runs ({count})", "已归档运行（{count}）", { count: visibleRuns.length })
                    : runFilter === "unread"
                      ? t("Unread runs ({count})", "未读运行（{count}）", { count: visibleRuns.length })
                      : t("Previous runs ({count})", "历史运行（{count}）", { count: visibleRuns.length })}</summary>
                  {visibleRuns.length === 0 ? (
                    <p>{runFilter === "current" ? t("This automation has not run yet.", "此自动任务尚未运行。") : t("No runs in this view.", "此视图中没有运行记录。")}</p>
                  ) : (
                    <ul>
                      {visibleRuns.map((run) => (
                        <li className={`${isUnreadRun(run) ? "automation-run-unread" : ""} ${run.archivedAt ? "automation-run-archived" : ""}`} key={run.id}>
                          <span className={`automation-run-status ${run.status}`}>{runStatusLabel(run.status)}</span>
                          <span>{formatDate(run.startedAt)}</span>
                          <span className="automation-run-error" title={run.error}>{run.error}</span>
                          {run.status !== "running" && (
                            <span className="automation-run-actions">
                              {run.sessionFile && (
                                <button className="automation-open-run" type="button" disabled={busy} onClick={() => void openRun(automation, run)}>
                                  {t("Open session", "打开会话")}
                                </button>
                              )}
                              {!run.archivedAt && (
                                <button className="automation-run-mark-read" type="button" disabled={busy} onClick={() => void updateRun(automation, run, run.readAt ? "unread" : "read")}>
                                  {run.readAt ? t("Mark unread", "标为未读") : t("Mark read", "标为已读")}
                                </button>
                              )}
                              <button className={run.archivedAt ? "automation-run-restore" : "automation-run-archive"} type="button" disabled={busy} onClick={() => void updateRun(automation, run, run.archivedAt ? "restore" : "archive")}>
                                {run.archivedAt ? t("Restore", "恢复") : t("Archive", "归档")}
                              </button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </article>
            );
          })}
        </div>
      </div>

      <Dialog
        open={editorId !== null}
        title={editorId === "new" ? t("New automation", "新建自动任务") : t("Edit automation", "编辑自动任务")}
        className="automation-editor-dialog"
        onClose={saving ? undefined : () => setEditorId(null)}
        actions={
          <>
            <button className="dialog-btn dialog-btn-secondary" type="button" disabled={saving} onClick={() => setEditorId(null)}>{t("Cancel", "取消")}</button>
            <button className="dialog-btn dialog-btn-primary" type="submit" form="automation-editor-form" disabled={saving}>{saving ? t("Saving…", "正在保存…") : t("Save", "保存")}</button>
          </>
        }
      >
        <form id="automation-editor-form" className="automation-form" onSubmit={saveAutomation}>
          <label>
            <span>{t("Name", "名称")}</span>
            <input name="name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={120} required autoFocus />
          </label>
          <label>
            <span>{t("Automation type", "自动任务类型")}</span>
            <select
              name="kind"
              value={draft.kind}
              disabled={editorId !== "new"}
              onChange={(event) => setDraft((current) => {
                const kind = event.target.value as AutomationKind;
                return {
                  ...current,
                  kind,
                  ...(kind === "heartbeat" ? { cwd: workspaceCwd, destination: "local" as const } : {}),
                };
              })}
            >
              <option value="cron">{t("Independent scheduled task", "独立定时任务")}</option>
              <option value="heartbeat">{t("Continue current conversation", "继续当前会话")}</option>
            </select>
          </label>
          {draft.kind === "heartbeat" && (
            <p className="automation-target-note">{t(
              "The main process will bind this automation to the current conversation: {session}",
              "主进程会将此自动任务绑定到当前会话：{session}",
              { session: heartbeatTargetLabel ?? t("current conversation", "当前会话") },
            )}</p>
          )}
          {promptTemplates.length > 0 && (
            <label>
              <span>{t("Prompt template", "提示词模板")}</span>
              <select
                name="template"
                value=""
                onChange={(event) => {
                  if (event.target.value) setDraft((current) => ({ ...current, prompt: `/${event.target.value}` }));
                }}
              >
                <option value="">{t("Choose a loaded template…", "选择已加载的模板…")}</option>
                {promptTemplates.map((template) => (
                  <option value={template.name} key={`${template.sourceInfo.path}:${template.name}`}>
                    {template.description ? `${template.name} — ${template.description}` : template.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>{t("Prompt", "提示词")}</span>
            <textarea name="prompt" value={draft.prompt} onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} maxLength={20_000} rows={6} required />
          </label>
          <label>
            <span>{t("Workspace", "工作区")}</span>
            <span className="automation-workspace-field">
              <input name="cwd" value={draft.cwd} disabled={draft.kind === "heartbeat" || (editorId !== "new" && draft.destination === "worktree")} onChange={(event) => setDraft((current) => ({ ...current, cwd: event.target.value }))} maxLength={4096} required />
              <button className="dialog-btn dialog-btn-secondary" type="button" disabled={draft.kind === "heartbeat" || (editorId !== "new" && draft.destination === "worktree")} onClick={() => void chooseAutomationWorkspace()}>{t("Browse…", "浏览…")}</button>
            </span>
          </label>
          <label>
            <span>{t("Run destination", "运行目标")}</span>
            <select
              name="destination"
              value={draft.destination}
              disabled={draft.kind === "heartbeat" || editorId !== "new"}
              onChange={(event) => setDraft((current) => ({
                ...current,
                destination: event.target.value as AutomationDestination,
              }))}
            >
              <option value="local">{t("Local workspace", "本地工作区")}</option>
              <option value="worktree">{t("Dedicated git worktree", "专属 Git 工作树")}</option>
            </select>
          </label>
          {draft.destination === "worktree" && (
            <p className="automation-target-note">{t(
              "A dedicated task branch and worktree are retained for this automation. Deleting it removes a clean worktree; local changes are kept.",
              "此自动任务会保留专属任务分支和工作树。删除时仅清理干净的工作树；本地更改会保留。",
            )}</p>
          )}
          <label>
            <span>{t("Model", "模型")}</span>
            <select
              name="model"
              value={draft.model ? modelValue(draft.model) : ""}
              onChange={(event) => {
                const model = models.find((candidate) => modelValue(candidate) === event.target.value);
                setDraft((current) => ({
                  ...current,
                  model: model ? { provider: model.provider, id: model.id } : undefined,
                  reasoningEffort: model?.reasoning ? current.reasoningEffort : undefined,
                }));
              }}
            >
              <option value="">{t("Backend default", "后端默认")}</option>
              {draft.model && !selectedModel && (
                <option value={modelValue(draft.model)}>{`${draft.model.id} — ${draft.model.provider} (${t("unavailable", "不可用")})`}</option>
              )}
              {models.map((model) => (
                <option value={modelValue(model)} key={modelValue(model)}>{`${model.name ?? model.id} — ${model.provider}`}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("Reasoning effort", "推理强度")}</span>
            <select
              name="reasoningEffort"
              value={draft.reasoningEffort ?? ""}
              disabled={!selectedModel?.reasoning}
              onChange={(event) => setDraft((current) => ({
                ...current,
                reasoningEffort: event.target.value ? event.target.value as ThinkingLevel : undefined,
              }))}
            >
              <option value="">{t("Provider default", "提供商默认")}</option>
              {draft.reasoningEffort && !availableThinkingLevels.includes(draft.reasoningEffort) && (
                <option value={draft.reasoningEffort}>{thinkingLabel(draft.reasoningEffort)}</option>
              )}
              {availableThinkingLevels.map((level) => <option value={level} key={level}>{thinkingLabel(level)}</option>)}
            </select>
          </label>
          <label>
            <span>{t("Common schedule", "常用计划")}</span>
            <select
              name="schedule"
              value={presetId(draft.rrule)}
              onChange={(event) => {
                const preset = SCHEDULE_PRESETS.find((candidate) => candidate.id === event.target.value);
                if (preset) setDraft((current) => ({ ...current, rrule: preset.rrule }));
              }}
            >
              <option value="hourly">{t("Every hour", "每小时")}</option>
              <option value="daily">{t("Every day at 09:00", "每天 09:00")}</option>
              <option value="weekdays">{t("Weekdays at 09:00", "工作日 09:00")}</option>
              <option value="weekly">{t("Mondays at 09:00", "每周一 09:00")}</option>
              <option value="custom">{t("Custom RRULE", "自定义 RRULE")}</option>
            </select>
          </label>
          <label>
            <span>{t("RRULE (local time)", "RRULE（本地时间）")}</span>
            <input name="rrule" className="automation-rrule-input" value={draft.rrule} onChange={(event) => setDraft((current) => ({ ...current, rrule: event.target.value }))} maxLength={500} required spellCheck={false} />
          </label>
          <label>
            <span>{t("Notifications", "通知")}</span>
            <select
              name="notificationPolicy"
              value={draft.notificationPolicy}
              onChange={(event) => setDraft((current) => ({
                ...current,
                notificationPolicy: event.target.value as AutomationNotificationPolicy,
              }))}
            >
              <option value="all">{t("All completed and failed runs", "所有完成和失败的运行")}</option>
              <option value="failures">{t("Failed runs only", "仅失败运行")}</option>
            </select>
          </label>
          <p className="automation-permission-note">{t("Background runs use Auto tool permissions. Heartbeats exclusively lock their bound session while running; independent tasks keep separate session history.", "后台运行使用“自动”工具权限。会话心跳运行时会独占绑定会话；独立任务保留各自的会话历史。")}</p>
          {formError && <p className="automation-form-error" role="alert">{formError}</p>}
        </form>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        title={t("Delete automation?", "删除自动任务？")}
        onClose={busyId ? undefined : () => setDeleteTarget(null)}
        actions={
          <>
            <button className="dialog-btn dialog-btn-secondary" type="button" disabled={Boolean(busyId)} onClick={() => setDeleteTarget(null)}>{t("Cancel", "取消")}</button>
            <button className="dialog-btn dialog-btn-danger" type="button" disabled={Boolean(busyId)} onClick={() => void deleteAutomation()}>{t("Delete", "删除")}</button>
          </>
        }
      >
        <p>{deleteTarget?.worktree
          ? t("Delete {name} and its schedule? Its clean worktree will be removed; a worktree with local changes will be kept.", "删除 {name} 及其计划？干净的工作树会被清理；存在本地更改的工作树会保留。", { name: deleteTarget.name })
          : t("Delete {name} and its schedule? Existing session files remain available in thread history.", "删除 {name} 及其计划？已有会话文件仍保留在线程历史中。", { name: deleteTarget?.name ?? "" })}</p>
      </Dialog>
    </section>
  );
}
