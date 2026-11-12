import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MONKEY_PHASES,
  MONKEY_SLIP_DISTANCE,
  measureMonkeyGutters,
  nextMonkeyPhase,
  resistedMonkeyPull,
} from '../src/sampark/mascot/mascotModel.js';

test('the mascot requires both the large-display regime and room in each real gutter', () => {
  assert.equal(measureMonkeyGutters(1999, { left: 250, right: 1749 }).enabled, false);
  assert.equal(measureMonkeyGutters(2000, { left: 179, right: 1819 }).enabled, false);
  assert.equal(measureMonkeyGutters(2000, { left: 220, right: 1821 }).enabled, false);
  assert.equal(measureMonkeyGutters(2000, { left: 180, right: 1820 }).enabled, true);
  assert.equal(measureMonkeyGutters(2560, { left: 384, right: 2176 }).enabled, true);
});

test('pull movement resists the pointer and saturates without reversing', () => {
  const first = resistedMonkeyPull(100);
  const second = resistedMonkeyPull(200);
  assert.ok(first > 0 && first < 75);
  assert.ok(second > first && second < 132);
  assert.ok(second - first < first);
  assert.equal(resistedMonkeyPull(-40), 0);
});

test('an early release recoils, while a slip completes the one-time scene', () => {
  let phase = nextMonkeyPhase(MONKEY_PHASES.HIDDEN_TEASE, { type: 'ENTER' });
  phase = nextMonkeyPhase(phase, { type: 'GRAB' });
  phase = nextMonkeyPhase(phase, { type: 'PULL', distance: 140 });
  assert.equal(phase, MONKEY_PHASES.STRAINING);
  assert.equal(nextMonkeyPhase(phase, { type: 'RELEASE', distance: MONKEY_SLIP_DISTANCE - 1 }), MONKEY_PHASES.RESETTING);
  assert.equal(nextMonkeyPhase(MONKEY_PHASES.RESETTING, { type: 'ANIMATION_END' }), MONKEY_PHASES.HIDDEN_TEASE);

  phase = nextMonkeyPhase(phase, { type: 'RELEASE', distance: MONKEY_SLIP_DISTANCE });
  const expected = [
    MONKEY_PHASES.SLIPPING, MONKEY_PHASES.FALLING, MONKEY_PHASES.LANDED,
    MONKEY_PHASES.DUSTING_OFF, MONKEY_PHASES.WALKING,
    MONKEY_PHASES.DRAGGING_NEWSPAPER, MONKEY_PHASES.PULLING_CHAIR,
    MONKEY_PHASES.SITTING, MONKEY_PHASES.READING,
  ];
  for (const state of expected) {
    assert.equal(phase, state);
    phase = nextMonkeyPhase(phase, { type: 'ANIMATION_END' });
  }
  assert.equal(phase, MONKEY_PHASES.READING);
  assert.equal(nextMonkeyPhase(phase, { type: 'GRAB' }), MONKEY_PHASES.READING);
});
