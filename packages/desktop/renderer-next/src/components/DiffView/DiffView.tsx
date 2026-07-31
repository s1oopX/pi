import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { html, parse } from "diff2html";
import type { DiffFile } from "diff2html/lib/types";
import { useI18n } from "../../i18n";
import { Icon } from "../Icon";
import {
  diffFileDisplayPath,
  diffFileStat,
  summarizeDiffStats,
  type DiffFileStat,
} from "./diffStats";
import { addDiffLineAnchors } from "./lineAnchors";

type OutputFormat = "side-by-side" | "line-by-line";

interface DiffViewProps {
  patch: string;
  defaultFormat?: OutputFormat;
  renderHunkActions?: (hunkIndex: number) => ReactNode;
  onLineSelect?: (line: DiffLineSelection) => void;
}

export interface DiffLineSelection {
  path: string;
  side: "old" | "new";
  line: number;
  text: string;
}

interface RenderedDiffFile {
  whole: string;
  hunks: string[];
}

export function DiffView({ patch, defaultFormat = "line-by-line", renderHunkActions, onLineSelect }: DiffViewProps) {
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
  const renderByHunk = Boolean(renderHunkActions);
  const lineSelectionEnabled = Boolean(onLineSelect);
  const hunkOffsets = useMemo(() => {
    let offset = 0;
    return diffFiles.map((file) => {
      const current = offset;
      offset += file.blocks.length;
      return current;
    });
  }, [diffFiles]);

  // Render each file independently so it can live inside its own collapsible
  // section, instead of diff2html's single monolithic block.
  const renderedByPath = useMemo(() => {
    const map = new Map<string, RenderedDiffFile>();
    for (const file of diffFiles) {
      const options = {
        drawFileList: false,
        matching: "lines",
        outputFormat: format,
      } as const;
      const render = (files: DiffFile[]) => {
        const markup = html(files, options);
        return lineSelectionEnabled && format === "line-by-line"
          ? addDiffLineAnchors(
              markup,
              t("Comment on old line", "评论旧行"),
              t("Comment on new line", "评论新行"),
            )
          : markup;
      };
      map.set(diffFileDisplayPath(file), {
        whole: render([file]),
        hunks: renderByHunk
          ? file.blocks.map((block) => render([{ ...file, blocks: [block] }]))
          : [],
      });
    }
    return map;
  }, [diffFiles, format, lineSelectionEnabled, renderByHunk, t]);

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
        {diffFiles.map((file, fileIndex) => {
          const stat = diffFileStat(file);
          const rendered = renderedByPath.get(stat.path) ?? { whole: "", hunks: [] };
          const isCollapsed = collapsed.has(stat.path);
          return (
            <DiffFileSection
              key={stat.path}
              stat={stat}
              rendered={rendered}
              collapsed={isCollapsed}
              onToggle={() => toggleFile(stat.path)}
              renderHunkActions={renderHunkActions
                ? (hunkIndex) => renderHunkActions(hunkOffsets[fileIndex] + hunkIndex)
                : undefined}
              onLineSelect={onLineSelect}
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
  renderHunkActions,
  onLineSelect,
}: {
  stat: DiffFileStat;
  rendered: RenderedDiffFile;
  collapsed: boolean;
  onToggle: () => void;
  renderHunkActions?: (hunkIndex: number) => ReactNode;
  onLineSelect?: (line: DiffLineSelection) => void;
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
        <span className="diff-file-chevron" aria-hidden="true">
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={13} />
        </span>
        <span className="diff-file-path" title={stat.path}>{stat.path}</span>
        {kindLabel && <span className={`diff-file-kind kind-${stat.kind}`}>{kindLabel}</span>}
        <DiffStatBadge added={stat.addedLines} deleted={stat.deletedLines} />
      </button>
      {!collapsed && renderHunkActions && rendered.hunks.length > 0 ? (
        <div className="diff-content">
          {rendered.hunks.map((hunk, hunkIndex) => (
            <div className="diff-hunk" key={hunkIndex}>
              <div className="diff-hunk-actions">{renderHunkActions(hunkIndex)}</div>
              <div
                onClick={(event) => selectDiffLine(event, stat.path, onLineSelect)}
                dangerouslySetInnerHTML={{ __html: hunk }}
              />
            </div>
          ))}
        </div>
      ) : !collapsed ? (
        <div
          className="diff-content"
          onClick={(event) => selectDiffLine(event, stat.path, onLineSelect)}
          dangerouslySetInnerHTML={{ __html: rendered.whole }}
        />
      ) : null}
    </div>
  );
}

function selectDiffLine(
  event: ReactMouseEvent<HTMLDivElement>,
  path: string,
  onLineSelect: ((line: DiffLineSelection) => void) | undefined,
): void {
  if (!onLineSelect || !(event.target instanceof Element)) return;
  const anchor = event.target.closest<HTMLButtonElement>(".diff-line-anchor");
  if (!anchor || !event.currentTarget.contains(anchor)) return;
  const line = Number(anchor.dataset.diffLine);
  const side = anchor.dataset.diffSide;
  if (!Number.isInteger(line) || line < 1 || (side !== "old" && side !== "new")) return;
  const text = anchor.closest("tr")?.querySelector<HTMLElement>(".d2h-code-line-ctn")?.textContent?.trimEnd() ?? "";
  onLineSelect({ path, side, line, text });
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
