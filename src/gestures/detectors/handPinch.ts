// Lightweight per-hand pinch tracker. Unlike the primary-hand state machine (which tracks
// pinch-and-drag lifecycle, click interactions, freeze windows, etc.), this is just a boolean
// "is this hand pinching right now?" plus the midpoint of thumb+index in viewport pixels.
//
// Tracks TWO independent pinch modalities per frame:
//   - pinch (thumb+index): drives per-hand anchor hover / single-hand drag semantics.
//   - triPinch (thumb+index+middle): gates bimanual resize/zoom — a deliberate three-finger pose
//     the user must form to engage window resizing, so a stray thumb+index pinch with the other
//     hand can't spuriously trigger (or sustain) a resize session.

import type { Hand } from '../types';
import { FINGERTIPS } from '../handTopology';
import { pinchDistance, triPinchDistance } from '../fingers';

export interface HandPinchState {
  isPinching: boolean;
  // Midpoint of thumb-tip and index-tip in viewport pixels. Meaningful only when isPinching.
  midpoint: { x: number; y: number };
  smoothedPinchDist: number;
  isTriPinching: boolean;
  // Centroid of thumb+index+middle tips in viewport pixels. Meaningful only when isTriPinching.
  triMidpoint: { x: number; y: number };
  smoothedTriPinchDist: number;
}

export interface HandPinchTuning {
  pinchIn: number;
  pinchOut: number;
  smoothing: number; // weight on previous smoothed value in EMA
  // Three-finger pinch (thumb+index+middle all touching). Higher thresholds than the two-finger
  // pinch because triPinchDistance takes the MAX of three pairwise normalized distances — the
  // slowest pair to close sets the value.
  triPinchIn: number;
  triPinchOut: number;
}

export const DEFAULT_HAND_PINCH_TUNING: HandPinchTuning = {
  // Matches stateMachine.DEFAULT_TUNING — see its `pinchIn` comment for the fixture calibration.
  pinchIn: 0.45,
  pinchOut: 0.60,
  smoothing: 0.4,
  // Original (0.55 / 0.90) was loose enough that a relaxed open hand registered so waving fired
  // bimanual zoom. 0.30 / 0.60 killed real tri-pinches. 0.40 / 0.70 held until fixture data
  // showed backlit tri-pinches and one hand of a bimanual gesture landing at 0.40–0.41 — right
  // on the boundary. Bumped to 0.45 so deliberate tri-pinches have margin; nearest negative
  // (two-pinch-middle-out) sits at 0.55 so waving/loose-hand rejection is preserved.
  triPinchIn: 0.45,
  triPinchOut: 0.70,
};

export function createHandPinchState(): HandPinchState {
  return {
    isPinching: false,
    midpoint: { x: 0, y: 0 },
    smoothedPinchDist: 1,
    isTriPinching: false,
    triMidpoint: { x: 0, y: 0 },
    smoothedTriPinchDist: 1,
  };
}

export function stepHandPinch(
  prev: HandPinchState,
  hand: Hand,
  viewport: { width: number; height: number },
  tuning: HandPinchTuning = DEFAULT_HAND_PINCH_TUNING,
): HandPinchState {
  const raw = pinchDistance(hand);
  const smoothed = (1 - tuning.smoothing) * raw + tuning.smoothing * prev.smoothedPinchDist;

  const tipT = hand[FINGERTIPS.thumb];
  const tipI = hand[FINGERTIPS.index];
  const tipM = hand[FINGERTIPS.middle];
  const midpoint = {
    x: ((tipT.x + tipI.x) / 2) * viewport.width,
    y: ((tipT.y + tipI.y) / 2) * viewport.height,
  };

  // Hysteresis: pinchIn to enter, pinchOut to leave. Same shape as the main state machine.
  let isPinching = prev.isPinching;
  if (isPinching && smoothed > tuning.pinchOut) isPinching = false;
  else if (!isPinching && smoothed < tuning.pinchIn) isPinching = true;

  const rawTri = triPinchDistance(hand);
  const smoothedTri =
    (1 - tuning.smoothing) * rawTri + tuning.smoothing * prev.smoothedTriPinchDist;
  const triMidpoint = {
    x: ((tipT.x + tipI.x + tipM.x) / 3) * viewport.width,
    y: ((tipT.y + tipI.y + tipM.y) / 3) * viewport.height,
  };

  let isTriPinching = prev.isTriPinching;
  if (isTriPinching && smoothedTri > tuning.triPinchOut) isTriPinching = false;
  else if (!isTriPinching && smoothedTri < tuning.triPinchIn) isTriPinching = true;

  return {
    isPinching,
    midpoint,
    smoothedPinchDist: smoothed,
    isTriPinching,
    triMidpoint,
    smoothedTriPinchDist: smoothedTri,
  };
}
