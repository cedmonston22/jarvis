import { describe, it, expect } from 'vitest';
import {
  createForwardTapState,
  stepForwardTapDetector,
  DEFAULT_FORWARD_TAP_TUNING,
  type ForwardTapState,
} from './forwardTap';

// Feeds a sequence of bbox-diagonal values through the detector and returns
// the number of fires + final state.
function run(diagonals: number[], allowFire = true) {
  let state: ForwardTapState = createForwardTapState();
  let fires = 0;
  for (const d of diagonals) {
    const r = stepForwardTapDetector(state, d, allowFire, DEFAULT_FORWARD_TAP_TUNING);
    state = r.state;
    if (r.fired) fires += 1;
  }
  return { fires, state };
}

describe('forwardTap', () => {
  it('fires on a rapid diagonal enlargement', () => {
    // Hand diagonal grows rapidly over ~3 frames, then plateaus — classic forward-tap pulse.
    const { fires } = run([0.20, 0.24, 0.28, 0.32, 0.33, 0.33, 0.33]);
    expect(fires).toBeGreaterThan(0);
  });

  it('does not fire on slow, sustained growth (user walking closer)', () => {
    // Growth per frame stays below velocityEnter (0.015).
    const diagonals: number[] = [];
    for (let i = 0; i < 40; i++) diagonals.push(0.20 + i * 0.003);
    const { fires } = run(diagonals);
    expect(fires).toBe(0);
  });

  it('does not fire on static hand (no growth)', () => {
    const { fires } = run(Array(30).fill(0.25));
    expect(fires).toBe(0);
  });

  it('fires at most once per pulse thanks to firedThisPulse latch', () => {
    // Long sustained high-velocity period — should fire once, then sit in APPROACHING/COOLDOWN
    // without re-firing.
    const { fires } = run([0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.40, 0.40]);
    expect(fires).toBe(1);
  });

  it('re-fires on a second pulse after cooldown', () => {
    // Fire once, let velocity drop and cooldown expire, then fire again.
    const seq = [
      0.20, 0.25, 0.30, 0.30, 0.30, // first tap + settle
      0.30, 0.30, 0.30, 0.30, 0.30, 0.30, 0.30, 0.30, 0.30, // cooldown
      0.35, 0.40, 0.45,              // second tap
    ];
    const { fires } = run(seq);
    expect(fires).toBe(2);
  });

  it('is suppressed while allowFire is false', () => {
    const { fires } = run([0.20, 0.24, 0.28, 0.32, 0.36], false);
    expect(fires).toBe(0);
  });
});
