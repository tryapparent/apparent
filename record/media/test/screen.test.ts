import assert from 'node:assert/strict';
import {test} from 'node:test';
import {screenCandidatePage,screenBundleTime} from '../src/screen-policy.ts';
test('screen pages preserve every 220ms request without allocating a full long-recording plan',()=>{
  const first=screenCandidatePage(105601,500,'recovery','null');
  assert.equal(first.maxEdge,640);assert.equal(first.times.length,480);assert.equal(first.times.at(-1),105380);
  assert.equal(first.nextStart,480);
  const last=screenCandidatePage(105601,500,'recovery',JSON.stringify({start:480,previous:105000}));
  assert.deepEqual(last.times,[105600]);assert.equal(last.previous,105000);assert.equal(last.nextStart,null);
  assert.equal(screenCandidatePage(Number.MAX_SAFE_INTEGER,0,'recovery','null').times.length,480);
  assert.equal(screenCandidatePage(220,0,'benchmark','null').maxEdge,480);
  assert.equal(screenBundleTime(350,500),850);
  assert.throws(()=>screenBundleTime(Number.MAX_SAFE_INTEGER,1));
});
test('invalid durations, offsets, purposes and continuation state fail before native execution',()=>{
  for(const cursor of ['{}','[]','"bad"',JSON.stringify({start:1,previous:0}),JSON.stringify({start:480,previous:-1}),
    JSON.stringify({start:480,previous:0,extra:true}),JSON.stringify({start:960,previous:0})])
    assert.throws(()=>screenCandidatePage(105601,0,'recovery',cursor));
  for(const duration of [0,-1,1.5,NaN])assert.throws(()=>screenCandidatePage(duration,0,'recovery','null'));
  assert.throws(()=>screenCandidatePage(1000,-1,'recovery','null'));
  assert.throws(()=>screenCandidatePage(Number.MAX_SAFE_INTEGER,1,'recovery','null'));
  assert.throws(()=>screenCandidatePage(1000,0,'other','null'));
});
