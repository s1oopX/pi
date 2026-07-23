import {
  DEFAULT_APPEARANCE_PREFERENCES,
  FONT_SCALE_OPTIONS,
  INTERFACE_DENSITIES,
  useAppearancePreferences,
} from "../../appearance/preferences";
import { useI18n, type LanguagePreference } from "../../i18n";
import { useStore, type Theme } from "../../store";

const THEME_OPTIONS: Theme[] = ["system", "light", "dark"];
const LANGUAGE_OPTIONS: LanguagePreference[] = ["system", "en", "zh-CN"];

export function AppearanceSettings() {
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
  const { language, setLanguage, t } = useI18n();
  const { fontScale, density, setFontScale, setDensity, reset } = useAppearancePreferences();
  const allDefaults =
    theme === "system" &&
    language === "system" &&
    fontScale === DEFAULT_APPEARANCE_PREFERENCES.fontScale &&
    density === DEFAULT_APPEARANCE_PREFERENCES.density;

  function themeLabel(value: Theme): string {
    if (value === "light") return t("Light", "浅色");
    if (value === "dark") return t("Dark", "深色");
    return t("System", "跟随系统");
  }

  function languageLabel(value: LanguagePreference): string {
    if (value === "en") return "English";
    if (value === "zh-CN") return "简体中文";
    return t("System", "跟随系统");
  }

  function handleRestoreDefaults(): void {
    setTheme("system");
    setLanguage("system");
    reset();
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">
        <SettingsSectionIcon route="appearance" />
        {t("Appearance", "外观")}
      </h3>
      <p className="settings-section-desc">
        {t("Adjust the application language, theme, text size, and spacing.", "调整应用语言、主题、文字大小和间距。")}
      </p>

      <div className="settings-group">
        <span className="settings-group-label">{t("Language", "语言")}</span>
        <p className="settings-group-desc">
          {t("Choose the language used by the application interface.", "选择应用界面使用的语言。")}
        </p>
        <div className="theme-picker" role="group" aria-label={t("Language", "语言")}>
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option}
              className={`theme-picker-btn ${language === option ? "active" : ""}`}
              type="button"
              aria-pressed={language === option}
              onClick={() => setLanguage(option)}
            >
              {languageLabel(option)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <span className="settings-group-label">{t("Theme", "主题")}</span>
        <p className="settings-group-desc">
          {t("Choose light, dark, or follow the system preference.", "选择浅色、深色或跟随系统设置。")}
        </p>
        <div className="theme-picker" role="group" aria-label={t("Theme", "主题")}>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option}
              className={`theme-picker-btn ${theme === option ? "active" : ""}`}
              type="button"
              aria-pressed={theme === option}
              onClick={() => setTheme(option)}
            >
              {themeLabel(option)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <span className="settings-group-label">{t("Text size", "文字大小")}</span>
        <p className="settings-group-desc">
          {t("Scale interface text without changing the application window zoom.", "缩放界面文字，不改变应用窗口缩放。")}
        </p>
        <div className="theme-picker font-scale-picker" role="group" aria-label={t("Text size", "文字大小")}>
          {FONT_SCALE_OPTIONS.map((option) => (
            <button
              key={option}
              className={`theme-picker-btn ${fontScale === option ? "active" : ""}`}
              type="button"
              aria-pressed={fontScale === option}
              onClick={() => setFontScale(option)}
            >
              {Math.round(option * 100)}%
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <span className="settings-group-label">{t("Interface density", "界面密度")}</span>
        <p className="settings-group-desc">
          {t("Choose comfortable or compact spacing for common controls.", "选择常用控件的舒适或紧凑间距。")}
        </p>
        <div className="theme-picker" role="group" aria-label={t("Interface density", "界面密度")}>
          {INTERFACE_DENSITIES.map((option) => (
            <button
              key={option}
              className={`theme-picker-btn ${density === option ? "active" : ""}`}
              type="button"
              aria-pressed={density === option}
              onClick={() => setDensity(option)}
            >
              {option === "comfortable" ? t("Comfortable", "舒适") : t("Compact", "紧凑")}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <button className="settings-btn" type="button" disabled={allDefaults} onClick={handleRestoreDefaults}>
          {t("Restore appearance defaults", "恢复外观默认设置")}
        </button>
      </div>
    </div>
  );
}
