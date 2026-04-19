// One-Euro filter for 2D cursor smoothing. Adaptive low-pass: cutoff increases with velocity, so
// slow, deliberate pointer movement is heavily smoothed (kills landmark jitter) while fast flicks
// stay responsive (no lag). This is what MediaPipe itself uses internally on its tracker outputs.
//
// Reference: Casiez et al. 2012, "1€ filter: A simple speed-based low-pass filter for noisy input"
//
// API is state-object based (no classes) so the gesture state machine can thread filter state
// through its pure reducer.

export interface OneEuroParams {
  // Baseline cutoff frequency (Hz). Lower = smoother at rest, higher = more responsive.
  minCutoff: number;
  // How aggressively the cutoff rises with velocity. Higher = faster cutoff rise = snappier on
  // fast motion.
  beta: number;
  // Derivative smoothing cutoff (Hz). Rarely needs tuning.
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 };

export interface OneEuroState {
  // Previous filtered x and dx (per-axis), and the timestamp of the last sample.
  xHat: { x: number; y: number } | null;
  dxHat: { x: number; y: number };
  tPrev: number;
}

export function createOneEuroState(): OneEuroState {
  return { xHat: null, dxHat: { x: 0, y: 0 }, tPrev: 0 };
}

// Returns a NEW state object so reducer callers can assign atomically. Input `t` is ms.
export function oneEuroStep(
  state: OneEuroState,
  x: number,
  y: number,
  t: number,
  params: OneEuroParams = DEFAULT_ONE_EURO,
): { state: OneEuroState; x: number; y: number } {
  if (state.xHat === null) {
    return {
      state: { xHat: { x, y }, dxHat: { x: 0, y: 0 }, tPrev: t },
      x,
      y,
    };
  }

  const dt = Math.max(1e-3, (t - state.tPrev) / 1000);

  const dxRaw = { x: (x - state.xHat.x) / dt, y: (y - state.xHat.y) / dt };
  const dxHat = {
    x: lowpass(dxRaw.x, state.dxHat.x, alpha(params.dCutoff, dt)),
    y: lowpass(dxRaw.y, state.dxHat.y, alpha(params.dCutoff, dt)),
  };

  const speed = Math.hypot(dxHat.x, dxHat.y);
  const cutoff = params.minCutoff + params.beta * speed;
  const a = alpha(cutoff, dt);

  const xHat = {
    x: lowpass(x, state.xHat.x, a),
    y: lowpass(y, state.xHat.y, a),
  };

  return { state: { xHat, dxHat, tPrev: t }, x: xHat.x, y: xHat.y };
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function lowpass(x: number, prev: number, a: number): number {
  return a * x + (1 - a) * prev;
}
