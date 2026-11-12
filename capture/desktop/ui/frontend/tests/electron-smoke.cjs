const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Exercise the real Electron main/preload/renderer against an explicitly synthetic
// socket. This is transport/security proof, not a live Rust or native-platform pass.
test('Electron preview, read-only bridge and isolation', { timeout: 45000 }, async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-'));
  const requests = [];
  let reply = '{"state":{"phase":"idle","capture_id":null}}\n';
  let reportingEnabled = true;
  let reportingReads = 0;
  let reportingAlwaysBusy = false;
  let reportingWrites = 0;
  let rejectReportingWrite = true;
  let publicFailure=false;
  let server;
  const application = await electron.launch({
    args: [path.join(__dirname, '..')],
    ...(process.env.PUBLIC_SHARE_VIDEO ? {recordVideo:{dir:process.env.PUBLIC_SHARE_VIDEO,size:{width:920,height:760}}}:{}),
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config') },
  });
  let phase = 'launch';
  let phaseStarted = Date.now();
  const progress = (next) => {
    phase = next;
    phaseStarted = Date.now();
    console.log(`Synthetic preview phase: ${phase}`);
  };
  // Synchronous owned-fixture metadata only: diagnostics must not wait on the
  // renderer/IPC that may be stalled, or delay the original test deadline.
  const diagnose = () => console.log('Synthetic preview state: ' + JSON.stringify({
    phase, phaseMs: Date.now() - phaseStarted, requests: requests.length,
    publicRequests: requests.filter(request => request.includes('"publicShare"')).length,
    socketListening: server?.listening ?? false,
    windows: application.windows().length,
    pid: application.process().pid, exitCode: application.process().exitCode,
  }));
  let diagnosticTimer;
  t.after(async () => {
    clearInterval(diagnosticTimer);
    diagnose();
    await application.close();
    if(process.env.PUBLIC_SHARE_VIDEO && page.video()) await page.video().saveAs(path.join(process.env.PUBLIC_SHARE_VIDEO,'sender-electron.webm'));
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(home, { recursive: true, force: true });
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('Not connected', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => ({
    keys: Object.keys(window.apparent), require: typeof window.require, process: typeof window.process,
  })), { keys: ['readMicrophoneEnabled', 'setMicrophoneEnabled', 'readRuntimeState', 'readCaptureReference', 'copyCaptureReference', 'startPublicShare', 'readPublicShare', 'cancelPublicShare', 'readCaptureLocation', 'changeCaptureLocation', 'resetCaptureLocation',
    'readErrorReporting', 'setErrorReporting', 'readConnectSettings', 'connectSettings', 'allowConnectUploads', 'cancelConnectSettings', 'checkConnectConnection',
    'disableConnectUploads', 'disconnectConnectSettings', 'requestDisableConnectUploads', 'requestDisconnectConnectSettings', 'openConnectSharedLinks',
    'openConnectBrowser', 'readRetention', 'saveRetention', 'resetRetention', 'readCaptureUsage', 'navigateSettings', 'showCaptureFolder'], require: 'undefined', process: 'undefined' });
  assert.equal(await application.evaluate(({ BrowserWindow }) => {
    const options = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return options.contextIsolation && options.sandbox && !options.nodeIntegration && options.webSecurity;
  }), true);
  assert.equal(await page.evaluate(async () => {
    try { await fetch('https://example.com'); return false; } catch { return true; }
  }), true);

  for (const label of ['Recording', 'Processing', 'Uploading', 'Preparing', 'Permission', 'Error', 'Idle']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await page.getByRole('tabpanel').getByText('SYNTHETIC EXAMPLE', { exact: true }).waitFor();
    await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  await page.getByRole('tab', { name: 'Idle', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Recording', exact: true })).toHaveAttribute('aria-selected', 'true');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 760));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  const directory = path.join(home, '.config/apparent/agent-control');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  server = net.createServer((socket) => socket.once('data', (data) => {
    requests.push(data.toString());
    const request = data.toString().startsWith('{') ? JSON.parse(data.toString()) : null;
    if (request?.reference) {
      socket.end('{"reference":{"id":"synthetic.apparent","copied":false}}\n');
    } else if(request?.publicShare) {
      if(request.publicShare==='deliver' && publicFailure) socket.end('{"error":"clipboard_failed"}\n');
      else socket.end(JSON.stringify({publicShare:request.publicShare==='start'?{operation:'a'.repeat(32),state:'preparing'}:{state:request.publicShare==='read'?'prepared':request.publicShare==='deliver'?'copied':'cancelled'}})+'\n');
    } else if (request?.errorReporting) {
      if (request.errorReporting === 'read' && (++reportingReads <= 3 || reportingAlwaysBusy)) {
        socket.end('{"error":"app_busy"}\n');
        return;
      }
      if (request.errorReporting === 'set') {
        reportingWrites += 1;
        if (rejectReportingWrite) return socket.end('{"error":"app_busy"}\n');
        reportingEnabled = request.enabled;
      }
      socket.end(JSON.stringify({ errorReporting: { enabled: reportingEnabled } }) + '\n');
    } else socket.end(reply);
  }));
  const address = path.join(directory, 'capture.sock');
  await new Promise((resolve) => server.listen(address, resolve));
  await fs.chmod(address, 0o600);
  // Let the production one-second cooldown expire, rather than bypassing it.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await page.getByRole('button', { name: 'Refresh state' }).click();
  await page.getByText('Connected · idle', { exact: true }).waitFor();
  const reporting = page.getByRole('region', { name: 'Send technical error reports', exact: true });
  await reporting.getByRole('button', { name: 'Refresh reporting setting' }).click();
  const toggle = reporting.getByRole('checkbox', { name: 'Send technical error reports' });
  await expect(toggle).toBeChecked();
  assert.equal(reportingReads, 4, 'repeated busy reads recover without another human action');
  await toggle.click();
  await expect(reporting.getByText('Rust is handling another settings request. Refresh shortly.')).toBeVisible();
  assert.equal(reportingWrites, 1, 'a rejected save must never be repeated');
  rejectReportingWrite = false;
  await reporting.getByRole('button', { name: 'Refresh reporting setting' }).click();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  assert.equal(reportingEnabled, false);
  const beforeBusy = reportingReads;
  reportingAlwaysBusy = true;
  await reporting.getByRole('button', { name: 'Refresh reporting setting' }).click();
  await expect(reporting.getByText('Rust is handling another settings request. Refresh shortly.')).toBeVisible();
  await expect(reporting.getByRole('button', { name: 'Refresh reporting setting' })).toBeEnabled();
  assert.equal(reportingReads - beforeBusy, 6, 'persistent contention stops after the bounded read attempts');
  reportingAlwaysBusy = false;
  assert.equal(await page.evaluate(async () => {
    try { await window.apparent.setErrorReporting('false'); return false; } catch { return true; }
  }), true);
  reply = '{"error":"app_busy"}\n';
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await page.getByRole('button', { name: 'Refresh state' }).click();
  await page.getByText('Unable to read state', { exact: true }).waitFor();
  reply = '{"state":{"phase":"processing","capture_id":"private"}}\n';
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await page.reload();
  await page.getByText('Connected · processing', { exact: true }).waitFor();
  assert.equal(await page.getByText('private', { exact: true }).count(), 0);
  assert.ok(requests.length >= 3);
  assert.ok(requests.every((request) => request === 'state\n' || JSON.parse(request).microphone === 'read' || ['read', 'locationfacts', 'probelocation', 'retention', 'usage'].includes(JSON.parse(request).storage) || JSON.parse(request).reference === 'read' || JSON.parse(request).connect === 'settings' ||
    ['read', 'set'].includes(JSON.parse(request).errorReporting)));
  assert.deepEqual(errors, []);
  const screenshot = path.join(os.tmpdir(), `apparent-foundation-${process.pid}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(`Synthetic Electron screenshot: ${screenshot}`);

  diagnosticTimer = setInterval(diagnose, 5000);
  diagnosticTimer.unref();
  progress('refresh capture reference: click');
  await page.getByRole('button',{name:'Refresh capture reference',exact:true}).click();
  progress('refresh capture reference: readback');
  await page.getByText('synthetic.apparent',{exact:true}).waitFor();
  const beforeShare=requests.filter(r=>r.includes('"publicShare"')).length;
  progress('public link: open confirmation');
  await page.getByRole('button',{name:'Copy public link',exact:true}).click();
  progress('public link: disclosure visible');
  await expect(page.getByText('Anyone with this link can view this capture. Shared captures are not end-to-end encrypted.',{exact:true})).toBeVisible();
  assert.equal(requests.filter(r=>r.includes('"publicShare"')).length,beforeShare);
  if(process.env.PUBLIC_SHARE_VIDEO) await page.waitForTimeout(1500);
  progress('public link: create');
  await page.getByRole('button',{name:'Create and copy public link',exact:true}).click();
  progress('public link: copied readback');
  await page.getByText('Link copied · upload may still be preparing. Open the link to check readiness.',{exact:true}).waitFor();
  if(process.env.PUBLIC_SHARE_VIDEO) {await page.screenshot({path:path.join(process.env.PUBLIC_SHARE_VIDEO,'sender-copied.png')});await page.waitForTimeout(1500);}
  assert.equal(requests.filter(r=>r.includes('"publicShare":"deliver"')).length,1);
  publicFailure=true;
  progress('public link failure: open confirmation');
  await page.getByRole('button',{name:'Copy public link',exact:true}).click();
  progress('public link failure: create');
  await page.getByRole('button',{name:'Create and copy public link',exact:true}).click();
  progress('public link failure: error readback');
  await page.getByText('Public link was not confirmed copied. Check your clipboard and refresh before trying again. Local Paste remains available.',{exact:true}).waitFor();

  // Do this after interaction checks: Playwright tracks even a cancelled Electron
  // navigation as pending; the actual webContents URL remains authoritative.
  const originalUrl = page.url();
  progress('isolation: external navigation attempt');
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'https://example.com'; document.body.append(link); link.click(); link.remove();
    window.open('https://example.com');
  });
  progress('isolation: owned URL readback');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL()), originalUrl);
  assert.equal(application.windows().length, 1);

  // A second renderer with the same preload still cannot invoke the bridge.
  progress('isolation: second renderer bridge refusal');
  assert.equal(await application.evaluate(async ({ BrowserWindow }, root) => {
    const other = new BrowserWindow({ show: false, webPreferences: {
      preload: root + '/electron/preload.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false,
    } });
    try {
      await other.loadFile(root + '/dist/index.html');
      return await other.webContents.executeJavaScript(`Promise.all(['readRuntimeState', 'readCaptureReference', 'copyCaptureReference', 'startPublicShare', 'readPublicShare', 'cancelPublicShare'].map(k => window.apparent[k]().then(() => false, () => true))).then(r => r.every(Boolean))`);
    } finally { other.destroy(); }
  }, path.join(__dirname, '..')), true);
  progress('complete');
});

// Rust state is synthetic; the main/preload/renderer and OS window resizing are real.
for(const mode of ['--onboarding'])test(`onboarding fixed window shrinks to coach and restores setup ${mode}`, { timeout: 45000 }, async (t) => {
  const { spawn } = require('node:child_process');
  const { chromium } = require('@playwright/test');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'onboarding-window-'));
  const child = spawn(require('electron'), [path.join(__dirname, '..'), mode, '--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
    env: { ...process.env, APPARENT_UI_PROFILE: profile }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let browser;
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.stdin.end('{"type":"close"}\n');
      const timer = setTimeout(() => child.kill(), 3000);
      await exited; clearTimeout(timer);
    }
    await browser?.close();
    await fs.rm(profile, { recursive: true, force: true });
  });
  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(Error('No Electron debugger endpoint')), 10000);
    child.once('error', reject);
    child.once('exit', () => { clearTimeout(timer); reject(Error('Electron exited before connection')); });
    child.stderr.on('data', bytes => {
      log += bytes;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context=browser.contexts()[0];
  const page=context.pages()[0]||await context.waitForEvent('page');
  const send = patch => child.stdin.write(JSON.stringify({ type:'state', step:'welcome', rows:[], ready:true,
    index:0, count:5, testInstance:true, shortcut:'⌃⌥⇧9', ...patch })+'\n');
  let output='';child.stdout.on('data',bytes=>output+=bytes);
  await page.emulateMedia({reducedMotion:'no-preference'});
  send({});
  await expect(page.getByRole('heading',{name:'Where’s ur agent at?',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Right here',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Up in the cloud',exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'idk?? →',exact:true}).click();
  await expect(page.getByText('Can ur agent open files on this computer?',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Right here →',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"continue"');
  send({ penPicker:true });
  await expect(page.getByRole('heading', { name:'Pick your pen.', exact:true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(760);
  assert.deepEqual(await page.locator('.native-pencils button').allTextContents(),['','','','']);
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.native-setup')).toHaveCSS('font-family', '"Host Grotesk", system-ui, sans-serif');
  await expect(page.getByRole('heading',{name:'Pick your pen.',exact:true})).toHaveCSS('font-size','36px');
  await expect(page.getByRole('button',{name:'Use this pen',exact:true})).toHaveCount(0);
  for(const scheme of ['light','dark','light']){
    await page.emulateMedia({colorScheme:scheme});
    await expect(page.locator('.native-setup')).toHaveCSS('background-color',scheme==='light'?'rgb(245, 240, 232)':'rgb(2, 1, 2)');
    const tip=await page.locator('.native-pencils button span').first().evaluate(el=>getComputedStyle(el,'::after').borderTopColor);
    assert.notEqual(tip,scheme==='light'?'rgb(245, 240, 232)':'rgb(2, 1, 2)','pen tip must remain visible against the page');
  }

  // Hold the first image decode, as on a cold launch. Save must finish first.
  await page.locator('.native-pond-frog').evaluate(img=>{const decode=img.decode.bind(img);img.decode=()=>decode().then(()=>new Promise(resolve=>{window.releasePenImage=resolve}));});
  const before=await page.locator('.native-pond-frog').boundingBox();
  await page.getByRole('button',{name:'purple pen',exact:true}).click();
  await expect.poll(()=>output).toContain('pen:purple:');
  const penSaveId=JSON.parse(output.trim().split('\n').at(-1)).action.split(':')[2];
  send({penPicker:true,penSelected:true,penRgb:[122,88,199]});
  await page.waitForTimeout(100);
  assert.equal(output.includes('"action":"continue"'),false,'stale selection cannot acknowledge this save');
  send({penPicker:true,penSelected:true,penRgb:[122,88,199],penSaveId});
  await expect(page.locator('.native-puddle path')).toHaveCSS('fill','rgb(122, 88, 199)');
  await expect(page.getByRole('button',{name:'purple pen',exact:true})).toBeDisabled();
  await new Promise(resolve=>setTimeout(resolve,1400));
  assert.equal(output.includes('"action":"continue"'),false,'cold image readiness must not be bypassed by a timer');
  await page.evaluate(()=>window.releasePenImage());
  await expect(page.locator('.native-pond')).toHaveAttribute('data-landing','true');
  const minimum=await page.evaluate(()=>new Promise(resolve=>{
    const frog=document.querySelector('.native-pond-frog');let min=frog.getBoundingClientRect().y;const began=performance.now();
    function sample(){min=Math.min(min,frog.getBoundingClientRect().y);if(performance.now()-began<1000)requestAnimationFrame(sample);else resolve(min)}requestAnimationFrame(sample);
  }));
  assert.ok(minimum<before.y-25,'frog must rise visibly before landing');
  await expect.poll(()=>output).toContain('"action":"continue"');
  assert.equal(output.match(/"action":"continue"/g)?.length,1);
  send({step:'try-it',practice:'screen'});
  await expect(page.getByRole('heading',{name:'Choose Screen.',exact:true})).toBeVisible();
  send({step:'try-it',practice:'screen',platform:'linux'});
  await expect(page.getByRole('heading',{name:'Choose your display.',exact:true})).toBeVisible();
  await expect(page.locator('.native-control')).toHaveCount(0);
  send({ step:'try-it', practice:'whiteboard', anchor:[300,30,320,50] });
  await expect(page.getByRole('heading', { name:'Open Whiteboard.', exact:true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(380);
  assert.equal(await page.evaluate(() => {
    const rect=document.querySelector('main').getBoundingClientRect();
    return rect.left>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight;
  }), true);
  send({step:'try-it',practice:'copy-failed'});
  await page.getByRole('button',{name:'Find saved capture',exact:true}).click();
  await expect.poll(()=>output).toContain('practice-locate');
  send({ step:'try-it', practice:'locate', anchor:[900,0,24,24] });
  await expect(page.getByRole('heading', { name:'apparent lives here.', exact:true })).toBeVisible();
  await expect(page.getByText('Click the a in your menu bar, then Open Latest Capture.', { exact:true })).toBeVisible();
  await expect(page.locator('.native-coach')).toHaveAttribute('data-arrow','true');
  for(const phase of ['screen','whiteboard','board-ink','screen-ink','stop','preparing','copied','paste','locate','complete','retry','copy-failed']){
    send({step:'try-it',practice:phase});
    await expect(page.locator('.native-coach')).toHaveAttribute('data-stage',phase);
    if(phase==='screen-ink'){
      await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(720);
      await expect(page.locator('.native-coach')).toHaveAttribute('data-paired','true');
      await expect(page.getByRole('complementary',{name:'Trackpad drawing hint'})).toBeVisible();
      const pair=await page.evaluate(()=>{const a=document.querySelector('.native-coach').getBoundingClientRect(),b=document.querySelector('.native-trackpad-helper').getBoundingClientRect();return{separate:a.right<b.left,inside:b.right<=innerWidth&&b.bottom<=innerHeight}});
      assert.deepEqual(pair,{separate:true,inside:true});
    }else{assert.equal(await page.getByRole('complementary',{name:'Trackpad drawing hint'}).count(),0)}
    const layout=await page.locator('.native-coach').evaluate(card=>{
      const content=card.querySelector('.native-coach-content'),rect=card.getBoundingClientRect();
      const buttons=[...card.querySelectorAll('button')].map(button=>({font:parseFloat(getComputedStyle(button).fontSize),radius:getComputedStyle(button).borderRadius,...(()=>{const r=button.getBoundingClientRect();return{width:r.width,height:r.height}})()}));
      return{bottom:rect.bottom,viewport:innerHeight,horizontal:content.scrollWidth>content.clientWidth,scroll:content.scrollHeight>content.clientHeight,buttons};
    });
    assert.ok(layout.bottom<=layout.viewport,phase+' coach is clipped');
    assert.equal(layout.horizontal,false,phase+' content overflows horizontally');
    assert.equal(layout.scroll,false,phase+' needs scrolling at normal text size');
    for(const button of layout.buttons){assert.ok(button.font>=18&&button.width>=44&&button.height>=44,phase+' button violates brand minimum');assert.equal(button.radius,'0px');}
  }
  send({step:'try-it',practice:'stop',shortcut:'⌃⌥⇧9',firstCaptureRequired:true});
  await expect(page.getByRole('heading',{name:'Finish your capture.',exact:true})).toBeVisible();
  assert.deepEqual(await page.locator('.native-saved-keys kbd').allTextContents(),['⌃','⌥','⇧','9']);
  assert.equal(await page.locator('.native-control').count(),0);
  await expect(page.getByRole('button',{name:'Close guide'})).toBeVisible();
  const human=[[20,30],[40,50],[70,60],[90,80]];
  const board={id:'apparent-test-1',strokes:[human],color:[59,121,189]};
  send({step:'try-it',practice:'board-ink',practiceBoard:[100,100,720,540],boardView:board});
  await expect(page.locator('.native-board')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Watch this.');
  if(process.env.APPARENT_ONBOARDING_EVIDENCE){await fs.mkdir(process.env.APPARENT_ONBOARDING_EVIDENCE,{recursive:true});await expect.poll(()=>page.locator('.native-board-lesson path').evaluate(el=>parseFloat(getComputedStyle(el).strokeDashoffset))).toBeLessThan(.5);await page.screenshot({path:path.join(process.env.APPARENT_ONBOARDING_EVIDENCE,'whiteboard-demo.png')});}
  const beforeGuide=output;
  await expect(page.getByRole('status')).toHaveText('Your turn.');
  assert.equal(output,beforeGuide,'the demonstration cannot emit native input');
  await expect(page.locator('.native-board-paper > svg polyline')).toHaveCount(1);
  await page.getByRole('button',{name:'Clear',exact:true}).click();
  await expect.poll(()=>output).toContain('"operation":"clear"');
  send({step:'try-it',practice:'board-ink',practiceBoard:[100,100,720,540],boardView:{id:'apparent-test-1',strokes:[],color:[59,121,189]}});
  await expect(page.locator('.native-board-paper > svg polyline')).toHaveCount(0);
  const beforeReplay=output;
  await page.getByRole('button',{name:'Replay guide',exact:true}).click();
  assert.equal(output,beforeReplay,'replay cannot clear or export human ink');
  const canvas=await page.getByLabel('Whiteboard drawing canvas').boundingBox();
  await page.mouse.move(canvas.x+20,canvas.y+30);await page.mouse.down();
  await page.mouse.move(canvas.x+100,canvas.y+90,{steps:5});await page.mouse.up();
  await expect.poll(()=>output).toContain('"operation":"end"');
  assert.ok(output.includes('"id":"apparent-test-1","operation":"begin"'));
  await page.mouse.move(canvas.x+150,canvas.y+120);await page.mouse.down();
  await page.mouse.move(canvas.x+190,canvas.y+150,{steps:3});
  send({step:'try-it',practice:'board-ink',practiceBoard:[100,100,720,540],boardView:null});
  await expect(page.locator('.native-board')).toHaveCount(0);
  await expect.poll(()=>output).toContain('"operation":"cancel"');
  await page.mouse.up();
  send({step:'try-it',practice:'board-ink',practiceBoard:[100,100,720,540],boardView:{id:'apparent-test-1',strokes:[human],color:[59,121,189]}});
  await expect(page.locator('.native-board')).toBeVisible();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'Replay guide',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Your turn.');
  await page.getByRole('button',{name:'Close whiteboard',exact:true}).click();
  await expect.poll(()=>output).toContain('"operation":"close"');
  await page.emulateMedia({reducedMotion:'no-preference'});
  send({step:'try-it',practice:'note',firstCaptureRequired:true});
  await expect(page.locator('.native-coach')).toHaveAttribute('data-stage','screen-ink');
  await expect(page.getByRole('heading',{name:'Draw on your screen.',exact:true})).toBeVisible();
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','draw');
  assert.equal(await page.getByRole('textbox').count(),0,'the coach must not replace the real note editor');
  await page.emulateMedia({reducedMotion:'no-preference'});
  // All three control examples remain presentation only, and settle once.
  for(const [phase,kind] of [['whiteboard','whiteboard'],['locate','locate']]){
    send({step:'try-it',practice:phase,firstCaptureRequired:true});
    await expect(page.locator('.native-control')).toHaveAttribute('data-kind',kind);
    const before=output;
    await page.locator('.native-control button').click();
    assert.equal(output,before,'Control-guide replay must never drive the app');
  }
  send({step:'try-it',practice:'whiteboard',firstCaptureRequired:true});
  await expect(page.locator('.native-control')).toHaveAttribute('data-kind','whiteboard');
  await page.locator('.native-control').evaluate(el=>{for(const a of el.getAnimations({subtree:true})){a.pause();a.currentTime=2500}});
  await expect(page.locator('.control-screen')).toHaveCSS('opacity','0');
  await expect(page.locator('.control-board')).toHaveCSS('opacity','1');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.native-control').evaluate(el=>el.getAnimations({subtree:true}).length),0);
  await expect(page.locator('.native-control button')).toBeHidden();
  await page.emulateMedia({reducedMotion:'no-preference'});
  send({step:'try-it',practice:'whiteboard',platform:'linux',firstCaptureRequired:true});
  assert.equal(await page.getByText('Click Whiteboard in the recording controls.',{exact:true}).count(),0);
  await expect(page.getByRole('figure',{name:'Example: click Whiteboard',exact:true})).toBeVisible();
  await expect(page.locator('.control-screen')).toBeHidden();
  await expect(page.locator('.control-board')).toHaveCSS('opacity','1');
  // Guides use the saved keys, finish once, and replay without invoking app actions.
  send({step:'try-it',practice:'retry',shortcut:'⌃⌘9',firstCaptureRequired:true});
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','record');
  assert.deepEqual(await page.locator('.native-gesture kbd').allTextContents(),['⌃','⌘','9']);
  const strip=await page.locator('.native-gesture').boundingBox();
  assert.ok(strip.height<=80,'Keep the inline demonstration compact');
  await page.locator('.native-gesture').evaluate(async el=>{
    await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished));
  });
  assert.equal(await page.locator('.native-gesture').evaluate(el=>el.getAnimations({subtree:true}).every(animation=>animation.playState==='finished')),true);
  await page.locator('.native-gesture-motion').evaluate(el=>window.originalGuideNode=el);
  const priorActions=output;
  await page.getByRole('button',{name:'Replay shortcut guide',exact:true}).click();
  assert.equal(await page.locator('.native-gesture-motion').evaluate(el=>el!==window.originalGuideNode),true);
  assert.equal(output,priorActions,'Replay must never send shortcuts or advance onboarding');
  send({step:'try-it',practice:'paste',platform:'linux',firstCaptureRequired:true});
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','paste');
  assert.deepEqual(await page.locator('.native-gesture kbd').allTextContents(),['Ctrl','V']);
  send({step:'try-it',practice:'retry',platform:'linux',shortcut:'Ctrl+Alt+K',firstCaptureRequired:true});
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','record');
  assert.deepEqual(await page.locator('.native-gesture kbd').allTextContents(),['Ctrl','Alt','K']);
  for(const [platform,shortcut,keys] of [
    ['linux','Ctrl++',['Ctrl','+']],
    ['macos','⌥⇧Space',['⌥','⇧','Space']],
    ['macos','⌥⇧+',['⌥','⇧','+']],
  ]){
    send({step:'try-it',practice:'retry',platform,shortcut,firstCaptureRequired:true});
    await expect(page.locator('.native-gesture')).toHaveAttribute('aria-label','Record with '+shortcut);
    assert.deepEqual(await page.locator('.native-gesture kbd').allTextContents(),keys);
  }
  await page.emulateMedia({colorScheme:'dark'});
  await page.locator('.native-gesture').evaluate(el=>{for(const animation of el.getAnimations({subtree:true})){animation.pause();animation.currentTime=2000}});
  await expect(page.locator('.native-gesture kbd').first()).toHaveCSS('color','rgb(2, 1, 2)');
  await expect(page.locator('.native-gesture')).toHaveCSS('background-color','rgb(231, 224, 238)');
  await expect(page.getByRole('button',{name:'Replay shortcut guide',exact:true})).toHaveCSS('color','rgb(2, 1, 2)');
  send({step:'try-it',practice:'screen-ink',firstCaptureRequired:true});
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','draw');
  await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
  assert.equal(await page.locator('.native-gesture').evaluate(el=>el.getAnimations({subtree:true}).length),0);
  await expect(page.getByRole('button',{name:'Replay drawing guide',exact:true})).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'light'});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(720);
  await expect(page.locator('.native-coach')).toHaveAttribute('data-paired','true');
  await expect(page.locator('.native-coach-content > p')).toHaveCSS('font-size','36px');
  await expect(page.locator('.native-trackpad-helper p')).toHaveCSS('font-size','36px');
  const enlargedHelper=await page.locator('.native-trackpad-helper').evaluate(el=>{const r=el.getBoundingClientRect(),content=el.querySelector('.native-trackpad-helper-content');return{inside:r.right<=innerWidth&&r.bottom<=innerHeight,horizontal:content.scrollWidth>content.clientWidth}});
  assert.deepEqual(enlargedHelper,{inside:true,horizontal:false});
  assert.equal(await page.locator('.native-coach-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.getByRole('button',{name:'Close guide',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:'Close guide',exact:true})).toBeInViewport();
  await page.evaluate(()=>document.documentElement.style.fontSize='');

  send({ step:'permissions' });
  await expect(page.getByRole('heading', { name:'We need three things.', exact:true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(760);
  assert.equal(await page.locator('.native-setup section > p').count(),0);
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:false,platform:'linux',shortcut:'Super+Shift+Copilot',shortcutEditor:{recording:false,externallyManaged:true}});
  await expect(page.locator('.native-shortcut kbd')).toHaveText('Super+Shift+Copilot');
  await expect(page.getByRole('button',{name:'Use Super+Shift+Copilot',exact:true})).toBeInViewport();
  await expect(page.getByRole('button',{name:'Choose another shortcut',exact:true})).toBeInViewport();
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Choose another shortcut',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"change-shortcut"');
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:false,platform:'macos',shortcutEditor:{recording:false,externallyManaged:false}});
  await expect(page.getByRole('heading',{name:'Choose your shortcut.',exact:true})).toBeVisible();
  await expect(page.locator('.native-shortcut kbd')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Choose shortcut',exact:true}).click();
  await expect.poll(()=>output).toContain('change-shortcut');
  assert.equal(output.includes('use-current-shortcut'),false);
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:false});
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  assert.equal(await page.getByText(/This check won’t record/).count(),0);
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
  assert.equal(output.includes('accept-shortcut-choice:'),false,'a held choice cannot complete practice');
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:false,shortcutSelectionReleased:true});
  await expect.poll(()=>output).toContain('accept-shortcut-choice:⌃⌥⇧9');
  assert.equal(await page.evaluate(()=>window.nativeOnboarding.action('accept-shortcut-choice:⌃⌥⇧9').then(()=>false,()=>true)),true,'renderer cannot forge a native selection receipt');
  const beforeTrialAdvance=(output.match(/"action":"continue"/g)?.length??0);
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:true});
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  await expect.poll(()=>(output.match(/"action":"continue"/g)?.length??0)).toBe(beforeTrialAdvance+1);
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:true});
  await page.waitForTimeout(100);
  assert.equal((output.match(/"action":"continue"/g)?.length??0),beforeTrialAdvance+1,'repeated state must not advance twice');
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Change shortcut',exact:true})).toBeVisible();
  send({step:'try-it',practice:'start',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:true});
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  assert.equal(await page.getByText(/Press .* to start recording/).count(),0);
  await expect(page.locator('.native-setup')).toBeVisible();
  await expect(page.locator('.native-coach')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>[innerWidth,innerHeight])).toEqual([760,520]);
  await expect(page.locator('.native-shortcut kbd')).toHaveText('⌃⌥⇧9');
  await expect(page.locator('.native-shortcut kbd')).toHaveCSS('font-size','40px');
  await page.evaluate(()=>document.getAnimations().forEach(a=>a.finish()));
  const heading=await page.getByRole('heading',{name:'One more time.',exact:true}).boundingBox();
  const keys=await page.locator('.native-shortcut kbd').boundingBox();
  assert.ok(Math.abs(heading.x+heading.width/2-(keys.x+keys.width/2))<2,'heading and shortcut share a centre');
  assert.ok(keys.y-(heading.y+heading.height)>=14&&keys.y-(heading.y+heading.height)<=18,'heading is 16px above shortcut');
  if(process.env.APPARENT_ONBOARDING_EVIDENCE){
    await fs.mkdir(process.env.APPARENT_ONBOARDING_EVIDENCE,{recursive:true});
    for(const scheme of ['light','dark']){
      await page.emulateMedia({colorScheme:scheme});
      await expect(page.locator('.native-setup')).toHaveCSS('background-color',scheme==='light'?'rgb(245, 240, 232)':'rgb(2, 1, 2)');
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      await page.screenshot({path:path.join(process.env.APPARENT_ONBOARDING_EVIDENCE,'one-more-time-'+scheme+'.png'),animations:'disabled'});
    }
  }
  assert.ok(Math.abs(keys.x+keys.width/2-380)<2,'keys are horizontally centered');
  assert.ok(Math.abs(keys.y+keys.height/2-260)<60,'keys are vertically centered in the compact setup');
  assert.equal(await page.locator('.native-setup section').evaluate(el=>el.scrollHeight>el.clientHeight),false);
  await expect(page.getByRole('button',{name:'Try a capture',exact:true})).toHaveCount(0);
  send({step:'try-it',practice:'screen',firstCaptureRequired:true});
  await expect(page.locator('.native-coach')).toBeVisible();
  await expect(page.locator('.native-setup')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThan(760);
  send({step:'try-it',practice:null,firstCaptureRequired:true});
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>[innerWidth,innerHeight])).toEqual([760,520]);
  await page.setViewportSize({width:320,height:520});
  for(const scheme of ['light','dark']){
    await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
    await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeInViewport();
    await expect(page.locator('.native-shortcut kbd')).toBeInViewport();
    assert.equal(await page.locator('.native-shortcut-prompt').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.keyboard.press('Tab');
    if(process.env.APPARENT_ONBOARDING_EVIDENCE)await page.screenshot({path:path.join(process.env.APPARENT_ONBOARDING_EVIDENCE,'one-more-time-320-'+scheme+'.png'),animations:'disabled'});
  }
  await page.setViewportSize({width:760,height:520});
  const fnChoiceStart=output.length;
  send({step:'shortcut',platform:'macos',shortcutChosen:false,shortcutEditor:{recording:false,externallyManaged:false,error:null}});
  await page.getByRole('button',{name:'Use Fn',exact:true}).click();
  await expect.poll(()=>output.slice(fnChoiceStart)).toContain('\"keyCode\":63');
  assert.ok(output.slice(fnChoiceStart).indexOf('change-shortcut')<output.slice(fnChoiceStart).indexOf('\"keyCode\":63'),'open the provider editor before Fn selection');
  send({step:'shortcut',shortcutEditor:{recording:true,externallyManaged:false}});
  const recorder=page.getByRole('group',{name:'Shortcut recorder'});
  await recorder.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button',{name:'Close setup'})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(recorder).toBeFocused();
  await expect(recorder).toHaveCSS('outline-style','solid');
  const screenshot=async name=>{
    if(!process.env.APPARENT_FN_EVIDENCE)return;
    await fs.mkdir(process.env.APPARENT_FN_EVIDENCE,{recursive:true});
    await page.screenshot({path:path.join(process.env.APPARENT_FN_EVIDENCE,name+'.png'),fullPage:true});
  };
  await screenshot('shortcut-listening-normal-light');
  await page.setViewportSize({width:320,height:520});
  for(const scheme of ['light','dark']){
    await page.emulateMedia({colorScheme:scheme});
    await expect(page.locator('.native-setup')).toHaveCSS('background-color',scheme==='light'?'rgb(245, 240, 232)':'rgb(2, 1, 2)');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`shortcut editor overflows at 320px in ${scheme} mode`);
    await expect(recorder).toBeInViewport();
    await screenshot(`shortcut-listening-320-${scheme}`);
  }
  await page.emulateMedia({colorScheme:'light'});
  const priorFnCount=(output.match(/"keyCode":63/g)||[]).length;
  await recorder.evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Fn',code:'Fn',metaKey:true,bubbles:true})));
  await expect(page.getByRole('alert')).toContainText('Fn alone');
  await screenshot('shortcut-rejected-fn-modifier');
  assert.equal((output.match(/"keyCode":63/g)||[]).length,priorFnCount,'Fn with another modifier must not be accepted');
  await recorder.getByRole('button',{name:'Use Fn',exact:true}).click();
  await expect.poll(()=>output).toContain('"keyCode":63,"modifiers":0,"key":"Fn"');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await screenshot('shortcut-fn-error-recovered');
  send({step:'shortcut',platform:'macos',shortcut:'Fn',shortcutChosen:true,shortcutTested:false,shortcutEditor:{recording:false,externallyManaged:false,error:null}});
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  await expect(page.locator('.native-shortcut kbd')).toHaveText('Fn');
  await screenshot('shortcut-accepted-fn');
  send({step:'shortcut',platform:'macos',shortcut:'Fn',shortcutChosen:true,shortcutEditor:{recording:true,externallyManaged:false,error:null}});
  await page.getByRole('group',{name:'Shortcut recorder'}).focus();
  await page.getByRole('group',{name:'Shortcut recorder'}).press('Control+Alt+k');
  await expect.poll(()=>output).toContain('"keyCode":40');
  await expect.poll(()=>output).toContain('"modifiers":6144');
  await page.getByRole('group',{name:'Shortcut recorder'}).evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'ß',code:'KeyS',altKey:true,bubbles:true})));
  await expect.poll(()=>output).toContain('"keyCode":1,"modifiers":2048,"key":"s"');
  await page.getByRole('group',{name:'Shortcut recorder'}).press('Tab');
  await expect(page.getByRole('button',{name:'Use Fn',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Use Fn',exact:true}).press('Tab');
  await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Cancel',exact:true}).press('Enter');
  await expect.poll(()=>output).toContain('cancel-shortcut');
  send({step:'shortcut',platform:'linux',shortcutChosen:false,shortcutEditor:{recording:false,externallyManaged:false,error:null}});
  await expect(page.getByRole('button',{name:'Use Fn',exact:true})).toHaveCount(0);
  send({shortcutEditor:{recording:true,externallyManaged:false,error:null}});
  await expect(page.getByRole('button',{name:'Use Fn',exact:true})).toHaveCount(0);

  await page.emulateMedia({reducedMotion:'reduce'});
  send({penPicker:true,penSelected:true,penRgb:[59,121,189]});
  await expect(page.getByRole('heading',{name:'Pick your pen.',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'blue pen',exact:true}).click();
  await expect.poll(()=>output).toContain('pen:blue:');
  const blueSaveId=JSON.parse(output.trim().split('\n').at(-1)).action.split(':')[2];
  send({penPicker:true,penSelected:true,penRgb:[59,121,189],penSaveId:blueSaveId});
  await expect.poll(()=>output.match(/"action":"continue"/g)?.length).toBe(beforeTrialAdvance+2);
  await expect(page.locator('.native-pond-frog')).toHaveCSS('animation-name','none');
  await page.setViewportSize({width:320,height:720});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'pen picker must reflow at 320 CSS pixels');
  await page.setViewportSize({width:760,height:720});

  // Back returns to a stable picker; an old success must never replay advance.
  const advances=()=>output.match(/"action":"continue"/g)?.length??0;
  const beforeBack=advances();
  send({step:'permissions',index:1});
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"back"');
  send({penPicker:true,penSelected:true,penRgb:[59,121,189],penSaveId:blueSaveId});
  await expect(page.getByRole('button',{name:'blue pen',exact:true})).toBeEnabled();
  await page.waitForTimeout(120);
  assert.equal(advances(),beforeBack);
  for(const scheme of ['light','dark'])for(const width of [760,320]){
    await page.emulateMedia({colorScheme:scheme});
    await page.setViewportSize({width,height:720});
    await page.getByRole('button',{name:'blue pen',exact:true}).focus();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const back=await page.getByRole('button',{name:'Back',exact:true}).boundingBox();
    assert.ok(back.x<60,'Back stays at the leading edge after removing confirmation');
    if(process.env.APPARENT_PEN_EVIDENCE)await page.screenshot({path:path.join(process.env.APPARENT_PEN_EVIDENCE,`picker-${scheme}-${width}.png`)});
  }
  // Keyboard selection and an immediate duplicate click produce just one save.
  const saves=()=>output.match(/pen:blue:/g)?.length??0;
  const beforeSave=saves();
  await page.getByRole('button',{name:'blue pen',exact:true}).press('Enter');
  await page.getByRole('button',{name:'blue pen',exact:true}).evaluate(button=>button.click());
  await expect.poll(saves).toBe(beforeSave+1);
  const failedId=JSON.parse(output.trim().split('\n').at(-1)).action.split(':')[2];
  assert.notEqual(failedId,blueSaveId,'same-colour reselection has a fresh receipt');
  send({penPicker:true,penSelected:false,penError:true,penSaveId:failedId});
  await expect(page.getByRole('alert')).toHaveText('The colour could not be saved. Try choosing it again.');
  await expect(page.getByRole('button',{name:'blue pen',exact:true})).toBeEnabled();
  assert.equal(advances(),beforeBack);
  for(const width of [760,320]){
    await page.setViewportSize({width,height:720});
    await page.locator('.native-setup section').evaluate(section=>section.scrollTop=0);
    const alert=await page.getByRole('alert').boundingBox(),section=await page.locator('.native-setup section').boundingBox();
    assert.ok(alert.y>=section.y&&alert.y+alert.height<=section.y+section.height,'save feedback must be visible above the footer without scrolling');
  }
  if(process.env.APPARENT_PEN_EVIDENCE)await page.screenshot({path:path.join(process.env.APPARENT_PEN_EVIDENCE,'picker-save-error-dark-320.png')});
  await page.getByRole('button',{name:'blue pen',exact:true}).press('Space');
  await expect.poll(saves).toBe(beforeSave+2);
  const retryId=JSON.parse(output.trim().split('\n').at(-1)).action.split(':')[2];
  send({penPicker:true,penSelected:false,penError:true,penSaveId:failedId});
  await page.waitForTimeout(100);assert.equal(advances(),beforeBack);
  send({penPicker:true,penSelected:true,penRgb:[59,121,189],penSaveId:retryId});
  await expect.poll(advances).toBe(beforeBack+1);
});
