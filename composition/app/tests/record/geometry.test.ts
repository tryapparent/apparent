import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clamp, contains, layout, shape } from '../../src/record/geometry.ts';

test('transparent count reserve stays click-through until its row width grows', () => {
  const area = { x: 0, y: 0, width: 1000, height: 700 };
  const before = { x: 300, y: 30, width: 480, height: 58 };
  const next = layout(before, area, 480, 58, 58, 0, 408, 408);
  assert.deepEqual(next.bounds, before);
  assert.equal(contains({ x: 750, y: 59 }, before, 0, 58, 408, 408), false);
  assert.equal(contains({ x: 750, y: 59 }, before, 0, 58, 480, 408), true);
  assert.ok(shape(480, 58, 0, 58, 408, 408).every(rect => rect.x + rect.width <= 408));
});

test('native hit rows track the zero/nonzero notes width and an opened pocket', () => {
  const closed = shape(512, 58, 0, 56, 440, 440);
  const withNotes = shape(512, 58, 0, 56, 512, 440);
  const openPocket = shape(512, 180, 0, 56, 512, 440);
  assert.equal(closed.length, 56);
  assert.equal(withNotes.length, 56);
  assert.equal(Math.max(...closed.map(rect => rect.width)), 438);
  assert.equal(Math.max(...withNotes.map(rect => rect.width)), 510);
  assert.equal(openPocket.length, 176);
  assert(openPocket.slice(56).every(rect => rect.x + rect.width <= 440));
  assert.equal(shape(512, 58, 0, 56, 440, 440).length, closed.length, 'closing restores the compact native hit region');
});

test('rounded corners remain transparent and negative-origin displays clamp correctly', () => {
  const bounds = { x: -100, y: 30, width: 600, height: 58 };
  assert.equal(contains({ x: -100, y: 30 }, bounds), false);
  assert.equal(contains({ x: 200, y: 30 }, bounds), true);
  assert.equal(contains({ x: 200, y: 90 }, bounds), false);
  const hitRows = shape(600, 58);
  assert.equal(hitRows.length, 58);
  assert(hitRows[0].x > 0);
  assert.equal(hitRows[28].x, 0);
  assert.deepEqual(clamp({ ...bounds, x: -2000, y: 2000 }, { x: -1920, y: 0, width: 1920, height: 1080 }), { x: -1920, y: 1022 });
});

test('opening and closing an upward pocket preserves the row anchor and hit-region shape', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1080 };
  const before = { x: -1200, y: 950, width: 500, height: 58 };
  const open = layout(before, area, 500, 220, 58);
  assert.equal(open.side, 'up');
  assert.equal(open.bounds.y + open.rowY, before.y);
  assert.equal(open.bounds.x, before.x);
  const closed = layout(open.bounds, area, 500, 58, 58, open.rowY);
  assert.deepEqual(closed.bounds, before);

  for (const rowY of [0, 162]) {
    const bounds = { x: 0, y: 0, width: 500, height: 220 };
    const hitRows = shape(500, 220, rowY, 58);
    for (let y = 0; y < 220; y++) {
      for (const x of [0, 10, 250, 489, 499]) {
        const represented = hitRows.some(rect => rect.y === y && x >= rect.x && x < rect.x + rect.width);
        assert.equal(contains({ x: x + 0.5, y: y + 0.5 }, bounds, rowY, 58), represented);
      }
    }
  }

  const down = layout({ ...before, y: 34 }, area, 500, 220, 58);
  assert.equal(down.side, 'down');
  assert.equal(down.bounds.y, 34);
});

test('layout recenters width changes and clamps oversized windows without changing the donor math', () => {
  const area = { x: 20, y: 40, width: 300, height: 160 };
  const before = { x: 100, y: 60, width: 200, height: 58 };
  const wider = layout(before, area, 240, 58, 58, 0, 240, 200);
  assert.deepEqual(wider.bounds, { x: 80, y: 60, width: 240, height: 58 });
  const oversized = layout(before, area, 400, 240, 58);
  assert.deepEqual(oversized.bounds, { x: 20, y: 40, width: 400, height: 240 });
});
