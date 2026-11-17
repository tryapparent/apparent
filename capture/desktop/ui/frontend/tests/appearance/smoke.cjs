const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
test('Settings renderer and window follow Electron theme changes without reload', {timeout:30000}, async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'theme-'));
  const application = await electron.launch({args:[path.resolve(__dirname,'../..'),'--settings-storage'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
  t.after(async()=>{await application.close();await fs.rm(home,{recursive:true,force:true});});
  const page = await application.firstWindow();
  await page.locator('.settings-shell').waitFor();
  // The shipped host permits 15s for committed DOM plus its first frame before
  // exiting for native fallback. Allow that startup deadline before theme checks.
  await expect.poll(() => application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isVisible()),
    {timeout:16000, message:'Settings presents within its existing startup deadline'}).toBe(true);
  assert.equal(await page.evaluate(() => typeof window.apparentSettingsMounted), 'function');
  assert.deepEqual(await application.evaluate(({BrowserWindow}) => {
    const {width, height} = BrowserWindow.getAllWindows()[0].getBounds();
    return {width, height};
  }), {width:720, height:530});
  // Playwright otherwise forces light media even when Electron follows the OS.
  await page.emulateMedia({colorScheme:null});
  await page.locator('.settings-shell').waitFor();
  assert.equal(await application.evaluate(({nativeTheme})=>nativeTheme.themeSource),'system');
  for(const mode of ['light','dark','light']) {
    await application.evaluate(({nativeTheme},mode)=>{nativeTheme.themeSource=mode;},mode);
    await expect(page.locator('body')).toHaveCSS('background-color',mode==='dark'?'rgb(32, 27, 36)':'rgb(245, 240, 232)');
    await expect(page.locator('.settings-shell')).toHaveCSS('background-color',mode==='dark'?'rgb(2, 1, 2)':'rgb(245, 240, 232)');
    assert.equal(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBackgroundColor().slice(0,7).toLowerCase()),mode==='dark'?'#201b24':'#f5f0e8');
    await expect(page.locator('.settings-sidebar')).toHaveCSS('background-color','rgb(2, 1, 2)');
    await expect(page.getByRole('button',{name:'Storage',exact:true})).toHaveCSS('color','rgb(2, 1, 2)');
    assert.equal(await page.locator('.settings-sidebar').evaluate(element => element.getBoundingClientRect().width), 216);
    for(const width of [720,640]) {
      await application.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,530),width);
      for(const name of ['General','Recording','Storage','Permissions','Agents','Labs','About']) {
        const control=page.getByRole('button',{name,exact:true});
        await control.hover();
        await expect(control).toHaveCSS('color','rgb(2, 1, 2)');
        await expect(control.locator('svg')).toHaveCSS('color','rgb(2, 1, 2)');
        await expect(control.locator('svg')).toHaveCSS('stroke','rgb(2, 1, 2)');
      }
      if(process.env.APPARENT_SHELL_PROOF) {
        await fs.mkdir(process.env.APPARENT_SHELL_PROOF,{recursive:true});
        await page.getByRole('button',{name:'Agents',exact:true}).hover();
        await page.screenshot({path:path.join(process.env.APPARENT_SHELL_PROOF,`sidebar-hover-${width}-${mode}.png`)});
      }
      await page.mouse.move(0,529);
      await expect(page.getByRole('button',{name:'Agents',exact:true}).locator('svg')).toHaveCSS('color','rgb(183, 165, 216)');
    }
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(720,530));
    for(const [name,color] of [['General','rgb(183, 165, 216)'],['Storage','rgb(2, 1, 2)']]) {
      const control=page.getByRole('button',{name,exact:true});
      await control.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
      await expect(control).toBeFocused();
      await expect(control).toHaveCSS('outline-style','solid');
      await expect(control).toHaveCSS('outline-color',color);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), true);
  }
  await application.evaluate(({nativeTheme})=>{nativeTheme.themeSource='system';});
});
