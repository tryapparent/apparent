import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';

export function commandRunner({budget, environment, redact}: {
  budget: (cap: number) => number;
  environment: () => NodeJS.ProcessEnv;
  redact: (value: unknown) => string;
}) {
async function command(executable: string, args: string[], options: {env?: NodeJS.ProcessEnv; timeout?: number; input?: string; ownedGroup?: boolean} = {}) {
  const cap = budget(options.timeout ?? 8000);
  const child = spawn(executable, args, {env: options.env ?? environment(), detached: options.ownedGroup === true, stdio: ['pipe', 'pipe', 'pipe']});
  const killOwned = () => {
    if (!options.ownedGroup) { child.kill('SIGKILL'); return; }
    try { process.kill(-child.pid!, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  let stdout = '', stderr = '', failure: Error | undefined;
  let expire: () => void = () => {};
  const expired = new Promise<never>((_, reject) => { expire = () => reject(failure); });
  const timer = setTimeout(() => { failure ??= Error(`${path.basename(executable)} exceeded command deadline`); killOwned(); child.stdout.destroy(); child.stderr.destroy(); expire(); }, cap);
  child.stdout.on('data', b => { stdout += b; if (stdout.length + stderr.length > 1_000_000) { failure = Error('Command output exceeded bound'); killOwned(); } });
  child.stderr.on('data', b => { stderr += b; if (stdout.length + stderr.length > 1_000_000) { failure = Error('Command output exceeded bound'); killOwned(); } });
  const inputDone = new Promise<void>(resolve => {
    let completed = false;
    const complete = (error?: Error | null) => {
      if (error) failure ??= error;
      if (!completed) { completed = true; resolve(); }
    };
    child.stdin.on('error', complete);
    child.stdin.end(options.input ?? '', complete);
  });
  try {
    const closed = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', () => resolve()); });
    await Promise.race([Promise.all([closed, inputDone]), expired]).finally(() => clearTimeout(timer));
    if (failure) throw failure;
    assert.equal(child.exitCode, 0, `${path.basename(executable)} failed: ${redact(stderr.slice(-1200))}`);
    return stdout;
  } catch (error) {
    if (options.ownedGroup) throw Error(redact(JSON.stringify({error: String(error),
      exitCode: child.exitCode, signal: child.signalCode, stdout: stdout.slice(-16_384), stderr: stderr.slice(-16_384)})));
    throw error;
  }
}

return command;
}

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
