import type { ExtensionWidgetPlacement } from "../../ipc/extensionUIEffects";
import { useI18n } from "../../i18n";
import "../../styles/extension-widgets.css";

export interface ExtensionWidgetRecord {
  readonly key: string;
  readonly lines: readonly string[];
  readonly placement: ExtensionWidgetPlacement;
  readonly order: number;
}

interface ExtensionWidgetsProps {
  widgets: readonly ExtensionWidgetRecord[];
  placement: ExtensionWidgetPlacement;
}

const ESCAPE = 0x1b;
const BELL = 0x07;
const C1_CSI = 0x9b;
const C1_OSC = 0x9d;
const C1_ST = 0x9c;

function consumeControlString(text: string, start: number, allowBellTerminator: boolean): number {
  for (let index = start; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((allowBellTerminator && code === BELL) || code === C1_ST) return index + 1;
    if (code === ESCAPE && text.charCodeAt(index + 1) === 0x5c) return index + 2;
  }
  return text.length;
}

function consumeControlSequence(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return text.length;
}

function consumeEscapeSequence(text: string, start: number): number {
  const introducer = text.charCodeAt(start + 1);
  if (Number.isNaN(introducer)) return text.length;
  if (introducer === 0x5b) return consumeControlSequence(text, start + 2);
  if (introducer === 0x5d) return consumeControlString(text, start + 2, true);
  if (introducer === 0x50 || introducer === 0x58 || introducer === 0x5e || introducer === 0x5f) {
    return consumeControlString(text, start + 2, false);
  }

  let index = start + 1;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code > 0x2f) break;
    index += 1;
  }
  return Math.min(text.length, index + 1);
}

export function stripAnsiControlSequences(text: string): string {
  let result = "";
  let plainTextStart = 0;
  let index = 0;

  while (index < text.length) {
    const code = text.charCodeAt(index);
    let nextIndex = index + 1;

    if (code === ESCAPE) {
      nextIndex = consumeEscapeSequence(text, index);
    } else if (code === C1_CSI) {
      nextIndex = consumeControlSequence(text, index + 1);
    } else if (code === C1_OSC) {
      nextIndex = consumeControlString(text, index + 1, true);
    } else if (code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
      nextIndex = consumeControlString(text, index + 1, false);
    } else if (code >= 0x80 && code <= 0x9f) {
      // C1 terminal controls are non-printing even when no payload follows.
    } else {
      index += 1;
      continue;
    }

    result += text.slice(plainTextStart, index);
    index = nextIndex;
    plainTextStart = index;
  }

  return result + text.slice(plainTextStart);
}

export function getRenderableExtensionWidgets(
  widgets: readonly ExtensionWidgetRecord[],
  placement: ExtensionWidgetPlacement,
): ExtensionWidgetRecord[] {
  return widgets
    .map((widget, inputIndex) => ({
      inputIndex,
      widget: {
        ...widget,
        lines: widget.lines.map(stripAnsiControlSequences),
      },
    }))
    .filter(({ widget }) =>
      widget.placement === placement && widget.lines.some((line) => line.trim().length > 0),
    )
    .sort((left, right) => left.widget.order - right.widget.order || left.inputIndex - right.inputIndex)
    .map(({ widget }) => widget);
}

export function ExtensionWidgets({ widgets, placement }: ExtensionWidgetsProps) {
  const { t } = useI18n();
  const renderedWidgets = getRenderableExtensionWidgets(widgets, placement);
  if (renderedWidgets.length === 0) return null;

  const placementLabel = placement === "aboveEditor" ? t("above", "上方") : t("below", "下方");

  return (
    <section
      className={`extension-widgets extension-widgets-${placement}`}
      aria-label={t(
        "Extension widgets {placement} the message editor",
        "消息编辑器{placement}的扩展小组件",
        { placement: placementLabel },
      )}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {renderedWidgets.map((widget) => (
        <section
          className="extension-widget"
          aria-label={t("Extension widget {key}", "扩展小组件 {key}", { key: widget.key })}
          key={widget.key}
        >
          <pre className="extension-widget-content">{widget.lines.join("\n")}</pre>
        </section>
      ))}
    </section>
  );
}
