/** Bounded subprocess execution for installed foreground acceptance. */
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
    // The regression's Node runner owns a Swift child. Retire both on timeout
    // or output overflow, without changing other native command lifecycles.
    try { process.kill(-child.pid!, 'SIGKILL'); } catch (error: any) { if (error.code !== 'ESRCH') throw error; }
  };
  let stdout = '', stderr = '', failure: Error | undefined;
  let expire: () => void = () => {};
  const expired = new Promise<never>((_, reject) => { expire = () => reject(failure); });
  const timer = setTimeout(() => { failure ??= Error(`${path.basename(executable)} exceeded command deadline`); killOwned(); child.stdout.destroy(); child.stderr.destroy(); expire(); }, cap);
  child.stdout.on('data', b => { stdout += b; if (stdout.length + stderr.length > 1_000_000) { failure = Error('Command output exceeded bound'); killOwned(); } });
  child.stderr.on('data', b => { stderr += b; if (stdout.length + stderr.length > 1_000_000) { failure = Error('Command output exceeded bound'); killOwned(); } });
  // stdin belongs to a separate stream: ChildProcess 'error' does not catch
  // EPIPE when a short-lived native command closes its input. Retain that
  // failure, then await the original child close/deadline before returning.
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
    // Node's test runner writes Swift compiler/assertion failures to TAP stdout.
    // Retain bounded diagnostics in the caller's private failure receipt, also
    // on deadline/output failures, before failing the installed native case.
    if (options.ownedGroup) throw Error(redact(JSON.stringify({error: String(error),
      exitCode: child.exitCode, signal: child.signalCode, stdout: stdout.slice(-16_384), stderr: stderr.slice(-16_384)})));
    throw error;
  }
}

return command;
}
