import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareForegroundScene, type LaunchObservation} from '../foreground/startup.ts';

const settings = {pid: 41, windowId: 7, title: 'Apparent Settings — About'};

test('the scene starts only after the exact launch Settings has closed', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const dismissal = new Promise<void>(resolve => { release = resolve; });
  const observations: LaunchObservation[] = [{frontPid: 1, settings: []}, {frontPid: 52, settings: []}];
  const pending = prepareForegroundScene({
    readySettings: async () => ({frontPid: 41, settings: [settings]}),
    closeSettings: async window => { assert.deepEqual(window, settings); calls.push('close'); await dismissal; },
    startScene: async () => { calls.push('scene'); return {pid: 52}; },
    observe: async () => observations.shift()!,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['close']);
  release();
  assert.deepEqual(await pending, {pid: 52});
  assert.deepEqual(calls, ['close', 'scene']);
});

test('failed or uncertain dismissal never starts a scene or repeats Close', async () => {
  let closes = 0, scenes = 0;
  const failure = Error('Native Close outcome unknown');
  await assert.rejects(prepareForegroundScene({
    readySettings: async () => ({frontPid: 41, settings: [settings]}),
    closeSettings: async () => { closes++; throw failure; },
    startScene: async () => { scenes++; return {pid: 52}; },
    observe: async () => { throw Error('Must not observe after uncertain Close'); },
  }), error => error === failure);
  assert.equal(closes, 1); assert.equal(scenes, 0);
});

test('remaining Settings and foreign foreground refuse capture admission', async () => {
  for (const retained of [true, false]) {
    let scenes = 0;
    await assert.rejects(prepareForegroundScene({
      readySettings: async () => ({frontPid: 41, settings: [settings]}),
      closeSettings: async () => {},
      startScene: async () => { scenes++; return {pid: 52}; },
      observe: async () => ({frontPid: 41, settings: retained ? [settings] : []}),
    }), retained ? /remained visible/ : /lacks foreground/);
    assert.equal(scenes, retained ? 0 : 1);
  }
});
