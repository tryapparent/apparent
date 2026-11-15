import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {timingContracts} from '../local-tests/contracts.ts';
import {selectedOwners} from '../ci/routing/consumers.ts';

test('new timing owner tests enter the shared contract inventory without changing its executor', t => {
  const root = mkdtempSync(join(tmpdir(), 'apparent-dev-contract-inventory-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'enablement/timing/review'), {recursive: true});
  assert.throws(() => timingContracts(root), /empty/);
  const first = 'enablement/timing/review/first.test.ts';
  writeFileSync(join(root, first), 'synthetic');
  assert.deepEqual(timingContracts(root), [first]);
  const next = 'enablement/timing/later.test.ts';
  writeFileSync(join(root, next), 'synthetic');
  assert.deepEqual(timingContracts(root), [next, first]);
  assert.deepEqual(selectedOwners([first, next]), ['tooling']);
  assert.notDeepEqual(selectedOwners(['enablement/local-tests/contracts.ts']), ['tooling'], 'execution definition changes stay conservative');
  symlinkSync(join(root, next), join(root, 'enablement/timing/escape.test.ts'));
  assert.throws(() => timingContracts(root), /symlink/);
});
