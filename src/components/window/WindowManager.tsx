import { useEffect, useRef, useState } from 'react';
import { Window, type Grip } from './Window';
import { useWindowStore, type WindowState } from '@/stores/windowStore';
import { useGestureBus } from '@/gestures/useGestureBus';

// Tri-pinch driven window sessions.
//   - 1 hand tri-pinching on a grip zone (T/B/L/R or a corner) → move the window. Grabbing
//     anywhere in the window's middle 60% with one hand does nothing — requiring a handle keeps
//     a stray mid-window tri-pinch from starting an accidental drag.
//   - 2 hands on matching grip zones → bimanual move (midpoint-tracked).
//   - 2 hands on opposing corners / sides → resize (2D / horizontal / vertical).
//   - 2 hands in the middle of the same window → zoom.
// Sessions reconcile only on hand join/leave, so the session's cached initials stay pinned for
// smooth deltas during continuous motion.
type MoveSingleSession = {
  kind: 'move-single';
  targetId: string;
  hand: number;
  initialWinX: number;
  initialWinY: number;
  initialHandX: number;
  initialHandY: number;
};

type MoveBimanualSession = {
  kind: 'move-bimanual';
  targetId: string;
  initialWinX: number;
  initialWinY: number;
  initialMidX: number;
  initialMidY: number;
};

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

type Session = MoveSingleSession | MoveBimanualSession | ResizeSession | ZoomSession;

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

