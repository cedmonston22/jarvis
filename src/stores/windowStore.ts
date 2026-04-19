import { create } from 'zustand';
import { APPS } from '@/apps/registry';

// Floating window manager. One window instance per app id for now (v1 rule: re-launching an
// already-open app focuses the existing window instead of spawning a duplicate). Positions and
// sizes live here in viewport pixels — the Window component applies them to a `position: fixed`
// element each render.

export interface WindowState {
  id: string;       // instance id; same as appId under the one-window-per-app rule
  appId: string;
  x: number;        // top-left, viewport px
  y: number;
  width: number;
  height: number;
  // CSS-transform scale applied to the app body. 1.0 = default; the zoom gesture nudges this.
  zoom: number;
}

export interface WindowStore {
  windows: Record<string, WindowState>;
  // Back-to-front. Last entry is the top-most. Closed ids are removed.
  focusOrder: string[];
  openApp: (appId: string) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, width: number, height: number) => void;
  // Apply a relative zoom delta to a window (clamped). Caller scales bus zoom:delta events into
  // this however they like; the store itself only enforces the clamp range.
  zoomWindow: (id: string, delta: number) => void;
}

// Minimum size ensures the title bar + close button can still be grabbed if a user resizes way
// down. Doesn't need to be tight — just stop the window from collapsing to a dot.
const MIN_W = 240;
const MIN_H = 160;
// Zoom range. Below 0.5 the content is illegibly small; above 2.5 it overflows the window without
// meaningful benefit. Wide enough to feel like real zoom, narrow enough to avoid footguns.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
// Minimum pixels of the window that must remain on-screen on any given side — prevents dragging
// a window so far off that the title bar / grips are unreachable.
const OFFSCREEN_BUFFER = 100;
// Minimum visible strip from the top of the viewport (never negative Y past this — title bar must
// always be reachable).
const TOP_MIN_VISIBLE = 0;

// Pull viewport size once per clamp. `typeof window` guard keeps this safe in node-like test envs.
function viewportSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1280, h: 720 };
  return { w: window.innerWidth, h: window.innerHeight };
}

function clampPosition(x: number, y: number, width: number): { x: number; y: number } {
  const { w: vpW, h: vpH } = viewportSize();
  // Horizontal: at least OFFSCREEN_BUFFER of the window's right/left edge must remain visible.
  const minX = OFFSCREEN_BUFFER - width;
  const maxX = vpW - OFFSCREEN_BUFFER;
  // Vertical: don't let the top go above 0 (title bar must be reachable). At least
  // OFFSCREEN_BUFFER of bottom edge stays visible.
  const minY = TOP_MIN_VISIBLE;
  const maxY = vpH - OFFSCREEN_BUFFER;
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

export const useWindowStore = create<WindowStore>((set) => ({
  windows: {},
  focusOrder: [],

  openApp: (appId) =>
    set((state) => {
      const manifest = APPS[appId];
      if (!manifest) return state;

      // One window per app: if the app is already open, just focus it.
      if (state.windows[appId]) {
        return {
          focusOrder: [...state.focusOrder.filter((id) => id !== appId), appId],
        };
      }

      // Default placement: centered on the viewport. Staggered by the current open-count so a
      // rapid sequence of openApp calls doesn't stack windows perfectly on top of each other.
      const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const viewportH = typeof window !== 'undefined' ? window.innerHeight : 720;
      const stagger = state.focusOrder.length * 32;
      const w = manifest.defaultSize.width;
      const h = manifest.defaultSize.height;
      const x = Math.max(16, Math.round((viewportW - w) / 2) + stagger);
      const y = Math.max(16, Math.round((viewportH - h) / 2) + stagger);

      const win: WindowState = { id: appId, appId, x, y, width: w, height: h, zoom: 1 };
      return {
        windows: { ...state.windows, [appId]: win },
        focusOrder: [...state.focusOrder, appId],
      };
    }),

  closeWindow: (id) =>
    set((state) => {
      if (!state.windows[id]) return state;
      const { [id]: _removed, ...rest } = state.windows;
      return {
        windows: rest,
        focusOrder: state.focusOrder.filter((wid) => wid !== id),
      };
    }),

  focusWindow: (id) =>
    set((state) => {
      if (!state.windows[id]) return state;
      // Already on top — no-op to avoid a pointless re-render on every pinch:down frame.
      if (state.focusOrder[state.focusOrder.length - 1] === id) return state;
      return {
        focusOrder: [...state.focusOrder.filter((wid) => wid !== id), id],
      };
    }),

  moveWindow: (id, x, y) =>
    set((state) => {
      const win = state.windows[id];
      if (!win) return state;
      const clamped = clampPosition(x, y, win.width);
      return { windows: { ...state.windows, [id]: { ...win, x: clamped.x, y: clamped.y } } };
    }),

  resizeWindow: (id, width, height) =>
    set((state) => {
      const win = state.windows[id];
      if (!win) return state;
      const w = Math.max(MIN_W, width);
      const h = Math.max(MIN_H, height);
      // Resize may push the window past the off-screen buffer on one edge; re-clamp position so
      // we stay grabbable even after a big stretch.
      const clamped = clampPosition(win.x, win.y, w);
      return {
        windows: {
          ...state.windows,
          [id]: { ...win, x: clamped.x, y: clamped.y, width: w, height: h },
        },
      };
    }),

  zoomWindow: (id, delta) =>
    set((state) => {
      const win = state.windows[id];
      if (!win) return state;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, win.zoom + delta));
      if (next === win.zoom) return state;
      return { windows: { ...state.windows, [id]: { ...win, zoom: next } } };
    }),
}));
