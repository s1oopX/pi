import type { SessionState } from "../../ipc/types";

/**
 * Show the trust banner only when the current project has trust-requiring
 * resources (project-local .pi extensions/settings/skills/prompts) and the
 * user has not trusted it yet. Trusted or resource-free projects show nothing.
 */
export function shouldShowTrustBanner(session: SessionState | null | undefined): boolean {
  if (!session) return false;
  return Boolean(session.projectTrustRequired) && !session.projectTrusted;
}