function classifyOpposingPair(
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

// True when both zone sets share at least one grip (both TL, both L, etc.) — this is the signal
// for "matching sides → bimanual move, not resize".
function hasMatchingZone(a: Set<Grip>, b: Set<Grip>): boolean {
  for (const z of a) if (b.has(z)) return true;
  return false;
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

// Per-hand tracking info. x,y are always the latest raw position; windowId/zones are populated
// only when the hand is currently over a window (used for session derivation, not for applying
// drag — a move-single session continues to track raw xy even if the hand leaves window bounds).
type HandInfo = { x: number; y: number; windowId?: string; zones?: Set<Grip> };

// Build a signature describing the kind + target of a session derived from the given hand map.
// Used to detect when a session needs to transition (e.g. 1 hand → 2 hands). Position-only
// changes inside the same kind/target don't change the signature, so initials stay pinned.
function sessionSignature(handPos: Map<number, HandInfo>): string {
  const overWindow = [...handPos.entries()].filter(([, i]) => i.windowId != null);
  if (overWindow.length === 0) return 'none';
  if (overWindow.length === 1) {
    const [hand, info] = overWindow[0];
    // Single-hand move requires a handle — the outer 20% bands only. Pinching in the middle
    // 60% with one hand produces an empty zone set and does nothing.
    if (!info.zones || info.zones.size === 0) return 'none';
    return `move-single:${info.windowId}:h${hand}`;
  }
  const sorted = overWindow.sort(([a], [b]) => a - b).slice(0, 2);
  const [[, a], [, b]] = sorted;
  if (a.windowId !== b.windowId) return 'cross-window';
  const pair = classifyOpposingPair(a.zones!, b.zones!);
  if (pair) return `${pair.kind}:${a.windowId}:${pair.gripA}-${pair.gripB}`;
  if (hasMatchingZone(a.zones!, b.zones!)) return `move-bimanual:${a.windowId}`;
  return `zoom:${a.windowId}`;
}

// Derive a fresh session from the current tri-pinch state, anchoring all initial values to the
// live window + hand positions. Called at signature-change transitions; moves just re-apply the
// session's cached initials against the latest positions.
function deriveSession(handPos: Map<number, HandInfo>): Session | null {
  const overWindow = [...handPos.entries()].filter(([, i]) => i.windowId != null);
  if (overWindow.length === 0) return null;
  const { windows } = useWindowStore.getState();

  if (overWindow.length === 1) {
    const [hand, info] = overWindow[0];
    if (!info.zones || info.zones.size === 0) return null;
    const w = windows[info.windowId!];
    if (!w) return null;
    return {
      kind: 'move-single',
      targetId: w.id,
      hand,
      initialWinX: w.x,
      initialWinY: w.y,
      initialHandX: info.x,
      initialHandY: info.y,
    };
  }

  const sorted = overWindow.sort(([a], [b]) => a - b).slice(0, 2);
  const [[, a], [, b]] = sorted;
  if (a.windowId !== b.windowId) return null;
  const w = windows[a.windowId!];
  if (!w) return null;

  const pair = classifyOpposingPair(a.zones!, b.zones!);
  if (pair) {
    const { kind, gripA, gripB } = pair;
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

  if (hasMatchingZone(a.zones!, b.zones!)) {
    return {
      kind: 'move-bimanual',
      targetId: w.id,
      initialWinX: w.x,
      initialWinY: w.y,
      initialMidX: (a.x + b.x) / 2,
      initialMidY: (a.y + b.y) / 2,
    };
  }

  const initialHorzDist = Math.abs(a.x - b.x);
  if (initialHorzDist < 1) return null;
  return { kind: 'zoom', targetId: w.id, initialHorzDist, initialZoom: w.zoom };
}

// Apply the active session using the current hand positions. Each kind reads the hand positions
// it needs and dispatches to the store. Silently no-ops if required hands aren't present.
function applySession(session: Session, handPos: Map<number, HandInfo>): void {
  const { windows } = useWindowStore.getState();
  const w = windows[session.targetId];
  if (!w) return;
  const store = useWindowStore.getState();

  if (session.kind === 'move-single') {
    const info = handPos.get(session.hand);
    if (!info) return;
    store.moveWindow(
      session.targetId,
      session.initialWinX + (info.x - session.initialHandX),
      session.initialWinY + (info.y - session.initialHandY),
    );
    return;
  }

  if (session.kind === 'move-bimanual') {
    const pair = [...handPos.values()].slice(0, 2);
    if (pair.length < 2) return;
    const [a, b] = pair;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    store.moveWindow(
      session.targetId,
      session.initialWinX + (midX - session.initialMidX),
      session.initialWinY + (midY - session.initialMidY),
    );
    return;
  }

  const sorted = [...handPos.entries()].sort(([a], [b]) => a - b).slice(0, 2);
  if (sorted.length < 2) return;
  const [[, a], [, b]] = sorted;

  if (session.kind === 'zoom') {
    const currentHorzDist = Math.abs(a.x - b.x);
    const targetZoom = session.initialZoom * (currentHorzDist / session.initialHorzDist);
    store.zoomWindow(session.targetId, targetZoom - w.zoom);
    return;
  }

  if (session.kind === 'resize-2d') {
    const currentDist = Math.hypot(a.x - b.x, a.y - b.y);
    const scale = currentDist / session.initialDist;
    const newWidth = session.initialWidth * scale;
    const newHeight = session.initialHeight * scale;
    store.moveWindow(session.targetId, session.centerX - newWidth / 2, session.centerY - newHeight / 2);
    store.resizeWindow(session.targetId, newWidth, newHeight);
    return;
  }

  if (session.kind === 'resize-horizontal') {
    const currentHorzDist = Math.abs(a.x - b.x);
    const newWidth = session.initialWidth * (currentHorzDist / session.initialHorzDist);
    store.moveWindow(session.targetId, session.centerX - newWidth / 2, w.y);
    store.resizeWindow(session.targetId, newWidth, w.height);
    return;
  }

  const currentVertDist = Math.abs(a.y - b.y);
  const newHeight = session.initialHeight * (currentVertDist / session.initialVertDist);
  store.moveWindow(session.targetId, w.x, session.centerY - newHeight / 2);
  store.resizeWindow(session.targetId, w.width, newHeight);
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

  const sessionRef = useRef<Session | null>(null);
  const sessionSigRef = useRef<string>('none');

  // Per-hand live tri-pinch position. Always records x,y; populates windowId/zones only when
  // the hand is currently over a window. Used for session derivation + live grip glow.
  const handPosRef = useRef<Map<number, HandInfo>>(new Map());

  const [activeGripsByWindow, setActiveGripsByWindow] = useState<
    Map<string, ReadonlySet<Grip>>
  >(new Map());

  useEffect(() => {
    const recomputeActiveGrips = () => {
      const next = new Map<string, Set<Grip>>();
      for (const info of handPosRef.current.values()) {
        if (!info.windowId || !info.zones) continue;
        const existing = next.get(info.windowId) ?? new Set<Grip>();
        for (const g of info.zones) existing.add(g);
        next.set(info.windowId, existing);
      }
      setActiveGripsByWindow((prev) => (sameGripMap(prev, next) ? prev : next));
    };

    const updateHandPosition = (hand: number, x: number, y: number) => {
      const { windows: wins, focusOrder: order } = useWindowStore.getState();
      const win = findWindowAt(x, y, wins, order);
      const info: HandInfo = { x, y };
      if (win) {
        info.windowId = win.id;
        info.zones = gripZonesAtFraction((x - win.x) / win.width, (y - win.y) / win.height);
      }
      handPosRef.current.set(hand, info);
    };

    // Re-check session identity against the current hand state. On a signature change, spin up
    // a fresh session anchored to the live positions (so the drag doesn't jump). On no change,
    // leave the existing session + its cached initials untouched.
    const reconcileSession = () => {
      const sig = sessionSignature(handPosRef.current);
      if (sig === sessionSigRef.current) return;
      sessionSigRef.current = sig;
      sessionRef.current = deriveSession(handPosRef.current);
    };

    const unsub = bus.subscribe((e) => {
      if (e.type === 'pinch:down') {
        const { windows: wins, focusOrder: order } = useWindowStore.getState();
        const hit = findWindowAt(e.x, e.y, wins, order);
        if (hit) focusWindow(hit.id);
        return;
      }

      if (e.type === 'hand:triPinch:start') {
        updateHandPosition(e.hand, e.x, e.y);
        // Focus the window under the first tri-pinching hand — so the bimanual resize / move
        // target is always brought to front the moment the user commits.
        const info = handPosRef.current.get(e.hand);
        if (info?.windowId) focusWindow(info.windowId);
        reconcileSession();
        recomputeActiveGrips();
        if (sessionRef.current) applySession(sessionRef.current, handPosRef.current);
        return;
      }

      if (e.type === 'hand:triPinch:move') {
        updateHandPosition(e.hand, e.x, e.y);
        recomputeActiveGrips();
        // Moves never change session identity (kind/target stays latched until a hand
        // joins/leaves). Just replay the session against the latest positions.
        if (sessionRef.current) applySession(sessionRef.current, handPosRef.current);
        return;
      }

      if (e.type === 'hand:triPinch:end') {
        handPosRef.current.delete(e.hand);
        reconcileSession();
        recomputeActiveGrips();
        if (sessionRef.current) applySession(sessionRef.current, handPosRef.current);
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
