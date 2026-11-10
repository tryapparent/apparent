import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import type { PolicyContext, PolicyState } from '../src/settings-policy.cts';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/settings-policy.cts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'settings-policy.cts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const policyModule = { exports: {} as Record<string, unknown> };
new Function('exports', 'require', 'module', compiled)(policyModule.exports, require, policyModule);
const { transition } = policyModule.exports as typeof import('../src/settings-policy.cts');

const idle: PolicyState = { consent: false, confirmation: null };
const context = (action: PolicyContext['action'], extra: Partial<PolicyContext> = {}): PolicyContext => ({
  action, snapshotAvailable: true, busy: false, retryDisable: null, closed: false, ...extra,
});

test('forged allow and unavailable local snapshot cannot create upload consent or login intent', () => {
  assert.deepEqual(transition(idle, context('allow')).effect, null);
  const unavailable = transition(idle, context('connect', { snapshotAvailable: false }));
  assert.deepEqual(unavailable.state, idle);
  assert.equal(unavailable.overlay.mode, null);
});

test('consent is a separate local step before login intent and cancel is local', () => {
  const consent = transition(idle, context('connect'));
  assert.equal(consent.state.consent, true);
  assert.equal(consent.effect, null);
  assert.equal(consent.overlay.mode, 'consent');
  const allowed = transition(consent.state, context('allow'));
  assert.equal(allowed.effect, 'allow');
  assert.equal(allowed.state.consent, false);
  const cancelled = transition(consent.state, context('cancel'));
  assert.equal(cancelled.effect, null);
  assert.deepEqual(cancelled.state, idle);
});

test('busy and closed generations reject late transition requests without effects', () => {
  const consent = transition(idle, context('connect')).state;
  for (const blocked of [context('allow', { busy: true }), context('allow', { closed: true })]) {
    const result = transition(consent, blocked);
    assert.equal(result.effect, null);
    assert.equal(result.overlay.mode, null);
    assert.deepEqual(result.state, consent);
  }
});

test('disable and disconnect require the matching explicit confirmation', () => {
  assert.equal(transition(idle, context('disable')).effect, null);
  assert.equal(transition(idle, context('disconnect')).effect, null);
  const disable = transition(idle, context('request-disable'));
  assert.equal(disable.overlay.mode, 'confirmation');
  assert.equal(disable.overlay.buttons[0]?.command, 'disable');
  assert.equal(transition(disable.state, context('disconnect')).effect, null);
  assert.equal(transition(disable.state, context('disable')).effect, 'disable');
  const disconnect = transition(idle, context('request-disconnect'));
  assert.equal(disconnect.overlay.buttons[0]?.command, 'disconnect');
  assert.equal(transition(disconnect.state, context('disconnect')).effect, 'disconnect');
});

test('confirmation cancel clears only the local confirmation', () => {
  const confirmed = transition(idle, context('request-disconnect'));
  const cancelled = transition(confirmed.state, context('cancel'));
  assert.equal(cancelled.effect, null);
  assert.deepEqual(cancelled.state, idle);
  assert.equal(cancelled.overlay.mode, null);
});

test('durable disable failures retain the exact retry action even without a snapshot', () => {
  assert.equal(transition(idle, context('disable', { retryDisable: false, snapshotAvailable: false })).effect, 'disable');
  assert.equal(transition(idle, context('disconnect', { retryDisable: true, snapshotAvailable: false })).effect, 'disconnect');
  assert.equal(transition(idle, context('disconnect', { retryDisable: false })).effect, null);
});

test('offline/read errors never become upload consent or a health probe', () => {
  const result = transition(idle, context('connect', { snapshotAvailable: false }));
  assert.equal(result.effect, null);
  assert.equal(result.state.consent, false);
  assert.equal(result.overlay.mode, null);
});
