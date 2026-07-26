import type { ReactNode, SVGProps } from "react";

// Single source of truth for line icons. Every glyph is authored in a 24x24
// coordinate space and rendered with a shared stroke weight and round caps/
// joins, so the whole app speaks one icon language (matching the existing
// SettingsSectionIcon standard: viewBox 24 / stroke 1.6 / round). Icons that
// were previously hand-inlined in 16- or 18-unit boxes are redrawn here at 24
// scale so their optical stroke weight matches everything else.
//
// No emoji, no external icon dependency — this keeps the supply chain surface
// unchanged while giving us a consistent, tweakable icon set.

export type IconName =
  | "panel-left"
  | "panel-right"
  | "command"
  | "search"
  | "plus"
  | "check"
  | "alert-triangle"
  | "monitor"
  | "arrow-left"
  | "close"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "copy"
  | "folder"
  | "folder-open"
  | "grid"
  | "terminal"
  | "git-branch"
  | "paperclip"
  | "send"
  | "queue"
  | "rotate-ccw"
  | "rotate-cw"
  | "more-vertical"
  | "pencil"
  | "trash"
  | "settings"
  | "user"
  | "moon"
  | "info"
  | "activity"
  | "file"
  | "download"
  | "upload"
  | "more-horizontal"
  | "eye"
  | "eye-off";

const GLYPHS: Record<IconName, ReactNode> = {
  "panel-left": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  "panel-right": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  command: <path d="m8 8-4 4 4 4M12 16h8" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  "alert-triangle": (
    <>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 21h8M12 18v3" />
    </>
  ),
  "arrow-left": <path d="M19 12H5M12 19l-7-7 7-7" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  folder: (
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
  ),
  "folder-open": (
    <path d="M3 7h6l1.8 2.2H21v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.2z" />
  ),
  grid: <path d="M5 5h14v14H5zM9 5v14M9 9h10M9 13h10" />,
  terminal: <path d="m6 8 4 4-4 4M12 17h6" />,
  "git-branch": (
    <>
      <circle cx="6.5" cy="5.5" r="2.25" />
      <circle cx="6.5" cy="18.5" r="2.25" />
      <circle cx="17.5" cy="9" r="2.25" />
      <path d="M6.5 7.75v8.5M8.75 16.5c4.5-.5 8-2.4 8-4.75" />
    </>
  ),
  paperclip: (
    <path d="m20.5 11.5-8.2 8.2a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 1 1-2.8-2.8l8.2-8.2" />
  ),
  send: <path d="M12 19V5m0 0-5.5 5.5M12 5l5.5 5.5" />,
  queue: (
    <>
      <path d="M5 7h14M5 12h9M5 17h6" />
      <path d="M18 13v6m-3-3h6" />
    </>
  ),
  "rotate-ccw": <path d="M3 9a9 9 0 1 0 3-6.7L3 5m0 0v4m0-4h4" />,
  "rotate-cw": <path d="M21 9a9 9 0 1 1-3-6.7L21 5m0 0V1m0 4h-4" />,
  "more-vertical": (
    <>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" />
    </>
  ),
  "more-horizontal": (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </>
  ),
  pencil: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  trash: <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
    </>
  ),
  moon: <path d="M20 13.5A7.5 7.5 0 1 1 10.5 4a5.8 5.8 0 0 0 9.5 9.5z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  activity: <path d="M3 12h4l2-6 4 12 2-6h6" />,
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  upload: (
    <>
      <path d="M12 21V9m0 0 4 4m-4-4-4 4" />
      <path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M4 4l16 16" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill" | "stroke"> {
  name?: IconName;
  path?: string;
  size?: number;
  strokeWidth?: number;
}

// Either `name` (a registry glyph) or `path` (a raw 24-box path string, for
// icons whose shape is data-driven at the call site) selects the glyph. Both
// render through the same standard svg attributes so the icon language stays
// uniform.
export function Icon({ name, path, size = 16, strokeWidth = 1.6, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {path !== undefined ? <path d={path} /> : name ? GLYPHS[name] : null}
    </svg>
  );
}
