export function isBranchLoadCurrent(
  requestId: number,
  latestRequestId: number,
  requestedSessionId: string,
  currentSessionId: string | null,
): boolean {
  return requestId === latestRequestId && requestedSessionId === currentSessionId;
}
