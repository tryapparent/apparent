const {test} = require('node:test');
const assert = require('node:assert/strict');
const {_electron: electron, expect} = require('@playwright/test');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

test('Storage Settings reads usage and confirms only explicitly saved limits', {timeout:45_000}, async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-ui-'));
  const directory = path.join(home, '.config/apparent/agent-control');
  await fs.mkdir(directory, {recursive:true, mode:0o700});
  const address = path.join(directory, 'capture.sock');
  let maximumMb = 20000;
  let revision = 'a'.repeat(16);
  let unknown = false;
  let usageFailed = false;
  let releaseUsage;
  let savedLocation = '/captures';
  const requests = [];
  const location = () => ({location:{saved:savedLocation ? {kind:'string',value:savedLocation} : {kind:'absent'},
    environment:{present:false,value:null}, homePath:home, builtinPath:'/captures', revision:'d'.repeat(16)}});
  const server = net.createServer(socket => {
    socket.once('data', data => {
      if (data.toString() === 'state\n') return socket.end('{"state":{"phase":"idle"}}\n');
      const request = JSON.parse(data.toString());
      const send = value => socket.end(JSON.stringify(value) + '\n');
      if (!request.storage) return send({error:'feature_disabled'});
      requests.push(request);
      const policy = () => ({maximumMb, revision, custom:true, secret:'hidden', retention:{
        mediaDays:{present:true,value:7}, bundleDays:{present:true,value:30},
      }});
      switch (request.storage) {
        case 'locationfacts': return send(location());
        case 'resetlocation':
          assert.equal(request.expected, 'd'.repeat(16));
          savedLocation = null;
          return send(location());
        case 'probelocation': return send({probe:{available:true}});
        case 'usage': {
          if (usageFailed) return send({error:'usage_unavailable'});
          const reply = () => send({usage:{effectivePath:'/captures', displayPath:'/captures', formatted:'12.4 GB', bytes:'12400000000'}});
          if (releaseUsage === undefined) {releaseUsage = reply; return;}
          return reply();
        }
        case 'retention': return send(policy());
        case 'savelimit':
          assert.equal(request.expected, revision);
          maximumMb = request.maximumMb;
          revision = revision === 'a'.repeat(16) ? 'b'.repeat(16) : 'c'.repeat(16);
          return send(unknown ? {error:'outcome_unknown'} : policy());
        default: return send({error:'invalid_request'});
      }
    });
  });
  await new Promise(resolve => server.listen(address, resolve));
  await fs.chmod(address, 0o600);
  let app;
  t.after(async () => {
    await app?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(home, {recursive:true, force:true});
  });
  app = await electron.launch({args:[path.join(__dirname, '..'), '--settings-storage'],
    env:{...process.env, HOME:home, XDG_CONFIG_HOME:path.join(home, '.config')}});
  const page = await app.firstWindow();
  const field = page.getByRole('spinbutton', {name:'Maximum storage in GB'});
  const save = page.getByRole('button', {name:'Save limit', exact:true});
  const proof = process.env.APPARENT_SETTINGS_PROOF;
  if (proof) await fs.mkdir(proof, {recursive:true});
  const shot = name => proof && page.screenshot({path:path.join(proof,name+'.png')});
  await expect(page.getByText('Calculating folder usage…')).toBeVisible();
  await expect(field).toBeDisabled();
  await expect.poll(() => typeof releaseUsage).toBe('function');
  await shot('storage-loading');
  releaseUsage();
  await expect(page.getByText('7.6 GB below the 20 GB limit')).toBeVisible();
  await expect(field).toHaveValue('20');
  await expect(page.getByRole('button',{name:'Refresh usage'})).toHaveCount(0);
  await expect(page.getByText('Keep recordings', {exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Show folder'})).toBeEnabled();
  assert.ok(!requests.some(request => /save|reset/.test(request.storage)));
  for (const width of [720, 640]) for (const theme of ['light','dark']) {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', {width,height:530,deviceScaleFactor:1,mobile:false});
    await page.emulateMedia({colorScheme:theme});
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => innerWidth),width);
    await expect(field).toBeVisible();
    const unit = await page.locator('.storage-limit-field span').boundingBox();
    assert.ok(unit && unit.height <= 24, 'GB stays on one line');
    await shot(`storage-${width}-${theme}`);
    await session.detach();
  }
  await field.fill('-1');
  await expect(page.getByText('Use 0 GB or more.')).toBeVisible();
  await expect(save).toBeDisabled();
  await shot('storage-invalid');
  await field.fill('10');
  await expect(page.getByText('7.6 GB below the saved 20 GB limit')).toBeVisible();
  await expect(page.getByText('Cleanup may move the oldest captures to the Trash to meet this limit.')).toBeVisible();
  await field.press('Escape');
  await expect(field).toHaveValue('20');
  assert.equal(requests.filter(request => request.storage === 'savelimit').length,0);
  await field.fill('10');
  await field.press('Tab');
  await expect(save).toBeFocused();
  await save.press('Enter');
  await expect(page.getByText('2.4 GB over the 10 GB limit')).toBeVisible();
  await expect(field).toBeFocused();
  await shot('storage-over-limit');
  unknown = true;
  await field.fill('0');
  await save.click();
  await expect(page.getByText('Could not confirm the save.', {exact:false})).toBeVisible();
  await expect(field).toBeDisabled();
  await expect(page.getByText('2.4 GB over the saved 10 GB limit')).toBeVisible();
  await shot('storage-unconfirmed');
  await page.getByRole('button',{name:'Check saved limit'}).click();
  await expect(field).toBeEnabled();
  await expect(field).toHaveValue('0');
  await expect(page.getByText('No size limit',{exact:true})).toBeVisible();
  assert.equal(requests.filter(request => request.storage === 'savelimit').length,2);
  usageFailed = true;
  await page.reload();
  await expect(page.getByText('Could not measure folder usage.')).toBeVisible();
  usageFailed = false;
  await page.getByRole('button',{name:'Retry usage scan'}).click();
  await expect(page.getByText('12.4 GB',{exact:true})).toBeVisible();
  const resetLocation = page.getByRole('button',{name:'Reset location'});
  await resetLocation.click();
  await expect(resetLocation).toHaveCount(0);
  assert.equal(requests.filter(request => request.storage === 'resetlocation').length,1);
});
