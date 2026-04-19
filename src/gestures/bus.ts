// Minimal typed event bus for gesture events. Per the architecture rule: per-frame landmark data
// lives in refs; only these discrete events bridge from the frame loop into React state.
//
// Kept intentionally tiny — one `subscribe(fn)` that returns an unsubscribe function, one
// `emit(event)`. No priority, no once, no wildcard matching.

export type GestureEvent =
  | { type: 'pointer:move'; x: number; y: number }
  | { type: 'click'; x: number; y: number }
  | { type: 'pinch:down'; x: number; y: number }
  | { type: 'pinch:up'; x: number; y: number }
  | { type: 'drag:start'; x: number; y: number }
  | { type: 'drag:move'; x: number; y: number }
  | { type: 'drag:end'; x: number; y: number }
  | { type: 'zoom:delta'; delta: number };

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
