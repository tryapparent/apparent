import assert from 'node:assert/strict';

export type LaunchWindow = {pid: number; windowId: number; title: string};
export type LaunchObservation = {frontPid: number; settings: LaunchWindow[]};

// Plain `apparent app` intentionally opens Settings. Close that owned launch
// surface before admitting the synthetic scene; idle does not mean it painted.
export async function prepareForegroundScene<T extends {pid: number}>(driver: {
  readySettings(): Promise<LaunchObservation>;
  closeSettings(window: LaunchWindow): Promise<void>;
  startScene(): Promise<T>;
  observe(): Promise<LaunchObservation>;
}): Promise<T> {
  const launch = await driver.readySettings();
  assert.equal(launch.settings.length, 1, 'Expected one owned launch Settings window');
  const window = launch.settings[0]!;
  assert.equal(window.title, 'Apparent Settings — About');
  assert.ok(Number.isSafeInteger(window.pid) && window.pid > 1);
  assert.ok(Number.isSafeInteger(window.windowId) && window.windowId > 0);
  await driver.closeSettings(window);
  const closed = await driver.observe();
  assert.deepEqual(closed.settings, [], 'Launch Settings remained visible after dismissal');
  const scene = await driver.startScene();
  const admitted = await driver.observe();
  assert.deepEqual(admitted.settings, [], 'Launch Settings reopened before capture');
  assert.equal(admitted.frontPid, scene.pid, 'Synthetic scene lacks foreground before capture');
  return scene;
}
