// Shared assertions for owned disposable native desktops only. No backend/socket mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { expect } = require('@playwright/test');

module.exports = async function verifyRetention(page, { config, captures, output }) {
  const marker = path.join(captures, 'retention-synthetic.bin');
  await fs.writeFile(marker, Buffer.alloc(1_000_000, 42), { flag: 'wx', mode: 0o600 });
  const original = JSON.parse(await fs.readFile(config, 'utf8'));
  const select = page.getByLabel('Keep recordings');
  const refresh = page.getByRole('button', { name: 'Refresh retention', exact: true });
  const usage = page.getByRole('button', { name: 'Refresh usage', exact: true });
  const save = page.getByRole('button', { name: 'Save retention', exact: true });
  const reset = page.getByRole('button', { name: 'Reset retention', exact: true });
  await expect(usage).toBeEnabled();
  await usage.click();
  await expect(page.getByText(/1 MB in captures/)).toBeVisible();
  await expect(select).toHaveValue('week');
  if (process.platform === 'darwin') {
    // CDP keyboard events leave the macOS native select popup open. Exercise
    // the real select/change handler without claiming native keyboard proof.
    await select.selectOption('month');
  } else {
    await select.focus();
    // Actual keyboard events, not setting DOM state or bypassing the renderer.
    // First option then two steps: disabled Custom, week, month.
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    if (await select.inputValue() === 'week') await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }
  await expect(select).toHaveValue('month');
  await save.click();
  await expect(usage).toBeEnabled();
  await expect(select).toHaveValue('month');
  let raw = JSON.parse(await fs.readFile(config, 'utf8'));
  assert.deepEqual(raw.retention, { mediaDays: 30, bundleDays: 90 });
  await refresh.click();
  await expect(usage).toBeEnabled();
  await expect(select).toHaveValue('month');
  await page.screenshot({ path: path.join(output, 'retention-saved.png'), fullPage: true });
  await reset.click();
  await expect(usage).toBeEnabled();
  await expect(select).toHaveValue('week');
  raw = JSON.parse(await fs.readFile(config, 'utf8'));
  assert.equal(Object.hasOwn(raw, 'retention'), false);
  const beforeFailure = await fs.readFile(config);
  // Genuine writer failure on a private config directory; never personal state.
  if (process.platform === 'darwin') await select.selectOption('forever');
  else { await select.focus(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); }
  await expect(select).toHaveValue('forever');
  try {
    await fs.chmod(path.dirname(config), 0o500);
    await save.click();
    await expect(page.getByText('Retention could not be saved.', { exact: false })).toBeVisible();
    assert.deepEqual(await fs.readFile(config), beforeFailure);
    await page.screenshot({ path: path.join(output, 'retention-write-error.png'), fullPage: true });
  } finally { await fs.chmod(path.dirname(config), 0o700); }
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(usage).toBeEnabled();
  await expect(select).toHaveValue('week');
  const blocked = path.join(captures, 'unreadable-synthetic');
  await fs.mkdir(blocked, { mode: 0o700 });
  try {
    await fs.chmod(blocked, 0);
    await usage.click();
    await expect(page.getByText('Folder usage is unavailable', { exact: false })).toBeVisible();
    assert.equal(await page.getByText(/1 MB in captures/).count(), 0);
    await page.screenshot({ path: path.join(output, 'retention-usage-error.png'), fullPage: true });
  } finally { await fs.chmod(blocked, 0o700); await fs.rmdir(blocked); }
  await usage.click(); await expect(page.getByText(/1 MB in captures/)).toBeVisible();
  assert.deepEqual(await fs.readFile(marker), Buffer.alloc(1_000_000, 42));
  const after = JSON.parse(await fs.readFile(config, 'utf8'));
  for (const key of Object.keys(original)) assert.deepEqual(after[key], original[key], `Unrelated ${key} changed`);
  await page.screenshot({ path: path.join(output, 'retention-reset.png'), fullPage: true });
  const preferenceRefresh = page.getByRole('button', { name: 'Refresh preferences', exact: true });
  const fixtureHome = path.dirname(path.dirname(path.dirname(config)));
  const legacyMode = process.platform === 'darwin'
    ? path.join(fixtureHome, 'Library/Application Support/apparent/last-mode')
    : path.join(fixtureHome, '.local/share/apparent/last-mode');
  await fs.mkdir(path.dirname(legacyMode), { recursive: true, mode: 0o700 });
  await fs.writeFile(legacyMode, 'screen\n', { mode: 0o600, flag: 'wx' });
  await preferenceRefresh.click();
  const pickerMode = page.getByLabel('Picker mode', { exact: true });
  const checks = page.getByLabel('Automatic update checks', { exact: true });
  const downloads = page.getByLabel('Automatic update downloads', { exact: true });
  await expect(pickerMode).toBeEnabled();
  if (!Object.hasOwn(original, 'lastCaptureMode')) await expect(pickerMode).toHaveValue('screen');
  assert.equal(await fs.readFile(legacyMode, 'utf8'), 'screen\n');
  await pickerMode.selectOption('screen');
  await expect(pickerMode).toBeEnabled();
  assert.equal(JSON.parse(await fs.readFile(config, 'utf8')).lastCaptureMode, 'screen');
  await checks.selectOption('false'); await expect(checks).toBeEnabled();
  await downloads.selectOption('false'); await expect(downloads).toBeEnabled();
  const savedPreferences = JSON.parse(await fs.readFile(config, 'utf8'));
  assert.equal(savedPreferences.automaticUpdateChecks, false);
  assert.equal(savedPreferences.automaticUpdateDownloads, false);
  for (const key of Object.keys(original)) assert.deepEqual(savedPreferences[key], original[key], `Preference edit changed unrelated ${key}`);
  await page.screenshot({ path: path.join(output, 'picker-updater-saved.png'), fullPage: true });
  const beforePreferenceFailure = await fs.readFile(config);
  try {
    await fs.chmod(path.dirname(config), 0o500);
    await downloads.selectOption('true');
    await expect(page.getByText('Could not confirm preferences. Refresh before trying again.')).toBeVisible();
    assert.deepEqual(await fs.readFile(config), beforePreferenceFailure);
    await page.screenshot({ path: path.join(output, 'picker-updater-write-error.png'), fullPage: true });
  } finally { await fs.chmod(path.dirname(config), 0o700); }
  await preferenceRefresh.click(); await expect(downloads).toHaveValue('false');
  await checks.selectOption('default'); await expect(checks).toBeEnabled();
  await downloads.selectOption('default'); await expect(downloads).toBeEnabled();
  const resetPreferences = JSON.parse(await fs.readFile(config, 'utf8'));
  assert.equal(Object.hasOwn(resetPreferences, 'automaticUpdateChecks'), false);
  assert.equal(Object.hasOwn(resetPreferences, 'automaticUpdateDownloads'), false);
  // Direct edits are an explicit supported input, in this owned synthetic config.
  resetPreferences.lastCaptureMode = 'window';
  await fs.writeFile(config, JSON.stringify(resetPreferences));
  await preferenceRefresh.click(); await expect(pickerMode).toHaveValue('area');
  await expect(page.getByText('The saved picker mode is unavailable.', { exact: false })).toBeVisible();
  assert.equal(JSON.parse(await fs.readFile(config, 'utf8')).lastCaptureMode, 'window');
  // Restore only these synthetic test keys so the enclosing Storage checks retain
  // their original config contract; no real-user config is opened by this fixture.
  for (const key of ['lastCaptureMode','automaticUpdateChecks','automaticUpdateDownloads']) {
    if (Object.hasOwn(original,key)) resetPreferences[key] = original[key]; else delete resetPreferences[key];
  }
  await fs.writeFile(config, JSON.stringify(resetPreferences));
  await fs.rm(legacyMode);
  await preferenceRefresh.click(); await expect(pickerMode).toBeEnabled();
  return { backend: 'real Rust GUI', renderer: 'shipped Electron production assets', data: 'synthetic owned files',
    save: true, reset: true, readback: true, failedWrite: true, usage: true, usageError: true,
    pickerUpdaterNativeControls: true, pickerUpdaterFailedWrite: true, unavailableModePreserved: true, legacyModeProjected: true,
    recovery: true, unknownConfigAndCapturePreserved: true, keyboard: process.platform !== 'darwin' };
};
