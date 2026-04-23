// Minimal typed event bus for gesture events. Per the architecture rule: per-frame landmark data
// lives in refs; only these discrete events bridge from the frame loop into React state.
//
// Kept intentionally tiny — one `subscribe(fn)` that returns an unsubscribe function, one
// `emit(event)`. No priority, no once, no wildcard matching.

export interface BimanualPoint {
  x: number;
  y: number;
}

export type GestureEvent =
  | { type: 'pointer:move'; x: number; y: number }
  | { type: 'click'; x: number; y: number }
  | { type: 'pinch:down'; x: number; y: number }
  | { type: 'pinch:up'; x: number; y: number }
  | { type: 'drag:start'; x: number; y: number }
  | { type: 'drag:move'; x: number; y: number }
  | { type: 'drag:end'; x: number; y: number }
  // Bimanual pinch — fires when both hands are pinching simultaneously. Start captures the
  // initial pair of midpoints; move updates continuously; end fires when either hand releases.
  // Used for two-hand zoom (scale windows) and eventually two-corner resize.
  | { type: 'bimanual:pinch:start'; a: BimanualPoint; b: BimanualPoint }
  | { type: 'bimanual:pinch:move'; a: BimanualPoint; b: BimanualPoint }
  | { type: 'bimanual:pinch:end' }
  // Per-hand pinch state. Fires alongside the bimanual events so consumers can light up
  // individual anchor visuals as each hand enters / moves / leaves a pinch. `hand` is the
  // landmark index (0 = primary, 1 = secondary).
  | { type: 'hand:pinch:start'; hand: number; x: number; y: number }
  | { type: 'hand:pinch:move'; hand: number; x: number; y: number }
  | { type: 'hand:pinch:end'; hand: number }
  // Per-hand three-finger pinch (thumb+index+middle). Used for bimanual resize/zoom anchors —
  // grip handles glow only while this stricter pose is held, so the user sees exactly when a
  // resize is armed. Midpoint is the centroid of the three tips.
  | { type: 'hand:triPinch:start'; hand: number; x: number; y: number }
  | { type: 'hand:triPinch:move'; hand: number; x: number; y: number }
  | { type: 'hand:triPinch:end'; hand: number };

export type GestureListener = (event: GestureEvent) => void;

export interface GestureBus {
  subscribe(listener: GestureListener): () => void;
  emit(event: GestureEvent): void;
}

export function createGestureBus(): GestureBus {
  const listeners = new Set<GestureListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const l of listeners) l(event);
    },
  };
}

// Stub bus for "gesture-disabled" subtrees. Used to isolate non-front windows from the gesture
// stream: PinchTarget / AppFrame / any bus consumer inside such a subtree subscribes to this
// instead of the real bus, receives nothing, and emits into a sink — so back windows can't be
// clicked, dragged, or scrolled without first being brought to front.
export function createStubBus(): GestureBus {
  return {
    subscribe() {
      return () => {};
    },
    emit() {},
  };
}
