import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { inputAccessView, inputConsent } from './input-access.ts';

test('the shipped Electron projector preserves only validated Linux input facts', () => {
  const { project } = createRequire(import.meta.url)('../../electron/onboarding.cjs');
  const base = { type: 'state', step: 'permissions', rows: [], ready: true, platform: 'linux' };
  const facts = { keyboard: false, pointer: true, loginPending: true, restartRequired: false };
  assert.deepEqual(project({ ...base, inputAccess: { ...facts, secret: 'excluded' } }).inputAccess, facts);
  assert.equal(project({ ...base, inputAccess: { ...facts, keyboard: 'true' } }).inputAccess, null);
  for (const key of ['keyboard', 'pointer', 'loginPending']) {
    const incomplete: Record<string, unknown> = { ...facts };
    delete incomplete[key];
    assert.equal(project({ ...base, inputAccess: incomplete }).inputAccess, null);
    assert.equal(project({ ...base, inputAccess: { ...facts, [key]: null } }).inputAccess, null);
  }
  assert.deepEqual(project({ ...base, inputAccess: { keyboard: false, pointer: false, loginPending: false, restartRequired: false } }).inputAccess, { keyboard: false, pointer: false, loginPending: false, restartRequired: false });
  assert.equal(project({ ...base, platform: 'macos', inputAccess: facts }).inputAccess, null);
  assert.equal(project(base).inputAccess, null);
  assert.equal(project({ ...base, inputAccess: { ...facts, restartRequired: 'false' } }).inputAccess, null);
  assert.equal(project({ ...base, inputAccess: { ...facts, restartRequired: null } }).inputAccess, null);
  assert.equal(project({ ...base, inputAccess: { ...facts, restartRequired: true } }).inputAccess.restartRequired, true);
  const legacy = { keyboard: true, pointer: true, loginPending: false };
  assert.deepEqual(project({ ...base, inputAccess: legacy }).inputAccess, legacy);
  assert.equal(inputAccessView(project({ ...base, inputAccess: legacy }).inputAccess).label, 'Input reader status unknown');
});

test('only both native capabilities report full device access', () => {
  for (const [keyboard, pointer, label] of [
    [false, false, 'Screen and voice only'],
    [true, false, 'Partial input access'],
    [false, true, 'Partial input access'],
    [true, true, 'Keyboard and mouse access available'],
  ] as const) {
    assert.equal(inputAccessView({ keyboard, pointer, loginPending: false, restartRequired: false }).label, label);
  }
  assert.match(inputAccessView({ keyboard: true, pointer: true, loginPending: false, restartRequired: false }).detail, /access alone does not verify/);
});

test('pending login and unknown are distinct from access granted', () => {
  assert.equal(inputAccessView({ keyboard: false, pointer: false, loginPending: true, restartRequired: false }).label, 'Log out to apply input access');
  assert.match(inputAccessView({ keyboard: false, pointer: false, loginPending: true, restartRequired: false }).detail, /Reopening Apparent alone is not enough/);
  assert.equal(inputAccessView(null).label, 'Input access unknown');
  assert.match(inputConsent, /all processes/);
  assert.match(inputConsent, /never runs sudo/);
});

test('changed native facts immediately remove previously available status', () => {
  assert.match(inputAccessView({ keyboard: true, pointer: true, loginPending: false, restartRequired: false }).label, /available/);
  assert.equal(inputAccessView({ keyboard: false, pointer: false, loginPending: false, restartRequired: false }).label, 'Screen and voice only');
});

test('a changed reader or an old peer cannot promise current telemetry', () => {
  for (const [keyboard, pointer] of [[true, true], [false, false], [true, false]]) {
    const view = inputAccessView({ keyboard, pointer, loginPending: false, restartRequired: true });
    assert.equal(view.label, 'Restart Apparent to apply input changes');
    assert.match(view.detail, /Finish any capture/);
    assert.match(view.detail, /retain earlier access until you quit/);
  }
  assert.equal(inputAccessView({ keyboard: true, pointer: true, loginPending: false }).label, 'Input reader status unknown');
});
