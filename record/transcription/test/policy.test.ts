import {test} from 'node:test';
import assert from 'node:assert/strict';
import {admission, preview} from '../src/policy.ts';
test('admission passes validated facts to Record policy', () => {
  function check(enabled: boolean, supported: boolean) {
    assert.equal(enabled, true);
    return supported;
  }
  for (const platform of ['linux', 'macos']) {
    assert.deepEqual(admission({enabled: true, platform}, check), {version: 1, streaming: true});
  }
  assert.equal(admission({enabled: true, platform: 'unsupported'}, check).streaming, false);
  assert.throws(() => admission({enabled: 'true', platform: 'linux'}, check));
});
test('preview ends with its recording and cannot split unicode or grow indefinitely', () => {
  assert.equal(preview({state: 'streaming', text: 'private'}, false), null);
  const result = preview({state: 'streaming', text: '😀'.repeat(2000) + ' final words'}, true)!;
  assert.equal(Array.from(result.text).length, 1024);
  assert.ok(result.text.endsWith(' final words'));
  assert.equal(result.text.includes('\uFFFD'), false);
  assert.deepEqual(preview({state: 'failed', text: ''}, true), {text: '', failed: true});
});
