import { useI18n } from "../../i18n";
import { useStore } from "../../store";
import type { SessionState } from "../../ipc/types";
import type { CompactionActivity } from "../../store/agentActivity";

interface StatusBarContentSnapshot {
  session: SessionState | null;
  isStreaming: boolean;
  compactionActivity: CompactionActivity | null;
}

export function hasStatusBarContent({
  session,
  isStreaming,
  compactionActivity,
}: StatusBarContentSnapshot): boolean {
  // Run state (streaming, compaction) and context/token stats now live in the
  // composer's ContextMeter. The sticky status row only carries the one thing
  // the meter does not: messages queued behind the current run.
  const isCompacting = compactionActivity !== null || Boolean(session?.isCompacting);
  return !isStreaming && !isCompacting && (session?.pendingMessageCount ?? 0) > 0;
}

export function StatusBar() {
  const { t } = useI18n();
  const session = useStore((state) => state.session);
  const isStreaming = useStore((state) => state.isStreaming);
  const compactionActivity = useStore((state) => state.compactionActivity);

  const pendingCount = session?.pendingMessageCount ?? 0;
  const isCompacting = compactionActivity !== null || Boolean(session?.isCompacting);

  // Keep the pending badge out of the way while a run/compaction is active — the
  // ContextMeter already signals that work is in flight.
  if (isStreaming || isCompacting || pendingCount === 0) return null;

  return (
    <div className="session-status">
      <span className="status-pending" role="status" aria-live="polite">
        {t("{count} pending", "{count} 条待处理", { count: pendingCount })}
      </span>
    </div>
  );
}
