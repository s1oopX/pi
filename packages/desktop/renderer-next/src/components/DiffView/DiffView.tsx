import { useMemo, useState } from "react";
import { html, parse } from "diff2html";
import type { DiffFile } from "diff2html/lib/types";

type OutputFormat = "side-by-side" | "line-by-line";

interface DiffViewProps {
  patch: string;
  defaultFormat?: OutputFormat;
}

export function DiffView({ patch, defaultFormat = "line-by-line" }: DiffViewProps) {
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
    return <div className="diff-empty">No changes</div>;
  }

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="diff-file-count">
          {diffFiles.length} file{diffFiles.length !== 1 ? "s" : ""} changed
        </span>
        <div className="diff-format-toggle" role="group" aria-label="Diff display format">
          <button
            className={`diff-format-btn ${format === "line-by-line" ? "active" : ""}`}
            type="button"
            onClick={() => setFormat("line-by-line")}
            aria-pressed={format === "line-by-line"}
          >
            Inline
          </button>
          <button
            className={`diff-format-btn ${format === "side-by-side" ? "active" : ""}`}
            type="button"
            onClick={() => setFormat("side-by-side")}
            aria-pressed={format === "side-by-side"}
          >
            Side by side
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
