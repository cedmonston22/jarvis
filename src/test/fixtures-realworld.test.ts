// Real-world fixture regression suite. Each JSON under src/test/fixtures/ is a `Hand[]` captured
// from the dev server via the voice command flow ("capture <label>"). Tests assert that live
// detectors behave correctly against actual user landmarks, not synthetic `makeHand()` geometry.
//
// Organized by detector so a failure immediately points at which part of the gesture layer drifted.
// Filenames are lowercase-kebab; lighting environments are prefixed (backlit-*, ok-light-*).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPointerPose } from '@/gestures/detectors/pointer';
import { pinchDistance, triPinchDistance } from '@/gestures/fingers';
import { DEFAULT_TUNING } from '@/gestures/stateMachine';
import { DEFAULT_HAND_PINCH_TUNING } from '@/gestures/detectors/handPinch';
import type { Hand, Hands } from '@/gestures/types';

function load(name: string): Hands {
  const path = resolve(process.cwd(), 'src/test/fixtures', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as Hands;
}

function primary(name: string): Hand {
  const hands = load(name);
  if (!hands.length) throw new Error(`fixture ${name} has no hands`);
  return hands[0];
}

// `point-close`, `backlit-clean-point`, and `ok-light-clean-point` are excluded — the diagnostic
// dump revealed the captures don't actually contain a pointing pose (ok-light-clean-point has
// middle/ring/pinky at ~1.00 → open palm; backlit-clean-point has index at -1.00 → index was
// folded at capture time). Any threshold that accepts these would also accept a wave. Recapture
// those three before re-adding them. Kept on disk so the user has a record.
const POINTING_POSITIVES = [
  'clean-point',
  'clean-point-left',
  'point-loose-middle',
  'point-edge-right',
  'point-edge-left',
  'point-far',
  'backlit-point-loose-middle',
];

const POINTING_NEGATIVES = ['wave-open-palm', 'fist', 'peace-sign'];

// `backlit-pinch-front-facing` excluded — the fixture reads 0.69 (well above fist at 0.55, which
// is our hard ceiling for pinchIn). This is the case B1 was added for: the runtime hand-region
// luma sample should now trigger dark-boost on backlit scenes, improving landmark quality. But
// this fixture was captured before B1 shipped, so the stored landmarks are the old noisy reading.
// Recapture in backlit conditions with dark-boost firing and re-add it.
const PINCH_POSITIVES = [
  'pinch-front-facing',
  'pinch-side-facing',
  'pinch-tilted',
  'backlit-pinch-side-facing',
  'ok-light-pinch-front-facing',
  'ok-light-pinch-side-facing',
];

// pinch-open is the clear release pose; fist/wave/point shouldn't trip two-finger pinch either.
// claw-false-pinch is the canonical pathological case — all fingers curled with thumb near index
// tip. CLAUDE.md says the current pinchDistance ratio math handles it; if this fixture fails we
// have evidence the rejection isn't as clean as claimed.
const PINCH_NEGATIVES = [
  'pinch-open',
  'fist',
  'wave-open-palm',
  'clean-point',
  'claw-false-pinch',
];

const TRI_PINCH_POSITIVES = [
  'tri-pinch-tight',
  'tri-pinch-front-facing',
  'tri-pinch-side-facing',
  'backlit-tri-pinch-tight',
  'backlit-tri-pinch-front-facing',
];

// Two-finger pinches explicitly belong here: triPinchDistance takes the MAX of the three pairwise
// distances, so a pinch where the middle is NOT touching the thumb/index cluster must read high.
// If these fail it means a two-finger pinch would accidentally trip window-grip sessions.
const TRI_PINCH_NEGATIVES = [
  'tri-pinch-loose',
  'two-pinch-middle-out',
  'pinch-front-facing',
  'pinch-side-facing',
  'wave-open-palm',
  'fist',
  'clean-point',
  'claw-false-pinch',
];

const BIMANUAL_POSITIVES = ['bimanual-opposing', 'bimanual-matching'];

describe('real-world fixtures', () => {
  describe('isPointerPose', () => {
    for (const name of POINTING_POSITIVES) {
      it(`${name} → pointing`, () => {
        expect(isPointerPose(primary(name))).toBe(true);
      });
    }
    for (const name of POINTING_NEGATIVES) {
      it(`${name} → not pointing`, () => {
        expect(isPointerPose(primary(name))).toBe(false);
      });
    }
  });

  describe('pinchDistance', () => {
    const threshold = DEFAULT_TUNING.pinchIn;
    for (const name of PINCH_POSITIVES) {
      it(`${name} < pinchIn (${threshold})`, () => {
        expect(pinchDistance(primary(name))).toBeLessThan(threshold);
      });
    }
    for (const name of PINCH_NEGATIVES) {
      it(`${name} ≥ pinchIn (${threshold})`, () => {
        expect(pinchDistance(primary(name))).toBeGreaterThanOrEqual(threshold);
      });
    }
  });

  describe('triPinchDistance', () => {
    const threshold = DEFAULT_HAND_PINCH_TUNING.triPinchIn;
    for (const name of TRI_PINCH_POSITIVES) {
      it(`${name} < triPinchIn (${threshold})`, () => {
        expect(triPinchDistance(primary(name))).toBeLessThan(threshold);
      });
    }
    for (const name of TRI_PINCH_NEGATIVES) {
      it(`${name} ≥ triPinchIn (${threshold})`, () => {
        expect(triPinchDistance(primary(name))).toBeGreaterThanOrEqual(threshold);
      });
    }
  });

  describe('bimanual', () => {
    for (const name of BIMANUAL_POSITIVES) {
      it(`${name} has two hands, both tri-pinching`, () => {
        const hands = load(name);
        expect(hands.length).toBe(2);
        for (const h of hands) {
          expect(triPinchDistance(h)).toBeLessThan(DEFAULT_HAND_PINCH_TUNING.triPinchIn);
        }
      });
    }

    it('bimanual-idle: two hands visible, at least one NOT tri-pinching', () => {
      const hands = load('bimanual-idle');
      expect(hands.length).toBe(2);
      const distances = hands.map((h) => triPinchDistance(h));
      expect(distances.some((d) => d >= DEFAULT_HAND_PINCH_TUNING.triPinchIn)).toBe(true);
    });
  });
});
