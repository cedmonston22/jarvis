import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import clsx from 'clsx';
import { useGestureBus } from '@/gestures/useGestureBus';

export interface PinchTargetProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

// A hit-testable element that reacts to the fingertip. Subscribes to the gesture bus:
//   - pointer:move  → hover state if fingertip is inside our rect
//   - pinch:down   → pressed state if we were being hovered at pinch-start
//   - pinch:up     → if still pressed, commit onClick, then release
// Hit-testing uses getBoundingClientRect() fresh on each event so layout changes (resize, scroll,
// parent transforms) are picked up automatically.
//
// Hover/press are component-local state (not a store) because only this element cares — React's
// re-render cost is only paid on transition.
export function PinchTarget({ children, className, style, onClick }: PinchTargetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);
  const pressedRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const bus = useGestureBus();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const contains = (x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const unsub = bus.subscribe((e) => {
      switch (e.type) {
        case 'pointer:move': {
          const h = contains(e.x, e.y);
          if (h !== hoveredRef.current) {
            hoveredRef.current = h;
            setHovered(h);
          }
          break;
        }
        case 'click': {
          // Air-tap click. Briefly flash the pressed state as visual confirmation, then release.
          if (contains(e.x, e.y)) {
            setPressed(true);
            window.setTimeout(() => setPressed(false), 120);
            onClick?.();
          }
          break;
        }
        case 'pinch:down': {
          // Pinch initiates a grab (drag) — no click. Still show a pressed visual so the user
          // knows the system saw their grab attempt.
          if (contains(e.x, e.y)) {
            pressedRef.current = true;
            setPressed(true);
          }
          break;
        }
        case 'pinch:up':
        case 'drag:end': {
          if (pressedRef.current) {
            pressedRef.current = false;
            setPressed(false);
          }
          break;
        }
      }
    });
    return unsub;
  }, [bus, onClick]);

  return (
    <div
      ref={ref}
      style={style}
      className={clsx(
        'select-none rounded-2xl border transition-[transform,border-color,background-color,box-shadow] duration-150',
        'border-white/15 bg-white/5 backdrop-blur-md',
        hovered && !pressed && 'scale-[1.03] border-jarvis-accent/70 bg-white/10 shadow-[0_0_0_2px_rgba(124,200,255,0.25)]',
        pressed && 'scale-[0.97] border-jarvis-accent bg-jarvis-accent/20',
        className,
      )}
    >
      {children}
    </div>
  );
}
