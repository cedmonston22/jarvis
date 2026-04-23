// "Passive" pose detection — fist and open palm / wave. These poses are geometric dead-ends: we
// want them to produce NO pointer, NO click, NO pinch, NO window gestures. Any hand pose we can
// classify unambiguously as passive is a chance to short-circuit the rest of the gesture layer
// rather than trusting each detector's own thresholds to reject it correctly.
//
// Rationale: the individual detectors (pointer, airTap, pinch, triPinch) already reject these
// shapes in the common case, but transitional frames (opening from fist to point, closing palm
// into a pinch) can produce brief false positives. A conservative pose gate evaluated up front
// stops those transients from leaking out as events.
//
// Both detectors are conservative: they AND a 2D straightness check with a 3D reach check so a
// foreshortened finger can't single-handedly flip the classification. Fixture values (see the
// diagnostic runs in the tuning history) land well outside the thresholds for every fist or
// open-palm fixture, and every pointing/pinch/tri-pinch fixture falls on the other side.

import { fingerReach, fingerStraightness2D } from '../fingers';
import type { Hand } from '../types';

// Fist: index/middle/ring/pinky are all curled in the image plane. Thumb is don't-care because
// its geometry in a clenched fist (wrapping across the palm) varies.
//
// Single signal: `fingerStraightness2D < 0.1` on each of the four non-thumb fingers. Observed
// values:
//
//   - front-facing fist fixture (`fist`):      i=-1.00  m=-1.00  r=-1.00  p=-0.99
//   - side-view fist fixture (`fist-side`):    i=-0.23  m=-0.19  r=-0.14  p=-0.06
//   - tightest tri-pinch (`backlit-tri-pinch-front-facing`):  i=+0.14  (rejects this gate)
//   - everything else (pointing, wave, pinches): at least one non-thumb 2D cos > 0.1
//
// The gap between the highest fist reading (-0.06) and the lowest tri-pinch reading (+0.14)
// straddles zero; threshold 0.1 sits in the tri-pinch side of the gap with margin on both sides.
//
// Reach is NOT used here. In a side-view fist the z-axis is nearly flat (MediaPipe can't recover
// depth when the hand is edge-on), so 3D reach collapses to 2D reach — and 2D reach stays high
// (~1.5–1.84 for the side-view fist) because curled fingers still project outward in the image
// plane when viewed from the side. Reach-based rejection missed every side-view fist.
const FIST_2D_COS_MAX = 0.1;

export function isFist(hand: Hand): boolean {
  for (const i of [1, 2, 3, 4] as const) {
    if (fingerStraightness2D(hand, i) >= FIST_2D_COS_MAX) return false;
  }
  return true;
}

// Open hand / wave: index/middle/ring/pinky all clearly extended. Thumb is don't-care (could be
// splayed or tucked). Mirror of the pointer-pose check: pointer needs exactly one extended
// non-thumb finger; a wave has all four. Uses the same AND-of-2D-and-reach gate so a finger
// drifting slightly past one threshold alone can't flip the classification.
const OPEN_STRAIGHT_2D_MIN = 0.88;
const OPEN_REACH_MIN = 1.85;

export function isOpenHand(hand: Hand): boolean {
  for (const i of [1, 2, 3, 4] as const) {
    if (fingerStraightness2D(hand, i) <= OPEN_STRAIGHT_2D_MIN) return false;
    if (fingerReach(hand, i) <= OPEN_REACH_MIN) return false;
  }
  return true;
}

export function isPassivePose(hand: Hand): boolean {
  return isFist(hand) || isOpenHand(hand);
}
