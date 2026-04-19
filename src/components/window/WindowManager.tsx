import { useEffect, useRef, useState } from 'react';
import { Window, type Grip } from './Window';
import { useWindowStore, type WindowState } from '@/stores/windowStore';
import { useGestureBus } from '@/gestures/useGestureBus';

// Resize sessions come in three flavors based on which opposing grip-pair the user grabbed:
//   - 'resize-2d'     TL↔BR or TR↔BL: proportional 2D scale (aspect preserved)
//   - 'resize-horizontal' L↔R: width only
//   - 'resize-vertical'   T↔B: height only
type ResizeSession =
  | {
      kind: 'resize-2d';
      targetId: string;
      grips: [Grip, Grip];
      initialDist: number;
      initialWidth: number;
      initialHeight: number;
      centerX: number;
      centerY: number;
    }
  | {
      kind: 'resize-horizontal';
      targetId: string;
      grips: [Grip, Grip];
      initialHorzDist: number;
      initialWidth: number;
      centerX: number;
    }
  | {
      kind: 'resize-vertical';
      targetId: string;
      grips: [Grip, Grip];
      initialVertDist: number;
      initialHeight: number;
      centerY: number;
    };

type ZoomSession = {
  kind: 'zoom';
  targetId: string;
  initialHorzDist: number;
  initialZoom: number;
};

type BimanualSession = ResizeSession | ZoomSession;

// Each axis is split into outer-20%/middle-60%/outer-20%. Zones OVERLAP: a pinch at top-left
// satisfies top + left + TL all at once. The generous middle 60% is the zoom zone.
function gripZonesAtFraction(fx: number, fy: number): Set<Grip> {
  const zones = new Set<Grip>();
  const top = fy < 0.2;
  const bottom = fy > 0.8;
  const left = fx < 0.2;
  const right = fx > 0.8;
  if (top) zones.add('T');
  if (bottom) zones.add('B');
  if (left) zones.add('L');
  if (right) zones.add('R');
  if (top && left) zones.add('TL');
  if (top && right) zones.add('TR');
  if (bottom && left) zones.add('BL');
  if (bottom && right) zones.add('BR');
  return zones;
}

function classifyPair(
  zonesA: Set<Grip>,
  zonesB: Set<Grip>,
):
  | { kind: 'resize-2d' | 'resize-horizontal' | 'resize-vertical'; gripA: Grip; gripB: Grip }
  | null {
  if (zonesA.has('TL') && zonesB.has('BR')) return { kind: 'resize-2d', gripA: 'TL', gripB: 'BR' };
  if (zonesA.has('BR') && zonesB.has('TL')) return { kind: 'resize-2d', gripA: 'BR', gripB: 'TL' };
  if (zonesA.has('TR') && zonesB.has('BL')) return { kind: 'resize-2d', gripA: 'TR', gripB: 'BL' };
  if (zonesA.has('BL') && zonesB.has('TR')) return { kind: 'resize-2d', gripA: 'BL', gripB: 'TR' };
  if (zonesA.has('L') && zonesB.has('R')) return { kind: 'resize-horizontal', gripA: 'L', gripB: 'R' };
  if (zonesA.has('R') && zonesB.has('L')) return { kind: 'resize-horizontal', gripA: 'R', gripB: 'L' };
  if (zonesA.has('T') && zonesB.has('B')) return { kind: 'resize-vertical', gripA: 'T', gripB: 'B' };
  if (zonesA.has('B') && zonesB.has('T')) return { kind: 'resize-vertical', gripA: 'B', gripB: 'T' };
  return null;
}

function pointInWindow(x: number, y: number, w: WindowState): boolean {
  return x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height;
}

function findWindowAt(
  x: number,
  y: number,
  wins: Record<string, WindowState>,
  order: readonly string[],
): WindowState | null {
  for (let i = order.length - 1; i >= 0; i--) {
    const w = wins[order[i]];
    if (w && pointInWindow(x, y, w)) return w;
  }
  return null;
}

