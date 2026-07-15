import { useState } from "react";
import { useStore } from "../../store";
import * as api from "../../ipc/api";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const sessions = useStore((s) => s.sessions);
  const session = useStore((s) => s.session);
  const workspaceCwd = useStore((s) => s.workspaceCwd);
  const backendStatus = useStore((s) => s.backendStatus);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [exporting, setExporting] = useState(false);

  const activeSessionId = session?.sessionId;

  function beginRename() {
    setRenameValue(session?.sessionName ?? "");
    setRenaming(true);
  }

  async function commitRename() {
    const name = renameValue.trim();
    setRenaming(false);
    if (name && name !== session?.sessionName) {
      await api.setSessionName(name);
      useStore.getState().refreshSession();
    }
  }

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      await api.exportHtml();
    } catch {
      // export errors surface via backend log stream
    } finally {
      setExporting(false);
    }
  }

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Sidebar">
      <div className="titlebar-drag" />

      <div className="brand-header">
        <button
          className="icon-button sidebar-toggle"
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggle}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9 3v18" fill="none" stroke="currentColor" strokeWidth="1.5" />
            {collapsed
              ? <path d="m13 9 3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              : <path d="m16 15-3-3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />}
          </svg>
        </button>
        {!collapsed && (
          <div className="brand-lockup" aria-label="Pi Studio">
            <span className="brand-copy">
              <strong className="brand-name">Pi Studio</strong>
              <span className="brand-tagline">API workspace</span>
            </span>
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          <button
            className="new-agent-button"
            type="button"
            onClick={() => { api.newSession(); }}
          >
            <svg className="new-agent-icon" viewBox="0 0 18 18" aria-hidden="true">
              <line x1="9" y1="3" x2="9" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>New Agent</span>
          </button>

          <div className="agent-list-section">
            <div className="agent-list-header">
              <span>Agents</span>
            </div>
            <div className="agent-list" role="list">
              {sessions.map((s) => {
                const isActive = activeSessionId != null && s.id === activeSessionId;
                if (isActive && renaming) {
                  return (
                    <input
                      key={s.path}
                      className="agent-rename-input"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                        if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
                      }}
                      aria-label="Rename agent"
                    />
                  );
                }
                return (
                  <button
                    key={s.path}
                    className={`agent-row ${isActive ? "active" : ""}`}
                    type="button"
                    onClick={() => { api.switchSession(s.path); }}
                    onDoubleClick={() => { if (isActive) beginRename(); }}
                    title={isActive ? "Double-click to rename" : undefined}
                    role="listitem"
                  >
                    <span className="agent-row-title">{s.name ?? s.firstMessage ?? "Untitled"}</span>
                  </button>
                );
              })}
              {sessions.length === 0 && (
                <div className="agent-empty-state">No agents yet</div>
              )}
            </div>
          </div>

          <div className="sidebar-footer">
            {session && (
              <button
                className="sidebar-action-btn"
                type="button"
                onClick={handleExport}
                disabled={exporting}
                title="Export this session to HTML"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
                  <path d="M12 3v12m0 0 4-4m-4 4-4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span>{exporting ? "Exporting..." : "Export HTML"}</span>
              </button>
            )}
            <div className="workspace-mini">
              <span className="workspace-cwd" title={workspaceCwd}>
                {workspaceCwd ? workspaceCwd.split(/[\\/]/).pop() : "No workspace"}
              </span>
              <button
                className="icon-button"
                type="button"
                aria-label="Choose workspace"
                onClick={() => { api.chooseWorkspace(); }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                    fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </div>
            <div className="status-row">
              <span
                className={`backend-dot ${backendStatus.ready ? "ready" : ""}`}
                aria-label={backendStatus.ready ? "Backend running" : "Backend offline"}
              />
              <span className="status-text">
                {backendStatus.ready ? "Ready" : backendStatus.starting ? "Starting..." : "Offline"}
              </span>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
