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
import { fingerStraightness2D, pinchDistance } from '@/gestures/fingers';
import {
  createTapState,
  stepTapDetector,
  DEFAULT_TAP_TUNING,
  type TapState,
  type TapTuning,
} from '@/gestures/detectors/airTap';
import {
  createHandPinchState,
  stepHandPinch,
  DEFAULT_HAND_PINCH_TUNING,
  type HandPinchState,
  type HandPinchTuning,
} from '@/gestures/detectors/handPinch';
import { isFist, isOpenHand } from '@/gestures/detectors/poses';
import type { Hands } from '@/gestures/types';

export type PassivePose = 'none' | 'fist' | 'open';

export interface UseGesturesOptions {
  tuning?: Tuning;
  tap?: TapTuning;
  handPinch?: HandPinchTuning;
}

export interface UseGesturesResult {
  bus: GestureBus;
  stateRef: React.MutableRefObject<State>;
  modeRef: React.MutableRefObject<Mode>;
  // Snapshot of the primary-hand tap detector for the debug HUD.
  tapStateRef: React.MutableRefObject<TapState>;
  // Live pinch-distance reading on the primary hand, for HUD calibration.
  pinchDistRef: React.MutableRefObject<number>;
  // Primary-hand passive-pose classification for the HUD. 'none' when the hand is doing anything
  // meaningful (pointing, pinching, tri-pinching, transitioning); 'fist' / 'open' when we've
  // explicitly short-circuited event emission because the pose is a geometric dead-end.
  passivePoseRef: React.MutableRefObject<PassivePose>;
}