// Build a bimanual session from the two pinch midpoints. Returns the best-matching resize
// session, or a zoom fallback when `allowZoomFallback=true` and the hands are over the same
// window but not on a valid opposing grip pair.
//
// Called both at `bimanual:pinch:start` (fallback allowed — we always want *some* session
// committed so the user can engage zoom with hands in the middle) and at `bimanual:pinch:move`
// (fallback forbidden — we only upgrade to a real resize, never downgrade or spontaneously
// commit to zoom mid-gesture).
function classifyBimanual(
  a: { x: number; y: number },
  b: { x: number; y: number },
  allowZoomFallback: boolean,
): BimanualSession | null {
  const { windows: wins, focusOrder: order } = useWindowStore.getState();
  const winA = findWindowAt(a.x, a.y, wins, order);
  const winB = findWindowAt(b.x, b.y, wins, order);
  if (!winA || !winB || winA.id !== winB.id) return null;
  const w = winA;

  const zonesA = gripZonesAtFraction((a.x - w.x) / w.width, (a.y - w.y) / w.height);
  const zonesB = gripZonesAtFraction((b.x - w.x) / w.width, (b.y - w.y) / w.height);
  const match = classifyPair(zonesA, zonesB);

  if (match) {
    const { kind, gripA, gripB } = match;
    if (kind === 'resize-2d') {
      return {
        kind: 'resize-2d',
        targetId: w.id,
        grips: [gripA, gripB],
        initialDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        initialWidth: w.width,
        initialHeight: w.height,
        centerX: w.x + w.width / 2,
        centerY: w.y + w.height / 2,
      };
    }
    if (kind === 'resize-horizontal') {
      return {
        kind: 'resize-horizontal',
        targetId: w.id,
        grips: [gripA, gripB],
        initialHorzDist: Math.abs(a.x - b.x) || 1,
        initialWidth: w.width,
        centerX: w.x + w.width / 2,
      };
    }
    return {
      kind: 'resize-vertical',
      targetId: w.id,
      grips: [gripA, gripB],
      initialVertDist: Math.abs(a.y - b.y) || 1,
      initialHeight: w.height,
      centerY: w.y + w.height / 2,
    };
  }

  if (!allowZoomFallback) return null;
  const initialHorzDist = Math.abs(a.x - b.x);
  if (initialHorzDist < 1) return null;
  return { kind: 'zoom', targetId: w.id, initialHorzDist, initialZoom: w.zoom };
}

// Shallow equality for Map<string, Set<Grip>>. Used to skip React re-renders when the per-window
// active-grip aggregation hasn't actually changed frame-to-frame.
function sameGripMap(a: Map<string, ReadonlySet<Grip>>, b: Map<string, ReadonlySet<Grip>>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb || vb.size !== va.size) return false;
    for (const g of va) if (!vb.has(g)) return false;
  }
  return true;
}

