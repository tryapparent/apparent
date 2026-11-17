const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
// Transport/UI security fixture only. Actual consent policy is tested in Rust.
test('Connect shipped Electron IPC, consent presentation, browser action and lifecycle ownership', { timeout: process.env.CONNECT_VIDEO ? 300000 : 180000 }, async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ec-'));
  const evidence = process.env.CONNECT_EVIDENCE;
  if(evidence) await fs.mkdir(evidence,{recursive:true});
  const directory = path.join(home, '.config/apparent/agent-control');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const clients = new Set(), requests = [];
  let encryption=true;
  let closes = 0, stage = 'initial', accountInitial = 'S', hold, holdAction;
  const button = (command, title) => ({ command, title, enabled: true });
  const view = () => {
    const buttons = stage === 'enabling' ? [button('cancel','Cancel')] : stage === 'error' ? [button('connect','Connect')] : stage === 'disconnect-confirm' ? [button('disconnect','Disconnect'),button('cancel','Keep connected')] : stage === 'initial' ? [button('connect', 'Connect')]
      : stage === 'consent' ? [button('allow', 'Allow & continue'), button('cancel', 'Not now')]
      : stage === 'connected' ? [button('check','Check connection'), button('request-disable','Turn off uploads'), button('request-disconnect','Disconnect this computer')]
      : stage === 'disable-confirm' ? [button('disable','Turn off uploads'),button('cancel','Keep uploads on')]
      : stage === 'off' ? [button('connect','Enable uploads'),button('check','Check connection'),button('request-disconnect','Disconnect this computer')]
      : [button('open-browser', 'Open browser'), button('cancel', 'Cancel')];
    const headline = {enabling:'Enabling uploads…',initial:'Help others see what you mean.',consent:'Allow new capture uploads?',approval:'Finish connecting in your browser.',connected:'Connect ready',off:'Uploads are off.','disable-confirm':'Turn uploads off?'}[stage];
    return { encryption, phase:stage==='enabling'?'enabling':stage==='error'?'failed':stage==='approval'?'approval':stage==='connected'?'connected':'disconnected', title:'Apparent Connect', status:stage === 'connected' ? 'Uploads on' : 'Not connected',
      detail:stage === 'consent' ? 'Explicit upload consent required.' : 'Synthetic transport fixture.',
      server:'https://api.example.com', note:'No old captures or public links.',
      userCode:stage === 'approval' ? 'TEST-CODE' : null,
      verificationUri:stage === 'approval' ? 'https://example.com/device?code=TEST-CODE' : null,
      buttons,
      presentation:{tone:stage==='enabling'?'progress':stage==='error'?'failure':stage === 'connected' ? 'success' : stage === 'approval' ? 'progress' : ['disable-confirm','disconnect-confirm'].includes(stage) ? 'warning' : 'neutral',
        headline:stage==='error'?'Connection failed.':stage==='disconnect-confirm'?'Disconnect this computer?':headline,detail:stage === 'consent' ? 'Explicit upload consent required.' : 'Synthetic transport fixture.',note:'',
        artwork:['initial','consent','approval','connected'].includes(stage),compact:stage === 'connected',
        accountMenu:['connected','off'].includes(stage),...(accountInitial ? {accountInitial} : {}),buttons,
        menuActions:buttons.filter(b=>['check','request-disable','request-disconnect'].includes(b.command)).map(b=>b.command),sharedLinksUrl:null }
    };
  };
  const server = net.createServer(socket => {
    clients.add(socket); socket.on('error', () => {});
    let connect = false, bytes = '';
    socket.on('close', () => { clients.delete(socket); if (connect) closes += 1; });
    socket.on('data', chunk => {
      bytes += chunk;
      while (bytes.includes('\n')) {
        const end = bytes.indexOf('\n'), line = bytes.slice(0, end); bytes = bytes.slice(end + 1);
        if (line === 'state') { socket.end('{"state":{"phase":"idle"}}\n'); continue; }
        const request = JSON.parse(line);
        if (request.microphone === 'read') { socket.end('{"microphone":{"enabled":true}}\n'); continue; }
        if (request.errorReporting === 'read') { socket.end('{"errorReporting":{"enabled":true}}\n'); continue; }
        if (request.storage || request.reference) { socket.end('{"error":"feature_disabled"}\n'); continue; }
        connect = true; requests.push(request);
        if (request.connect === 'settings' && stage === 'approval') stage = 'initial';
        if (request.command === 'connect') stage = 'consent';
        if (request.command === 'allow') stage = 'approval';
        if (request.command === 'cancel') stage = ['disable-confirm','disconnect-confirm'].includes(stage) ? 'connected' : 'initial';
        if (request.command === 'request-disable') stage = 'disable-confirm';
        if (request.command === 'request-disconnect') stage = 'disconnect-confirm';
        if (request.command === 'disable') stage = 'off';
        const response = { connect: { ...view(), privateCredential: 'synthetic-secret' },
          ...(request.command === 'open-browser' ? { openUri: view().verificationUri } : {}) };
        if (request.command && request.command === holdAction) { hold = () => socket.write(JSON.stringify(response) + '\n'); continue; }
        socket.write(JSON.stringify(response) + '\n');
      }
    });
  });
  const address = path.join(directory, 'capture.sock');
  await new Promise(resolve => server.listen(address, resolve)); await fs.chmod(address, 0o600);
  const application = await electron.launch({ ...(process.env.APPARENT_SETTINGS_TEST_RUNTIME ? {executablePath:process.env.APPARENT_SETTINGS_TEST_RUNTIME}:{}), args: [process.env.APPARENT_SETTINGS_TEST_APP ?? path.join(__dirname, '../..'), '--settings-storage', '--settings-general'],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config') } });
  t.after(async () => {
    await application.close(); for (const client of clients) client.destroy();
    await new Promise(resolve => server.close(resolve)); await fs.rm(home, { recursive: true, force: true });
  });
  await application.evaluate(({ shell }) => { global.openedUris = []; shell.openExternal = async uri => { global.openedUris.push(uri); }; });
  const page = await application.firstWindow();
  await expect(page).toHaveTitle('Apparent Settings — General');
  assert.equal(await page.evaluate(async()=>{try{await window.apparent.changeCaptureLocation();return false;}catch{return true;}}),true);
  let parentOutput = '';
  application.process().stdout.on('data', data => { parentOutput += data; });
  const projectGeneral = async (loginOn = false, recording = false, label = 'Ctrl+R', error = null) => {
    await page.locator('.general-settings').waitFor();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await application.evaluate(({BrowserWindow},{loginOn,recording,label,error}) => BrowserWindow.getAllWindows()[0].webContents.send('apparent:general-state', {type:'general-state',
    platform:'linux',login:{on:loginOn,available:true,needsApproval:false},shortcuts:[{kind:'record',title:'Record',label,recording,externallyManaged:false,isDefault:true,clearable:false,error}],
    errorReporting:true,lowerPlayback:false,playbackLevel:35,playbackAvailable:false,
  }),{loginOn,recording,label,error});
    await expect(page.getByRole('switch',{name:'Launch at login',exact:true})).toBeVisible();
  };
  await projectGeneral();
  await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('apparent:general-state', {type:'general-state',platform:'linux',login:{on:false,available:true,needsApproval:false},shortcuts:[{kind:'record',title:'Record',label:'F1',recording:true,externallyManaged:false,isDefault:false,clearable:false,error:null}],errorReporting:true,lowerPlayback:false,playbackLevel:35,playbackAvailable:false}));
  await expect(page.getByRole('button',{name:'Cancel changing Record shortcut',exact:true})).toBeVisible();
  await page.keyboard.press('F12');
  await expect.poll(()=>parentOutput.includes('"keyCode":123')).toBe(true);
  await projectGeneral();
  await application.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(1);w.setSize(720,530)});
  await projectGeneral();
  await application.evaluate(({shell})=>{global.failBrowser=true;shell.openExternal=async uri=>{if(global.failBrowser)throw Error('Synthetic browser failure');global.openedUris.push(uri);};});
  const card = page.getByRole('region', { name: 'Apparent Connect' });
  await page.locator('.settings-content').evaluate(element=>{element.scrollTop=0});
  await page.screenshot({path:path.join(os.tmpdir(),'general-initial.png'),fullPage:true});
  await expect(card.getByText('End-to-end encrypted captures.')).toBeVisible();
  const activityText='While connected, recording starts contribute to daily and weekly account totals. Only a pseudonymous identifier and last active UTC date are kept for seven days; no recording content or email. Manage this in your Connect account’s analytics settings. Practice recordings are excluded.';
  const commandsBeforePrivacy=requests.filter(r=>r.command).length, writesBeforePrivacy=parentOutput;
  await expect(card.getByText(activityText,{exact:true})).toBeHidden();
  await card.locator('summary').filter({hasText:'Privacy'}).click();
  await expect(card.getByText(activityText,{exact:true})).toBeVisible();
  assert.equal(requests.filter(r=>r.command).length,commandsBeforePrivacy);
  assert.equal(parentOutput,writesBeforePrivacy,'privacy expansion does not write preferences');
  await expect(card.getByText(/New captures upload end-to-end encrypted:/)).toBeVisible();
  const privacy=await card.locator('summary').filter({hasText:'Privacy'}).boundingBox(),primary=await card.getByRole('button',{name:'Connect with Google',exact:true}).boundingBox();
  assert.ok(Math.abs(privacy.y-primary.y)<2,'privacy disclosure keeps the primary desktop action beside its control');
  await page.keyboard.press('Escape');
  await expect(card.locator('summary').filter({hasText:'Privacy'})).toBeFocused();
  await expect(card.locator('.connect-info')).not.toHaveAttribute('open');
  await page.evaluate(()=>{document.documentElement.style.fontSize='32px'});
  await card.locator('summary').filter({hasText:'Privacy'}).click();
  const largePrivacy=await card.locator('summary').filter({hasText:'Privacy'}).boundingBox(),largePrimary=await card.getByRole('button',{name:'Connect with Google',exact:true}).boundingBox();
  assert.ok(largePrivacy.x+largePrivacy.width<=largePrimary.x||largePrimary.x+largePrimary.width<=largePrivacy.x||largePrivacy.y+largePrivacy.height<=largePrimary.y||largePrimary.y+largePrimary.height<=largePrivacy.y,'200% text does not overlap privacy and primary controls');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{document.documentElement.style.fontSize=''});
  assert.equal(requests.filter(r=>r.command==='allow').length,0);
  assert.deepEqual(await application.evaluate(()=>global.openedUris),[]);
  await card.getByRole('button',{name:'Connect with Google',exact:true}).click();
  await expect(card.getByRole('button',{name:'Open browser',exact:true})).toBeVisible();
  const cancel=await card.getByRole('button',{name:'Cancel',exact:true}).boundingBox();
  const recovery=await card.getByRole('button',{name:'Open browser',exact:true}).boundingBox();
  assert.ok(Math.abs(recovery.y-cancel.y)<2,'browser recovery peers share a row');
  assert.ok(cancel.x-recovery.x-recovery.width>=8 && cancel.x-recovery.x-recovery.width<=12,'browser recovery peers are adjacent');
  assert.deepEqual(await card.locator('.status-actions button').allTextContents(),['Open browser','Cancel']);
  const explanation=await card.getByRole('alert').filter({hasText:'The browser could not be opened.'}).boundingBox();
  assert.ok(explanation.y+explanation.height<=recovery.y,'explanation above both actions');
  await expect(card.getByText('Approve in your browser.',{exact:true})).toBeVisible();
  await page.locator('.settings-content').evaluate(element=>{element.scrollTop=0});
  await page.screenshot({path:path.join(os.tmpdir(),'general-browser-failure.png'),fullPage:true});
  await application.evaluate(()=>{global.failBrowser=false;});
  await card.getByRole('button',{name:'Open browser',exact:true}).click();
  await expect.poll(()=>application.evaluate(()=>global.openedUris.length)).toBe(1);
  assert.deepEqual(requests.filter(r=>['connect','allow','open-browser'].includes(r.command)).map(r=>r.command),['connect','allow','open-browser','open-browser']);
  await expect(card.getByRole('button',{name:'Open browser',exact:true})).toHaveCount(0);
  await expect(card.getByLabel('Connect setup').locator('[aria-current=step]')).toHaveText('2 · Approve');
  await expect(card.getByText('TEST-CODE',{exact:true})).toHaveCount(0);
  assert.equal((await page.evaluate(()=>window.apparent.readConnectSettings())).view.privateCredential,undefined);
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Connect with Google', exact: true })).toBeEnabled();
  assert.equal(requests.filter(r => r.command === 'cancel').length, 1);
  // Real renderer, typed semantic state, and a separate Rust confirmation command.
  stage = 'connected';
  await expect(card.getByText('Connect ready', {exact:true})).toBeVisible();
  await expect(card.locator('[data-tone="success"]')).toHaveCSS('border-inline-start-color','rgb(20, 107, 67)');
  const account = page.getByRole('button',{name:'Account and connection options'});
  await expect(account).toContainText('Account');
  await page.emulateMedia({colorScheme:null});
  for (const mode of ['light','dark']) {
    await application.evaluate(({nativeTheme},mode)=>{nativeTheme.themeSource=mode;},mode);
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches),
      {message:`${mode} theme reaches renderer`}).toBe(mode === 'dark');
    for (const interaction of ['normal','hover','focus']) {
      await page.mouse.move(0,0);
      await account.evaluate(button=>button.blur());
      if (interaction === 'hover') await account.hover();
      if (interaction === 'focus') await account.focus();
      const contrast = await account.evaluate(async button=>{
        // Theme and hover changes animate colors; measure the settled state.
        await Promise.all(button.getAnimations().map(animation=>animation.finished));
        const style=getComputedStyle(button);
        const luminance = color => {
          const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});
          return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
        };
        const a=luminance(style.color),b=luminance(style.backgroundColor);
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });
      assert.ok(contrast>=4.5,`${mode} ${interaction}: ${contrast}`);
    }
  }
  await application.evaluate(({nativeTheme})=>{nativeTheme.themeSource='system';});
  accountInitial='M'; await expect(account).toContainText('Account');
  accountInitial=undefined;
  await expect(account).toContainText('Account');
  await expect(account).not.toContainText('M');
  accountInitial='S'; await expect(account).toContainText('Account');
  await account.click();
  await page.getByRole('button',{name:'Turn off uploads',exact:true}).click();
  await expect(card.getByText('Turn uploads off?',{exact:true})).toBeVisible();
  assert.equal(requests.filter(r=>r.command==='disable').length,0);
  await page.getByRole('button',{name:'Turn off uploads',exact:true}).click();
  await expect(card.getByText('Send captures to your cloud agent.',{exact:true})).toBeVisible();
  assert.equal(requests.filter(r=>r.command==='disable').length,1);
  await page.locator('.settings-content').evaluate(element=>{element.scrollTop=0});
  await page.screenshot({path:path.join(os.tmpdir(),'general-uploads-off.png'),fullPage:true});
  stage = 'initial';
  await expect(card.getByRole('button',{name:'Connect with Google',exact:true})).toBeVisible();
  // All shipped Connect handlers reject extra args, wrong frames and other windows.
  assert.equal(await application.evaluate(async ({ ipcMain, BrowserWindow }, root) => {
    const owner = BrowserWindow.getAllWindows()[0].webContents;
    for (const [name, handler] of ipcMain._invokeHandlers) {
      if (!name.startsWith('apparent:connect-') && name !== 'apparent:read-connect-settings') continue;
      for (const [sender, frame, args] of [[owner, owner.mainFrame, ['https://arbitrary.example/']], [owner, { url: owner.getURL() }, []]]) {
        try { await handler({ sender, senderFrame: frame }, ...args); return false; } catch {}
      }
    }
    const other = new BrowserWindow({ show: false, webPreferences: { preload: root + '/electron/preload.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await other.loadFile(root + '/dist/index.html');
      return await other.webContents.executeJavaScript(`Promise.all(['readConnectSettings','connectSettings','allowConnectUploads','cancelConnectSettings','checkConnectConnection','disableConnectUploads','disconnectConnectSettings','openConnectBrowser'].map(k => window.apparent[k]().then(() => false, () => true))).then(r => r.every(Boolean))`);
    } finally { other.destroy(); }
  }, path.join(__dirname, '../..')), true);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 530));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  // Hold the automatically opened approval request, then revoke it on reload.
  holdAction='open-browser';
  await application.evaluate(({ipcMain})=>{
    const original=ipcMain._invokeHandlers.get('apparent:connect-open-browser');
    ipcMain._invokeHandlers.set('apparent:connect-open-browser',(...args)=>{
      global.oldConnect=original(...args);return global.oldConnect;
    });
  });
  await card.getByRole('button',{name:'Connect with Google',exact:true}).click();
  await expect.poll(() => typeof hold).toBe('function');
  await page.reload(); await projectGeneral();
  assert.deepEqual(await application.evaluate(() => global.oldConnect), { status: 'cancelled' });
  await expect.poll(() => closes).toBe(1);
  holdAction = undefined; hold();
  await expect(card.getByRole('button', { name: 'Connect with Google', exact: true })).toBeVisible();
  assert.deepEqual(await application.evaluate(() => global.openedUris), ['https://example.com/device?code=TEST-CODE']);
  assert.equal(await page.getByText('synthetic-secret').count(), 0);
  // A saved session checks/renews once on opening; local polling stays local.
  stage = 'connected';
  const checks = requests.filter(r => r.command === 'check').length;
  await page.reload(); await projectGeneral();
  await expect.poll(() => requests.filter(r => r.command === 'check').length).toBe(checks + 1);
  await expect(card.getByText('Connect ready', { exact: true })).toBeVisible();
  const reads = requests.filter(r => r.connect === 'read').length;
  await expect.poll(() => requests.filter(r => r.connect === 'read').length).toBeGreaterThan(reads);
  assert.equal(requests.filter(r => r.command === 'check').length, checks + 1);
  for (const mode of ['light', 'dark']) {
    await application.evaluate(({nativeTheme}, mode) => { nativeTheme.themeSource = mode; }, mode);
    for (const width of [720, 640]) {
      await application.evaluate(({BrowserWindow}, width) => { BrowserWindow.getAllWindows()[0].setResizable(true); BrowserWindow.getAllWindows()[0].setSize(width, 530); }, width);
      await expect(card.getByText('Connect ready', { exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await account.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', {name:'Check connection', exact:true})).toBeVisible();
      await page.keyboard.press('Escape');
      await page.screenshot({path:path.join(os.tmpdir(), `apparent-session-${mode}-${width}.png`), fullPage:true});
    }
  }
  const activityScreenshot=async name=>{
    if(!evidence)return;
    const png=await application.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await fs.writeFile(path.join(evidence,name),Buffer.from(png,'base64'));
  };
  // Activity disclosures remain readable without granting consent or writing settings.
  for(const theme of ['light','dark'])for(const width of [720,640])for(const zoom of [1,2]) {
    await application.evaluate(({nativeTheme,BrowserWindow},{theme,width,zoom})=>{nativeTheme.themeSource=theme;const w=BrowserWindow.getAllWindows()[0];w.setSize(width,530);w.webContents.setZoomFactor(zoom)}, {theme,width,zoom});
    for(const state of ['initial','off','connected']) {
      stage=state;
      await expect(card.locator('h2')).toHaveText(state==='connected'?'Connect ready':'Send captures to your cloud agent.');
      if(state!=='connected')await expect(card.getByRole('button',{name:state==='off'?'Enable uploads':'Connect with Google',exact:true})).toBeVisible();
      const summary=state==='connected'?page.getByText('Activity counts',{exact:true}):card.locator('summary').filter({hasText:'Privacy'});
      if(state==='connected') { await account.focus();await page.keyboard.press('Enter'); }
      const details=summary.locator('..');
      if(await details.getAttribute('open')!==null) { await summary.focus();await page.keyboard.press('Escape'); }
      await expect(details.locator('p').last()).toBeHidden();
      await activityScreenshot(`activity-${state}-${theme}-${width}-${zoom}-collapsed.png`);
      const commands=requests.filter(r=>r.command).length,writes=parentOutput;
      await summary.focus();await page.keyboard.press('Enter');
      await expect(details.getByText(activityText,{exact:true})).toBeVisible();
      await details.getByText(activityText,{exact:true}).scrollIntoViewIfNeeded();
      assert.equal(requests.filter(r=>r.command).length,commands);
      assert.equal(parentOutput,writes,'disclosure does not write preferences');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const last=details.locator('p').last();
      assert.equal(await last.evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1}),true);
      if(state==='connected')assert.equal(await page.locator('.disclosure-panel').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1),true,'account panel fits viewport');
      await activityScreenshot(`activity-${state}-${theme}-${width}-${zoom}-expanded.png`);
      await summary.focus();await page.keyboard.press('Escape');await expect(summary).toBeFocused();await expect(details).not.toHaveAttribute('open');
      if(state==='connected') {await page.keyboard.press('Escape');await expect(account).toBeFocused();await expect(account).toHaveAttribute('aria-expanded','false');}
    }
  }
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await expect(page.locator('h1')).toHaveCSS('font-size','48px');
  await expect(page.locator('h1')).toHaveCSS('font-weight','700');
  await expect(page.getByRole('heading',{name:'Keyboard shortcuts'})).toHaveCSS('font-size','24px');
  await expect(page.locator('.general-row').first()).toHaveCSS('font-weight','500');
  for(const theme of ['light','dark'])for(const width of [720,640]) {
    await application.evaluate(({nativeTheme,BrowserWindow},{theme,width})=>{nativeTheme.themeSource=theme;BrowserWindow.getAllWindows()[0].setSize(width,530)}, {theme,width});
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const state of ['initial','approval','enabling','off','connected','error','disconnect-confirm','disable-confirm']) {
      stage=state;
      await expect(card.locator('h2')).toHaveText({enabling:'Enabling uploads…',initial:'Send captures to your cloud agent.',approval:'Approve in your browser.',off:'Send captures to your cloud agent.',connected:'Connect ready',error:'Connection failed.','disconnect-confirm':'Disconnect this computer?','disable-confirm':'Turn uploads off?'}[state]);
      if(state==='approval')assert.equal(await card.locator('.status-icon').evaluate(el=>getComputedStyle(el).animationName),'none');
      if(state==='disconnect-confirm') {
        await card.getByRole('button',{name:'Keep connected',exact:true}).focus();
        await page.keyboard.press('Enter');
        await expect(card.getByText('Connect ready',{exact:true})).toBeVisible();
        assert.equal(requests.filter(r=>r.command==='disconnect').length,0);
        stage='disconnect-confirm';await expect(card.getByRole('button',{name:'Keep connected',exact:true})).toBeVisible();
        await expect(card.getByText('Uploads stop. Saved captures stay.',{exact:true})).toBeVisible();
        await expect(card.locator('.status-actions button').first()).toHaveText('Keep connected');
        await expect(card.getByRole('button',{name:'Keep connected',exact:true})).toHaveClass(/primary-action/);
        await expect(card.getByRole('button',{name:'Disconnect',exact:true})).toHaveClass(/destructive-action/);
      }
      if(['disconnect-confirm','disable-confirm','error','initial','off'].includes(state)) {
        const actions=card.locator('.status-actions');
        const primary=actions.locator('button').first();
        await expect(primary).toHaveClass(/primary-action/);
        const group=await actions.boundingBox(),first=await primary.boundingBox();
        assert.ok(Math.abs(group.x-first.x)<2,'task recommendation starts at leading edge');
        const peer=actions.locator('button,summary').nth(1);
        const next=await peer.boundingBox();
        if(next && Math.abs(next.y-first.y)<8) assert.ok(next.x-first.x-first.width>=8 && next.x-first.x-first.width<=12,'task peers adjacent');
        if(state==='error') {
          const title=await card.locator('h2').boundingBox();
          assert.ok(first.y-title.y-title.height<=16,'failure recovery close below headline');
        }
      }
      const geometry=await card.locator('.status-heading').evaluate(el=>{
        const icon=el.querySelector('.status-icon'),title=el.querySelector('.status-title');
        if(!icon)return null;
        const a=icon.getBoundingClientRect(),b=title.getBoundingClientRect();return {w:a.width,h:a.height,delta:Math.abs(a.y+a.height/2-b.y-b.height/2)};
      });
      if(geometry){assert.equal(geometry.w,26);assert.equal(geometry.h,26);assert.ok(geometry.delta<1,'icon and title center together');}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const pairs=await card.evaluate(root=>{
        const lum=color=>{const a=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return a[0]*.2126+a[1]*.7152+a[2]*.0722};
        return [...root.querySelectorAll('button,summary,h2,p')].filter(el=>el.getClientRects().length).map(el=>{
          let node=el,bg=getComputedStyle(node).backgroundColor;
          while(bg==='rgba(0, 0, 0, 0)'&&node.parentElement){node=node.parentElement;bg=getComputedStyle(node).backgroundColor}
          const fg=getComputedStyle(el).color,a=lum(fg),b=lum(bg);
          return {text:el.textContent,fg,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
        });
      });
      for(const pair of pairs)assert.ok(pair.ratio>=4.5,JSON.stringify(pair));
      if(evidence)await fs.writeFile(path.join(evidence,`contrast-${state}-${theme}-${width}.json`),JSON.stringify(pairs,null,2));
      if(evidence) await page.screenshot({path:path.join(evidence,`general-${state}-${theme}-${width}.png`)});
      if(!['initial','approval'].includes(state))assert.equal(await card.getByLabel('Connect setup').count(),0);
      if(state==='connected')assert.equal(await card.locator('.status-artwork').evaluate(el=>el.getBoundingClientRect().width),112);
      if(state==='initial') assert.ok(await card.locator('.status-artwork').evaluate(el=>el.getBoundingClientRect().width)>=140);
      if(state==='approval') {
        const heading=await card.locator('h2').boundingBox(), cancel=await card.getByRole('button',{name:'Cancel',exact:true}).boundingBox();
        assert.ok(Math.abs(heading.y-cancel.y)<30,'waiting and Cancel share a row');
      }
    }
  }
  for(const theme of ['light','dark'])for(const width of [720,640]) {
    await application.evaluate(({nativeTheme,BrowserWindow},{theme,width})=>{nativeTheme.themeSource=theme;BrowserWindow.getAllWindows()[0].setSize(width,530)},{theme,width});
    stage='initial';await expect(card.getByRole('button',{name:'Connect with Google',exact:true})).toBeVisible();
    await application.evaluate(()=>{global.failBrowser=true});
    await card.getByRole('button',{name:'Connect with Google',exact:true}).click();
    await expect(card.getByRole('button',{name:'Open browser',exact:true})).toBeVisible();
    const primary=card.getByRole('button',{name:'Open browser',exact:true}),alternative=card.getByRole('button',{name:'Cancel',exact:true});
    const a=await primary.boundingBox(),b=await alternative.boundingBox();
    assert.ok(Math.abs(a.y-b.y)<2 && b.x-a.x-a.width>=8 && b.x-a.x-a.width<=12,'browser recovery adjacent in both themes and widths');
    await primary.focus();await page.keyboard.press('Tab');await expect(alternative).toBeFocused();
    if(evidence)await page.screenshot({path:path.join(evidence,`browser-failure-${theme}-${width}.png`)});
    await application.evaluate(()=>{global.failBrowser=false});
    await primary.click();await expect(primary).toHaveCount(0);
    if(evidence)await page.screenshot({path:path.join(evidence,`browser-recovered-${theme}-${width}.png`)});
    await alternative.click();
  }
  stage='connected';
  for(const mode of [false,null,true]) {
    encryption=mode;
    await expect(card.getByText(mode===true?'End-to-end encrypted.':mode===false?'Capture encryption is off.':'Encryption status unavailable.',{exact:true})).toBeVisible();
  }
  for(const zoomTheme of ['light','dark']) {
    await application.evaluate(({nativeTheme},theme)=>{nativeTheme.themeSource=theme},zoomTheme);
  for(const zoom of [1,2]) {
    await application.evaluate(({BrowserWindow},zoom)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom),zoom);
    for(const next of ['initial','approval','connected','error','disconnect-confirm']) {
      stage=next;
      await expect(card.locator('h2')).toHaveText({initial:'Send captures to your cloud agent.',approval:'Approve in your browser.',connected:'Connect ready',error:'Connection failed.','disconnect-confirm':'Disconnect this computer?'}[next]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      for(const button of await card.getByRole('button').all()) {
        const bounds=await button.boundingBox(); if(bounds)assert.ok(bounds.x>=0&&bounds.x+bounds.width<=await page.evaluate(()=>innerWidth)+1);
      }
      assert.equal(await page.locator('.settings-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'pane reflows without hidden horizontal overflow');
      if(evidence){
        const png=await application.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
        await fs.writeFile(path.join(evidence,`zoom-${zoomTheme}-${zoom}-${next}.png`),Buffer.from(png,'base64'));
        const last=card.getByRole('button').last();
        if(await last.count()) { await last.focus();const lower=await application.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));await fs.writeFile(path.join(evidence,`zoom-${zoomTheme}-${zoom}-${next}-action.png`),Buffer.from(lower,'base64')); }
        await fs.writeFile(path.join(evidence,`zoom-${zoomTheme}-${zoom}-${next}.json`),JSON.stringify(await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,card:document.querySelector('.apparent-status-card').getBoundingClientRect().toJSON()}))));
      }
    }
  }
  }
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  for (const theme of ['light','dark']) {
    await application.evaluate(({nativeTheme,BrowserWindow},theme)=>{nativeTheme.themeSource=theme;BrowserWindow.getAllWindows()[0].setSize(640,530)},theme);
    stage='initial';
    await expect(card.getByRole('button',{name:'Connect with Google',exact:true})).toBeVisible();
    await page.evaluate(()=>{document.documentElement.style.fontSize='32px'});
    const privacy=card.locator('summary').filter({hasText:'Privacy'});
    await privacy.focus();await page.keyboard.press('Enter');
    const action=card.getByRole('button',{name:'Connect with Google',exact:true});
    await expect.poll(async()=>{
      const a=await privacy.boundingBox(),b=await action.boundingBox();
      return a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y;
    },{message:`${theme} enlarged privacy and action remain separate`}).toBe(true);
    const primaryBox=await action.boundingBox(),helpBox=await privacy.boundingBox();
    assert.ok(helpBox.y>=primaryBox.y && (helpBox.y>=primaryBox.y+primaryBox.height || helpBox.x>=primaryBox.x+primaryBox.width),'enlarged text keeps recommendation first');
    if(evidence)await page.screenshot({path:path.join(evidence,`text-200-${theme}.png`)});
    await action.focus();
    if(evidence)await page.screenshot({path:path.join(evidence,`text-200-${theme}-action.png`)});
    assert.equal(await page.locator('.settings-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{document.documentElement.style.fontSize=''});
  }
  if(process.env.CONNECT_VIDEO) {
    await page.emulateMedia({reducedMotion:'no-preference'});
    const {spawn}=require('node:child_process');
    await application.evaluate(({BrowserWindow,nativeTheme})=>{nativeTheme.themeSource='light';const w=BrowserWindow.getAllWindows()[0];w.setSize(720,530);w.setPosition(0,0)});
    stage='initial';
    await expect(card.getByRole('button',{name:'Connect with Google',exact:true})).toBeVisible();
    await page.locator('.settings-content').evaluate(el=>el.scrollTop=0);
    const started=Date.now(),timeline=[];
    const recorder=spawn('ffmpeg',['-y','-progress','pipe:2','-stats_period','0.1','-f','x11grab','-framerate','30','-video_size','720x530','-i',process.env.DISPLAY+'+0,0','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-pix_fmt','yuv420p',process.env.CONNECT_VIDEO],{stdio:['pipe','ignore','pipe']});
    let firstFrameAt,progress='';const mediaClock=[];
    recorder.stderr.on('data',chunk=>{
      progress+=chunk.toString();
      const matches=[...progress.matchAll(/out_time_us=(\d+)/g)];
      if(matches.length){const pts=Number(matches.at(-1)[1]);if(pts>0&&firstFrameAt===undefined){firstFrameAt=Date.now()-pts/1000;mediaClock.push({at:Date.now(),pts,origin:firstFrameAt})}}
    });
    const pause=async()=>{await page.locator('.settings-content').evaluate(el=>{el.scrollTop=0});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));timeline.push(Math.max(0,Date.now()-(firstFrameAt??started)));return new Promise(resolve=>setTimeout(resolve,10000))};
    try {
      await pause();
      await card.locator('summary').filter({hasText:'Privacy'}).click(); await pause();
      await application.evaluate(()=>{global.failBrowser=true});
      await card.getByRole('button',{name:'Connect with Google',exact:true}).click();
      await expect(card.getByRole('button',{name:'Open browser',exact:true})).toBeVisible();await pause();
      await application.evaluate(()=>{global.failBrowser=false});
      await card.getByRole('button',{name:'Open browser',exact:true}).click();await pause();
      stage='connected';await expect(card.getByText('Connect ready',{exact:true})).toBeVisible();await pause();
      await account.click();await page.getByRole('button',{name:'Turn off uploads',exact:true}).click();await page.getByRole('button',{name:'Turn off uploads',exact:true}).click();await pause();
      stage='error';await expect(card.getByText('Connection failed.',{exact:true})).toBeVisible();await pause();
      await card.getByRole('button',{name:'Try again',exact:true}).click();
      await expect(card.getByText('Approve in your browser.',{exact:true})).toBeVisible();
      stage='connected';await expect(card.getByText('Connect ready',{exact:true})).toBeVisible();
      await account.click();await page.getByRole('button',{name:'Disconnect this computer',exact:true}).click();
      await expect(card.getByRole('button',{name:'Disconnect',exact:true})).toBeVisible();await pause();
      await card.getByRole('button',{name:'Keep connected',exact:true}).click();await pause();
    } finally {recorder.stdin.write('q');await new Promise(resolve=>recorder.on('exit',resolve));await fs.writeFile(process.env.CONNECT_VIDEO+'.timing.json',JSON.stringify(timeline));await fs.writeFile(process.env.CONNECT_VIDEO+'.clock.json',JSON.stringify({started,firstFrameAt,mediaClock}));await fs.writeFile(process.env.CONNECT_VIDEO+'.ffmpeg.log',progress);assert.ok(firstFrameAt,'FFmpeg media timestamps establish the narration clock');}
  }
  assert.equal(await page.evaluate(async()=>{try{await window.apparentLabs.read();return false;}catch{return true;}}),true);
  await assert.rejects(application.evaluate(async ({ipcMain,webContents})=>{
    const wc=webContents.getAllWebContents().find(w=>w.getURL().includes('settings.html'));
    return ipcMain._invokeHandlers.get('apparent:labs-preference')({sender:wc,senderFrame:wc.mainFrame},true,'sharing');
  }));
  await application.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(1);w.setSize(720,530)});
  for (const pane of ['Labs','Agents','Recording','Permissions','Storage','About']) {
    const target=page.getByRole('button',{name:pane,exact:true});
      await expect(target).toBeEnabled();await target.focus();await expect(target).toBeFocused();await target.press('Enter');
    await expect.poll(()=>parentOutput.includes('"pane":"'+pane.toLowerCase()+'"')).toBe(true);
  }
  const shot = path.join(os.tmpdir(), `apparent-connect-${process.pid}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`Synthetic Connect screenshot: ${shot}`);
});
