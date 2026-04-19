import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import clsx from 'clsx';
import { useGestureBus } from '@/gestures/useGestureBus';

export interface PinchTargetProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  // Drag hooks. When the user pinches while the fingertip is inside this target and then drags,
  // onDragStart fires once on drag commit, onDragDelta fires every frame with cumulative (dx, dy)
  // in viewport px relative to pinch-start, onDragEnd fires on release. Consumer stores the final
  // offset however it likes.
  onDragStart?: () => void;
  onDragDelta?: (dx: number, dy: number) => void;
  onDragEnd?: () => void;
  // Live drag offset applied to the element's transform (in viewport px). Combined with the
  // hover/press scale and any transform in `style`. Callers that don't support drag pass nothing.
  dragOffset?: { x: number; y: number };
}

// Hit-testable element that reacts to the fingertip via bus events.
//   pointer:move → hover state if fingertip is inside our rect
//   click        → onClick (from finger-curl detector)
//   pinch:down  → pressed state (start of a possible drag)
//   drag:start  → onDragStart (only fires if pinch started over us)
//   drag:move   → onDragDelta with cumulative offset from pinch-start
//   pinch:up / drag:end → release + onDragEnd
//
// Callbacks are held in refs so the bus subscription stays stable across renders — consumers can
// pass inline closures (e.g. that capture drag state) without causing the subscription to churn
// at 30Hz and drop events.
export function PinchTarget({
  children,
  className,
  style,
  onClick,
  onDragStart,
  onDragDelta,
  onDragEnd,
  dragOffset,
}: PinchTargetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);
  const pressedRef = useRef(false);
  const pinchStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const bus = useGestureBus();

  // Event-handler refs: updated on every render, read inside the stable subscription.
  const handlersRef = useRef({ onClick, onDragStart, onDragDelta, onDragEnd });
  handlersRef.current = { onClick, onDragStart, onDragDelta, onDragEnd };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const contains = (x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    // Release is called on pinch:up or drag:end. Three outcomes:
    //   - Was dragging → fire onDragEnd.
    //   - Was pressed but never dragged, and release point still over us → treat as a click.
    //     This makes a quick pinch-and-release function as a click, alongside the finger-curl
    //     click detector. Two input modalities, same onClick handler.
    //   - Neither → silent reset.
    const release = (releaseX?: number, releaseY?: number) => {
      const h = handlersRef.current;
      if (draggingRef.current) {
        h.onDragEnd?.();
      } else if (
        pressedRef.current &&
        h.onClick &&
        releaseX !== undefined &&
        releaseY !== undefined &&
        contains(releaseX, releaseY)
      ) {
        h.onClick();
      }
      draggingRef.current = false;
      pinchStartRef.current = null;
      pressedRef.current = false;
      setPressed(false);
    };

    const unsub = bus.subscribe((e) => {
      const h = handlersRef.current;
      switch (e.type) {
        case 'pointer:move': {
          const over = contains(e.x, e.y);
          if (over !== hoveredRef.current) {
            hoveredRef.current = over;
            setHovered(over);
          }
          break;
        }
        case 'click': {
          if (contains(e.x, e.y)) {
            setPressed(true);
            window.setTimeout(() => setPressed(false), 120);
            h.onClick?.();
          }
          break;
        }
        case 'pinch:down': {
          if (contains(e.x, e.y)) {
            pressedRef.current = true;
            setPressed(true);
            pinchStartRef.current = { x: e.x, y: e.y };
          }
          break;
        }
        case 'drag:start': {
          if (pinchStartRef.current) {
            draggingRef.current = true;
            h.onDragStart?.();
          }
          break;
        }
        case 'drag:move': {
          if (draggingRef.current && pinchStartRef.current && h.onDragDelta) {
            h.onDragDelta(e.x - pinchStartRef.current.x, e.y - pinchStartRef.current.y);
          }
          break;
        }
        case 'drag:end':
        case 'pinch:up': {
          if (pressedRef.current || draggingRef.current) release(e.x, e.y);
          break;
        }
      }
    });
    return unsub;
  }, [bus]);

  // Compose the final transform. Caller's `style.transform` (typically a centering translate like
  // `translate(-50%, -50%)`) applies first; drag offset and hover/press scale stack inside it.
  const scale = hovered || pressed ? 1.04 : 1;
  const dragTx = dragOffset?.x ?? 0;
  const dragTy = dragOffset?.y ?? 0;
  const baseTransform = style?.transform ?? '';
  const composed = `${baseTransform} translate(${dragTx}px, ${dragTy}px) scale(${scale})`.trim();

  return (
    <div
      ref={ref}
      // Marker attribute — lets the window body's scroll handler hit-test via
      // `document.elementFromPoint(...)` and refuse to pan-scroll when the pinch started on an
      // interactive target (chip, button, track row). Without it, scrolling would steal drags
      // that were meant as clicks or drags on the target itself.
      data-pinch-target="true"
      style={{
        ...style,
        transform: composed,
        transition: draggingRef.current ? 'none' : 'transform 150ms ease, box-shadow 150ms ease',
      }}
      className={clsx(
        'select-none rounded-2xl border',
        'border-white/15 bg-white/5 backdrop-blur-md',
        // Both hover and press share the accent glow; press is brighter + thicker border so the
        // user can clearly see a tile is grabbed.
        hovered && !pressed && 'border-jarvis-accent/70 bg-white/10 shadow-[0_0_0_2px_rgba(124,200,255,0.25)]',
        pressed && 'border-jarvis-accent bg-jarvis-accent/25 shadow-[0_0_0_3px_rgba(124,200,255,0.5)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
