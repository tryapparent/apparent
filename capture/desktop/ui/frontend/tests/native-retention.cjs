// Shared assertions for owned disposable native desktops only. No backend/socket mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {expect} = require('@playwright/test');

module.exports = async function verifyRetention(page, {config, captures, output}) {
  const marker = path.join(captures, 'retention-synthetic.bin');
  await fs.writeFile(marker, Buffer.alloc(1_000_000, 42), {flag:'wx', mode:0o600});
  const original = JSON.parse(await fs.readFile(config, 'utf8'));
  const field = page.getByRole('spinbutton', {name:'Maximum storage in GB'});
  const save = page.getByRole('button', {name:'Save limit', exact:true});
  const retry = page.getByRole('button', {name:'Check saved limit'});
  const usage = page.locator('.storage-used');
  await page.reload();
  await expect(usage).toHaveText('0.001 GB');
  await expect(field).toBeEnabled();
  await expect(field).toHaveValue('1');
  await expect(page.getByText('0.999 GB below the 1 GB limit')).toBeVisible();
  await field.fill('12.5');
  await field.press('Enter');
  await expect(page.getByText('Storage limit saved.')).toBeVisible();
  const capped = JSON.parse(await fs.readFile(config, 'utf8'));
  assert.deepEqual(capped, {...original, retention:{...original.retention, maximumMb:12500}});
  await page.screenshot({path:path.join(output, 'storage-limit-saved.png')});
  const beforeFailure = await fs.readFile(config);
  await field.fill('10');
  try {
    await fs.chmod(path.dirname(config), 0o500);
    await save.click();
    await expect(page.getByText('Could not confirm the save.', {exact:false})).toBeVisible();
    assert.deepEqual(await fs.readFile(config), beforeFailure);
    await page.screenshot({path:path.join(output, 'storage-limit-write-error.png')});
  } finally {await fs.chmod(path.dirname(config), 0o700);}
  await retry.click();
  await expect(field).toBeEnabled();
  await field.fill('0');
  await field.press('Enter');
  await expect(page.getByText('No size limit', {exact:true})).toBeVisible();
  const uncapped = JSON.parse(await fs.readFile(config, 'utf8'));
  assert.deepEqual(uncapped, {...original, retention:{...original.retention, maximumMb:0}});
  const blocked = path.join(captures, 'unreadable-synthetic');
  await fs.mkdir(blocked, {mode:0o700});
  try {
    await fs.chmod(blocked, 0);
    await page.reload();
    await expect(page.getByText('Could not measure folder usage.')).toBeVisible();
    await expect(usage).toHaveCount(0);
  } finally {await fs.chmod(blocked, 0o700); await fs.rmdir(blocked);}
  await page.getByRole('button', {name:'Retry usage scan'}).click();
  await expect(usage).toHaveText('0.001 GB');
  assert.deepEqual(await fs.readFile(marker), Buffer.alloc(1_000_000,42));
  return {backend:'real Rust GUI', renderer:'shipped Electron production assets', data:'synthetic owned files',
    save:true, reset:true, readback:true, failedWrite:true, usage:true, usageError:true,
    recovery:true, unknownConfigAndCapturePreserved:true, keyboard:true};
};
