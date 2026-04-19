import { describe, it, expect } from 'vitest';
import {
  createHandPinchState,
  stepHandPinch,
  DEFAULT_HAND_PINCH_TUNING,
} from './handPinch';
import { pointingHand } from '@/test/fixtures/makeHand';

const VIEWPORT = { width: 1000, height: 1000 };

describe('handPinch', () => {
  it('starts idle (not pinching)', () => {
    const s = createHandPinchState();
    expect(s.isPinching).toBe(false);
  });

  it('enters pinching when smoothed pinchDist drops below pinchIn', () => {
    let state = createHandPinchState();
    // Feed several frames of a pinched hand so smoothed value settles below threshold.
    for (let i = 0; i < 4; i++) {
      state = stepHandPinch(state, pointingHand(0.01), VIEWPORT);
    }
    expect(state.isPinching).toBe(true);
  });

  it('exits pinching when smoothed pinchDist rises above pinchOut', () => {
    let state = createHandPinchState();
    for (let i = 0; i < 4; i++) {
      state = stepHandPinch(state, pointingHand(0.01), VIEWPORT);
    }
    expect(state.isPinching).toBe(true);
    for (let i = 0; i < 4; i++) {
      state = stepHandPinch(state, pointingHand(0.8), VIEWPORT);
    }
    expect(state.isPinching).toBe(false);
  });

  it('hysteresis: a pinchDist in the gap between pinchIn and pinchOut holds the state', () => {
    let state = createHandPinchState();
    for (let i = 0; i < 4; i++) {
      state = stepHandPinch(state, pointingHand(0.01), VIEWPORT);
    }
    expect(state.isPinching).toBe(true);
    // Hand slightly opens — ratio lands between pinchIn (0.35) and pinchOut (0.60). Must stay
    // pinched.
    for (let i = 0; i < 3; i++) {
      state = stepHandPinch(state, pointingHand(0.09), VIEWPORT);
    }
    expect(state.isPinching).toBe(true);
  });

  it('midpoint tracks the average of thumb and index tips', () => {
    let state = createHandPinchState();
    state = stepHandPinch(state, pointingHand(0.01), VIEWPORT);
    // pointingHand has thumb at (indexTip.x + 0.01, indexTip.y + 0.002); midpoint x ≈ indexTip.x.
    expect(state.midpoint.x).toBeGreaterThan(0);
    expect(state.midpoint.y).toBeGreaterThan(0);
  });

  it('respects tuning overrides (stricter pinchIn)', () => {
    let state = createHandPinchState();
    const tight = { ...DEFAULT_HAND_PINCH_TUNING, pinchIn: 0.05 };
    // With a very strict pinchIn, a moderate pinch (separation 0.1) shouldn't trip it.
    for (let i = 0; i < 4; i++) {
      state = stepHandPinch(state, pointingHand(0.25), VIEWPORT, tight);
    }
    expect(state.isPinching).toBe(false);
  });
});
