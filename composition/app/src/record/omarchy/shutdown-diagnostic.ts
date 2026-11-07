import type { RecordCaptureCoordinatorShutdownReport } from '@apparent/record/host/capture2-coordinator';

/** Privileged local diagnostics only. Never pass owner tokens, clipboard data or SDK requests. */
export function recordShutdownEvent(stage: string, facts: object = {}): void {
  // Evidence failure must not alter admission, clearance or cleanup behavior.
  try { console.error('[record-shutdown]', JSON.stringify({ stage, ...facts })); } catch { /* Retain the original decision. */ }
}

export function shutdownReportDiagnostic(report: RecordCaptureCoordinatorShutdownReport) {
  return { scope: report.scope, admission: report.admission, localDrain: report.localDrain,
    runtimeClearance: report.runtimeClearance, nextShortcutAdmission: report.nextShortcutAdmission?.state,
    work: Array.isArray(report.work) ? report.work.map(item => ({ owner: item.owner, state: item.state })) : null };
}
