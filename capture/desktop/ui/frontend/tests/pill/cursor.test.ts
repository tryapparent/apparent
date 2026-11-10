import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CompositorCursor} from '../../electron/pill/cursor.ts';

test('compositor observations follow the pointer off the XWayland window', () => {
  const cursor = new CompositorCursor();
  assert.equal(cursor.current(0), null);
  cursor.observe([600, 200], 10);
  assert.deepEqual(cursor.current(20), {x: 600, y: 200});
  cursor.observe([100, 700], 30);
  assert.deepEqual(cursor.current(40), {x: 100, y: 700});
  cursor.observe([-800, -20], 50);
  assert.deepEqual(cursor.current(60), {x: -800, y: -20});
});

test('unavailable and expired native facts release hover without a stale fallback', () => {
  const cursor = new CompositorCursor();
  const point = [600, 200];
  cursor.observe(point, 100);
  point[0] = 0;
  const readback = cursor.current(101)!;
  readback.x = 0;
  assert.deepEqual(cursor.current(499), {x: 600, y: 200});
  assert.equal(cursor.current(500), null);
  assert.equal(cursor.current(99), null);
  cursor.observe([600, 200], 600);
  cursor.observe(null, 601);
  assert.equal(cursor.current(602), null);
  cursor.observe([100, 700], 700);
  assert.deepEqual(cursor.current(701), {x: 100, y: 700});
});

test('malformed parent cursor facts are rejected', () => {
  for (const value of [undefined, {}, [0], [0, 0, 0], ['0', 0], [NaN, 0], [0, Infinity]]) {
    assert.throws(() => new CompositorCursor().observe(value, 0));
  }
});
