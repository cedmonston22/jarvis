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

// Visual smoothing factor for the dots/skeleton. 0..1 — lower = smoother but laggier. Kept
// display-only so the gesture detectors continue to see unsmoothed landmarks (click/pinch
// detection depends on sharp transitions).
const DISPLAY_SMOOTH_ALPHA = 0.55;

export function HandOverlay({ landmarksRef, modeRef, visible }: HandOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const smoothedRef = useRef<Hands>([]);
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
      const raw = landmarksRef.current;
      // Per-landmark EMA smoothing for display only. Big jumps between frames (hand swaps,
      // appear/disappear) reset the smoother for that slot so we don't chase a phantom.
      const smoothed = smoothedRef.current;
      if (smoothed.length !== raw.length) {
        smoothedRef.current = raw.map((h) => h.map((p) => ({ ...p })));
      } else {
        for (let h = 0; h < raw.length; h++) {
          for (let i = 0; i < raw[h].length; i++) {
            const r = raw[h][i];
            const s = smoothed[h][i];
            const dx = r.x - s.x;
            const dy = r.y - s.y;
            // Reset if the landmark jumped too far in one frame (likely a hand swap).
            if (Math.hypot(dx, dy) > 0.2) {
              s.x = r.x; s.y = r.y; s.z = r.z;
            } else {
              s.x = DISPLAY_SMOOTH_ALPHA * r.x + (1 - DISPLAY_SMOOTH_ALPHA) * s.x;
              s.y = DISPLAY_SMOOTH_ALPHA * r.y + (1 - DISPLAY_SMOOTH_ALPHA) * s.y;
              s.z = DISPLAY_SMOOTH_ALPHA * r.z + (1 - DISPLAY_SMOOTH_ALPHA) * s.z;
            }
          }
        }
      }
      if (visible) drawHands(ctx, smoothedRef.current, modeRef.current, cw, ch);
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

const FINGERTIP_IDX = new Set<number>([
  FINGERTIPS.thumb,
  FINGERTIPS.index,
  FINGERTIPS.middle,
  FINGERTIPS.ring,
  FINGERTIPS.pinky,
]);

function drawHands(
  ctx: CanvasRenderingContext2D,
  hands: Hands,
  _mode: Mode,
  cw: number,
  ch: number,
): void {
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

    // All landmark dots the same — small white. Gesture state is communicated via the tile
    // highlight, not the fingertip, so the cursor stays clean.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < hand.length; i++) {
      const p = hand[i];
      ctx.beginPath();
      ctx.arc(p.x * cw, p.y * ch, FINGERTIP_IDX.has(i) ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
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
