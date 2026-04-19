import { beforeEach, describe, expect, it } from 'vitest';
import { useWindowStore } from './windowStore';

// JSDOM provides window.innerWidth/Height, so openApp's centering math is well-defined in tests.

function reset() {
  useWindowStore.setState({ windows: {}, focusOrder: [] });
}

describe('windowStore', () => {
  beforeEach(reset);

  it('openApp creates a window and pushes onto focus order', () => {
    useWindowStore.getState().openApp('google');
    const s = useWindowStore.getState();
    expect(s.windows.google).toBeDefined();
    expect(s.windows.google.appId).toBe('google');
    expect(s.focusOrder).toEqual(['google']);
  });

  it('re-opening an app focuses existing window rather than creating a duplicate', () => {
    const { openApp } = useWindowStore.getState();
    openApp('google');
    openApp('spotify');
    openApp('google');
    const s = useWindowStore.getState();
    expect(Object.keys(s.windows)).toHaveLength(2);
    // google was first, spotify was second, re-opening google brings it to the top.
    expect(s.focusOrder).toEqual(['spotify', 'google']);
  });

  it('unknown appId is a no-op', () => {
    useWindowStore.getState().openApp('nonexistent');
    const s = useWindowStore.getState();
    expect(s.windows).toEqual({});
    expect(s.focusOrder).toEqual([]);
  });

  it('focusWindow moves the id to the top; no-op if already on top', () => {
    const { openApp, focusWindow } = useWindowStore.getState();
    openApp('google');
    openApp('spotify');
    expect(useWindowStore.getState().focusOrder).toEqual(['google', 'spotify']);

    focusWindow('google');
    expect(useWindowStore.getState().focusOrder).toEqual(['spotify', 'google']);

    // Calling focus again on the top window should keep the same reference (no-op).
    const prev = useWindowStore.getState().focusOrder;
    focusWindow('google');
    expect(useWindowStore.getState().focusOrder).toBe(prev);
  });

  it('closeWindow removes the window and drops it from focus order', () => {
    const { openApp, closeWindow } = useWindowStore.getState();
    openApp('google');
    openApp('spotify');
    closeWindow('google');
    const s = useWindowStore.getState();
    expect(s.windows.google).toBeUndefined();
    expect(s.focusOrder).toEqual(['spotify']);
  });

  it('moveWindow updates x/y within bounds', () => {
    const { openApp, moveWindow } = useWindowStore.getState();
    openApp('google');
    moveWindow('google', 120, 80);
    const w = useWindowStore.getState().windows.google;
    expect(w.x).toBe(120);
    expect(w.y).toBe(80);
  });

  it('moveWindow clamps off-screen positions so the window stays grabbable', () => {
    const { openApp, moveWindow } = useWindowStore.getState();
    openApp('google');
    // Way off to the right past the viewport; should be pulled back to keep at least the
    // off-screen buffer visible on the left side.
    moveWindow('google', 99999, 99999);
    const w = useWindowStore.getState().windows.google;
    expect(w.x).toBeLessThan(window.innerWidth);
    expect(w.y).toBeLessThan(window.innerHeight);
    // Off to top-left far past origin — top shouldn't go above 0 and window right edge still
    // has to leave some buffer visible.
    moveWindow('google', -99999, -99999);
    const w2 = useWindowStore.getState().windows.google;
    expect(w2.y).toBeGreaterThanOrEqual(0);
    expect(w2.x + w2.width).toBeGreaterThan(0);
  });

  it('resizeWindow respects minimum size', () => {
    const { openApp, resizeWindow } = useWindowStore.getState();
    openApp('google');
    resizeWindow('google', 10, 10);
    const w = useWindowStore.getState().windows.google;
    // MIN_W / MIN_H defined in windowStore — values below are clamped.
    expect(w.width).toBeGreaterThanOrEqual(240);
    expect(w.height).toBeGreaterThanOrEqual(160);
  });
});
