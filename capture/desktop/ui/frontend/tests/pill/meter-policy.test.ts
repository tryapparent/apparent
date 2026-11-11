import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepMeter} from '../../src/pill/meter-policy.ts';
test('captured amplitude attacks, silence releases, stalled transport reaches rest',()=>{
 const first=stepMeter({level:0,at:0},.8,40,40,false);
 assert.ok(first.level>0 && first.level<.8);
 const quiet=stepMeter(first,0,80,80,false);
 assert.ok(quiet.level<first.level);
 const stalled=stepMeter(first,.8,40,1040,false);
 assert.equal(stalled.level,0);
 assert.equal(stepMeter(first,null,80,80,true).level,0);
});
test('reduced motion reads amplitude directly and invalid input never animates',()=>{
 assert.equal(stepMeter({level:0,at:0},.8,40,40,true).level,.8);
 for(const input of [NaN,Infinity,-1,0])assert.equal(stepMeter({level:0,at:0},input,40,40,false).level,0);
 assert.equal(stepMeter({level:0,at:0},2,40,40,true).level,1);
});
