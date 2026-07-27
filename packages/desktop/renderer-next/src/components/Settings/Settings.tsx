import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { useStore } from "../../store";
import { Icon } from "../Icon";
import { AboutSettings } from "./AboutSettings";
import { AccountSettings } from "./AccountSettings";
import { AgentSettings } from "./AgentSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { CustomProviderSettings } from "./CustomProviderSettings";
import { MirrorSourcesSettings } from "./MirrorSourcesSettings";
import { ModelSettings } from "./ModelSettings";
import { ResourcesSettings } from "./ResourcesSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { filterSettingsNavigation, getSettingsNavigation } from "./settingsNavigation";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Settings() {
  const settingsRoute = useStore((s) => s.settingsRoute);
  const closeSettings = useStore((s) => s.closeSettings);
  const openSettings = useStore((s) => s.openSettings);
  const { resolvedLanguage, t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [customProvidersDirty, setCustomProvidersDirty] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigationItems = useMemo(() => getSettingsNavigation(resolvedLanguage), [resolvedLanguage]);
  const filteredNavigationItems = useMemo(
    () => filterSettingsNavigation(navigationItems, searchQuery, resolvedLanguage),
    [navigationItems, resolvedLanguage, searchQuery],
  );

  function confirmDiscardCustomProviders(): boolean {
    if (!customProvidersDirty || settingsRoute !== "custom-providers") return true;
    return window.confirm(
      t(
        "You have unsaved custom provider changes. Discard them?",
        "自定义提供商有未保存更改，确定丢弃吗？",
      ),
    );
  }

  function requestCloseSettings(): void {
    if (!confirmDiscardCustomProviders()) return;
    setCustomProvidersDirty(false);
    closeSettings();
  }

  function requestOpenSettings(route: typeof settingsRoute): void {
    if (!route) return;
    if (route === settingsRoute) return;
    if (!confirmDiscardCustomProviders()) return;
    if (settingsRoute === "custom-providers") setCustomProvidersDirty(false);
    openSettings(route);
  }

  useEffect(() => {
    if (!searchQuery.trim() || filteredNavigationItems.length === 0) return;
    if (filteredNavigationItems.some((item) => item.route === settingsRoute)) return;
    const nextRoute = filteredNavigationItems[0].route;
    if (!confirmDiscardCustomProviders()) return;
    if (settingsRoute === "custom-providers") setCustomProvidersDirty(false);
    openSettings(nextRoute);
  }, [customProvidersDirty, filteredNavigationItems, openSettings, searchQuery, settingsRoute, t]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    const appShellWasInert = appShell?.hasAttribute("inert") ?? false;
    appShell?.setAttribute("inert", "");

    const focusFrame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const activeNav = panel.querySelector<HTMLButtonElement>(".settings-nav-item.active");
      (activeNav ?? panel).focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        event.preventDefault();
        requestCloseSettings();
        return;
      }

      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const activeElement = document.activeElement;
      const focusIsInside = activeElement !== panel && activeElement instanceof Node && panel.contains(activeElement);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (!focusIsInside || activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!focusIsInside || activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      if (!appShellWasInert) appShell?.removeAttribute("inert");
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [closeSettings, customProvidersDirty, settingsRoute, t]);

  if (!settingsRoute) return null;

  return (
    <div className="settings-overlay">
      <div
        ref={panelRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
      >
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <button className="settings-back-btn" type="button" onClick={requestCloseSettings}>
              <Icon name="arrow-left" size={16} />
              <span>{t("Back", "返回")}</span>
            </button>
            <h2 id="settings-title" className="settings-sidebar-title">{t("Settings", "设置")}</h2>
          </div>
          <label className="settings-search">
            <Icon name="search" size={16} />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("Search settings", "搜索设置")}
              aria-label={t("Search settings", "搜索设置")}
            />
          </label>
          <nav className="settings-nav" aria-label={t("Settings navigation", "设置导航")}>
            {filteredNavigationItems.map((item) => (
              <button
                key={item.route}
                className={`settings-nav-item ${settingsRoute === item.route ? "active" : ""}`}
                type="button"
                data-route={item.route}
                onClick={() => requestOpenSettings(item.route)}
              >
                {item.label}
              </button>
            ))}
            {filteredNavigationItems.length === 0 && (
              <div className="settings-nav-empty">
                {t("No settings match your search.", "没有匹配的设置。")}
              </div>
            )}
          </nav>
        </div>
        <div className="settings-content">
          {filteredNavigationItems.length === 0 ? (
            <div className="settings-search-empty">
              <h3>{t("No settings found", "未找到设置")}</h3>
              <p>{t("Try a different keyword or clear the search.", "请尝试其他关键词，或清除搜索内容。")}</p>
              <button className="settings-btn" type="button" onClick={() => setSearchQuery("")}>
                {t("Clear search", "清除搜索")}
              </button>
            </div>
          ) : (
            <>
              {settingsRoute === "models-providers" && <ModelSettings />}
              {settingsRoute === "custom-providers" && (
                <CustomProviderSettings onDirtyChange={setCustomProvidersDirty} />
              )}
              {settingsRoute === "account" && <AccountSettings />}
              {settingsRoute === "agent-general" && <AgentSettings />}
              {settingsRoute === "appearance" && <AppearanceSettings />}
              {settingsRoute === "shortcuts" && <ShortcutsSettings />}
              {settingsRoute === "mirror-sources" && <MirrorSourcesSettings />}
              {settingsRoute === "resources" && <ResourcesSettings />}
              {settingsRoute === "about" && <AboutSettings />}
            </>
          )}
        </div>
        <button
          className="icon-button settings-close-btn"
          type="button"
          onClick={requestCloseSettings}
          aria-label={t("Close settings", "关闭设置")}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}
