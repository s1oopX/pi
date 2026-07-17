import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAppearancePreferences } from "../../appearance/preferences";
import { useI18n } from "../../i18n";
import { type ResolvedTheme, useStore } from "../../store";

export interface TerminalPanelHandle {
  write(data: string): void;
  writeln(data: string): void;
  clear(): void;
  focus(): void;
}

interface TerminalPanelProps {
  fontSize?: number;
  className?: string;
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  function TerminalPanel({ fontSize = 13, className = "" }, ref) {
    const { t } = useI18n();
    const { fontScale } = useAppearancePreferences();
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const resolvedTheme = useStore((state) => state.resolvedTheme);

    useImperativeHandle(ref, () => ({
      write(data: string) {
        termRef.current?.write(data);
      },
      writeln(data: string) {
        termRef.current?.writeln(data);
      },
      clear() {
        termRef.current?.clear();
      },
      focus() {
        termRef.current?.focus();
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const term = new Terminal({
        fontSize,
        fontFamily: "var(--font-mono), monospace",
        cursorBlink: false,
        disableStdin: true,
        convertEol: true,
        scrollback: 5000,
        theme: getTerminalTheme(useStore.getState().resolvedTheme),
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      termRef.current = term;
      fitRef.current = fitAddon;

      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => fitAddon.fit());
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    }, []);

    useEffect(() => {
      if (!termRef.current) return;
      termRef.current.options.fontSize = fontSize * fontScale;
      requestAnimationFrame(() => fitRef.current?.fit());
    }, [fontScale, fontSize]);

    useEffect(() => {
      if (termRef.current) {
        termRef.current.options.theme = getTerminalTheme(resolvedTheme);
      }
    }, [resolvedTheme]);

    return (
      <div
        ref={containerRef}
        className={`terminal-panel ${className}`}
        role="log"
        aria-label={t("Terminal output", "终端输出")}
      />
    );
  }
);

function getTerminalTheme(theme: ResolvedTheme): ITheme {
  if (theme === "dark") {
    return {
      background: "#171715",
      foreground: "#d8d7d1",
      cursor: "#91a0ff",
      selectionBackground: "#343a56",
      black: "#242421",
      red: "#ee817a",
      green: "#62bd7c",
      yellow: "#e1aa52",
      blue: "#91a0ff",
      magenta: "#c49be8",
      cyan: "#61b7b2",
      white: "#d8d7d1",
      brightBlack: "#72716a",
      brightRed: "#ff9a93",
      brightGreen: "#7ed495",
      brightYellow: "#f1c36f",
      brightBlue: "#acb7ff",
      brightMagenta: "#d8b2f2",
      brightCyan: "#7bcac5",
      brightWhite: "#f2f1ec",
    };
  }
  return {
    background: "#faf9f6",
    foreground: "#353531",
    cursor: "#5368d8",
    selectionBackground: "#dce1f7",
    black: "#353531",
    red: "#ba403a",
    green: "#287a45",
    yellow: "#956000",
    blue: "#5368d8",
    magenta: "#8557a6",
    cyan: "#247a78",
    white: "#e7e6e0",
    brightBlack: "#77776f",
    brightRed: "#d45b54",
    brightGreen: "#3d9359",
    brightYellow: "#ad7818",
    brightBlue: "#697de6",
    brightMagenta: "#9c6fbb",
    brightCyan: "#378f8c",
    brightWhite: "#fffefa",
  };
}