// Drives the gesture state machine from the landmarks ref, running at RAF cadence. Emits discrete
// events to the bus — the only bridge from the per-frame hot path into React state.
//
// Ordering per frame:
//   1. Step each visible hand's tap detector (uses prev frame's mode for clickOk).
//   2. Run the state machine on the primary hand, passing the primary's CURLING phase as
//      suppressPinch so the state machine refuses to enter PINCH_PENDING during a click-curl.
//   3. Emit click events for any tap detector that fired this frame.
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
  const handPinchStatesRef = useRef<HandPinchState[]>([]);
  // Tracks whether the bimanual gesture is currently active so we can emit the right transition
  // event (start / end). Persists across frames.
  const bimanualActiveRef = useRef<boolean>(false);
  const pinchDistRef = useRef<number>(0);
  const passivePoseRef = useRef<PassivePose>('none');

  const tuning = opts.tuning ?? DEFAULT_TUNING;
  const tapTuning = opts.tap ?? DEFAULT_TAP_TUNING;
  const handPinchTuning = opts.handPinch ?? DEFAULT_HAND_PINCH_TUNING;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const hands = landmarksRef.current;
      const primary = hands[0] ?? null;
      const now = performance.now();
      const viewport = { width: window.innerWidth, height: window.innerHeight };

      // Resize per-hand tap state arrays to match visible hands.
      if (tapStatesRef.current.length < hands.length) {
        while (tapStatesRef.current.length < hands.length) {
          tapStatesRef.current.push(createTapState());
        }
      } else if (tapStatesRef.current.length > hands.length) {
        tapStatesRef.current.length = hands.length;
      }
      // Emit hand:pinch:end / hand:triPinch:end for any hand that disappeared while still
      // pinching, before we truncate the per-hand state array.
      for (let i = hands.length; i < handPinchStatesRef.current.length; i++) {
        if (handPinchStatesRef.current[i].isPinching) {
          bus.emit({ type: 'hand:pinch:end', hand: i });
        }
        if (handPinchStatesRef.current[i].isTriPinching) {
          bus.emit({ type: 'hand:triPinch:end', hand: i });
        }
      }
      if (handPinchStatesRef.current.length < hands.length) {
        while (handPinchStatesRef.current.length < hands.length) {
          handPinchStatesRef.current.push(createHandPinchState());
        }
      } else if (handPinchStatesRef.current.length > hands.length) {
        handPinchStatesRef.current.length = hands.length;
      }

      // --- Per-hand passive pose classification. Fist or open-palm-wave short-circuits everything:
      // no clicks, no pinch entry, no tri-pinch sessions. The individual detectors already reject
      // these shapes in the common case, but transitional frames (opening from fist to point) can
      // leak false positives — this explicit gate stops them. Computed once per hand, reused below.
      const passivePerHand: PassivePose[] = hands.map((h) => {
        if (isFist(h)) return 'fist';
        if (isOpenHand(h)) return 'open';
        return 'none';
      });
      passivePoseRef.current = passivePerHand[0] ?? 'none';

      // --- Step 1: step all tap detectors using the PREVIOUS frame's mode for clickOk. ---
      // While pinching/dragging, clickOk is false, which forces the tap detector into cooldown —
      // any finger-curl transient during a pinch won't fire a click the moment the pinch ends.
      const prevMode = stateRef.current.mode;
      const clickOk = prevMode === 'POINTING' || prevMode === 'IDLE';
      const tapFired: { handIdx: number }[] = [];
      for (let i = 0; i < hands.length; i++) {
        const hand = hands[i];
        const straightness = fingerStraightness2D(hand, 1);
        const passive = passivePerHand[i] !== 'none';

        if (!clickOk || passive) {
          // Force the click detector into cooldown while pinching/dragging, OR while the hand is
          // in a passive pose (fist/wave). Any finger-curl transient shouldn't fire a click the
          // moment the pose resolves.
          tapStatesRef.current[i] = {
            phase: 'COOLDOWN',
            cooldown: tapTuning.cooldownFrames,
            minStraight: 1,
            curlFrames: 0,
          };
          continue;
        }
        const { state: tapNext, fired: curlFired } = stepTapDetector(
          tapStatesRef.current[i],
          straightness,
          clickOk,
          tapTuning,
        );
        tapStatesRef.current[i] = tapNext;

        if (curlFired) tapFired.push({ handIdx: i });
      }
      primaryTapRef.current =
        hands.length > 0 ? tapStatesRef.current[0] : createTapState();

      // --- Step 2: state machine. suppressPinch prevents click-curls from being misread as
      // pinches — if the primary tap detector is mid-curl, pinch entry is vetoed. Also gated on
      // passive pose so a fist doesn't slide into PINCH_PENDING the moment thumb+index end up
      // close enough inside the fold. Doesn't affect in-progress drags — suppressPinch only
      // blocks IDLE → PINCH_PENDING. ---
      const suppressPinch =
        primaryTapRef.current.phase === 'CURLING' || passivePoseRef.current !== 'none';
      const { state: next, events } = reduce(
        stateRef.current,
        { hand: primary, t: now, viewport, suppressPinch },
        tuning,
      );
      stateRef.current = next;
      modeRef.current = next.mode;
      pinchDistRef.current = primary ? pinchDistance(primary) : 0;
      for (const e of events) bus.emit(e);

      // --- Step 3: emit click events for any tap that fired this frame. ---
      for (const { handIdx } of tapFired) {
        const hand = hands[handIdx];
        const tip = hand[FINGERTIPS.index];
        bus.emit({
          type: 'click',
          x: tip.x * viewport.width,
          y: tip.y * viewport.height,
        });
      }

      // --- Step 4: per-hand pinch tracking. Step each hand's pinch detector, detect
      // transitions, and emit per-hand events (for live anchor visuals) and the aggregated
      // bimanual events (for zoom/resize logic). Bimanual requires the STRICTER three-finger
      // triPinch pose on both hands — differentiates deliberate resize gestures from incidental
      // two-finger pinches, and stops the bimanual session from getting "stuck" because a
      // normal thumb+index pinch lingers after the user thinks they released. ---
      const triPinchingPoints: { x: number; y: number }[] = [];
      for (let i = 0; i < hands.length; i++) {
        const prevState = handPinchStatesRef.current[i];
        let nextState = stepHandPinch(prevState, hands[i], viewport, handPinchTuning);
        // Passive-pose short-circuit. If the hand is in fist/wave, the detector's raw readings
        // might still say "pinching" (a tightly-closed fist can put thumb+index within the
        // pinchIn threshold). Force isPinching / isTriPinching off — the transition emission
        // below fires the end events cleanly if they were active last frame.
        if (passivePerHand[i] !== 'none') {
          nextState = { ...nextState, isPinching: false, isTriPinching: false };
        }
        handPinchStatesRef.current[i] = nextState;
        if (!prevState.isPinching && nextState.isPinching) {
          bus.emit({ type: 'hand:pinch:start', hand: i, x: nextState.midpoint.x, y: nextState.midpoint.y });
        } else if (prevState.isPinching && !nextState.isPinching) {
          bus.emit({ type: 'hand:pinch:end', hand: i });
        } else if (nextState.isPinching) {
          bus.emit({ type: 'hand:pinch:move', hand: i, x: nextState.midpoint.x, y: nextState.midpoint.y });
        }
        if (!prevState.isTriPinching && nextState.isTriPinching) {
          bus.emit({ type: 'hand:triPinch:start', hand: i, x: nextState.triMidpoint.x, y: nextState.triMidpoint.y });
        } else if (prevState.isTriPinching && !nextState.isTriPinching) {
          bus.emit({ type: 'hand:triPinch:end', hand: i });
        } else if (nextState.isTriPinching) {
          bus.emit({ type: 'hand:triPinch:move', hand: i, x: nextState.triMidpoint.x, y: nextState.triMidpoint.y });
        }
        if (nextState.isTriPinching) triPinchingPoints.push(nextState.triMidpoint);
      }
      const bimanualNow = triPinchingPoints.length >= 2;
      if (bimanualNow) {
        // Always use the first two triPinching hands. If a third joins, ignore it for now.
        const [a, b] = triPinchingPoints;
        if (!bimanualActiveRef.current) {
          bus.emit({ type: 'bimanual:pinch:start', a, b });
          bimanualActiveRef.current = true;
        } else {
          bus.emit({ type: 'bimanual:pinch:move', a, b });
        }
      } else if (bimanualActiveRef.current) {
        bus.emit({ type: 'bimanual:pinch:end' });
        bimanualActiveRef.current = false;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [landmarksRef, bus, tuning, tapTuning, handPinchTuning]);

  return { bus, stateRef, modeRef, tapStateRef: primaryTapRef, pinchDistRef, passivePoseRef };
}
