import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron, expect } from '@playwright/test';
import { buildShell, root } from '../../scripts/build.ts';
import { buildRecordArtifact } from '../../scripts/build-record.ts';
import { assemble, verifyAssembly } from '../../scripts/assemble.ts';
import { packageApplication } from '../../scripts/package.ts';
const { stopElectron } = createRequire(import.meta.url)('../../../../enablement/native/owned-processes.ts') as {
  stopElectron(application: Awaited<ReturnType<typeof electron.launch>> | undefined): Promise<void>;
};

test('packaged public Record pill uses only its injected bridge, compiled styles and local font', { timeout: 180_000 }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'record-pill-electron-')));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let sandbox: { path: string; bytes: Buffer; mode: number } | undefined;
  t.after(async () => {
    try { await stopElectron(application); }
    finally {
      if (sandbox) { await rm(sandbox.path); await writeFile(sandbox.path, sandbox.bytes, { mode: sandbox.mode }); await chmod(sandbox.path, sandbox.mode); }
      await rm(directory, { recursive: true, force: true });
    }
  });
  const binding = join(directory, 'binding.ts');
  await writeFile(binding, `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRecordFixture } from '@apparent/record/fixtures';
export async function createRecordHostServices({profilePath}) {
  const fixture = createRecordFixture('unsubscribe-during-recording');
  let detachCalls = 0;
  let statusCase = 0;
  return { record: {
    observe: fixture.client.observe.bind(fixture.client),
    async execute(command) {
      const result = await fixture.client.execute(command);
      if (result.status === 'accepted' && command.type === 'stop-capture') {
        const current = fixture.driver.current();
        fixture.driver.publish({...current, revision: current.revision + 1,
          captures: current.captures.map(capture => ({...capture, phase: 'cancelled'}))});
      }
      if (result.status === 'accepted' && command.type === 'refresh') {
        // Explicit public fixture facts test presentation/transport only, not
        // native Saved authentication, microphone or transcript production.
        const statuses = [null, {state:'collected',content:'nonempty',segmentCount:0},
          {state:'collected',content:'empty',segmentCount:4}, {state:'unavailable'}];
        const step = statusCase++;
        const status = statuses[step];
        const current = fixture.driver.current();
        if(step===4)fixture.driver.publish({...current,revision:current.revision+1,captures:[...current.captures,
          {captureId:'fixture-current-cancel',phase:'recording',delivery:'unknown',outcomes:[]}]});
        else if(step===5)fixture.driver.publish({...current,revision:current.revision+1,captures:current.captures.map(capture=>
          capture.captureId==='fixture-current-cancel'?{...capture,phase:'cancelled'}:capture)});
        else fixture.driver.publish({...current, revision:current.revision+1,captures:current.captures.map(capture=>{
          const next={...capture,phase:'saved',artifactId:'fixture-original-artifact'};
          delete next.transcriptStatus;delete next.warnings;
          if(status)next.transcriptStatus=status;
          if(status?.state==='unavailable')next.warnings=[{kind:'transcriptUnavailable'},{kind:'audioInitialGap',atMs:140}];
          return next;
        })});
      }
      await writeFile(join(profilePath, 'commands.json'), JSON.stringify(fixture.driver.commands()));
      return {...result, snapshot: fixture.driver.current()};
    },
    detach() { detachCalls++; fixture.client.detach(); },
  }, async canClose() { return !fixture.driver.captureContinues(); },
  async close() { await writeFile(join(profilePath, 'closed.json'), JSON.stringify({detachCalls})); } };
}
`);
  const shell = join(directory, 'shell');
  await buildShell(shell, undefined, { module: binding });
  const stream = join(directory, 'record'); await buildRecordArtifact(stream);
  const assembled = await assemble(shell, [stream], join(directory, 'app'));
  const bundle = await packageApplication(assembled, join(directory, 'packages'));
  const helper = process.env.APPARENT_FOUNDATION_SANDBOX_HELPER;
  if (process.platform === 'linux' && helper) {
    const metadata = await stat(helper);
    assert(metadata.isFile() && metadata.uid === 0 && (metadata.mode & 0o4000) && !(metadata.mode & 0o022));
    const path = join(bundle, 'chrome-sandbox');
    sandbox = { path, bytes: await readFile(path), mode: (await stat(path)).mode & 0o777 };
    await rm(path); await symlink(helper, path);
  }
  const payload = process.platform === 'darwin' ? join(bundle, 'Contents/Resources/app') : join(bundle, 'resources/app');
  await verifyAssembly(payload);
  const executablePath = process.platform === 'darwin' ? join(bundle, 'Contents/MacOS/apparent-foundation') : join(bundle, 'apparent-foundation');
  const profile = join(directory, 'profile'); await mkdir(profile, { mode: 0o700 });
  application = await electron.launch({ executablePath, args: [], env: { ...process.env, APPARENT_FOUNDATION_PROFILE: profile } });
  const page = application.windows()[0] ?? await application.waitForEvent('window');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const controls = page.getByRole('group', { name: 'Recording controls' });
  try { await expect(controls.getByRole('button', { name: 'Finish', exact: true })).toBeVisible(); }
  catch (error) {
    t.diagnostic(await page.content()); t.diagnostic(errors.join('\n'));
    throw error;
  }
  assert.equal(await page.locator('main.pill').getAttribute('data-phase'), 'recording');
  assert.deepEqual(await page.locator('.pill-row').evaluate(async row => {
    const fonts = await document.fonts.load('18px "Host Grotesk"', 'Recording');
    return { minimumHeight: getComputedStyle(row).minHeight, loaded: fonts.length > 0 && fonts.every(font => font.status === 'loaded') };
  }), { minimumHeight: '56px', loaded: true });
  assert.deepEqual(await page.evaluate(() => ({require: typeof (window as any).require, process: typeof (window as any).process})),
    {require: 'undefined', process: 'undefined'});
  if (process.env.APPARENT_RECORD_PILL_SCREENSHOT) await page.screenshot({ path: process.env.APPARENT_RECORD_PILL_SCREENSHOT });
  // Changing shell surfaces unmounts and reconnects presentation only, not capture.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
  await controls.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('main.pill')).toHaveAttribute('data-phase', 'selecting');
  const commands = JSON.parse(await readFile(join(profile, 'commands.json'), 'utf8'));
  assert.equal(commands.length, 1); assert.equal(commands[0].type, 'stop-capture'); assert.equal(commands[0].captureId, 'capture-active');
  assert.match(commands[0].requestId, /^[a-f0-9-]{36}$/);
  for(const notice of ['Saved locally','Saved locally · Transcript collected; 0 segments',
    'Saved locally · Transcript collected; no words','Saved locally · Transcript unavailable']){
    await page.evaluate(async()=>{
      const port=(window as any).apparent.record;const snapshot=await port.read();
      return port.execute({type:'refresh',requestId:crypto.randomUUID(),expected:{providerEpoch:snapshot.providerEpoch,revision:snapshot.revision}});
    });
    await expect(page.locator('main.pill')).toHaveAttribute('data-phase','completed');
    await expect(page.getByText(notice,{exact:true})).toBeVisible();
    await expect(controls.getByRole('button',{name:'Copy handoff',exact:true})).toBeEnabled();
  }
  await expect(page.getByText(/140/)).toBeVisible();
  if(process.env.APPARENT_RECORD_PILL_SCREENSHOT)await page.screenshot({path:process.env.APPARENT_RECORD_PILL_SCREENSHOT+'.transcript.png'});
  // Actual installed Record1015 presentation travels through the packaged
  // main/preload/renderer. These are public synthetic facts, not native Cancel
  // or authenticated Saved proof. ACK alone must leave the capture active.
  const refresh=()=>page.evaluate(async()=>{
    const port=(window as any).apparent.record,snapshot=await port.read();
    return port.execute({type:'refresh',requestId:crypto.randomUUID(),expected:{providerEpoch:snapshot.providerEpoch,revision:snapshot.revision}});
  });
  const previous=await page.evaluate(async()=>((await (window as any).apparent.record.read()).captures[0]));
  await refresh();
  await expect(controls.getByRole('button',{name:'Cancel',exact:true})).toBeVisible();
  await controls.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('main.pill')).toHaveAttribute('data-phase','recording');
  await expect(page.getByText('Current capture cancelled.',{exact:true})).toHaveCount(0);
  await refresh();
  await expect(page.getByText('Capture cancelled',{exact:true})).toBeVisible();
  await expect(page.getByText(/Current capture cancelled\. Previous recording remains saved\./)).toBeVisible();
  await expect(page.getByText(/Transcript unavailable/).first()).toBeVisible();
  await expect(controls.getByRole('button',{name:'Copy handoff',exact:true})).toBeEnabled();
  if(process.env.APPARENT_RECORD_PILL_SCREENSHOT)await page.screenshot({path:process.env.APPARENT_RECORD_PILL_SCREENSHOT+'.cancelled.png'});
  await controls.getByRole('button',{name:'Copy handoff',exact:true}).click();
  const afterCancelCommands=JSON.parse(await readFile(join(profile,'commands.json'),'utf8'));
  assert.equal(afterCancelCommands.find((command:any)=>command.type==='cancel-capture').captureId,'fixture-current-cancel');
  assert.equal(afterCancelCommands.at(-1).type,'copy-local');
  assert.equal(afterCancelCommands.at(-1).captureId,previous.captureId);
  assert.deepEqual(await page.evaluate(async()=>((await (window as any).apparent.record.read()).captures[0])),previous);
  assert.deepEqual(errors, []);
  const exited = application.waitForEvent('close');
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await exited; application = undefined;
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'closed.json'), 'utf8')), {detachCalls: 0});
});
