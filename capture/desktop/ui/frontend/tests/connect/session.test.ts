import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsBridge } from '../../src/connect/session.ts';
import type { ConnectSettings } from '../../src/connect/protocol.ts';

const saved = (check: boolean): ConnectSettings => ({ status: 'connected', view: {
  title: '', status: '', detail: '', server: null, verificationUri: null, userCode: null, note: '',
  buttons: check ? [{ command: 'check', title: 'Check connection', enabled: true }] : [],
} });

const unsupported = async (): Promise<ConnectSettings> => {
  throw new Error('Unexpected Connect command');
};
function session(read: () => ConnectSettings, check = unsupported) {
  return settingsBridge(() => ({
    readConnectSettings: async () => read(),
    checkConnectConnection: check,
    connectSettings: unsupported,
    resumeConnectUploads: unsupported,
    allowConnectUploads: unsupported,
    cancelConnectSettings: unsupported,
    disableConnectUploads: unsupported,
    disconnectConnectSettings: unsupported,
    openConnectBrowser: unsupported,
    requestDisableConnectUploads: unsupported,
    requestDisconnectConnectSettings: unsupported,
    openConnectSharedLinks: unsupported,
  })).open!;
}

test('the first active visit can check a saved connection, later visits read local facts', async () => {
  let reads = 0, checks = 0;
  const snapshot = saved(true), renewed = saved(true);
  const open = session(() => { reads++; return snapshot; },
    async () => { checks++; return renewed; });
  assert.equal(await open(() => false), snapshot);
  assert.equal(await open(() => true), renewed);
  assert.equal(await open(() => true), snapshot);
  assert.equal(checks, 1);
  assert.equal(reads, 3);
});

test('a first visit without a check does not defer an automatic check to a later visit', async () => {
  for (const first of [saved(false), { status: 'disabled' }, { status: 'error' }] as ConnectSettings[]) {
    const recent = saved(true);
    let snapshot = first;
    const open = session(() => snapshot);
    assert.equal(await open(() => true), first);
    snapshot = recent;
    assert.equal(await open(() => true), recent);
  }
});
