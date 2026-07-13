import { useStore, type SettingsRoute } from "../../store";
import { ModelSettings } from "./ModelSettings";
import { CustomProviderSettings } from "./CustomProviderSettings";
import { AccountSettings } from "./AccountSettings";
import { AgentSettings } from "./AgentSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { AboutSettings } from "./AboutSettings";

const NAV_ITEMS: { route: SettingsRoute; label: string }[] = [
  { route: "models-providers", label: "Models & Providers" },
  { route: "custom-providers", label: "Custom Providers" },
  { route: "account", label: "Account" },
  { route: "agent-general", label: "Agent" },
  { route: "appearance", label: "Appearance" },
  { route: "about", label: "About" },
];

export function Settings() {
  const settingsRoute = useStore((s) => s.settingsRoute);
  const closeSettings = useStore((s) => s.closeSettings);
  const openSettings = useStore((s) => s.openSettings);

  if (!settingsRoute) return null;

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <button className="settings-back-btn" type="button" onClick={closeSettings}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Back</span>
            </button>
          </div>
          <nav className="settings-nav" aria-label="Settings navigation">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.route}
                className={`settings-nav-item ${settingsRoute === item.route ? "active" : ""}`}
                type="button"
                onClick={() => openSettings(item.route)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="settings-content">
          {settingsRoute === "models-providers" && <ModelSettings />}
          {settingsRoute === "custom-providers" && <CustomProviderSettings />}
          {settingsRoute === "account" && <AccountSettings />}
          {settingsRoute === "agent-general" && <AgentSettings />}
          {settingsRoute === "appearance" && <AppearanceSettings />}
          {settingsRoute === "about" && <AboutSettings />}
        </div>
      </div>
    </div>
  );
}
