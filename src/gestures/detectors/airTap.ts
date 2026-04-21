// Per-hand click detector based on index-finger CURL. A click is a V-shape in finger straightness:
// the index briefly bends (straightness drops) then re-extends (straightness recovers). Hand tilts
// don't change joint angles, so tilting can't trigger the detector — a property the previous
// z-velocity model couldn't guarantee.
//
// Visually: point at a target, briefly curl your index like pressing a button, re-extend. Click.
//
// This is a pure state-in → state-out + fired-flag reducer, kept small so it can run per-hand in
// the gestures hook.

export interface TapState {
  phase: 'IDLE' | 'CURLING' | 'COOLDOWN';
  cooldown: number;
  minStraight: number;  // lowest straightness seen during the current CURLING phase
  curlFrames: number;   // length of the current CURLING phase in frames
}

export interface TapTuning {
  // Straightness must drop below this to enter CURLING. Default ≈ slightly below typical
  // "pointing cleanly" noise floor (~0.92–1.0).
  curlEnter: number;
  // Straightness must rise back above this to test firing. Hysteresis gap vs curlEnter.
  curlExit: number;
  // During CURLING, minStraight must have dipped below this for the curl to qualify as a real
  // click (not just a wobble).
  peakRequired: number;
  // Max frames a CURLING phase is allowed to last. Longer = user is slowly folding the finger, not
  // tapping — abort without firing.
  curlMaxFrames: number;
  // Cooldown after a successful click prevents instant re-triggering.
  cooldownFrames: number;
}

export const DEFAULT_TAP_TUNING: TapTuning = {
  // Middle-ground: old peakRequired=0.9 fired clicks from ambient finger motion during waving.
  // peakRequired=0.5 killed normal light taps. 0.75 requires a meaningful dip (index bent past
  // ~40°) while still accepting quick, non-exaggerated clicks.
  curlEnter: 0.8,
  curlExit: 0.84,
  peakRequired: 0.75,
  curlMaxFrames: 10,
  cooldownFrames: 7,
};

export function createTapState(): TapState {
  return { phase: 'IDLE', cooldown: 0, minStraight: 1, curlFrames: 0 };
}

// `straightness` is the cosine of the angle at the index finger's PIP joint (see
// fingerStraightness in gestures/fingers.ts). `allowFire` should be true whenever the hand is in
// a pose where a click makes sense (e.g. we're pointing or close to pointing). When false the
// detector stays idle but keeps its cooldown ticking.
export function stepTapDetector(
  prev: TapState,
  straightness: number,
  allowFire: boolean,
  tuning: TapTuning = DEFAULT_TAP_TUNING,
): { state: TapState; fired: boolean } {
  let phase = prev.phase;
  let cooldown = prev.cooldown;
  let minStraight = prev.minStraight;
  let curlFrames = prev.curlFrames;
  let fired = false;

  if (cooldown > 0) {
    cooldown -= 1;
    if (cooldown === 0 && phase === 'COOLDOWN') phase = 'IDLE';
  } else if (allowFire) {
    if (phase === 'IDLE' && straightness < tuning.curlEnter) {
      phase = 'CURLING';
      minStraight = straightness;
      curlFrames = 1;
    } else if (phase === 'CURLING') {
      curlFrames += 1;
      if (straightness < minStraight) minStraight = straightness;
      if (curlFrames > tuning.curlMaxFrames) {
        // Slow sustained curl — user is folding the hand, not clicking. Abort.
        phase = 'IDLE';
        minStraight = 1;
        curlFrames = 0;
      } else if (straightness > tuning.curlExit) {
        if (minStraight <= tuning.peakRequired) {
          // Deep-enough curl + crisp release → click.
          phase = 'COOLDOWN';
          cooldown = tuning.cooldownFrames;
          fired = true;
        } else {
          // Shallow wobble — discard without firing.
          phase = 'IDLE';
        }
        minStraight = 1;
        curlFrames = 0;
      }
    }
  } else if (phase === 'CURLING') {
    phase = 'IDLE';
    minStraight = 1;
    curlFrames = 0;
  }

  return { state: { phase, cooldown, minStraight, curlFrames }, fired };
}
