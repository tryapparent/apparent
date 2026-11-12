import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {YAML} from 'bun';

test('native verification and Linux publication use the same qualified Cargo layout', () => {
  const root = new URL('../../../', import.meta.url);
  const expected = new Map([
    ['verification-platform.yml', ['connect-client', 'rust']],
    ['release-linux.yml', ['linux']],
  ]);
  for (const [file, jobs] of expected) {
    const workflow = YAML.parse(readFileSync(new URL('.github/workflows/' + file, root), 'utf8'));
    for (const job of jobs) {
      const steps = workflow.jobs[job]?.steps;
      assert.ok(steps, file + ': ' + job);
      const toolchain = steps.filter((step: any) => step.uses?.startsWith('dtolnay/rust-toolchain@'));
      assert.equal(toolchain.length, 1, file + ': ' + job);
      assert.equal(toolchain[0].with?.toolchain, '1.99.1', 'Upgrade only with native staging and direct CLI evidence');
    }
  }
});
