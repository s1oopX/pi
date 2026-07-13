import { useState } from "react";
import { useStore } from "../../store";
import * as api from "../../ipc/api";
import { showToast } from "../Toast";
import type { Model } from "../../ipc/types";

export function ModelSettings() {
  const models = useStore((s) => s.models);
  const session = useStore((s) => s.session);
  const authStatuses = useStore((s) => s.authStatuses);
  const currentModel = session?.model;

  const grouped = groupByProvider(models);

  async function handleSelectModel(provider: string, modelId: string) {
    try {
      await api.setModel(provider, modelId);
      useStore.getState().refresh();
      showToast(`Switched to ${modelId}`, "success");
    } catch (e) {
      showToast(`Failed to switch model: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  async function handleTestModel(provider: string, modelId: string) {
    try {
      await api.testModel(provider, modelId);
      showToast(`${modelId} is reachable`, "success");
    } catch (e) {
      showToast(`Test failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Models & Providers</h3>
      <p className="settings-section-desc">
        Select the active model or manage provider authentication.
      </p>

      {Object.entries(grouped).map(([provider, providerModels]) => (
        <div key={provider} className="model-provider-group">
          <div className="model-provider-header">
            <span className="model-provider-name">{provider}</span>
            <AuthBadge provider={provider} status={authStatuses[provider]} />
          </div>
          <div className="model-provider-list">
            {providerModels.map((m) => {
              const isActive = m.provider === currentModel?.provider && m.id === currentModel?.id;
              return (
                <div key={m.id} className={`model-settings-row ${isActive ? "active" : ""}`}>
                  <div className="model-settings-info">
                    <span className="model-settings-name">{m.name ?? m.id}</span>
                    {m.reasoning && <span className="model-tag">reasoning</span>}
                    {m.contextWindow && (
                      <span className="model-tag">{Math.round(m.contextWindow / 1000)}k ctx</span>
                    )}
                  </div>
                  <div className="model-settings-actions">
                    <button
                      className="settings-btn-sm"
                      type="button"
                      onClick={() => handleTestModel(m.provider, m.id)}
                    >
                      Test
                    </button>
                    <button
                      className="settings-btn-sm settings-btn-primary"
                      type="button"
                      disabled={isActive}
                      onClick={() => handleSelectModel(m.provider, m.id)}
                    >
                      {isActive ? "Active" : "Use"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {models.length === 0 && (
        <div className="settings-empty">
          No models available. Configure a provider API key in the Account tab.
        </div>
      )}
    </div>
  );
}

function AuthBadge({ provider, status }: { provider: string; status: unknown }) {
  const auth = status as { configured?: boolean; source?: string } | undefined;
  if (!auth) return null;
  return (
    <span className={`auth-badge ${auth.configured ? "configured" : "not-configured"}`}>
      {auth.configured ? `✓ ${auth.source ?? "configured"}` : "Not configured"}
    </span>
  );
}

function groupByProvider(models: Model[]): Record<string, Model[]> {
  const groups: Record<string, Model[]> = {};
  for (const m of models) {
    (groups[m.provider] ??= []).push(m);
  }
  return groups;
}
