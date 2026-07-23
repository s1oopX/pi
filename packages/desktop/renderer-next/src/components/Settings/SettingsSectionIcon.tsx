import type { ReactNode } from "react";
import type { SettingsRoute } from "../../store";

type IconRoute = Exclude<SettingsRoute, null>;

// Line-icon glyph for each settings section, keyed by route. Kept minimal and
// stroke-based to match the app's existing inline-SVG language (sidebar,
// workbench). Rendered inside .settings-section-icon, which tints them to the
// muted foreground for a calm header rather than a loud colored glyph.
const ICON_PATHS: Record<IconRoute, ReactNode> = {
  "models-providers": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6v6H9zM4 9h0M4 15h0M20 9h0M20 15h0M9 4v0M15 4v0M9 20v0M15 20v0" />
    </>
  ),
  "custom-providers": (
    <>
      <path d="M9 7V4M15 7V4" />
      <path d="M7 7h10v4a5 5 0 0 1-10 0z" />
      <path d="M12 16v4" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </>
  ),
  "agent-general": (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  appearance: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.5 1-2 2-2h1a4 4 0 0 0 4-4c0-4.5-4-8-9-8Z" />
      <circle cx="7.5" cy="10.5" r="1" />
      <circle cx="12" cy="7.5" r="1" />
      <circle cx="16.5" cy="10.5" r="1" />
    </>
  ),
  shortcuts: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h0M11 10h0M15 10h0M8 14h8" />
    </>
  ),
  resources: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h0" />
    </>
  ),
};

export function SettingsSectionIcon({ route }: { route: IconRoute }) {
  return (
    <span className="settings-section-icon" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICON_PATHS[route]}
      </svg>
    </span>
  );
}
