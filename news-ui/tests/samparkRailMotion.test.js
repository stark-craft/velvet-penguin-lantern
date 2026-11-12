import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceRailOffset, normalizeRailOffset, railCopyCount, railLoopDistance } from '../src/sampark/all-news/railMotion.js';

test('rail measures the next copy start including its gap, independent of current transform', ()=> {
  const track = { children: [
    { getBoundingClientRect: ()=> ({ top: -83.5 }) },
    { getBoundingClientRect: ()=> ({ top: 26.5 }) },
    { getBoundingClientRect: ()=> ({ top: 156.5 }) },
  ] };
  assert.equal(railLoopDistance(track, 2), 240);
  assert.equal(railLoopDistance(track, 3), 0);
  assert.equal(railLoopDistance(null, 2), 0);
});

test('rail speed stays 18px per second on 60Hz and 144Hz monitors', ()=> {
  const simulate = (refreshRate, reduced = false)=> {
    let offset = 0;
    for (let frame = 0; frame < refreshRate; frame++) {
      offset = advanceRailOffset(offset, 1000 / refreshRate, 800, reduced);
    }
    return offset;
  };
  assert.ok(Math.abs(simulate(60) - 18) < 1e-9);
  assert.ok(Math.abs(simulate(144) - 18) < 1e-9);
  assert.ok(Math.abs(simulate(144, true) - 18 / 1.75) < 1e-9);
});

test('pause/resume preserves position and delayed frames do not jump after monitor moves', ()=> {
  assert.equal(advanceRailOffset(200, 0, 800), 200);
  assert.equal(advanceRailOffset(200, 20000, 800), 201.8);
  assert.equal(advanceRailOffset(200, -100, 800), 200);
  assert.ok(Math.abs(advanceRailOffset(799, 100, 800) - 0.8) < 1e-9);
});

test('a resized rail wraps its existing position into the new measured cycle', ()=> {
  assert.equal(normalizeRailOffset(420, 300), 120);
  assert.equal(normalizeRailOffset(420, 0), 0);
  assert.equal(normalizeRailOffset(-10, 300), 0);
  assert.equal(normalizeRailOffset(300, 300), 0);
});

test('short feeds have enough copies to cover tall windows at every loop position', ()=> {
  assert.equal(railCopyCount(327, 1030), 2);
  assert.equal(railCopyCount(327, 100), 5);
  assert.equal(railCopyCount(1440, 100), 16);
  assert.equal(railCopyCount(327, 0), 2);
});
