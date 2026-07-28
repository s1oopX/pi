import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { AutomationInput, AutomationRecord, AutomationRun, AutomationRunStatus } from "../../ipc/api";
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
}

const SCHEDULE_PRESETS = [
  { id: "hourly", rrule: "FREQ=HOURLY;INTERVAL=1;BYMINUTE=0" },
  { id: "daily", rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0" },
  { id: "weekdays", rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0" },
  { id: "weekly", rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;BYHOUR=9;BYMINUTE=0" },
] as const;

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

export function Automations({ onClose }: AutomationsProps) {
  const { resolvedLanguage, t } = useI18n();
  const workspaceCwd = useStore((state) => state.workspaceCwd);
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [editorId, setEditorId] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<AutomationDraft>({
    name: "",
    prompt: "",
    cwd: workspaceCwd,
    rrule: SCHEDULE_PRESETS[1].rrule,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRecord | null>(null);

  function replaceAutomation(updated: AutomationRecord): void {
    setAutomations((current) => [updated, ...current.filter((automation) => automation.id !== updated.id)]);
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

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return automations.filter((automation) => {
      if (filter !== "all" && automation.status !== filter) return false;
      if (!normalized) return true;
      return [automation.name, automation.prompt, automation.cwd, automation.rrule]
        .some((value) => value.toLowerCase().includes(normalized));
    });
  }, [automations, filter, query]);

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

  function openNew(): void {
    setDraft({ name: "", prompt: "", cwd: workspaceCwd, rrule: SCHEDULE_PRESETS[1].rrule });
    setFormError(null);
    setEditorId("new");
  }

  function openEdit(automation: AutomationRecord): void {
    setDraft({ name: automation.name, prompt: automation.prompt, cwd: automation.cwd, rrule: automation.rrule });
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
      await api.deleteAutomation(target.id);
      setAutomations((current) => current.filter((automation) => automation.id !== target.id));
      setDeleteTarget(null);
      showToast(t("Automation deleted", "自动任务已删除"), "success");
    } catch (error) {
      showToast(t("Could not delete automation: {error}", "删除自动任务失败：{error}", { error: errorText(error) }), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function openRun(automation: AutomationRecord, run: AutomationRun): Promise<void> {
    if (!run.sessionFile || busyId) return;
    setBusyId(automation.id);
    try {
      if (useStore.getState().taskRegistry.activeTaskId !== PRIMARY_TASK_ID) {
        await useStore.getState().switchActiveTask(PRIMARY_TASK_ID);
      }
      const result = await api.openAutomationRun(automation.id, run.id);
      if (result.cancelled) return;
      await useStore.getState().resetForWorkspace(result.cwd);
      onClose();
    } catch (error) {
      showToast(t("Could not open automation run: {error}", "打开自动任务记录失败：{error}", { error: errorText(error) }), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="automations-page" aria-labelledby="automations-title">
      <header className="automations-header">
        <button className="icon-button automations-back" type="button" onClick={onClose} aria-label={t("Back to conversation", "返回对话")}>
          <Icon name="arrow-left" size={18} />
        </button>
        <div className="automations-heading">
          <h1 id="automations-title">{t("Scheduled tasks", "定时任务")}</h1>
          <p>{t("Run recurring prompts in independent, reopenable sessions.", "在独立且可重新打开的会话中运行周期提示词。")}</p>
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
            <strong>{query || filter !== "all" ? t("No matching automations", "没有匹配的自动任务") : t("No scheduled tasks yet", "尚无定时任务")}</strong>
            {!query && filter === "all" && <button className="dialog-btn dialog-btn-primary" type="button" onClick={openNew}>{t("Create one", "创建一个")}</button>}
          </div>
        )}
        <div className="automations-list">
          {filtered.map((automation) => {
            const running = hasRunningRun(automation);
            const busy = busyId === automation.id;
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
                  <div><dt>{t("Workspace", "工作区")}</dt><dd title={automation.cwd}>{automation.cwd}</dd></div>
                </dl>
                {automation.lastError && <p className="automation-last-error" role="status">{automation.lastError}</p>}
                <details className="automation-history">
                  <summary>{t("Previous runs ({count})", "历史运行（{count}）", { count: automation.runs.length })}</summary>
                  {automation.runs.length === 0 ? (
                    <p>{t("This automation has not run yet.", "此自动任务尚未运行。")}</p>
                  ) : (
                    <ul>
                      {automation.runs.map((run) => (
                        <li key={run.id}>
                          <span className={`automation-run-status ${run.status}`}>{runStatusLabel(run.status)}</span>
                          <span>{formatDate(run.startedAt)}</span>
                          {run.error && <span className="automation-run-error" title={run.error}>{run.error}</span>}
                          {run.sessionFile && run.status !== "running" && (
                            <button className="automation-open-run" type="button" disabled={busy} onClick={() => void openRun(automation, run)}>
                              {t("Open session", "打开会话")}
                            </button>
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
            <span>{t("Prompt", "提示词")}</span>
            <textarea name="prompt" value={draft.prompt} onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} maxLength={20_000} rows={6} required />
          </label>
          <label>
            <span>{t("Workspace", "工作区")}</span>
            <span className="automation-workspace-field">
              <input name="cwd" value={draft.cwd} onChange={(event) => setDraft((current) => ({ ...current, cwd: event.target.value }))} maxLength={4096} required />
              <button className="dialog-btn dialog-btn-secondary" type="button" onClick={() => void chooseAutomationWorkspace()}>{t("Browse…", "浏览…")}</button>
            </span>
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
          <p className="automation-permission-note">{t("Background runs use Auto tool permissions: normal workspace work proceeds; risky commands and writes outside the workspace are blocked.", "后台运行使用“自动”工具权限：正常工作区操作可继续；危险命令和工作区外写入会被阻止。")}</p>
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
        <p>{t("Delete {name} and its schedule? Existing session files remain available in thread history.", "删除 {name} 及其计划？已有会话文件仍保留在线程历史中。", { name: deleteTarget?.name ?? "" })}</p>
      </Dialog>
    </section>
  );
}
