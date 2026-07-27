import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { MirrorManager, MirrorPreset, MirrorStatusResult } from "../../ipc/types";
import { showToast } from "../Toast";
import { SettingsSectionIcon } from "./SettingsSectionIcon";

const MANAGER_LABELS: Record<MirrorManager, { name: string; config: string }> = {
  npm: { name: "npm", config: ".npmrc" },
  pip: { name: "pip", config: "pip.conf / pip.ini" },
  cargo: { name: "cargo", config: ".cargo/config.toml" },
};

export function MirrorSourcesSettings() {
  const { language, t } = useI18n();
  const [status, setStatus] = useState<MirrorStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadStatus = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await api.getMirrorStatus();
      if (requestId === requestIdRef.current) setStatus(next);
    } catch (loadError: unknown) {
      if (requestId === requestIdRef.current) {
        setStatus(null);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    return () => {
      requestIdRef.current++;
    };
  }, [loadStatus]);

  function presetName(preset: MirrorPreset): string {
    return language === "zh-CN" ? preset.nameZh : preset.nameEn;
  }

  async function handleSwitch(manager: MirrorManager, preset: MirrorPreset) {
    setApplying(`${manager}:${preset.id}`);
    try {
      await api.setMirrorSource(manager, preset.id);
      showToast(
        t("{manager} now uses {source}", "{manager} 已切换到{source}", {
          manager: MANAGER_LABELS[manager].name,
          source: presetName(preset),
        }),
        "success",
      );
      await loadStatus();
    } catch (switchError: unknown) {
      const message = switchError instanceof Error ? switchError.message : String(switchError);
      showToast(t("Could not switch mirror: {message}", "切换镜像源失败：{message}", { message }), "error");
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">
        <SettingsSectionIcon route="mirror-sources" />
        {t("Mirror Sources", "镜像源")}
      </h3>
      <p className="settings-section-desc">
        {t(
          "Point npm, pip and cargo at a faster registry mirror. Changes are written to each tool's own config file and apply to every project on this machine.",
          "将 npm、pip、cargo 指向更快的镜像源。设置会写入各工具自己的配置文件，对本机所有项目生效。",
        )}
      </p>

      {error && <div className="settings-error">{error}</div>}
      {loading && !status && <div className="settings-empty">{t("Reading current mirrors…", "正在读取当前镜像源…")}</div>}

      {status && (
        <div className="mirror-manager-list">
          {status.sources.map((source) => {
            const presets = status.presets[source.manager] ?? [];
            const labels = MANAGER_LABELS[source.manager];
            const isCustom = source.current === "custom";
            return (
              <section className="mirror-manager" key={source.manager}>
                <div className="mirror-manager-heading">
                  <span className="mirror-manager-name">{labels.name}</span>
                  <span className="mirror-manager-config" title={labels.config}>
                    {labels.config}
                  </span>
                </div>
                <div className="mirror-manager-current">
                  {isCustom
                    ? t("Custom: {url}", "自定义：{url}", { url: source.currentUrl })
                    : source.currentUrl
                      ? source.currentUrl
                      : t("Using the tool's built-in default", "使用工具内置默认源")}
                </div>
                <div className="mirror-preset-row">
                  {presets.map((preset) => {
                    const active = !isCustom && preset.id === source.current;
                    const busy = applying === `${source.manager}:${preset.id}`;
                    return (
                      <button
                        key={preset.id}
                        className={`mirror-preset-btn ${active ? "active" : ""}`}
                        type="button"
                        disabled={applying !== null || active}
                        aria-pressed={active}
                        onClick={() => void handleSwitch(source.manager, preset)}
                        title={preset.url || t("The tool's built-in default", "工具内置默认源")}
                      >
                        {busy ? t("Switching…", "切换中…") : presetName(preset)}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
