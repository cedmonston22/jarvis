// Forward-tap click detector. Watches the hand's 2D bounding-box diagonal over time; a rapid
// enlargement pulse means the hand is approaching the camera — fire a click.
//
// Why 2D bbox diagonal, not z-velocity: a wrist rotation changes per-landmark z significantly
// without the hand actually translating toward the camera. The 2D bbox is unaffected by tilts
// (same hand area in the image plane), so it can't confuse tilts for taps the way the old
// z-velocity detector did.
//
// State machine mirrors airTap's shape: IDLE → APPROACHING → COOLDOWN. Fires as soon as peak
// velocity crosses the required threshold (no need to wait for retraction), so the click feels
// responsive. Cooldown prevents a sustained forward motion from firing repeated clicks.

export interface ForwardTapState {
  phase: 'IDLE' | 'APPROACHING' | 'COOLDOWN';
  prevDiagonal: number;        // 0 on first frame; used to bootstrap velocity without a spurious spike
  smoothedVelocity: number;    // EMA-smoothed diagonal-per-frame; noise filter
  firedThisPulse: boolean;     // has the current APPROACHING pulse already fired? (prevents double)
  approachFrames: number;
  cooldown: number;
}

export interface ForwardTapTuning {
  // Velocity (diagonal change per frame, normalized) to enter APPROACHING.
  velocityEnter: number;
  // Velocity below which APPROACHING ends.
  velocityExit: number;
  // Peak velocity required to fire the tap. Higher = more deliberate push needed.
  peakRequired: number;
  // If APPROACHING lasts longer than this, the user is probably just walking closer — bail to
  // cooldown (if we fired) or idle (if we didn't). Prevents slow forward drift from firing.
  approachMaxFrames: number;
  cooldownFrames: number;
  // Weight of prev smoothed velocity (0 = no smoothing, closer to 1 = heavier smoothing). Some
  // smoothing is needed because single-frame diagonal measurements jitter with MediaPipe noise.
  velocitySmoothing: number;
}

export const DEFAULT_FORWARD_TAP_TUNING: ForwardTapTuning = {
  velocityEnter: 0.015,
  velocityExit: 0.006,
  peakRequired: 0.025,
  approachMaxFrames: 8,
  cooldownFrames: 7,
  velocitySmoothing: 0.4,
};

export function createForwardTapState(): ForwardTapState {
  return {
    phase: 'IDLE',
    prevDiagonal: 0,
    smoothedVelocity: 0,
    firedThisPulse: false,
    approachFrames: 0,
    cooldown: 0,
  };
}

// Pure reducer. `bboxDiagonal` is sqrt(bbox.width² + bbox.height²) in the same normalized [0,1]
// coord space the landmarks live in. `allowFire` mirrors airTap's clickOk — held false while
// pinching/dragging to prevent accidental taps from hand motion inherent to those gestures.
export function stepForwardTapDetector(
  prev: ForwardTapState,
  bboxDiagonal: number,
  allowFire: boolean,
  tuning: ForwardTapTuning = DEFAULT_FORWARD_TAP_TUNING,
): { state: ForwardTapState; fired: boolean } {
  // First frame: no history to derive velocity from. Seed prevDiagonal and return without firing.
  if (prev.prevDiagonal === 0) {
    return { state: { ...prev, prevDiagonal: bboxDiagonal }, fired: false };
  }

  const rawVelocity = bboxDiagonal - prev.prevDiagonal;
  const smoothedVelocity =
    (1 - tuning.velocitySmoothing) * rawVelocity +
    tuning.velocitySmoothing * prev.smoothedVelocity;

  let phase = prev.phase;
  let firedThisPulse = prev.firedThisPulse;
  let approachFrames = prev.approachFrames;
  let cooldown = prev.cooldown;
  let firedThisFrame = false;

  if (cooldown > 0) {
    cooldown -= 1;
    if (cooldown === 0 && phase === 'COOLDOWN') phase = 'IDLE';
  } else if (!allowFire) {
    // Not allowed to fire right now (e.g., user is pinching). Hold in IDLE.
    phase = 'IDLE';
    firedThisPulse = false;
    approachFrames = 0;
  } else {
    if (phase === 'IDLE' && smoothedVelocity > tuning.velocityEnter) {
      phase = 'APPROACHING';
      firedThisPulse = false;
      approachFrames = 1;
    } else if (phase === 'APPROACHING') {
      approachFrames += 1;
      if (!firedThisPulse && smoothedVelocity >= tuning.peakRequired) {
        firedThisPulse = true;
        firedThisFrame = true;
      }
      if (smoothedVelocity < tuning.velocityExit) {
        // Pulse ended. If we already fired, cooldown; otherwise it was noise, go idle.
        phase = firedThisPulse ? 'COOLDOWN' : 'IDLE';
        cooldown = firedThisPulse ? tuning.cooldownFrames : 0;
        approachFrames = 0;
        firedThisPulse = false;
      } else if (approachFrames > tuning.approachMaxFrames) {
        // Sustained motion, not a tap. Cooldown prevents re-firing while user keeps approaching.
        phase = 'COOLDOWN';
        cooldown = tuning.cooldownFrames;
        approachFrames = 0;
        firedThisPulse = false;
      }
    }
  }

  return {
    state: {
      phase,
      prevDiagonal: bboxDiagonal,
      smoothedVelocity,
      firedThisPulse,
      approachFrames,
      cooldown,
    },
    fired: firedThisFrame,
  };
}
