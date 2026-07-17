import { useI18n } from "../../i18n";
import "../../styles/extension-statuses.css";
import { stripAnsiControlSequences } from "../ExtensionWidgets";

interface ExtensionStatusesProps {
  statuses: Readonly<Record<string, string>>;
}

export function sanitizeExtensionStatusText(text: string): string {
  return stripAnsiControlSequences(text)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function ExtensionStatuses({ statuses }: ExtensionStatusesProps) {
  const { t } = useI18n();
  const entries = Object.entries(statuses)
    .map(([key, text]) => [key, sanitizeExtensionStatusText(text)] as const)
    .filter(([, text]) => text.length > 0);
  if (entries.length === 0) return null;

  return (
    <div
      className="extension-statuses"
      role="status"
      aria-label={t("Extension status", "扩展状态")}
      aria-live="polite"
    >
      {entries.map(([key, text]) => (
        <span className="extension-status" title={key} key={key}>{text}</span>
      ))}
    </div>
  );
}
