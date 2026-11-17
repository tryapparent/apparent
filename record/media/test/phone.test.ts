import assert from 'node:assert/strict';
import {test} from 'node:test';
import {phoneCandidatePlan,uniqueCandidates} from '../src/phone-policy.ts';
test('phone cadence preserves legacy thresholds and overflow rather than truncating timestamps',()=>{
  for(const [duration,count,last] of [[1,1,0],[250,1,0],[251,2,250],[120000,480,119750],
    [120001,481,120000],[120479,482,120250],[239999,481,239520]]) {
    const plan=phoneCandidatePlan(duration); assert.equal(plan.maxEdge,320);
    assert.deepEqual(plan.times,Array.from({length:count},(_,index)=>count===1?0:index*last/(count-1)));
  }
  for(const duration of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>phoneCandidatePlan(duration));
  assert(phoneCandidatePlan(Number.MAX_SAFE_INTEGER).times.every(Number.isSafeInteger));
});
test('actual movie times deduplicate within and across native batches without changing source identity',()=>{
  const frames=[0,0,100,200,200].map((actualMs,requestIndex)=>({actualMs,requestIndex,requestedMs:requestIndex*50,
    width:1,height:1,file:`frame-${requestIndex}`}));
  assert.deepEqual(uniqueCandidates(frames).map(f=>[f.requestIndex,f.actualMs]),[[0,0],[2,100],[3,200]]);
  assert.deepEqual(uniqueCandidates(frames.slice(0,2),0),[]);
  assert.throws(()=>uniqueCandidates(frames,100));
  assert.throws(()=>uniqueCandidates([{...frames[0],actualMs:-1}]));
  assert.throws(()=>uniqueCandidates([{...frames[0],actualMs:0.5}]));
  assert.throws(()=>uniqueCandidates([{...frames[0],requestIndex:1}]));
});
