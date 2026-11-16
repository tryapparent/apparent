import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Run the shipped isolated preload with the pane arguments supplied by main.
// Capability presence matters even when the host also rejects the wrong page.
for (const pane of ['general','labs','agents','about','storage']) {
  test(`${pane} preload does not acquire another pane's General or Labs API`,()=>{
    const exposed:Record<string,unknown>={};
    const calls:unknown[][]=[];
    vm.runInNewContext(readFileSync(new URL('../../../electron/storage-preload.cjs',import.meta.url),'utf8'),{
      process:{argv: pane==='storage'?[]:[`--settings-${pane}`]},
      require:(name:string)=>{
        assert.equal(name,'electron');
        return {contextBridge:{exposeInMainWorld:(name:string,value:unknown)=>{exposed[name]=value;}},
          ipcRenderer:{invoke:(...args:unknown[])=>{calls.push(args);return Promise.resolve();}}};
      },
    });
    assert.equal('apparentGeneral' in exposed,pane==='general');
    assert.equal('apparentLabs' in exposed,pane==='labs');
    const apparent=exposed.apparent as Record<string,()=>unknown>;
    assert.equal('readConnectSettings' in apparent,pane==='general');
    if(pane==='general')apparent.readConnectSettings();
    if(pane==='labs')(exposed.apparentLabs as {save:(value:boolean,setting:string)=>void}).save(true,'sharing');
    assert.equal(calls.length,pane==='general'||pane==='labs'?1:0);
    if(pane==='labs')assert.equal(calls[0][0],'apparent:labs-preference');
  });
}
