import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identifyHiddenControlSurface, linuxStartTicks, nativeWindowId } from '../../src/native-surfaces/identity.ts';

// XID/CGWindowID both use the first native media-source component, never a pointer buffer.
test('native window IDs reject missing, desktop, zero, overflow and ambiguous encodings', () => {
  assert.equal(nativeWindowId('window:2097168:1'), 2097168);
  assert.equal(nativeWindowId('window:4294967295:0'), 4294967295);
  for (const value of ['window:0:0', 'screen:2097168:1', 'window:4294967296:0',
    'window:01:0', 'window:1:0:0', 'window:1:-1', 'window:1:0\n', 'window:1.5:0', 'window:1e3:0']) {
    assert.throws(() => nativeWindowId(value), /identity unavailable/, value);
  }
});

test('Linux process incarnation handles comm delimiters and retains exact u64 start ticks', () => {
  const stat = (ticks: string) => `123 (odd (name) with ) delimiters) S ${Array(18).fill('0').join(' ')} ${ticks} 0 0`;
  assert.equal(linuxStartTicks(stat('134621545')), '134621545');
  assert.equal(linuxStartTicks(stat('18446744073709551615')), '18446744073709551615');
  for (const value of ['0', '-1', '1.2', '18446744073709551616', '01']) {
    assert.throws(() => linuxStartTicks(stat(value)), /incarnation unavailable/);
  }
  assert.throws(() => linuxStartTicks('123 (unfinished'), /incarnation unavailable/);
});

test('ordinary Node cannot impersonate the owning Electron main process', () => {
  assert.throws(() => identifyHiddenControlSurface({} as never, 'x11'), /owning Electron process/);
});
