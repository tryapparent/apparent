import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hasCompletedBoardStroke} from '../../src/onboarding/state.ts';

test('a completed board stroke can be a dot',()=>{
  assert.equal(hasCompletedBoardStroke([]),false);
  assert.equal(hasCompletedBoardStroke([[[10,20]]]),true);
  assert.equal(hasCompletedBoardStroke([[],[[10,20]]]),true);
  assert.equal(hasCompletedBoardStroke([[[10,20]],[[30,40]]]),true);
});
