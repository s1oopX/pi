import { useStore, type Theme } from "../../store";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearanceSettings() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Appearance</h3>

      <div className="settings-group">
        <label className="settings-group-label">Theme</label>
        <p className="settings-group-desc">Choose light, dark, or follow system preference.</p>
        <div className="theme-picker">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`theme-picker-btn ${theme === opt.value ? "active" : ""}`}
              type="button"
              onClick={() => setTheme(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
