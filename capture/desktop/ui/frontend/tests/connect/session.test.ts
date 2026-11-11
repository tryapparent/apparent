import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openConnectSession } from '../../src/connect/session.ts';
import type { ConnectSettings } from '../../src/bridge.ts';

const saved = (check: boolean): ConnectSettings => ({ status: 'connected', view: {
  title: '', status: '', detail: '', server: null, verificationUri: null, userCode: null, note: '',
  buttons: check ? [{ command: 'check', title: 'Check connection', enabled: true }] : [],
} });

test('opening a saved session checks it once; subsequent local reads do not renew', async () => {
  let reads = 0, checks = 0;
  const renewed = saved(true);
  const bridge = { readConnectSettings: async () => { reads++; return saved(true); },
    checkConnectConnection: async () => { checks++; return renewed; } };
  assert.equal(await openConnectSession(bridge, () => true), renewed);
  await bridge.readConnectSettings();
  assert.equal(checks, 1);
  assert.equal(reads, 2);
});

test('signed-out, disabled, unavailable and closed Settings never start a probe', async () => {
  for (const snapshot of [saved(false), { status: 'disabled' }, { status: 'error' }] as ConnectSettings[]) {
    assert.equal(await openConnectSession({ readConnectSettings: async () => snapshot,
      checkConnectConnection: async () => { throw new Error('unexpected probe'); } }, () => true), snapshot);
  }
  const snapshot = saved(true);
  assert.equal(await openConnectSession({ readConnectSettings: async () => snapshot,
    checkConnectConnection: async () => { throw new Error('closed window'); } }, () => false), snapshot);
});
