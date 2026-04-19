// Pure gesture state machine. Consumes a per-frame snapshot of hand landmarks and returns a new
// state plus the discrete events fired during the transition. No DOM, no refs, no side effects —
// every field needed across frames is part of State so the reducer is fully deterministic and
// fixture-testable.
//
// States:
//   IDLE           no hand visible, or pose not recognized
//   POINTING       index extended only; cursor tracks fingertip
//   PINCH_PENDING  pinch just detected; cursor latched for N frames (kills click-down jitter)
//   PINCH_DOWN     pinch confirmed after latch window
//   DRAGGING       pinch held AND hand moved > drag threshold from pinch start
//   ZOOMING        all 5 fingers extended; emits zoom:delta from spread change
//
// Crucial invariant: the cursor emitted during a pinch stays at its `frozenCursor` position even
// when the user's fingertip drifts during the pinch motion. Without this, every click lands 8–15
// pixels away from where the user aimed. See plan doc for the full rationale.

import type { Hand } from './types';
import { FINGERTIPS } from './handTopology';
import { fingerExtensions, pinchDistance, handSpread } from './fingers';
import { isPointerPose } from './detectors/pointer';
import {
  createOneEuroState,
  oneEuroStep,
  type OneEuroState,
  type OneEuroParams,
  DEFAULT_ONE_EURO,
} from './oneEuro';
import type { GestureEvent } from './bus';

// Tunables. Expose as fields of a `Tuning` object so tests can stress edge cases without
// recompiling. Values match the plan doc.
export interface Tuning {
  pinchIn: number;          // pinchDist threshold to enter PINCH_PENDING
  pinchOut: number;         // pinchDist threshold to leave PINCH_DOWN/DRAGGING (hysteresis gap)
  // Consecutive frames pinchDist must stay above pinchOut before we fire release. Filters single-
  // frame noise spikes during fast drag motion without forcing a wider threshold (which makes
  // release feel sticky). 2 frames at 30fps ≈ 66ms of lag on a real release — imperceptible.
  pinchReleaseHoldFrames: number;
  pinchFreezeFrames: number;// frames to latch cursor before emitting pinch:down
  dragThreshold: number;    // normalized midpoint travel that promotes PINCH_DOWN → DRAGGING
  pointingMinFrames: number;// pointing must be stable this long before entering POINTING
  pointerExitFrames: number;// consecutive non-pointer frames required before POINTING → IDLE
  zoomMinFrames: number;    // all-5 extended must be stable this long before entering ZOOMING
  zoomDeadband: number;     // spread delta below this is ignored (filters jitter)
  lostGraceFrames: number;  // hand lost this many frames → reset to IDLE
  oneEuro: OneEuroParams;
}

export const DEFAULT_TUNING: Tuning = {
  pinchIn: 0.35,   // tips close but not literal contact — leaves headroom for landmark noise
  pinchOut: 0.60,  // gap of 0.25 above pinchIn; combined with pinchReleaseHoldFrames ignores drag-flutter spikes
  pinchReleaseHoldFrames: 2,   // 2-frame hold above pinchOut filters drag-flutter spikes
  pinchFreezeFrames: 4,
  dragThreshold: 0.04,
  pointingMinFrames: 2,
  pointerExitFrames: 4,
  zoomMinFrames: 3,
  zoomDeadband: 0.02,
  lostGraceFrames: 10,
  oneEuro: DEFAULT_ONE_EURO,
};

export type Mode =
  | 'IDLE'
  | 'POINTING'
  | 'PINCH_PENDING'
  | 'PINCH_DOWN'
  | 'DRAGGING'
  | 'ZOOMING';

export interface State {
  mode: Mode;
  cursor: { x: number; y: number };       // last emitted cursor position (viewport px)
  filter: OneEuroState;
  frozenCursor: { x: number; y: number } | null;
  pinchFreezeRemaining: number;
  pinchRefMidpoint: { x: number; y: number } | null; // pinch-space reference for drag delta
  pointingStreak: number;
  pointerExitStreak: number;  // consecutive non-pointer frames while in POINTING (grace counter)
  zoomStreak: number;
  prevSpread: number | null;
  lostFrames: number;
  // EMA-smoothed pinch distance. Used for all pinch threshold checks so single-frame noise
  // spikes (common at distance where MediaPipe landmarks are less stable) don't flip mode.
  smoothedPinchDist: number;
  // Consecutive frames where pinchDist has been above pinchOut while in PINCH_DOWN/DRAGGING.
  // Release fires once this reaches pinchReleaseHoldFrames; resets to 0 below pinchOut.
  pinchReleaseStreak: number;
}

