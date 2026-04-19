import { useEffect, useRef } from 'react';
import {
  reduce,
  createInitialState,
  DEFAULT_TUNING,
  type State,
  type Mode,
  type Tuning,
} from '@/gestures/stateMachine';
import { createGestureBus, type GestureBus } from '@/gestures/bus';
import { FINGERTIPS } from '@/gestures/handTopology';
import { fingerStraightness } from '@/gestures/fingers';
import {
  createTapState,
  stepTapDetector,
  DEFAULT_TAP_TUNING,
  type TapState,
  type TapTuning,
} from '@/gestures/detectors/airTap';
import type { Hands } from '@/gestures/types';

export interface UseGesturesOptions {
  tuning?: Tuning;
  tap?: TapTuning;
}

export interface UseGesturesResult {
  bus: GestureBus;
  stateRef: React.MutableRefObject<State>;
  modeRef: React.MutableRefObject<Mode>;
  // Snapshot of the primary-hand tap detector for the debug HUD.
  tapStateRef: React.MutableRefObject<TapState>;
}

// Drives the gesture state machine from the landmarks ref, running at RAF cadence. Emits discrete
// events to the bus — the only bridge from the per-frame hot path into React state.
//
// Architecture: the main state machine handles the "primary" hand (hand[0]) for pointer / pinch /
// drag / zoom. Air-tap detection runs independently for EVERY visible hand — so either hand can
// fire a click, and tap detection works even when a non-primary hand is doing the tapping.
export function useGestures(
  landmarksRef: React.MutableRefObject<Hands>,
  opts: UseGesturesOptions = {},
): UseGesturesResult {
  const busRef = useRef<GestureBus | null>(null);
  if (!busRef.current) busRef.current = createGestureBus();
  const bus = busRef.current;

  const stateRef = useRef<State>(createInitialState());
  const modeRef = useRef<Mode>('IDLE');
  const tapStatesRef = useRef<TapState[]>([]);
  const primaryTapRef = useRef<TapState>(createTapState());

  const tuning = opts.tuning ?? DEFAULT_TUNING;
  const tapTuning = opts.tap ?? DEFAULT_TAP_TUNING;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const hands = landmarksRef.current;
      const primary = hands[0] ?? null;
      const now = performance.now();
      const viewport = { width: window.innerWidth, height: window.innerHeight };

      // 1. Main state machine on the primary hand.
      const { state: next, events } = reduce(
        stateRef.current,
        { hand: primary, t: now, viewport },
        tuning,
      );
      stateRef.current = next;
      modeRef.current = next.mode;
      for (const e of events) bus.emit(e);

      // 2. Air-tap detection on every visible hand. A tap fires only when the specific hand is
      //    in pointer pose, so pinch/drag gestures on one hand can't accidentally click from the
      //    other hand's motion. Click coords come from the tapping hand's own fingertip.
      if (tapStatesRef.current.length < hands.length) {
        while (tapStatesRef.current.length < hands.length) {
          tapStatesRef.current.push(createTapState());
        }
      } else if (tapStatesRef.current.length > hands.length) {
        tapStatesRef.current.length = hands.length;
      }
      for (let i = 0; i < hands.length; i++) {
        const hand = hands[i];
        const straightness = fingerStraightness(hand, 1); // index finger
        // Allow clicks whenever the index has been mostly extended recently — a very deep curl
        // during the click will drive straightness below our strict pointer threshold, but we
        // still want the V-shape to fire. Loose gate here; the tuning thresholds inside the
        // detector do the heavy lifting.
        const allow = true;
        const { state: tapNext, fired } = stepTapDetector(
          tapStatesRef.current[i],
          straightness,
          allow,
          tapTuning,
        );
        tapStatesRef.current[i] = tapNext;
        if (i === 0) primaryTapRef.current = tapNext;
        if (fired) {
          const tip = hand[FINGERTIPS.index];
          bus.emit({
            type: 'click',
            x: tip.x * viewport.width,
            y: tip.y * viewport.height,
          });
        }
      }
      if (hands.length === 0) {
        // No hands visible — keep primary tap ref fresh for the HUD.
        primaryTapRef.current = createTapState();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [landmarksRef, bus, tuning, tapTuning]);

  return { bus, stateRef, modeRef, tapStateRef: primaryTapRef };
}
