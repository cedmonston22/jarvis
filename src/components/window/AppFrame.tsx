import { useEffect, useRef, type ReactNode } from 'react';
import { useGestureBus } from '@/gestures/useGestureBus';

// Thin wrapper around an app's rendered content. Gives apps a consistent scroll region and
// isolates the body from the window chrome's layout. Exists as its own component so M10's apps
// can style against a stable contract rather than Window internals.
//
// `zoom` applies a CSS scale transform to the inner content — driven by the five-finger zoom
// gesture. The wrapper itself doesn't resize (preserves window chrome alignment); only the
// scaled content overflows visually and scrolls if it doesn't fit.
//
// Gesture scroll: a pinch-and-drag that starts *anywhere inside the scroll container* pans it
// (both axes). Clicks still fire for in-body PinchTargets because the gesture state machine
// promotes pinch → drag only after the midpoint moves ≈4% of the hand bbox — a deliberate
// pinch-and-release stays below the threshold and fires onClick as usual.
//
// The scroll handler only bails when the pinch landed on a PinchTarget that's OUTSIDE the scroll
// container (e.g. the single-hand resize grabber or a grip anchor in Window.tsx). Those are
// structural window chrome and keep owning their drags.
export interface AppFrameProps {
  children: ReactNode;
  zoom?: number;
}

export function AppFrame({ children, zoom = 1 }: AppFrameProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bus = useGestureBus();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Latched at pinch:down. Holds initial scroll offsets + pinch (x, y) so drag:move can compute
    // an absolute delta each frame rather than accumulating deltas (avoids drift).
    let start: { scrollTop: number; scrollLeft: number; x: number; y: number } | null = null;

    const contains = (x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    // True when the pinch hit a PinchTarget that is structurally *outside* our scroll container
    // (resize grabber, grip anchors, title bar). Those own their own drags; we must not steal.
    // PinchTargets INSIDE the body (chips, track rows) don't block scroll — they're click-only and
    // a drag over them is naturally a scroll intent.
    const pinchLandedOnExternalTarget = (x: number, y: number): boolean => {
      const point = document.elementFromPoint(x, y);
      if (!point) return false;
      const target = point.closest('[data-pinch-target="true"]');
      return !!target && !el.contains(target);
    };

    return bus.subscribe((e) => {
      switch (e.type) {
        case 'pinch:down':
          if (contains(e.x, e.y) && !pinchLandedOnExternalTarget(e.x, e.y)) {
            start = {
              scrollTop: el.scrollTop,
              scrollLeft: el.scrollLeft,
              x: e.x,
              y: e.y,
            };
          }
          break;
        case 'drag:move':
          if (start) {
            // Natural-feeling direction on both axes: drag up → scroll down, drag left → scroll
            // right. Browser clamps against [0, scrollHeight-clientHeight] so over-scroll is a
            // no-op rather than an error.
            el.scrollTop = start.scrollTop - (e.y - start.y);
            el.scrollLeft = start.scrollLeft - (e.x - start.x);
          }
          break;
        case 'drag:end':
        case 'pinch:up':
          start = null;
          break;
      }
    });
  }, [bus]);

  return (
    <div
      ref={scrollRef}
      className="gesture-scroll h-full min-h-0 w-full flex-1 overflow-auto"
    >
      <div
        className="h-full w-full origin-top-left px-4 py-3"
        style={{ transform: zoom === 1 ? undefined : `scale(${zoom})` }}
      >
        {children}
      </div>
    </div>
  );
}
