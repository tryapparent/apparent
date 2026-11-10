// Invoked by the ignored Rust provider contract test with the packaged Electron
// Node runtime. No windows, OS input, clipboard writes or renderer receipts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import type { PracticeHost as Host, NativePractice } from '../src/host.ts';
import type { ProgressSnapshot } from '../src/progress.ts';

const { PracticeHost } = createRequire(import.meta.url)(process.argv[2]!) as { PracticeHost: typeof Host };
const { facts, progress } = JSON.parse(readFileSync(0, 'utf8')) as { facts: NativePractice[]; progress: ProgressSnapshot };
const effects: unknown[] = [];
const host = new PracticeHost({
  send(value) {
    const message = value as Record<string, unknown>;
    if (message.action === 'practice-effect') effects.push(message);
    else {
      assert.equal(message.operation, 'read', 'This facts contract probe never completes or mutates progress');
      queueMicrotask(() => host.reply({ ...message, type: 'practice-progress', result: progress }));
    }
  },
  changed() {},
  timeout(callback) { const timer = setTimeout(callback, 3000); return () => clearTimeout(timer); },
});
try {
  const stages = [];
  for (const fact of facts) {
    assert.equal(host.receive(fact), true, 'Real native facts must decode in the bundled production host');
    await setImmediate();
    stages.push(host.view!.stage);
  }
  console.log(JSON.stringify({ stages, effects }));
} finally { host.close(); }
