import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assemble } from './package.ts';
import { targets } from './seal.ts';
test('assembly publishes signed bytes atomically and preserves raw provenance', () => {
 const root=mkdtempSync(join(tmpdir(),'package-test-'));
 try {
 const map=join(root,'pins.json'); const target='aarch64-apple-darwin';
 writeFileSync(map,JSON.stringify({schema:1,adopted:true,pins:Object.fromEntries(targets.map(target=>[target,{target}]))}));
 for(const failure of ['sign','verify','none']) {
 const out=join(root,failure); mkdirSync(out);
 const stage=(_pin:string,_target:string,path:string) => { mkdirSync(path); writeFileSync(join(path,'apparent-connect-recipient'),'raw'); writeFileSync(join(path,'manifest.json'),JSON.stringify({sha256:'raw-digest'})); return {} as ReturnType<typeof import('./stage.ts').stage>; };
 const run=((_command:string,args:string[]) => { assert.deepEqual(readdirSync(out).filter(x=>!x.startsWith('.')),[]); if(args[0]==='--verify') { if(failure==='verify') throw Error('verify'); } else { if(failure==='sign') throw Error('sign'); writeFileSync(args.at(-1)!,'signed'); } return Buffer.alloc(0); }) as typeof import('node:child_process').execFileSync;
 if(failure!=='none') { assert.throws(()=>assemble(map,target,out,['codesign','--sign','test'],{stage,run})); assert.deepEqual(readdirSync(out),[]); }
 else { assemble(map,target,out,['codesign','--sign','test'],{stage,run}); assert.deepEqual(readdirSync(out),['recipient']); const receipt=JSON.parse(readFileSync(join(out,'recipient/manifest.json'),'utf8')); assert.equal(receipt.sha256,createHash('sha256').update('signed').digest('hex')); assert.equal(JSON.parse(readFileSync(join(out,'recipient/recipient-provenance.json'),'utf8')).sha256,'raw-digest'); assert.throws(()=>assemble(map,target,out,['codesign'],{stage,run})); }
 }
 writeFileSync(map,JSON.stringify({schema:1,adopted:false,pins:{}}));
 assemble(map,target,root,[],{stage:()=>{throw Error('download');},run:()=>{throw Error('run');}});
 } finally { rmSync(root,{recursive:true,force:true}); }
});
