import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron, expect } from '@playwright/test';
import { buildShell } from '../../scripts/build.ts';
import { buildRecordArtifact } from '../../scripts/build-record.ts';
import { assemble } from '../../scripts/assemble.ts';
import { packageApplication } from '../../scripts/package.ts';
import { fixture } from '../native-record/fixture.ts';
const { stopElectron } = createRequire(import.meta.url)('../../../../enablement/native/owned-processes.ts') as {
  stopElectron(application: Awaited<ReturnType<typeof electron.launch>> | undefined): Promise<void>;
};

test('packaged setup uses remembered state, explicit replay, owner assets and the existing recording entry',
  { timeout: 120_000, skip: process.platform !== 'linux' || process.arch !== 'x64' }, async t => {
    const f = await fixture();
    let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
    t.after(async () => { try { await stopElectron(application); } finally { await rm(f.work, { recursive: true, force: true }); } });
    const binding = join(f.work, 'synthetic-owner.ts');
    await writeFile(binding, `
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRecordFixture} from '@apparent/record/fixtures';
import {initialProgress,onboardingProgressCodec} from '@apparent/onboarding';
export async function createRecordHostServices({profilePath}) {
  await mkdir(profilePath,{recursive:true,mode:0o700});
  const f=createRecordFixture();
  f.driver.publish({...f.driver.current(),revision:f.driver.current().revision+1,captures:[],readiness:{requirements:[]}});
  let value=onboardingProgressCodec.encode({...initialProgress(),status:'completed',stage:'complete',setupCompleted:true}),revision=1,writes=0;
  return {record:f.client,onboardingProgress:{
    async read(){return {revision,value:structuredClone(value)}},
    async compareAndSwap(expected,next){
      if(expected!==revision)return {status:'conflict',revision,current:structuredClone(value)};
      value=onboardingProgressCodec.encode(onboardingProgressCodec.decode(next));writes++;
      await writeFile(join(profilePath,'synthetic-progress.json'),JSON.stringify({value,writes,commands:f.driver.commands()}));
      return {status:'saved',revision:++revision};
    }
  },async canClose(){return true},async close(){await writeFile(join(profilePath,'synthetic-closed'),'closed')}};
}
`);
    const shell = join(f.work, 'entry-shell');
    await buildShell(shell, undefined, { module: binding, presentation: 'omarchy', nativeArtifacts: f.input });
    const record = join(f.work, 'record-stream'); await buildRecordArtifact(record);
    const app = await assemble(shell, [record], join(f.work, 'assembly'));
    const bundle = await packageApplication(app, join(f.work, 'packages'));
    // Existing approved sandbox helper, only linked into this disposable fixture.
    const helper = process.env.APPARENT_FOUNDATION_SANDBOX_HELPER;
    assert(helper, 'Use the maintained sandbox-helper fixture contract');
    const metadata = await stat(helper);
    assert(metadata.isFile() && metadata.uid === 0 && (metadata.mode & 0o4000) && !(metadata.mode & 0o022));
    const sandbox = join(bundle, 'chrome-sandbox'); await rm(sandbox); await symlink(helper, sandbox);
    const profile = join(f.work, 'synthetic-profile');
    application = await electron.launch({ executablePath: join(bundle, 'apparent-foundation'),
      args: [], env: { ...process.env, APPARENT_FOUNDATION_PROFILE: profile } });
    const page = await application.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'Apparent', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome.', exact: true })).toHaveCount(0);
    await assert.rejects(readFile(join(profile, 'synthetic-progress.json')), { code: 'ENOENT' });
    const windowId = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
    await page.getByRole('button', { name: 'Replay welcome tour', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome.', exact: true })).toBeVisible();
    await expect(page.getByAltText('apparent', { exact: true })).toBeVisible();
    assert(await page.getByAltText('apparent', { exact: true }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0));
    let progress = JSON.parse(await readFile(join(profile, 'synthetic-progress.json'), 'utf8'));
    assert.equal(progress.writes, 1); assert.equal(progress.value.setupCompleted, true); assert.equal(progress.value.stage, 'welcome');
    await page.getByRole('button', { name: 'Close setup', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Apparent', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume setup', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Apparent', exact: true })).toBeVisible();
    progress = JSON.parse(await readFile(join(profile, 'synthetic-progress.json'), 'utf8'));
    assert.equal(progress.value.setupCompleted, true); assert.equal(progress.value.status, 'deferred');
    assert.equal(progress.writes, 2); assert.deepEqual(progress.commands, []);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id), windowId);
    assert.deepEqual(errors, []);
    const exited = new Promise<void>(resolve => application!.process().once('exit', () => resolve()));
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await exited;
    // stopElectron owns positive process cleanup, including failures. This is
    // a synthetic renderer/bridge check, never native writer/capture proof.
    assert.equal(await readFile(join(profile, 'synthetic-closed'), 'utf8'), 'closed');
  });
