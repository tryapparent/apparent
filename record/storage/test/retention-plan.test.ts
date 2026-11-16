import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {closeSync,mkdtempSync,openSync,rmSync,truncateSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {planRetention,retentionForPreset,type RetentionFacts} from '../dist/index.js';
const day=86_400_000n;
const facts=(age:bigint,extra:Partial<RetentionFacts>={}):RetentionFacts=>({ageMs:age,unchangedMs:age,
  source:null,capture:null,durationMs:0n,videoBytes:null,heavyMedia:true,...extra});
test('settling, zero-day minimum, media/bundle precedence and forever preserve cleanup decisions',()=>{
  const week=retentionForPreset('week');
  assert.deepEqual(planRetention(week,[facts(day),facts(day*7n),facts(day*30n)]),[
    {index:1,kind:'trashMedia'},{index:2,kind:'trashBundle'}]);
  assert.deepEqual(planRetention({mediaDays:0,bundleDays:0},[facts(day-1n),facts(day)]),[{index:1,kind:'trashBundle'}]);
  assert.deepEqual(planRetention(week,[facts(day*50n,{unchangedMs:day-1n})]),[]);
  assert.deepEqual(planRetention(retentionForPreset('forever'),[facts(day*100n)]),[]);
  assert.deepEqual(planRetention({mediaDays:0xffff_ffff,bundleDays:0xffff_ffff},[facts(day*100n)]),[]);
});
test('both periodic and after-capture callers use exact native bitrate eligibility',()=>{
  const phone={source:'iphone',capture:'mirror',durationMs:1000n,videoBytes:1_000_000n};
  assert.deepEqual(planRetention(retentionForPreset('week'),[facts(599_999n,phone)]),[]);
  assert.deepEqual(planRetention(retentionForPreset('week'),[facts(600_000n,phone)]),[{index:0,kind:'shrink'}]);
  assert.deepEqual(planRetention(retentionForPreset('forever'),[facts(0n,phone)],'shrinkOnly'),[{index:0,kind:'shrink'}]);
  assert.deepEqual(planRetention(retentionForPreset('week'),[facts(day*8n,{...phone,heavyMedia:false})]),[]);
  assert.deepEqual(planRetention(retentionForPreset('forever'),[facts(day,{...phone,videoBytes:750_000n})]),[]);
  assert.deepEqual(planRetention(retentionForPreset('forever'),[facts(day,{...phone,source:null})]),[]);
  assert.deepEqual(planRetention(retentionForPreset('forever'),[facts(day,{...phone,durationMs:0n})]),[]);
});
test('u64 observations retain native saturating multiplication without Number rounding',()=>{
  const max=0xffff_ffff_ffff_ffffn;
  assert.deepEqual(planRetention(retentionForPreset('forever'),[facts(day,{source:'iphone',capture:'mirror',durationMs:max,videoBytes:max})]),[]);
  assert.throws(()=>planRetention(retentionForPreset('week'),[facts(-1n)]));
  assert.throws(()=>planRetention(retentionForPreset('week'),[facts(max+1n)]));
});
test('compiled worker consumes finite private stdin and rejects invalid fields without disclosure',()=>{
  const root=mkdtempSync(join(tmpdir(),'apparent-dev-retention-wire-')),path=join(root,'request.json');
  const worker=fileURLToPath(new URL('../dist/retention/worker.js',import.meta.url));
  const request={version:1,mode:'pass',policy:retentionForPreset('week'),observations:[{
    ageMs:String(day*8n),unchangedMs:String(day*8n),source:null,capture:null,durationMs:'0',videoBytes:null,heavyMedia:true}]};
  const run=(value:unknown,oversize=false)=>{
    writeFileSync(path,JSON.stringify(value),{mode:0o600});if(oversize)truncateSync(path,16*1024*1024+1);
    const fd=openSync(path,'r');
    try{return spawnSync(process.execPath,[worker],{stdio:[fd,'pipe','pipe'],encoding:'utf8',timeout:5000});}
    finally{closeSync(fd);}
  };
  try {
    const result=run(request);assert.equal(result.status,0);assert.equal(result.stderr,'');
    assert.deepEqual(JSON.parse(result.stdout),{version:1,actions:[{index:0,kind:'trashMedia'}]});
    for(const value of [{...request,mode:'unknown'},{...request,extra:'PRIVATE SENTINEL'},
      {...request,observations:[{...request.observations[0],ageMs:'18446744073709551616'}]},
      {...request,observations:[{...request.observations[0],ageMs:8}]},'PRIVATE SENTINEL']) {
      const bad=run(value);assert.equal(bad.status,1);assert.equal(bad.stdout,'');
      assert.equal(bad.stderr,'Record could not plan retention\n');
    }
    assert.equal(run(request,true).status,1);
  } finally{rmSync(root,{recursive:true,force:true});}
});
