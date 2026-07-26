import { getWorkspaceName } from "../components/Sidebar/sidebarState";

export interface WindowTitleInputs {
  /** Explicit title set by an extension — always wins. */
  extensionTitle: string | null;
  sessionName: string | null | undefined;
  workspaceCwd: string;
  appName: string;
}

/**
 * The window title carries the current context so the taskbar and Alt-Tab
 * stay identifiable: extension title verbatim, else "session — app", else
 * "workspace — app", else just the app name.
 */
export function composeWindowTitle({ extensionTitle, sessionName, workspaceCwd, appName }: WindowTitleInputs): string {
  if (extensionTitle) return extensionTitle;
  const context = sessionName?.trim() || (workspaceCwd ? getWorkspaceName(workspaceCwd) : "");
  return context ? `${context} — ${appName}` : appName;
}