export function createInitialState(): State {
  return {
    mode: 'IDLE',
    cursor: { x: 0, y: 0 },
    filter: createOneEuroState(),
    frozenCursor: null,
    pinchFreezeRemaining: 0,
    pinchRefMidpoint: null,
    pointingStreak: 0,
    pointerExitStreak: 0,
    zoomStreak: 0,
    prevSpread: null,
    lostFrames: 0,
    smoothedPinchDist: 1,
    pinchReleaseStreak: 0,
  };
}

export interface Frame {
  hand: Hand | null;
  t: number;                                   // ms timestamp
  viewport: { width: number; height: number }; // for scaling normalized coords to pixels
}

export interface ReduceResult {
  state: State;
  events: GestureEvent[];
}

export function reduce(
  prev: State,
  frame: Frame,
  tuning: Tuning = DEFAULT_TUNING,
): ReduceResult {
  const events: GestureEvent[] = [];

  // --- no hand this frame ---
  if (!frame.hand) {
    const lostFrames = prev.lostFrames + 1;
    if (lostFrames >= tuning.lostGraceFrames && prev.mode !== 'IDLE') {
      // If we were in a pinch when the hand was lost, close the interaction cleanly.
      if (prev.mode === 'PINCH_DOWN') {
        events.push({ type: 'pinch:up', x: prev.cursor.x, y: prev.cursor.y });
      } else if (prev.mode === 'DRAGGING') {
        events.push({ type: 'drag:end', x: prev.cursor.x, y: prev.cursor.y });
      }
      return { state: { ...createInitialState(), cursor: prev.cursor }, events };
    }
    return { state: { ...prev, lostFrames }, events };
  }

  const hand = frame.hand;
  const ext = fingerExtensions(hand);
  const rawPinchDist = pinchDistance(hand);
  // Reset smoothing when returning from hand-lost so the blend doesn't chase a stale value.
  const smoothedPinchDist =
    prev.lostFrames > 0
      ? rawPinchDist
      : 0.6 * rawPinchDist + 0.4 * prev.smoothedPinchDist;
  const pinchDist = smoothedPinchDist;
  const spread = handSpread(hand);

  // Cursor pipeline: index fingertip (already x-mirrored) → viewport pixels → one-euro smoothed.
  const tip = hand[FINGERTIPS.index];
  const rawX = tip.x * frame.viewport.width;
  const rawY = tip.y * frame.viewport.height;
  const euro = oneEuroStep(prev.filter, rawX, rawY, frame.t, tuning.oneEuro);
  const smoothedCursor = { x: euro.x, y: euro.y };

  const pointerPose = isPointerPose(hand);
  const allFive = ext.every(Boolean);

  // Streak counters for pose stability hysteresis.
  const pointingStreak = pointerPose ? prev.pointingStreak + 1 : 0;
  const zoomStreak = allFive ? prev.zoomStreak + 1 : 0;
  // Non-pointer streak: only accrues while we're already in POINTING, so it acts as a grace
  // counter that delays exit. Any frame with pointer pose resets it.
  const pointerExitStreak =
    prev.mode === 'POINTING' && !pointerPose ? prev.pointerExitStreak + 1 : 0;

  // Midpoint of thumb + index tips, in normalized coords (for drag-delta threshold, which is
  // scale-invariant).
  const midpoint = {
    x: (hand[FINGERTIPS.thumb].x + hand[FINGERTIPS.index].x) / 2,
    y: (hand[FINGERTIPS.thumb].y + hand[FINGERTIPS.index].y) / 2,
  };


  let mode = prev.mode;
  let frozenCursor = prev.frozenCursor;
  let pinchFreezeRemaining = prev.pinchFreezeRemaining;
  let pinchRefMidpoint = prev.pinchRefMidpoint;
  let pinchReleaseStreak = prev.pinchReleaseStreak;
  let outCursor = smoothedCursor;

  // --- mode transitions ---
  switch (prev.mode) {
    case 'IDLE': {
      // Cursor follows the fingertip even in IDLE — hover on targets should work regardless of
      // whether the user has adopted a formal pointing pose.
      events.push({ type: 'pointer:move', x: smoothedCursor.x, y: smoothedCursor.y });
      if (zoomStreak >= tuning.zoomMinFrames) {
        mode = 'ZOOMING';
      } else if (pinchDist < tuning.pinchIn) {
        // Pinch is independent of the pointing pose. A hand showing thumb+index close enough
        // counts, even if middle/ring/pinky are also extended or the index is partly bent.
        mode = 'PINCH_PENDING';
        frozenCursor = { ...smoothedCursor };
        pinchFreezeRemaining = tuning.pinchFreezeFrames;
        pinchRefMidpoint = midpoint;
        outCursor = frozenCursor;
      } else if (pointingStreak >= tuning.pointingMinFrames) {
        mode = 'POINTING';
      }
      break;
    }
    case 'POINTING': {
      // Pointer -> zoom takes priority over pinch start (all-5 can't coexist with index-only).
      if (zoomStreak >= tuning.zoomMinFrames) {
        mode = 'ZOOMING';
        break;
      }
      if (pinchDist < tuning.pinchIn) {
        mode = 'PINCH_PENDING';
        frozenCursor = { ...smoothedCursor };
        pinchFreezeRemaining = tuning.pinchFreezeFrames;
        pinchRefMidpoint = midpoint;
        outCursor = frozenCursor;
        break;
      }
      // Grace window on pose exit: a single tilted/blurred frame shouldn't drop POINTING. Only
      // exit once we've seen pointerExitFrames consecutive non-pointer frames. Meanwhile keep
      // emitting pointer:move so the fingertip visual stays active.
      if (pointerPose) {
        events.push({ type: 'pointer:move', x: smoothedCursor.x, y: smoothedCursor.y });
      } else if (pointerExitStreak + 1 >= tuning.pointerExitFrames) {
        mode = 'IDLE';
      } else {
        events.push({ type: 'pointer:move', x: smoothedCursor.x, y: smoothedCursor.y });
      }
      break;
    }
    case 'PINCH_PENDING': {
      // Held cursor, no events, countdown then commit.
      outCursor = frozenCursor ?? smoothedCursor;
      pinchFreezeRemaining -= 1;
      if (pinchDist > tuning.pinchOut) {
        // User released before the freeze window finished — cancel without ever emitting down.
        mode = pointerPose ? 'POINTING' : 'IDLE';
        frozenCursor = null;
        pinchRefMidpoint = null;
        pinchFreezeRemaining = 0;
      } else if (pinchFreezeRemaining <= 0) {
        mode = 'PINCH_DOWN';
        events.push({ type: 'pinch:down', x: outCursor.x, y: outCursor.y });
      }
      break;
    }
    case 'PINCH_DOWN': {
      outCursor = frozenCursor ?? smoothedCursor;
      const releaseStreak = pinchDist > tuning.pinchOut ? prev.pinchReleaseStreak + 1 : 0;
      if (releaseStreak >= tuning.pinchReleaseHoldFrames) {
        events.push({ type: 'pinch:up', x: outCursor.x, y: outCursor.y });
        mode = pointerPose ? 'POINTING' : 'IDLE';
        frozenCursor = null;
        pinchRefMidpoint = null;
        pinchReleaseStreak = 0;
        break;
      }
      pinchReleaseStreak = releaseStreak;
      // Promote to drag once midpoint has travelled > threshold.
      if (pinchRefMidpoint) {
        const travel = Math.hypot(midpoint.x - pinchRefMidpoint.x, midpoint.y - pinchRefMidpoint.y);
        if (travel > tuning.dragThreshold) {
          mode = 'DRAGGING';
          events.push({ type: 'drag:start', x: outCursor.x, y: outCursor.y });
        }
      }
      break;
    }
    case 'DRAGGING': {
      // Drag cursor = frozen anchor + midpoint delta, scaled to viewport px. Keeps the UI under
      // the user's hand without "snapping" the cursor at pinch-start.
      const ref = pinchRefMidpoint;
      const base = frozenCursor ?? smoothedCursor;
      outCursor = ref
        ? {
            x: base.x + (midpoint.x - ref.x) * frame.viewport.width,
            y: base.y + (midpoint.y - ref.y) * frame.viewport.height,
          }
        : smoothedCursor;
      const releaseStreak = pinchDist > tuning.pinchOut ? prev.pinchReleaseStreak + 1 : 0;
      if (releaseStreak >= tuning.pinchReleaseHoldFrames) {
        events.push({ type: 'drag:end', x: outCursor.x, y: outCursor.y });
        mode = pointerPose ? 'POINTING' : 'IDLE';
        frozenCursor = null;
        pinchRefMidpoint = null;
        pinchReleaseStreak = 0;
      } else {
        pinchReleaseStreak = releaseStreak;
        events.push({ type: 'drag:move', x: outCursor.x, y: outCursor.y });
      }
      break;
    }
    case 'ZOOMING': {
      if (!allFive) {
        mode = pointerPose ? 'POINTING' : 'IDLE';
        break;
      }
      if (prev.prevSpread !== null) {
        const delta = spread - prev.prevSpread;
        if (Math.abs(delta) > tuning.zoomDeadband) {
          events.push({ type: 'zoom:delta', delta });
        }
      }
      break;
    }
  }

  return {
    state: {
      mode,
      cursor: outCursor,
      filter: euro.state,
      frozenCursor,
      pinchFreezeRemaining,
      pinchRefMidpoint,
      pointingStreak,
      pointerExitStreak,
      zoomStreak,
      prevSpread: spread,
      lostFrames: 0,
      smoothedPinchDist,
      pinchReleaseStreak,
    },
    events,
  };
}
