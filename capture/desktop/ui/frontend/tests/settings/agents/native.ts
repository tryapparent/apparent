// The Rust test owns the real config writer. This driver only relays the
// shipped Electron pipe and exercises its real renderer/preload/clipboard.
import {chromium, expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const deadline = setTimeout(() => { console.error('Agents native bridge deadline exceeded'); process.exit(1); }, 30000);
deadline.unref();
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-native-'));
const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const application = spawn(createRequire(import.meta.url)('electron') as string,
  ['--no-sandbox', frontend, '--settings-storage', '--settings-agents', '--settings-parent', '--remote-debugging-port=0'],
  {env: {...process.env, ELECTRON_RUN_AS_NODE: '', HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache')}, stdio: 'pipe'});
const parent = createInterface({input: process.stdin});
parent.on('line', line => application.stdin.write(line + '\n'));
application.stdout.on('data', chunk => process.stdout.write(chunk));
const exited = new Promise<void>(resolve => application.once('exit', () => resolve()));
let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
try {
  const debuggerUrl = await new Promise<string>((resolve, reject) => {
    let stderr = '';
    application.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const url = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
      if (url) resolve(url);
    });
    application.once('error', reject);
    application.once('exit', code => reject(Error(`Electron exited (${code}): ${stderr.slice(-1200)}`)));
  });
  browser = await chromium.connectOverCDP(debuggerUrl);
  const page = browser.contexts()[0].pages()[0];

  await expect(page.locator('.agent-command')).toHaveText(process.argv[3]);
  const toggle = page.getByRole('switch', {name: 'Ask for video proof'});
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch',{name:'Send recordings to T3'})).toHaveCount(0);
  for (const on of [false, true]) {
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(on));
    const saved = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
    assert.equal(saved.experiments.agentDemoVideo, on);
    assert.equal(saved.secret, 'private');
  }
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
} finally {
  // Closing through CDP emits an ordinary close action; only preference actions
  // are part of this test's parent relay contract.
  application.stdout.removeAllListeners('data');
  await browser?.close().catch(() => {});
  if (application.exitCode === null) { application.kill('SIGTERM'); await exited; }
  parent.close(); process.stdin.unref();
  await fs.rm(home, {recursive: true, force: true});
  clearTimeout(deadline);
}
