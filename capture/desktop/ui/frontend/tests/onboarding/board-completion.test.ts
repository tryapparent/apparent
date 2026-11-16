import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shouldClosePracticeBoard} from '../../src/onboarding/state.ts';

test('practice keeps the first acknowledged mark and closes after two, including dots',()=>{
  assert.equal(shouldClosePracticeBoard([]),false);
  assert.equal(shouldClosePracticeBoard([[[10,20]]]),false);
  assert.equal(shouldClosePracticeBoard([[],[[10,20]]]),false);
  assert.equal(shouldClosePracticeBoard([[[10,20]],[[30,40]]]),true);
});
