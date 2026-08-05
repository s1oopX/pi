import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type {
  AutomationDestination,
  AutomationInput,
  AutomationKind,
  AutomationModel,
  AutomationNotificationPolicy,
  AutomationPromptTemplate,
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
import {
  AUTOMATION_WEEKDAYS,
  buildAutomationRRule,
  defaultAutomationSchedule,
  parseAutomationSchedule,
  type AutomationSchedule,
  type AutomationScheduleMode,
  type AutomationWeekday,
} from "./automationSchedule";

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
  promptTemplate?: AutomationPromptTemplate;
}

interface PackageScheduledTask {
  ref: AutomationPromptTemplate;
  name: string;
  prompt: string;
  rrule: string;
  description?: string;
}

type RunFilter = "current" | "unread" | "archived";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split("Error: ").pop()?.trim() || raw;
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
  const backendReady = useStore((state) => state.backendStatus.ready);
  const isStreaming = useStore((state) => state.isStreaming);
  const setComposerDraft = useStore((state) => state.setComposerDraft);
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
    rrule: buildAutomationRRule(defaultAutomationSchedule()),
    kind: "cron",
    destination: "local",
    notificationPolicy: "all",
  });
  const [scheduleMode, setScheduleMode] = useState<AutomationScheduleMode>("daily");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRecord | null>(null);
  const [archiveRunsTarget, setArchiveRunsTarget] = useState<{
    automation: AutomationRecord;
    runs: AutomationRun[];
  } | null>(null);
  const [resetTemplateTarget, setResetTemplateTarget] = useState<{
    automation: AutomationRecord;
    template: PackageScheduledTask;
  } | null>(null);

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

  const packageScheduledTasks = useMemo(() => commands.flatMap((command): PackageScheduledTask[] => {
    const scheduledTask = command.scheduledTask;
    const scope = command.sourceInfo.scope;
    if (
      command.source !== "prompt"
      || command.sourceInfo.origin !== "package"
      || (scope !== "user" && scope !== "project")
      || !scheduledTask?.name.trim()
      || !scheduledTask.prompt.trim()
      || !scheduledTask.rrule.trim()
    ) return [];
    return [{
      ref: { source: command.sourceInfo.source, scope, name: command.name },
      name: scheduledTask.name,
      prompt: scheduledTask.prompt,
      rrule: scheduledTask.rrule,
      description: command.description,
    }];
  }), [commands]);
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
  const schedule = useMemo(() => parseAutomationSchedule(draft.rrule), [draft.rrule]);

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
    const parsed = parseAutomationSchedule(rrule);
    switch (parsed.mode) {
      case "hourly":
        return parsed.interval === 1
          ? t("Every hour at :{minute}", "每小时第 {minute} 分钟", { minute: String(parsed.minute).padStart(2, "0") })
          : t("Every {interval} hours at :{minute}", "每 {interval} 小时第 {minute} 分钟", {
              interval: parsed.interval,
              minute: String(parsed.minute).padStart(2, "0"),
            });
      case "daily":
        return parsed.interval === 1
          ? t("Every day at {time}", "每天 {time}", { time: parsed.time })
          : t("Every {interval} days at {time}", "每 {interval} 天 {time}", { interval: parsed.interval, time: parsed.time });
      case "weekdays":
        return parsed.interval === 1
          ? t("Weekdays at {time}", "工作日 {time}", { time: parsed.time })
          : t("Every {interval} weeks on weekdays at {time}", "每 {interval} 周的工作日 {time}", { interval: parsed.interval, time: parsed.time });
      case "weekly":
        return parsed.interval === 1
          ? t("Every {weekday} at {time}", "每周{weekday} {time}", { weekday: weekdayLabel(parsed.weekday), time: parsed.time })
          : t("Every {interval} weeks on {weekday} at {time}", "每 {interval} 周的{weekday} {time}", {
              interval: parsed.interval,
              weekday: weekdayLabel(parsed.weekday),
              time: parsed.time,
            });
      default:
        return rrule;
    }
  }

  function weekdayLabel(weekday: AutomationWeekday): string {
    const labels: Record<AutomationWeekday, string> = {
      MO: t("Monday", "星期一"),
      TU: t("Tuesday", "星期二"),
      WE: t("Wednesday", "星期三"),
      TH: t("Thursday", "星期四"),
      FR: t("Friday", "星期五"),
      SA: t("Saturday", "星期六"),
      SU: t("Sunday", "星期日"),
    };
    return labels[weekday];
  }

  function runStatusLabel(status: AutomationRunStatus): string {
    if (status === "running") return t("Running", "运行中");
    if (status === "success") return t("Completed", "已完成");
    return t("Failed", "失败");
  }

  function thinkingLabel(level: ThinkingLevel | undefined): string {
    if (!level) return t("Provider default", "提供商默认");
    if (level === "off") return t("Off", "关闭");
    if (level === "minimal") return t("Minimum", "最低");
    if (level === "low") return t("Low", "低");
    if (level === "medium") return t("Medium", "中");
    if (level === "high") return t("High", "高");
    if (level === "xhigh") return t("Extra high", "极高");
    return t("Maximum", "最高");
  }

  function automationModelLabel(automation: AutomationRecord): string {
    if (!automation.model) return t("Backend default", "后端默认");
    const model = models.find((candidate) =>
      candidate.provider === automation.model?.provider && candidate.id === automation.model?.id);
    return `${model?.name ?? automation.model.id} · ${thinkingLabel(automation.reasoningEffort)}`;
  }

  function openNew(template?: PackageScheduledTask): void {
    const currentModel = session?.model ? { provider: session.model.provider, id: session.model.id } : undefined;
    const rrule = template?.rrule ?? buildAutomationRRule(defaultAutomationSchedule());
    setDraft({
      name: template?.name ?? "",
      prompt: template?.prompt ?? "",
      cwd: workspaceCwd,
      rrule,
      kind: "cron",
      destination: "local",
      notificationPolicy: "all",
      ...(currentModel ? { model: currentModel } : {}),
      ...(currentModel && session?.model?.reasoning ? { reasoningEffort: session.thinkingLevel as ThinkingLevel } : {}),
      ...(template ? { promptTemplate: template.ref } : {}),
    });
    setScheduleMode(parseAutomationSchedule(rrule).mode);
    setFormError(null);
    setEditorId("new");
  }

  async function createWithPi(): Promise<void> {
    if (creatingChat) return;
    if (!backendReady) {
      showToast(t("The agent backend is not ready", "智能体后端尚未就绪"), "error");
      return;
    }
    if (isStreaming) {
      showToast(t("Finish or stop the current run before creating a new thread.", "请先完成或停止当前运行，再新建会话。"), "warning");
      return;
    }
    setCreatingChat(true);
    try {
      const result = await api.newSession(workspaceCwd);
      if (result.cancelled) return;
      await useStore.getState().resetForWorkspace(result.cwd);
      setComposerDraft(t(
        "Let's set up a scheduled task together. First, explain how scheduled tasks work in Pi Studio. Then interview me to figure out what I need scheduled and when it should run.",
        "让我们一起设置一个定时任务。请先说明 Pi Studio 的定时任务如何工作，然后通过提问确认我需要安排什么任务以及何时运行。",
      ));
      onClose();
    } catch (error) {
      showToast(t("Could not start automation setup: {error}", "无法开始设置自动任务：{error}", {
        error: errorText(error),
      }), "error");
    } finally {
      setCreatingChat(false);
    }
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
      ...(automation.promptTemplate ? { promptTemplate: automation.promptTemplate } : {}),
    });
    setScheduleMode(parseAutomationSchedule(automation.rrule).mode);
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

  function updateStructuredSchedule(patch: Partial<AutomationSchedule>): void {
    setDraft((current) => {
      const parsed = parseAutomationSchedule(current.rrule);
      const base = parsed.mode === scheduleMode ? parsed : defaultAutomationSchedule(scheduleMode);
      return { ...current, rrule: buildAutomationRRule({ ...base, ...patch, mode: scheduleMode }) };
    });
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

  async function resetPromptTemplateDefaults(): Promise<void> {
    if (!resetTemplateTarget || busyId) return;
    const { automation, template } = resetTemplateTarget;
    setBusyId(automation.id);
    try {
      replaceAutomation(await api.updateAutomation(automation.id, {
        name: template.name,
        prompt: template.prompt,
        cwd: automation.cwd,
        rrule: template.rrule,
        kind: automation.kind,
        destination: automation.destination,
        notificationPolicy: automation.notificationPolicy,
        promptTemplate: template.ref,
        ...(automation.model ? { model: automation.model } : {}),
        ...(automation.reasoningEffort ? { reasoningEffort: automation.reasoningEffort } : {}),
      }));
      setResetTemplateTarget(null);
      showToast(t("Package defaults restored", "已恢复包默认值"), "success");
    } catch (error) {
      showToast(t("Could not reset automation: {error}", "无法重置自动任务：{error}", {
        error: errorText(error),
      }), "error");
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

  async function updateRuns(
    automation: AutomationRecord,
    runs: AutomationRun[],
    action: "read" | "archive",
  ): Promise<void> {
    if (busyId || runs.length === 0) return;
    setBusyId(automation.id);
    let updated = automation;
    let failed = 0;
    try {
      for (const run of runs) {
        try {
          updated = await api.updateAutomationRun(automation.id, run.id, action);
        } catch {
          failed += 1;
        }
      }
      replaceAutomation(updated);
      const succeeded = runs.length - failed;
      if (failed > 0) {
        showToast(t(
          "Updated {succeeded} runs; {failed} failed.",
          "已更新 {succeeded} 条运行记录；{failed} 条失败。",
          { succeeded, failed },
        ), "warning");
      } else {
        showToast(action === "read"
          ? t("Marked {count} runs as read", "已将 {count} 条运行记录标为已读", { count: succeeded })
          : t("Archived {count} runs", "已归档 {count} 条运行记录", { count: succeeded }), "success");
      }
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
        <div className="automations-create-actions">
          <button className="dialog-btn dialog-btn-primary automations-create-with-pi" type="button" disabled={creatingChat} onClick={() => void createWithPi()}>
            <Icon name="activity" size={15} />
            {creatingChat ? t("Starting…", "正在启动…") : t("Create with Pi", "使用 Pi 创建")}
          </button>
          <button className="dialog-btn dialog-btn-secondary automations-new" type="button" disabled={creatingChat} onClick={() => openNew()}>
            <Icon name="plus" size={15} />
            {t("Set up manually", "手动设置")}
          </button>
        </div>
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
        {packageScheduledTasks.length > 0 && (
          <section className="automations-package-templates" aria-labelledby="automations-package-templates-title">
            <div className="automations-package-templates-heading">
              <h2 id="automations-package-templates-title">{t("From Pi packages", "来自 Pi 包")}</h2>
              <p>{t("Start from defaults provided by installed packages.", "使用已安装包提供的默认值创建任务。")}</p>
            </div>
            <div className="automations-package-templates-grid">
              {packageScheduledTasks.map((template) => (
                <button
                  className="automation-package-template"
                  type="button"
                  disabled={creatingChat}
                  onClick={() => openNew(template)}
                  key={`${template.ref.scope}:${template.ref.source}:${template.ref.name}`}
                >
                  <strong>{template.name}</strong>
                  <span>{template.description || template.prompt}</span>
                  <small>{template.ref.source} · {scheduleLabel(template.rrule)}</small>
                </button>
              ))}
            </div>
          </section>
        )}
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
            {!query && filter === "all" && runFilter === "current" && <button className="dialog-btn dialog-btn-primary" type="button" onClick={() => openNew()}>{t("Create one", "创建一个")}</button>}
          </div>
        )}
        <div className="automations-list">
          {filtered.map((automation) => {
            const running = hasRunningRun(automation);
            const busy = busyId === automation.id;
            const unread = automation.runs.filter(isUnreadRun).length;
            const unreadRuns = automation.runs.filter(isUnreadRun);
            const archiveableRuns = automation.runs.filter((run) => run.status !== "running" && !run.archivedAt);
            const visibleRuns = automation.runs.filter((run) =>
              runFilter === "archived" ? Boolean(run.archivedAt) : runFilter === "unread" ? isUnreadRun(run) : !run.archivedAt,
            );
            const linkedTemplate = automation.promptTemplate
              ? packageScheduledTasks.find((template) =>
                  template.ref.source === automation.promptTemplate?.source
                  && template.ref.scope === automation.promptTemplate.scope
                  && template.ref.name === automation.promptTemplate.name)
              : undefined;
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
                    {linkedTemplate && (
                      <button className="dialog-btn dialog-btn-secondary automation-reset-template" type="button" disabled={busy || running} onClick={() => setResetTemplateTarget({ automation, template: linkedTemplate })}>
                        {t("Reset to package defaults", "恢复包默认值")}
                      </button>
                    )}
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
                  {automation.promptTemplate && <div><dt>{t("Package", "包")}</dt><dd className="automation-template-source" title={automation.promptTemplate.source}>{automation.promptTemplate.source}</dd></div>}
                </dl>
                {automation.lastError && <p className="automation-last-error" role="status">{automation.lastError}</p>}
                <details className="automation-history">
                  <summary>{runFilter === "archived"
                    ? t("Archived runs ({count})", "已归档运行（{count}）", { count: visibleRuns.length })
                    : runFilter === "unread"
                      ? t("Unread runs ({count})", "未读运行（{count}）", { count: visibleRuns.length })
                      : t("Previous runs ({count})", "历史运行（{count}）", { count: visibleRuns.length })}</summary>
                  {runFilter !== "archived" && automation.runs.length > 0 && (
                    <div className="automation-history-bulk">
                      <button
                        className="automation-runs-mark-all-read"
                        type="button"
                        disabled={busy || unreadRuns.length === 0}
                        onClick={() => void updateRuns(automation, unreadRuns, "read")}
                      >
                        {t("Mark all as read", "全部标为已读")}
                      </button>
                      <button
                        className="automation-runs-archive-all"
                        type="button"
                        disabled={busy || archiveableRuns.length === 0}
                        onClick={() => setArchiveRunsTarget({ automation, runs: archiveableRuns })}
                      >
                        {t("Archive all", "全部归档")}
                      </button>
                    </div>
                  )}
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
            <span>{t("Repeat", "重复")}</span>
            <select
              name="schedule"
              value={scheduleMode}
              onChange={(event) => {
                const mode = event.target.value as AutomationScheduleMode;
                setScheduleMode(mode);
                if (mode !== "custom") {
                  setDraft((current) => ({ ...current, rrule: buildAutomationRRule(defaultAutomationSchedule(mode)) }));
                }
              }}
            >
              <option value="hourly">{t("Every hour", "每小时")}</option>
              <option value="daily">{t("Every day", "每天")}</option>
              <option value="weekdays">{t("Weekdays", "工作日")}</option>
              <option value="weekly">{t("Every week", "每周")}</option>
              <option value="custom">{t("Advanced RRULE", "高级 RRULE")}</option>
            </select>
          </label>
          {scheduleMode === "custom" ? (
            <label>
              <span>{t("RRULE (local time)", "RRULE（本地时间）")}</span>
              <input name="rrule" className="automation-rrule-input" value={draft.rrule} onChange={(event) => setDraft((current) => ({ ...current, rrule: event.target.value }))} maxLength={500} required spellCheck={false} />
            </label>
          ) : (
            <div className="automation-schedule-fields">
              <label>
                <span>{scheduleMode === "hourly"
                  ? t("Interval (hours)", "间隔（小时）")
                  : scheduleMode === "daily"
                    ? t("Interval (days)", "间隔（天）")
                    : t("Interval (weeks)", "间隔（周）")}</span>
                <input
                  name="scheduleInterval"
                  type="number"
                  min="1"
                  max="365"
                  value={schedule.interval}
                  onChange={(event) => {
                    const interval = Number(event.target.value);
                    if (Number.isSafeInteger(interval) && interval >= 1 && interval <= 365) updateStructuredSchedule({ interval });
                  }}
                  required
                />
              </label>
              {scheduleMode === "hourly" ? (
                <label>
                  <span>{t("At minute", "在第几分钟")}</span>
                  <input
                    name="scheduleMinute"
                    type="number"
                    min="0"
                    max="59"
                    value={schedule.minute}
                    onChange={(event) => {
                      const minute = Number(event.target.value);
                      if (Number.isSafeInteger(minute) && minute >= 0 && minute <= 59) updateStructuredSchedule({ minute });
                    }}
                    required
                  />
                </label>
              ) : (
                <>
                  {scheduleMode === "weekly" && (
                    <label>
                      <span>{t("On", "在星期几")}</span>
                      <select name="scheduleWeekday" value={schedule.weekday} onChange={(event) => updateStructuredSchedule({ weekday: event.target.value as AutomationWeekday })}>
                        {AUTOMATION_WEEKDAYS.map((weekday) => <option value={weekday} key={weekday}>{weekdayLabel(weekday)}</option>)}
                      </select>
                    </label>
                  )}
                  <label>
                    <span>{t("At", "时间")}</span>
                    <input name="scheduleTime" type="time" value={schedule.time} onChange={(event) => event.target.value && updateStructuredSchedule({ time: event.target.value })} required />
                  </label>
                </>
              )}
            </div>
          )}
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
        open={resetTemplateTarget !== null}
        title={t("Reset to package defaults?", "恢复包默认值？")}
        onClose={busyId ? undefined : () => setResetTemplateTarget(null)}
        actions={
          <>
            <button className="dialog-btn dialog-btn-secondary" type="button" disabled={Boolean(busyId)} onClick={() => setResetTemplateTarget(null)}>{t("Cancel", "取消")}</button>
            <button className="dialog-btn dialog-btn-danger automation-reset-template-confirm" type="button" disabled={Boolean(busyId)} onClick={() => void resetPromptTemplateDefaults()}>{t("Reset", "恢复")}</button>
          </>
        }
      >
        <p>{t(
          "Replace the customized name, prompt, and schedule with the current defaults from {source}? Model, destination, workspace, notifications, status, and history stay unchanged.",
          "使用 {source} 当前提供的默认值替换已自定义的名称、提示词和计划？模型、运行目标、工作区、通知、状态和历史记录保持不变。",
          { source: resetTemplateTarget?.template.ref.source ?? "" },
        )}</p>
      </Dialog>

      <Dialog
        open={archiveRunsTarget !== null}
        title={t("Archive all completed runs?", "归档所有已完成运行？")}
        onClose={busyId ? undefined : () => setArchiveRunsTarget(null)}
        actions={
          <>
            <button className="dialog-btn dialog-btn-secondary" type="button" disabled={Boolean(busyId)} onClick={() => setArchiveRunsTarget(null)}>{t("Cancel", "取消")}</button>
            <button
              className="dialog-btn dialog-btn-danger automation-archive-all-confirm"
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => {
                const target = archiveRunsTarget;
                if (!target) return;
                setArchiveRunsTarget(null);
                void updateRuns(target.automation, target.runs, "archive");
              }}
            >
              {t("Archive all", "全部归档")}
            </button>
          </>
        }
      >
        <p>{t(
          "Archive {count} completed runs? Their sessions remain available in the archived view.",
          "归档 {count} 条已完成运行记录？其会话仍可在已归档视图中访问。",
          { count: archiveRunsTarget?.runs.length ?? 0 },
        )}</p>
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
