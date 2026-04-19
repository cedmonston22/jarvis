import { useEffect, useRef } from 'react';
import { HAND_CONNECTIONS, FINGERTIPS } from '@/gestures/handTopology';
import { useGestureBus } from '@/gestures/useGestureBus';
import type { Hands } from '@/gestures/types';
import type { Mode } from '@/gestures/stateMachine';

export interface HandOverlayProps {
  landmarksRef: React.MutableRefObject<Hands>;
  modeRef: React.MutableRefObject<Mode>;
  visible: boolean;
}

// Debug visualization of the MediaPipe hand skeleton. Owns its own RAF loop so it can clear +
// redraw independently of the main camera canvas. Reads from shared refs — no React state is
// touched per frame.
//
// The index fingertip rendering doubles as the cursor indicator: it's the "finger is the cursor"
// feedback the user sees. Its color and size encode the current gesture mode so the user knows
// the state machine recognizes their pose without a separate on-screen cursor.
interface Ripple {
  x: number;
  y: number;
  bornAt: number; // performance.now() when the click fired
}

export function HandOverlay({ landmarksRef, modeRef, visible }: HandOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const bus = useGestureBus();

  useEffect(() => {
    // Push a ripple for every click. Always on — independent of the debug overlay toggle so
    // click feedback remains visible even with dots hidden.
    return bus.subscribe((e) => {
      if (e.type === 'click') {
        ripplesRef.current.push({ x: e.x, y: e.y, bornAt: performance.now() });
      }
    });
  }, [bus]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    const tick = () => {
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);
      if (visible) drawHands(ctx, landmarksRef.current, modeRef.current, cw, ch);
      drawRipples(ctx, ripplesRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [visible, landmarksRef, modeRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 h-full w-full"
      style={{ zIndex: 40 }}
    />
  );
}

const NON_INDEX_TIPS = new Set<number>([
  FINGERTIPS.thumb,
  FINGERTIPS.middle,
  FINGERTIPS.ring,
  FINGERTIPS.pinky,
]);

function drawHands(
  ctx: CanvasRenderingContext2D,
  hands: Hands,
  mode: Mode,
  cw: number,
  ch: number,
): void {
  const pinchActive = mode === 'PINCH_DOWN' || mode === 'DRAGGING';
  const pointingActive = mode === 'POINTING' || pinchActive;

  for (const hand of hands) {
    // Skeleton lines
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(124, 200, 255, 0.55)';
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = hand[a];
      const pb = hand[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x * cw, pa.y * ch);
      ctx.lineTo(pb.x * cw, pb.y * ch);
    }
    ctx.stroke();

    // Non-index landmarks: small muted dots
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    for (let i = 0; i < hand.length; i++) {
      if (i === FINGERTIPS.index) continue;
      const p = hand[i];
      ctx.beginPath();
      ctx.arc(p.x * cw, p.y * ch, NON_INDEX_TIPS.has(i) ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Index fingertip — the "cursor". Color + ring encode gesture mode.
    const tip = hand[FINGERTIPS.index];
    const cx = tip.x * cw;
    const cy = tip.y * ch;
    drawFingertipCursor(ctx, cx, cy, { pointingActive, pinchActive, zooming: mode === 'ZOOMING' });
  }
}

function drawFingertipCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  flags: { pointingActive: boolean; pinchActive: boolean; zooming: boolean },
) {
  const { pointingActive, pinchActive, zooming } = flags;

  // Outer ring — shows "engaged" (accent) vs "idle" (muted white) and grows on pinch.
  ctx.beginPath();
  ctx.lineWidth = pinchActive ? 3 : 2;
  ctx.strokeStyle = pinchActive
    ? 'rgba(124, 200, 255, 1)'
    : pointingActive
      ? 'rgba(124, 200, 255, 0.85)'
      : 'rgba(255, 255, 255, 0.5)';
  const outerR = pinchActive ? 14 : pointingActive ? 11 : 9;
  ctx.arc(x, y, outerR, 0, Math.PI * 2);
  ctx.stroke();

  // Inner dot — solid fill on pinch, dot otherwise.
  ctx.beginPath();
  ctx.fillStyle = pinchActive
    ? 'rgba(124, 200, 255, 0.95)'
    : pointingActive
      ? 'rgba(124, 200, 255, 0.9)'
      : 'rgba(255, 255, 255, 0.9)';
  ctx.arc(x, y, pinchActive ? 7 : 4, 0, Math.PI * 2);
  ctx.fill();

  if (zooming) {
    // Pulsing second ring when spreading for zoom.
    const t = (performance.now() / 400) % 1;
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(124, 200, 255, ${0.6 * (1 - t)})`;
    ctx.arc(x, y, 11 + t * 14, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const RIPPLE_DURATION_MS = 450;

function drawRipples(ctx: CanvasRenderingContext2D, ripples: Ripple[]): void {
  const now = performance.now();
  // Remove expired ripples in-place.
  let write = 0;
  for (let read = 0; read < ripples.length; read++) {
    const r = ripples[read];
    const age = now - r.bornAt;
    if (age < RIPPLE_DURATION_MS) {
      ripples[write++] = r;
      const t = age / RIPPLE_DURATION_MS;
      const radius = 14 + t * 60;
      const alpha = 0.75 * (1 - t);
      ctx.beginPath();
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.strokeStyle = `rgba(124, 200, 255, ${alpha})`;
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ripples.length = write;
}
