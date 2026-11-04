import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discardApplication, prepareApplication, publishApplication, publishValidatedDirectory } from './transaction.ts';
function app(path: string, version: string) {
  mkdirSync(join(path, 'Contents/MacOS'), { recursive: true });
  writeFileSync(join(path, 'Contents/MacOS/apparent'), version);
  writeFileSync(join(path, 'Contents/MacOS/apparent-helper'), version);
  for (const component of ['inspection', 'recipient']) {
    mkdirSync(join(path, 'Contents/MacOS', component));
    writeFileSync(join(path, 'Contents/MacOS', component, 'version'), version);
  }
}
test('one managed app transaction upgrades both components; failed admission leaves installed bytes intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'application-transaction-'));
  try {
    const destination = join(root, 'Apparent.app');
    for (const version of ['initial', 'repeat', 'pin-upgrade']) {
      const candidate = prepareApplication(destination);
      assert.equal(statSync(join(candidate, '..')).mode & 0o777, 0o700);
      app(candidate, version);
      publishApplication(candidate, destination);
      discardApplication(candidate);
      for (const component of ['inspection', 'recipient']) assert.equal(readFileSync(join(destination, 'Contents/MacOS', component, 'version'), 'utf8'), version);
      assert.equal(statSync(destination).mode & 0o777, 0o755);
    }
    const failed = prepareApplication(destination);
    app(failed, 'unadmitted');
    // A component/signature admission failure never calls publish.
    discardApplication(failed);
    assert.equal(readFileSync(join(destination, 'Contents/MacOS/apparent'), 'utf8'), 'pin-upgrade');
    const candidate = prepareApplication(destination); app(candidate, 'rollback');
    assert.throws(() => publishValidatedDirectory(candidate, destination, () => {}, () => { throw Error('final publication failed'); }), /final publication failed/);
    discardApplication(candidate);
    assert.equal(readFileSync(join(destination, 'Contents/MacOS/apparent'), 'utf8'), 'pin-upgrade');
    const collision = join(root, 'component'); mkdirSync(collision);
    const source = join(root, 'validated'); mkdirSync(source); chmodSync(source, 0o700);
    assert.throws(() => publishValidatedDirectory(source, collision), /already exists/);
    assert(existsSync(source) && existsSync(collision));
  } finally { rmSync(root, { recursive: true }); }
});