export function WindowManager() {
  const windows = useWindowStore((s) => s.windows);
  const focusOrder = useWindowStore((s) => s.focusOrder);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const bus = useGestureBus();

  const bimanualSessionRef = useRef<BimanualSession | null>(null);

  // Per-hand current position: which window each pinching hand is over + which grip zones it
  // occupies. Updated from hand:pinch:start / :move / :end events. Ref because it changes every
  // frame; we only promote to React state when the DERIVED per-window grip sets actually change.
  const handPosRef = useRef<Map<number, { windowId: string; zones: Set<Grip> }>>(new Map());

  // Per-window active grip set = union of all currently-pinching hands' grip zones on that window.
  // Drives the glowing anchors on each Window. Using a Map so we can pass per-window sets cheaply.
  const [activeGripsByWindow, setActiveGripsByWindow] = useState<
    Map<string, ReadonlySet<Grip>>
  >(new Map());

  useEffect(() => {
    const recomputeActiveGrips = () => {
      const next = new Map<string, Set<Grip>>();
      for (const info of handPosRef.current.values()) {
        const existing = next.get(info.windowId) ?? new Set<Grip>();
        for (const g of info.zones) existing.add(g);
        next.set(info.windowId, existing);
      }
      setActiveGripsByWindow((prev) => (sameGripMap(prev, next) ? prev : next));
    };

    const updateHandPosition = (hand: number, x: number, y: number) => {
      const { windows: wins, focusOrder: order } = useWindowStore.getState();
      const win = findWindowAt(x, y, wins, order);
      if (!win) {
        handPosRef.current.delete(hand);
      } else {
        const zones = gripZonesAtFraction((x - win.x) / win.width, (y - win.y) / win.height);
        handPosRef.current.set(hand, { windowId: win.id, zones });
      }
    };

    const unsub = bus.subscribe((e) => {
      if (e.type === 'pinch:down') {
        const { windows: wins, focusOrder: order } = useWindowStore.getState();
        const hit = findWindowAt(e.x, e.y, wins, order);
        if (hit) focusWindow(hit.id);
        return;
      }

      if (e.type === 'hand:pinch:start' || e.type === 'hand:pinch:move') {
        updateHandPosition(e.hand, e.x, e.y);
        recomputeActiveGrips();
        return;
      }
      if (e.type === 'hand:pinch:end') {
        handPosRef.current.delete(e.hand);
        recomputeActiveGrips();
        return;
      }

      if (e.type === 'bimanual:pinch:start') {
        bimanualSessionRef.current = classifyBimanual(e.a, e.b, true);
        return;
      }

      if (e.type === 'bimanual:pinch:move') {
        // Mid-gesture upgrade: if the user pinched-down before landing both hands on a grip pair
        // (so we committed to zoom, or nothing), re-check each frame. The moment both hands are
        // over a valid opposing grip pair, swap to a resize session anchored to the current
        // positions. We never downgrade a resize back to zoom — once upgraded, it locks.
        let session = bimanualSessionRef.current;
        if (!session || session.kind === 'zoom') {
          const upgrade = classifyBimanual(e.a, e.b, false);
          if (upgrade && upgrade.kind !== 'zoom') {
            session = upgrade;
            bimanualSessionRef.current = upgrade;
          }
        }
        if (!session) return;
        const { windows: wins } = useWindowStore.getState();
        const win = wins[session.targetId];
        if (!win) return;

        if (session.kind === 'zoom') {
          const currentHorzDist = Math.abs(e.a.x - e.b.x);
          const targetZoom = session.initialZoom * (currentHorzDist / session.initialHorzDist);
          useWindowStore.getState().zoomWindow(session.targetId, targetZoom - win.zoom);
          return;
        }

        if (session.kind === 'resize-2d') {
          const currentDist = Math.hypot(e.a.x - e.b.x, e.a.y - e.b.y);
          const scale = currentDist / session.initialDist;
          const newWidth = session.initialWidth * scale;
          const newHeight = session.initialHeight * scale;
          useWindowStore
            .getState()
            .moveWindow(session.targetId, session.centerX - newWidth / 2, session.centerY - newHeight / 2);
          useWindowStore.getState().resizeWindow(session.targetId, newWidth, newHeight);
          return;
        }

        if (session.kind === 'resize-horizontal') {
          const currentHorzDist = Math.abs(e.a.x - e.b.x);
          const newWidth = session.initialWidth * (currentHorzDist / session.initialHorzDist);
          useWindowStore
            .getState()
            .moveWindow(session.targetId, session.centerX - newWidth / 2, win.y);
          useWindowStore.getState().resizeWindow(session.targetId, newWidth, win.height);
          return;
        }

        const currentVertDist = Math.abs(e.a.y - e.b.y);
        const newHeight = session.initialHeight * (currentVertDist / session.initialVertDist);
        useWindowStore
          .getState()
          .moveWindow(session.targetId, win.x, session.centerY - newHeight / 2);
        useWindowStore.getState().resizeWindow(session.targetId, win.width, newHeight);
        return;
      }

      if (e.type === 'bimanual:pinch:end') {
        bimanualSessionRef.current = null;
      }
    });
    return unsub;
  }, [bus, focusWindow]);

  return (
    <>
      {focusOrder.map((id, i) => {
        const win = windows[id];
        if (!win) return null;
        // z-index base of 20 keeps windows above the background canvas (z=0) but below the
        // subject canvas (z=30) so a re-enabled segmenter puts the user's hand in front.
        return (
          <Window
            key={id}
            win={win}
            zIndex={20 + i}
            activeGrips={activeGripsByWindow.get(id)}
          />
        );
      })}
    </>
  );
}
