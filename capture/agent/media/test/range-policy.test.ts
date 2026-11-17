import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {frameRangePlan} from '../src/range-policy.ts';

test('omission and explicit rates preserve Agent cadence and the saved-frame window',()=>{
  assert.deepEqual(frameRangePlan(1000n,2000n),{fromMs:1000n,toMs:2000n,fps:4,
    stepMs:250n,lowerMs:875n,upperMs:2125n});
  for(const [fps,step,margin] of [[1,1000n,500n],[7,142n,71n],[240,4n,2n]] as const) {
    const plan=frameRangePlan(1000n,2000n,fps);
    assert.equal(plan.stepMs,step);assert.equal(plan.lowerMs,1000n-margin);assert.equal(plan.upperMs,2000n+margin);
  }
});

test('zero-width ranges and full u64 clocks preserve saturating boundaries',()=>{
  assert.equal(frameRangePlan(0n,0n).lowerMs,0n);
  const maximum=0xffff_ffff_ffff_ffffn,plan=frameRangePlan(maximum,maximum,7);
  assert.equal(plan.fromMs,maximum);assert.equal(plan.lowerMs,maximum-71n);assert.equal(plan.upperMs,maximum);
});

test('invalid ranges and rates fail before any execution plan exists',()=>{
  assert.throws(()=>frameRangePlan(2n,1n),/Frame range ends before it starts/);
  for(const value of [-1n,0x1_0000_0000_0000_0000n,1 as unknown as bigint])
    assert.throws(()=>frameRangePlan(value,10n),/Invalid Agent frame time/);
  for(const fps of [0,241,-1,NaN,Infinity,1.5,null as unknown as number])
    assert.throws(()=>frameRangePlan(0n,10n,fps),/FPS must be between 1 and 240/);
});

test('the real worker emits exact clocks, bounded policy errors and redacted refusals',()=>{
  const worker=fileURLToPath(new URL('../src/range-worker.ts',import.meta.url));
  const run=(args:string[])=>spawnSync(process.execPath,['--experimental-strip-types',worker,...args],{
    encoding:'utf8',timeout:5000,maxBuffer:2048});
  const maximum='18446744073709551615';
  const good=run([maximum,maximum,'7']);assert.equal(good.status,0);assert.equal(good.stderr,'');
  assert.deepEqual(JSON.parse(good.stdout),{version:1,status:'plan',fromMs:maximum,toMs:maximum,
    fps:7,stepMs:'142',lowerMs:'18446744073709551544',upperMs:maximum});
  const omitted=run(['0','1','-']);assert.equal(JSON.parse(omitted.stdout).fps,4);
  const invalid=run(['0','1','0']);assert.equal(invalid.status,0);
  assert.deepEqual(JSON.parse(invalid.stdout),{version:1,status:'error',message:'FPS must be between 1 and 240'});
  const malformed=run(['PRIVATE SENTINEL','1','4']);assert.equal(malformed.status,1);assert.equal(malformed.stdout,'');
  assert.equal(malformed.stderr,'Agent could not plan the requested frame range\n');
});
