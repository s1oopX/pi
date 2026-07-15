import { useStore } from "../../store";

export function TopBar() {
  const openSettings = useStore((s) => s.openSettings);

  return (
    <div className="top-bar">
      <div className="top-bar-left" />

      <div className="top-bar-right">
        <button
          className="icon-button"
          type="button"
          aria-label="Settings"
          onClick={() => openSettings("models-providers")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
              fill="none" stroke="currentColor" strokeWidth="1.5"
            />
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
