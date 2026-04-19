// Lightweight per-hand pinch tracker. Unlike the primary-hand state machine (which tracks
// pinch-and-drag lifecycle, click interactions, freeze windows, etc.), this is just a boolean
// "is this hand pinching right now?" plus the midpoint of thumb+index in viewport pixels.
//
// Used by useGestures to detect bimanual pinch for two-hand gestures (zoom, corner resize).
// The primary hand's state machine can coexist with a handPinch instance on the same hand —
// they're reading the same landmarks but answering different questions.

import type { Hand } from '../types';
import { FINGERTIPS } from '../handTopology';
import { pinchDistance } from '../fingers';

export interface HandPinchState {
  isPinching: boolean;
  // Midpoint of thumb-tip and index-tip in viewport pixels. Meaningful only when isPinching.
  midpoint: { x: number; y: number };
  smoothedPinchDist: number;
}

export interface HandPinchTuning {
  pinchIn: number;
  pinchOut: number;
  smoothing: number; // weight on previous smoothed value in EMA
}

export const DEFAULT_HAND_PINCH_TUNING: HandPinchTuning = {
  pinchIn: 0.35,
  pinchOut: 0.60,
  smoothing: 0.4,
};

export function createHandPinchState(): HandPinchState {
  return { isPinching: false, midpoint: { x: 0, y: 0 }, smoothedPinchDist: 1 };
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
  const midpoint = {
    x: ((tipT.x + tipI.x) / 2) * viewport.width,
    y: ((tipT.y + tipI.y) / 2) * viewport.height,
  };

  // Hysteresis: pinchIn to enter, pinchOut to leave. Same shape as the main state machine.
  let isPinching = prev.isPinching;
  if (isPinching && smoothed > tuning.pinchOut) isPinching = false;
  else if (!isPinching && smoothed < tuning.pinchIn) isPinching = true;

  return { isPinching, midpoint, smoothedPinchDist: smoothed };
}
