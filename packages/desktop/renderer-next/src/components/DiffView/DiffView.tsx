import { useMemo, useState } from "react";
import { html, parse } from "diff2html";
import type { DiffFile } from "diff2html/lib/types";
import { useI18n } from "../../i18n";

type OutputFormat = "side-by-side" | "line-by-line";

interface DiffViewProps {
  patch: string;
  defaultFormat?: OutputFormat;
}

export function DiffView({ patch, defaultFormat = "line-by-line" }: DiffViewProps) {
  const { t } = useI18n();
  const [format, setFormat] = useState<OutputFormat>(defaultFormat);

  const diffFiles: DiffFile[] = useMemo(() => {
    if (!patch.trim()) return [];
    return parse(patch);
  }, [patch]);

  const rendered = useMemo(() => {
    if (diffFiles.length === 0) return "";
    return html(diffFiles, {
      drawFileList: false,
      matching: "lines",
      outputFormat: format,
    });
  }, [diffFiles, format]);

  if (!patch.trim()) {
    return <div className="diff-empty">{t("No changes", "没有更改")}</div>;
  }

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="diff-file-count">
          {t(
            diffFiles.length === 1 ? "{count} file changed" : "{count} files changed",
            "{count} 个文件已更改",
            { count: diffFiles.length },
          )}
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
      <div
        className="diff-content"
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </div>
  );
}
