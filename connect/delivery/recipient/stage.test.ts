import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stage } from './stage.ts';
test('authenticated staging publishes only after both attestations and validation', () => {
 const root=mkdtempSync(join(tmpdir(),'stage-test-'));
 try {
 const bytes=Buffer.alloc(64); bytes.write('7f454c46',0,'hex'); bytes[4]=2; bytes[5]=1; bytes.writeUInt16LE(3,16); bytes.writeUInt16LE(62,18);
 const identity={schema:1,protocol:1,repository:'tryapparent/apparent',workflow:'.github/workflows/connect-delivery.yml',executable:'apparent-connect-recipient'};
 const pin={target:'x86_64-unknown-linux-gnu',sourceSha:'a'.repeat(40),run:'123',attempt:'1',sha256:createHash('sha256').update(bytes).digest('hex'),version:`recipient-${'a'.repeat(40)}-123-1`,manifest:identity};
 const file=join(root,'pin.json'); writeFileSync(file,JSON.stringify(pin));
 for (const failure of ['producer-failed','producer-pending','producer-foreign','producer-attempt','download','manifest.json','apparent-connect-recipient','digest','protocol','archive','none','retry']) {
 const releaseVersion=failure==='retry'?`recipient-${pin.sourceSha}-${pin.run}-2`:pin.version;
 writeFileSync(file,JSON.stringify({...pin,releaseVersion}));
 let verified=0, downloaded=0; const out=join(root,failure);
 const runner=(command:string,args:string[]) => {
 if(command==='gh' && args[0]==='api') {
 assert.equal(args[1],`repos/tryapparent/apparent/actions/runs/123/attempts/${failure==='retry'?'2':'1'}`);
 return Buffer.from(JSON.stringify({id:123,run_attempt:failure==='producer-attempt'?2:failure==='retry'?2:1,
 repository:{full_name:failure==='producer-foreign'?'foreign/repo':'tryapparent/apparent'},head_repository:{full_name:'tryapparent/apparent'},
 head_branch:'main',head_sha:pin.sourceSha,path:'.github/workflows/connect-delivery.yml',event:'push',
 status:failure==='producer-pending'?'in_progress':'completed',conclusion:failure==='producer-failed'?'failure':'success'}));
 }
 if(command==='gh' && args[0]==='release') { downloaded++; if(failure==='download') throw Error('transport'); assert.equal(args[2],releaseVersion); assert.equal(args[6],`${releaseVersion}-${pin.target}.tar.gz`); writeFileSync(join(args.at(-1)!,`${releaseVersion}-${pin.target}.tar.gz`),'mock'); }
 if(command==='tar' && args[0]==='-tzf') return Buffer.from(failure==='archive'?'../escape\nmanifest.json':'manifest.json\napparent-connect-recipient');
 if(command==='tar' && args[0]==='-xOzf') return args.at(-1)==='manifest.json'?Buffer.from(JSON.stringify({...identity,...pin,protocol:failure==='protocol'?2:1})):failure==='digest'?Buffer.alloc(64):bytes;
 if(command==='gh' && args[0]==='attestation') { assert.ok(args.includes(pin.sourceSha)); assert.ok(args.includes('refs/heads/main')); assert.ok(args.includes('tryapparent/apparent/.github/workflows/connect-delivery.yml')); assert.equal(existsSync(out),false); verified++; if(args[2].endsWith('/'+failure)) throw Error('untrusted'); }
 return Buffer.alloc(0);
 };
 if((failure==='none'||failure==='retry')) { stage(file,pin.target,out,runner); assert.equal(verified,2); assert.deepEqual(readFileSync(join(out,'apparent-connect-recipient')),bytes); assert.equal(statSync(join(out,'apparent-connect-recipient')).mode & 0o777,0o755); assert.throws(()=>stage(file,pin.target,out,runner)); }
 else { assert.throws(()=>stage(file,pin.target,out,runner)); assert.equal(existsSync(out),false); if(failure.startsWith('producer-')) { assert.equal(downloaded,0); assert.equal(verified,0); } }
 }
 for (const releaseVersion of [`recipient-${pin.sourceSha}-${pin.run}-0`,`recipient-${pin.sourceSha}-124-2`,`recipient-${'b'.repeat(40)}-${pin.run}-2`]) {
 writeFileSync(file,JSON.stringify({...pin,releaseVersion}));
 assert.throws(()=>stage(file,pin.target,join(root,'invalid'),()=>{throw Error('must not download');}),/Invalid release version/);
 }
 } finally { rmSync(root,{recursive:true,force:true}); }
});
