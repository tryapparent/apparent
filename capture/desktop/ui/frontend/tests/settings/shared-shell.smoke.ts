import {test} from 'node:test';
import assert from 'node:assert/strict';
import {_electron as electron, expect} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function generalState(platform:'linux'|'macos',recording=false,label='F1',on=false,error:string|null=null){
  return {type:'general-state',platform,login:{on,available:true,needsApproval:false},shortcuts:[{kind:'record',title:'Record',label,recording,externallyManaged:false,isDefault:platform==='linux'||label==='Fn',clearable:false,suggestedFn:platform==='macos'?{keyCode:63,modifiers:0,key:'Fn'}:null,error}],errorReporting:true};
}

test('General waits for parent confirmation and keeps recovery keyboard input outside shortcut capture',{timeout:30000},async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'general-recovery-'));
  const application=await electron.launch({args:['--no-sandbox',path.resolve(import.meta.dirname,'../..'),'--settings-storage','--settings-general'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:home+'/config'}});
  const page=await application.firstWindow();let recoveryOutput='';application.process().stdout!.on('data',data=>recoveryOutput+=String(data));
  async function projectGeneral(loginOn=false,recording=false,label='Ctrl+R',error:string|null=null){
    await page.locator('.general-settings').waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await application.evaluate(({BrowserWindow},state)=>BrowserWindow.getAllWindows()[0].webContents.send('apparent:general-state',state),generalState('linux',recording,label,loginOn,error));
  }
  try {
  await application.evaluate(({ipcMain})=>{
    global.generalActionHandler=ipcMain._invokeHandlers.get('apparent:general-action');global.generalRefusals=0;
    ipcMain.removeHandler('apparent:general-action');ipcMain.handle('apparent:general-action',()=>{global.generalRefusals++;throw Error('Synthetic sender refusal')});
  });
  await projectGeneral(false,true);
  const listening=page.getByRole('button',{name:'Cancel changing Record shortcut',exact:true});
  await listening.focus();await page.keyboard.press('F7');
  const shortcutFailure=page.getByRole('alertdialog',{name:/^(Couldn’t change record shortcut|Record shortcut not confirmed)$/});
  await expect(shortcutFailure).toHaveAccessibleName('Couldn’t change record shortcut');
  await expect(shortcutFailure).toBeVisible();await page.keyboard.press('Tab');
  await expect(shortcutFailure.getByRole('button',{name:'Close',exact:true})).toBeFocused();
  await page.keyboard.press('Enter');await expect(shortcutFailure).not.toBeVisible();
  assert.equal(await application.evaluate(()=>global.generalRefusals),1,'Tab and Enter belong to modal recovery');
  await listening.focus();await page.keyboard.press('F8');await expect(shortcutFailure).toBeVisible();
  await page.keyboard.press('Escape');await expect(shortcutFailure).not.toBeVisible();await expect(listening).toBeFocused();
  assert.equal(await application.evaluate(()=>global.generalRefusals),2,'Escape dismisses the modal without submitting a shortcut');
  await application.evaluate(({ipcMain})=>{ipcMain.removeHandler('apparent:general-action');ipcMain.handle('apparent:general-action',global.generalActionHandler);delete global.generalActionHandler});
  await listening.focus();await page.keyboard.press('F9');await expect(shortcutFailure).toBeVisible({timeout:15000});
  await expect(shortcutFailure).toHaveAccessibleName('Record shortcut not confirmed');
  const retryStart=recoveryOutput.length;
  await shortcutFailure.getByRole('button',{name:'Try again',exact:true}).press('Enter');
  await expect.poll(()=>recoveryOutput.slice(retryStart).includes('"key":"F9"')).toBe(true);
  assert.equal(recoveryOutput.slice(retryStart).includes('"key":"Enter"'),false,'Enter retries the selected shortcut instead of binding Enter');
  const recordShortcut=page.getByRole('button',{name:'Change Record shortcut, currently F9',exact:true});
  await projectGeneral(false,false,'F9');await expect(shortcutFailure).not.toBeVisible();
  await expect(recordShortcut).toBeFocused();
  await projectGeneral(false,true,'F9');await listening.focus();await page.keyboard.press('F9');
  await expect(listening).toHaveAttribute('aria-busy','true');
  await projectGeneral(false,false,'F9');
  await expect(recordShortcut).not.toHaveAttribute('aria-busy','true');
  for(const zoom of [1,2]){
    await application.evaluate(({BrowserWindow},zoom)=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(640,530);w.webContents.setZoomFactor(zoom)},zoom);
    await projectGeneral(false,false,'F9');
    await recordShortcut.focus();await page.keyboard.press('Enter');await expect(recordShortcut).toHaveAttribute('aria-busy','true');
    await projectGeneral(false,false,'F9','Shortcut unavailable. Choose another shortcut.');
    await expect(recordShortcut).toBeFocused();
    assert.equal(await page.locator('.general-validation').evaluate(el=>{const r=el.closest('.general-shortcut').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),true,'focused shortcut and new validation are visible together');
  }
  await projectGeneral();
  await page.getByRole('switch',{name:'Launch at login',exact:true}).click();
  await expect.poll(()=>recoveryOutput.includes('"key":"launchAtLogin","value":true')).toBe(true);
  const startup=page.getByRole('switch',{name:'Launch at login',exact:true});
  await expect(startup).toBeDisabled();await expect(startup).toHaveAttribute('aria-busy','true');
  const sent=recoveryOutput.split('"key":"launchAtLogin"').length;
  await startup.evaluate(element=>element.click());
  assert.equal(recoveryOutput.split('"key":"launchAtLogin"').length,sent,'repeat activation waits for the parent state');
  await projectGeneral(true);await expect(startup).toBeEnabled();await expect(startup).toBeChecked();await expect(startup).not.toHaveAttribute('aria-busy','true');
  assert.equal(await page.evaluate(async()=>{try{await window.apparentGeneral.act({action:'set',key:'cloud',value:true});return false}catch{return true}}),true);
  }finally{await application.close();await fs.rm(home,{recursive:true,force:true})}
});
