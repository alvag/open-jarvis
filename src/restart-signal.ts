let pendingExitCode: number | null = null;

export function scheduleRestart(code: number): void {
  pendingExitCode = code;
}

export function getPendingRestart(): number | null {
  return pendingExitCode;
}
