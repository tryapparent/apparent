/** Auditable receipts for the bounded, owned foreground capture commands. */
export type ControlOperation = 'start' | 'inspect' | 'stop';
export type ControlReceipt = {operation: ControlOperation; captureId: string; phase: 'request' | 'result' | 'failure'; startedAt: number; finishedAt?: number; receipt?: unknown; error?: string};

/** Persist request before admission and result/failure before callers assert or clean up. */
export async function auditedControl<T>(input: {
  operation: ControlOperation;
  captureId: string;
  invoke: () => Promise<T>;
  record: (entry: ControlReceipt) => Promise<void>;
  reportEvidenceFailure?: (error: unknown) => Promise<void>;
  now?: () => number;
  describeError?: (error: unknown) => string;
}): Promise<T> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const base = {operation: input.operation, captureId: input.captureId, startedAt};
  await input.record({...base, phase: 'request'});
  let result: T;
  try {
    result = await input.invoke();
  } catch (error) {
    const primary = error;
    try {
      await input.record({...base, phase: 'failure', finishedAt: now(), error: (input.describeError ?? String)(primary)});
    } catch (evidenceError) {
      try { await input.reportEvidenceFailure?.(evidenceError); } catch { /* primary remains authoritative */ }
    }
    throw primary;
  }
  await input.record({...base, phase: 'result', finishedAt: now(), receipt: result});
  return result;
}
