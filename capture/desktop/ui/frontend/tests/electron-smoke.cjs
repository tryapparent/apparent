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
  let server;
  const application = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config') },
  });
  t.after(async () => {
    await application.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(home, { recursive: true, force: true });
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('Not connected', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => ({
    keys: Object.keys(window.apparent), require: typeof window.require, process: typeof window.process,
  })), { keys: ['readRuntimeState', 'readCaptureReference', 'copyCaptureReference', 'readCaptureLocation', 'changeCaptureLocation', 'resetCaptureLocation',
    'readErrorReporting', 'setErrorReporting', 'readConnectSettings', 'connectSettings', 'allowConnectUploads', 'cancelConnectSettings', 'checkConnectConnection',
    'disableConnectUploads', 'disconnectConnectSettings', 'openConnectBrowser', 'readRetention', 'saveRetention', 'resetRetention', 'readCaptureUsage'], require: 'undefined', process: 'undefined' });
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
    if (request?.errorReporting) {
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
  assert.ok(requests.every((request) => request === 'state\n' || JSON.parse(request).storage === 'read' || JSON.parse(request).reference === 'read' || JSON.parse(request).connect === 'settings' ||
    ['read', 'set'].includes(JSON.parse(request).errorReporting)));
  assert.deepEqual(errors, []);
  const screenshot = path.join(os.tmpdir(), `apparent-foundation-${process.pid}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(`Synthetic Electron screenshot: ${screenshot}`);

  // Do this after interaction checks: Playwright tracks even a cancelled Electron
  // navigation as pending; the actual webContents URL remains authoritative.
  const originalUrl = page.url();
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'https://example.com'; document.body.append(link); link.click(); link.remove();
    window.open('https://example.com');
  });
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL()), originalUrl);
  assert.equal(application.windows().length, 1);

  // A second renderer with the same preload still cannot invoke the bridge.
  assert.equal(await application.evaluate(async ({ BrowserWindow }, root) => {
    const other = new BrowserWindow({ show: false, webPreferences: {
      preload: root + '/electron/preload.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false,
    } });
    try {
      await other.loadFile(root + '/dist/index.html');
      return await other.webContents.executeJavaScript(`Promise.all(['readRuntimeState', 'readCaptureReference', 'copyCaptureReference'].map(k => window.apparent[k]().then(() => false, () => true))).then(r => r.every(Boolean))`);
    } finally { other.destroy(); }
  }, path.join(__dirname, '..')), true);
});

// Rust state is synthetic; the main/preload/renderer and OS window resizing are real.
test('onboarding fixed window shrinks to coach and restores setup', { timeout: 30000 }, async (t) => {
  const { spawn } = require('node:child_process');
  const { chromium } = require('@playwright/test');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'onboarding-window-'));
  const child = spawn(require('electron'), [path.join(__dirname, '..'), '--native-onboarding', '--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
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
  send({ penPicker:true });
  await expect(page.getByRole('heading', { name:'Pick your pen.', exact:true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(760);
  assert.deepEqual(await page.locator('.native-pencils button').allTextContents(),['','','','']);
  await page.getByRole('button',{name:'purple pen',exact:true}).click();
  await expect.poll(()=>output).toContain('pen:purple');
  send({penPicker:true,penSelected:true,penRgb:[122,88,199]});
  await expect(page.locator('.native-puddle path')).toHaveCSS('fill','rgb(122, 88, 199)');
  const centres=await page.evaluate(()=>{
    const h=document.querySelector('.native-pen-picker h1').getBoundingClientRect();
    const button=[...document.querySelectorAll('footer button')].at(-1).getBoundingClientRect();
    return [h.x+h.width/2,button.x+button.width/2,innerWidth/2];
  });
  assert.ok(Math.abs(centres[0]-centres[2])<2&&Math.abs(centres[1]-centres[2])<2);
  const before=await page.locator('.native-pond-frog').boundingBox();
  await page.getByRole('button',{name:'That’s my pen',exact:true}).click();
  await expect(page.getByRole('button',{name:'That’s my pen',exact:true})).toBeDisabled();
  const minimum=await page.evaluate(()=>new Promise(resolve=>{
    const frog=document.querySelector('.native-pond-frog');let min=frog.getBoundingClientRect().y;const began=performance.now();
    function sample(){min=Math.min(min,frog.getBoundingClientRect().y);if(performance.now()-began<1000)requestAnimationFrame(sample);else resolve(min)}requestAnimationFrame(sample);
  }));
  assert.ok(minimum<before.y-25,'frog must rise visibly before landing');
  await expect.poll(()=>output).toContain('"action":"continue"');
  assert.equal(output.match(/"action":"continue"/g)?.length,1);
  send({ step:'try-it', practice:'whiteboard', anchor:[300,30,320,50] });
  await expect(page.getByRole('heading', { name:'Open Whiteboard.', exact:true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(380);
  assert.equal(await page.evaluate(() => {
    const rect=document.querySelector('main').getBoundingClientRect();
    return rect.left>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight;
  }), true);
  send({ step:'try-it', practice:'locate', anchor:[900,0,24,24] });
  await expect(page.getByRole('heading', { name:'Apparent lives here.', exact:true })).toBeVisible();
  await expect(page.getByText('Find the Apparent icon in your menu bar. Click it, then choose Open Latest Capture.', { exact:true })).toBeVisible();
  await expect(page.locator('.native-coach')).toHaveAttribute('data-arrow','true');
  send({ step:'permissions' });
  await expect(page.getByRole('heading', { name:'We need three things.', exact:true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(760);
  assert.equal(await page.locator('.native-setup section > p').count(),0);
  send({step:'shortcut',shortcutChosen:true});
  await expect(page.getByRole('heading',{name:'Start and stop with your shortcut.',exact:true})).toBeVisible();
  assert.equal(await page.locator('.native-setup section > p').count(),0);
  await expect(page.getByRole('button',{name:'Change shortcut',exact:true})).toBeVisible();
  await page.emulateMedia({reducedMotion:'reduce'});
  send({penPicker:true,penSelected:true,penRgb:[59,121,189]});
  await expect(page.getByRole('heading',{name:'Pick your pen.',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'That’s my pen',exact:true}).click();
  await expect.poll(()=>output.match(/"action":"continue"/g)?.length).toBe(2);
  await expect(page.locator('.native-pond-frog')).toHaveCSS('animation-name','none');
});

// Replace only the default error dialog with a failing receipt. The real renderer,
// stdin/stdout pipes, shutdown handlers and profile are exercised unchanged.
test('onboarding survives a closed parent pipe and reopens the same profile', { timeout:30000 }, async t => {
  const { spawn }=require('node:child_process');
  const { chromium }=require('@playwright/test');
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'onboarding-parent-'));
  const wrapper=path.join(profile,'entry.cjs');
  await fs.writeFile(wrapper,`const {app}=require('electron');\nprocess.on('uncaughtException',error=>{process.stderr.write('UNHANDLED_ONBOARDING:'+error.stack+'\\n');app.exit(42)});\nrequire(${JSON.stringify(path.resolve(__dirname,'../electron/onboarding.cjs'))});\n`);
  const children=[],browsers=[];
  t.after(async()=>{
    for(const child of children)if(child.exitCode===null&&child.signalCode===null){
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owned Electron child did not exit during cleanup'));},3000);
        child.once('exit',()=>{clearTimeout(timer);resolve();});
        child.kill();
      });
    }
    for(const browser of browsers)await browser.close();
    await fs.rm(profile,{recursive:true,force:true});
  });
  for(const reason of ['stdin ended','close command','action after broken output']){
    const child=spawn(require('electron'),[wrapper,'--remote-debugging-port=0',...(process.platform==='linux'?['--no-sandbox']:[])],{env:{...process.env,APPARENT_UI_PROFILE:profile},stdio:['pipe','pipe','pipe']});
    children.push(child);let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
    const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    const endpoint=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('No debugger endpoint: '+stderr)),10000);
      child.once('exit',()=>{clearTimeout(timer);reject(Error('Early exit: '+stderr));});
      child.stderr.on('data',()=>{const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    });
    const browser=await chromium.connectOverCDP(endpoint);browsers.push(browser);
    const context=browser.contexts()[0],page=context.pages()[0]||await context.waitForEvent('page');
    child.stdin.write(JSON.stringify({type:'state',step:'permissions',ready:false,rows:[],index:1,count:4})+'\n');
    await expect(page.locator('.native-permissions')).toBeVisible();
    // The Rust parent can disappear during macOS Quit & Reopen. Its output
    // consumer is gone before Electron's window-close event is delivered.
    child.stdout.destroy();
    if(reason==='stdin ended')child.stdin.end();
    else if(reason==='close command')child.stdin.write('{"type":"close"}\n');
    else await page.getByRole('button',{name:'Back',exact:true}).click().catch(error=>{if(!/closed|Target/.test(error.message))throw error;});
    let timer;
    const result=await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Shutdown stalled: '+stderr)),5000)})]);
    clearTimeout(timer);
    assert.equal(result.code,0,reason+': '+stderr);
    assert.ok(!stderr.includes('UNHANDLED_ONBOARDING'),stderr);
    await browser.close();
  }
});
