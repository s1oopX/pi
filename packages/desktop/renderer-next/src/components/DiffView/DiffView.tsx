import { useMemo, useState } from "react";
import { html, parse } from "diff2html";
import type { DiffFile } from "diff2html/lib/types";
import { useI18n } from "../../i18n";
import {
  diffFileDisplayPath,
  diffFileStat,
  summarizeDiffStats,
  type DiffFileStat,
} from "./diffStats";

type OutputFormat = "side-by-side" | "line-by-line";

interface DiffViewProps {
  patch: string;
  defaultFormat?: OutputFormat;
}

export function DiffView({ patch, defaultFormat = "line-by-line" }: DiffViewProps) {
  const { t } = useI18n();
  const [format, setFormat] = useState<OutputFormat>(defaultFormat);
  // Files the user has explicitly collapsed. Keyed by display path so the set
  // stays stable across format toggles (which re-render but keep the files).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const diffFiles: DiffFile[] = useMemo(() => {
    if (!patch.trim()) return [];
    return parse(patch);
  }, [patch]);

  const summary = useMemo(() => summarizeDiffStats(diffFiles), [diffFiles]);

  // Render each file independently so it can live inside its own collapsible
  // section, instead of diff2html's single monolithic block.
  const renderedByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of diffFiles) {
      map.set(diffFileDisplayPath(file), html([file], {
        drawFileList: false,
        matching: "lines",
        outputFormat: format,
      }));
    }
    return map;
  }, [diffFiles, format]);

  function toggleFile(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (!patch.trim()) {
    return <div className="diff-empty">{t("No changes", "没有更改")}</div>;
  }

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="diff-file-count">
          {t(
            summary.fileCount === 1 ? "{count} file changed" : "{count} files changed",
            "{count} 个文件已更改",
            { count: summary.fileCount },
          )}
          <DiffStatBadge added={summary.addedLines} deleted={summary.deletedLines} />
        </span>
        <div
          className="diff-format-toggle"
          role="group"
          aria-label={t("Diff display format", "差异显示格式")}
        >
          <button
            className={`diff-format-btn ${format === "line-by-line" ? "active" : ""}`}
            type="button"
            onClick={() => setFormat("line-by-line")}
            aria-pressed={format === "line-by-line"}
          >
            {t("Inline", "行内")}
          </button>
          <button
            className={`diff-format-btn ${format === "side-by-side" ? "active" : ""}`}
            type="button"
            onClick={() => setFormat("side-by-side")}
            aria-pressed={format === "side-by-side"}
          >
            {t("Side by side", "并排")}
          </button>
        </div>
      </div>
      <div className="diff-files">
        {diffFiles.map((file) => {
          const stat = diffFileStat(file);
          const rendered = renderedByPath.get(stat.path) ?? "";
          const isCollapsed = collapsed.has(stat.path);
          return (
            <DiffFileSection
              key={stat.path}
              stat={stat}
              rendered={rendered}
              collapsed={isCollapsed}
              onToggle={() => toggleFile(stat.path)}
            />
          );
        })}
      </div>
    </div>
  );
}

function DiffFileSection({
  stat,
  rendered,
  collapsed,
  onToggle,
}: {
  stat: DiffFileStat;
  rendered: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const kindLabel = diffKindLabel(stat.kind, t);
  return (
    <div className={`diff-file-section ${collapsed ? "collapsed" : ""}`}>
      <button
        className="diff-file-toggle"
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className="diff-file-chevron" aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        <span className="diff-file-path" title={stat.path}>{stat.path}</span>
        {kindLabel && <span className={`diff-file-kind kind-${stat.kind}`}>{kindLabel}</span>}
        <DiffStatBadge added={stat.addedLines} deleted={stat.deletedLines} />
      </button>
      {!collapsed && (
        <div className="diff-content" dangerouslySetInnerHTML={{ __html: rendered }} />
      )}
    </div>
  );
}

function DiffStatBadge({ added, deleted }: { added: number; deleted: number }) {
  if (added === 0 && deleted === 0) return null;
  return (
    <span className="diff-stat-badge">
      {added > 0 && <span className="diff-stat-added">+{added}</span>}
      {deleted > 0 && <span className="diff-stat-deleted">&minus;{deleted}</span>}
    </span>
  );
}

function diffKindLabel(
  kind: DiffFileStat["kind"],
  t: (en: string, zhCN: string) => string,
): string | null {
  switch (kind) {
    case "added": return t("Added", "新增");
    case "deleted": return t("Deleted", "删除");
    case "renamed": return t("Renamed", "重命名");
    default: return null;
  }
}
