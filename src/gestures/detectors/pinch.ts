// Single-frame pinch detector. Returns the normalized thumb-tip ↔ index-tip distance and the
// binary pinch state implied by hysteresis thresholds. The state machine owns cross-frame
// hysteresis (pinch-in at LO, pinch-out at HI) — this function just reports the raw distance and
// the boundary outcomes.

import { pinchDistance } from '../fingers';
import type { Hand } from '../types';

export const PINCH_IN_THRESHOLD = 0.35;
export const PINCH_OUT_THRESHOLD = 0.5;

export interface PinchReading {
  distance: number;
  isPinched: boolean;
}

// `prevPinched` lets the caller apply hysteresis inline without routing through the machine
// (useful for tests and simple consumers). State machine passes its own pinchMode flag.
export function readPinch(hand: Hand, prevPinched: boolean): PinchReading {
  const distance = pinchDistance(hand);
  const threshold = prevPinched ? PINCH_OUT_THRESHOLD : PINCH_IN_THRESHOLD;
  const isPinched = prevPinched ? distance < threshold : distance < threshold;
  return { distance, isPinched };
}
