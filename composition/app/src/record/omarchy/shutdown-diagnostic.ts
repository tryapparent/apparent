/** Privileged local diagnostics only. Never pass owner tokens, clipboard data or SDK requests. */
export function recordShutdownEvent(stage: string, facts: object = {}): void {
  // Evidence failure must not alter admission, clearance or cleanup behavior.
  try { console.error('[record-shutdown]', JSON.stringify({ stage, ...facts })); } catch { /* Retain the original decision. */ }
}
