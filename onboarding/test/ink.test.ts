import test from 'node:test';
import assert from 'node:assert/strict';
import {boardPracticed, screenPracticed, validScreenInk} from '../src/ink.ts';
import {ink} from './facts.ts';

test('TS preserves the existing board and screen stroke qualification rules', () => {
  for (let points = 0; points <= 20; points++) {
    assert.equal(boardPracticed(points), points > 3);
    assert.equal(screenPracticed(ink(1, points), 0), points > 9);
    assert.equal(screenPracticed(ink(1, points, true), 0), false);
  }
});

test('only a qualifying durable stroke after the note baseline counts', () => {
  assert.equal(screenPracticed(ink(1, 6), 0), false, 'The retained Linux driver stroke had six points');
  assert.equal(screenPracticed(ink(1, 10), 1), false, 'Earlier drawing cannot satisfy a later lesson');
  assert.equal(screenPracticed(ink(100), 99), true);
  assert.equal(screenPracticed(ink(100), 100), false);
});

test('bounded native stroke windows reject malformed and duplicate observations', () => {
  assert.equal(validScreenInk(ink(0)), true);
  assert.equal(validScreenInk(ink(100)), true);
  for (const value of [null, 1, {}, ink(-1), ink(NaN), {...ink(1), recent:[{index:0,points:10,laser:false}]},
    {...ink(1), recent:[{index:2,points:10,laser:false}]}, {...ink(1),recent:[{index:1,points:NaN,laser:false}]},
    {...ink(1),recent:[{index:1,points:10,laser:1}]}, {...ink(1), recent:[...ink(1).recent,...ink(1).recent]},
    {total:65,recent:Array.from({length:65},(_,i)=>({index:i+1,points:10,laser:false}))}]) {
    assert.equal(validScreenInk(value), false);
  }
});
