import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waveformLevels,waveformHeight,WAVEFORM_BINS} from '../../src/pill/meter-policy.ts';
test('captured history preserves time order and curved gain makes quiet speech visible',()=>{
 const pcm=Array(WAVEFORM_BINS).fill(0);pcm[23]=.02;
 const levels=waveformLevels(pcm,40,40);
 assert.ok(levels.slice(0,23).every(value=>value===0));
 assert.ok(waveformHeight(levels[23],false)>5);
 assert.equal(waveformHeight(0,false),2);
 assert.equal(waveformHeight(1,false),28);
 assert.ok(waveformLevels(Array(24).fill(.8),40,40)[23]>levels[23]);
});
test('silence and stalled delivery rest; invalid values cannot create movement',()=>{
 assert.deepEqual(waveformLevels(Array(24).fill(.8),40,340),Array(24).fill(0));
 for(const input of [null,[],[.8]])assert.deepEqual(waveformLevels(input,40,40),Array(24).fill(0));
 assert.deepEqual(waveformLevels(Array(24).fill(NaN),40,40),Array(24).fill(0));
 assert.deepEqual(waveformLevels(Array(24).fill(0),40,40),Array(24).fill(0));
 for(const level of [0,.2,1])assert.equal(waveformHeight(level,true),2);
});
