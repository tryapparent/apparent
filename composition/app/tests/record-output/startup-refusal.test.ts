import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirmsForeignOwner, ForeignOwnerRefusal, isPreOwnershipRefusal, persistStartupFailure } from '../../src/record/omarchy/startup-refusal.ts';

const actual = { executableSha256: '9768f559f97b10e40b3efa348c54f220a87242794529d3d4fce37ace1b1e18d0',
  stderr: 'Error: native-host-only requires its own GUI owner\n', truncated: false,
  exitCode: 1, signal: null, profileWorkAbsent: true };
test('retained X1 pre-owner refusal requires reviewed executable, complete stderr, confirmed exit and absent profile work', () => {
  assert.equal(confirmsForeignOwner(actual), true);
  for (const change of [{ executableSha256: '0'.repeat(64) }, { exitCode: 0 }, { exitCode: null },
    { signal: 'SIGTERM' }, { truncated: true }, { profileWorkAbsent: false },
    { stderr: 'Native GUI readiness timed out' }, { stderr: actual.stderr.repeat(2) }]) {
    assert.equal(confirmsForeignOwner({ ...actual, ...change }), false);
  }
  assert.equal(isPreOwnershipRefusal(new Error(actual.stderr)), false);
  assert.equal(isPreOwnershipRefusal({ name: 'ForeignOwnerRefusal' }), false);
  assert.equal(isPreOwnershipRefusal(new ForeignOwnerRefusal()), true);
});
test('private startup evidence survives without serializing child handles and refuses symlink writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'startup-evidence-'));
  try {
    persistStartupFailure(root, new ForeignOwnerRefusal());
    const path = join(root, 'startup-diagnostic.log');
    assert.match(readFileSync(path, 'utf8'), /Another Apparent is running/);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    rmSync(path); const target = join(root, 'unrelated'); writeFileSync(target, 'preserve'); symlinkSync(target, path);
    assert.throws(() => persistStartupFailure(root, new Error('failed')));
    assert.equal(readFileSync(target, 'utf8'), 'preserve');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
