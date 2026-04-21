import { PinchTarget } from '@/components/PinchTarget';
// Note: all window movement AND resizing are owned by WindowManager via bimanual tri-pinch
// (split tri-pinch on matching grip zones moves; opposing zones resize; middle zooms). This
// component renders the chrome + close button only — no single-hand drag/resize handles.
import { AppFrame } from './AppFrame';
import { useWindowStore, type WindowState } from '@/stores/windowStore';
import { APPS } from '@/apps/registry';

// Each window has 8 possible grip zones: 4 corners (proportional 2D resize) and 4 sides (1D
// resize along one axis). WindowManager does the hit-testing and sends the active set back here
// for visual feedback.
export type Grip = 'TL' | 'TR' | 'BL' | 'BR' | 'T' | 'B' | 'L' | 'R';

export interface WindowProps {
  win: WindowState;
  zIndex: number;
  // Set of grip identifiers currently "locked on" for the bimanual resize gesture. Drives the
  // visual highlight on the matching L-brackets and edge ticks.
  activeGrips?: ReadonlySet<Grip>;
}

// A single floating window: passive title bar, close button, and 8 grip indicators (4 corners +
// 4 sides) used by the bimanual tri-pinch gestures. All movement and resizing goes through
// WindowManager — this component is purely a renderer.
export function Window({ win, zIndex, activeGrips }: WindowProps) {
  const manifest = APPS[win.appId];
  const closeWindow = useWindowStore((s) => s.closeWindow);

  if (!manifest) return null;
  const Component = manifest.component;
  const anyGripActive = (activeGrips?.size ?? 0) > 0;

  return (
    <div
      className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-jarvis-stroke bg-black/55 shadow-2xl shadow-black/60 backdrop-blur-md transition-shadow"
      style={{
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex,
        boxShadow: anyGripActive
          ? '0 0 0 2px rgba(124,200,255,0.6), 0 8px 32px rgba(0,0,0,0.6)'
          : undefined,
      }}
    >
      {/* Title bar — passive header. Window movement is a bimanual tri-pinch gesture owned by
          WindowManager; the title bar is no longer draggable on its own. */}
      <div className="flex items-stretch border-b border-white/10">
        <div className="flex flex-1 items-center gap-2 px-3 py-2 text-sm text-white/80">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: manifest.accent ?? '#7cc8ff' }}
          />
          <span className="font-medium">{manifest.name}</span>
        </div>
        <PinchTarget
          className="flex w-10 items-center justify-center border-none bg-transparent text-lg text-white/70"
          onClick={() => closeWindow(win.id)}
        >
          ×
        </PinchTarget>
      </div>

      <AppFrame zoom={win.zoom}>
        <Component />
      </AppFrame>

      {/* Grip indicators — 4 corner L-brackets + 4 side ticks. Passive affordances; hit-testing
          lives in WindowManager. Locked entries glow accent; others sit as subtle outlines. */}
      <CornerHandle corner="TL" active={activeGrips?.has('TL')} />
      <CornerHandle corner="TR" active={activeGrips?.has('TR')} />
      <CornerHandle corner="BL" active={activeGrips?.has('BL')} />
      <CornerHandle corner="BR" active={activeGrips?.has('BR')} />
      <SideHandle side="T" active={activeGrips?.has('T')} />
      <SideHandle side="B" active={activeGrips?.has('B')} />
      <SideHandle side="L" active={activeGrips?.has('L')} />
      <SideHandle side="R" active={activeGrips?.has('R')} />
    </div>
  );
}

const ACCENT = '#7cc8ff';
const IDLE = 'rgba(255,255,255,0.35)';

// L-bracket marker at a window corner. Each corner draws two of its four borders to form the L.
function CornerHandle({ corner, active }: { corner: 'TL' | 'TR' | 'BL' | 'BR'; active?: boolean }) {
  const color = active ? ACCENT : IDLE;
  const thick = active ? 3 : 2;
  const border = `${thick}px solid ${color}`;
  const base = {
    position: 'absolute' as const,
    width: 18,
    height: 18,
    pointerEvents: 'none' as const,
    transition: 'all 120ms ease',
    filter: active ? `drop-shadow(0 0 8px rgba(124,200,255,0.9))` : undefined,
  };
  switch (corner) {
    case 'TL':
      return <div style={{ ...base, top: 4, left: 4, borderTop: border, borderLeft: border, borderTopLeftRadius: 6 }} />;
    case 'TR':
      return <div style={{ ...base, top: 4, right: 4, borderTop: border, borderRight: border, borderTopRightRadius: 6 }} />;
    case 'BL':
      return <div style={{ ...base, bottom: 4, left: 4, borderBottom: border, borderLeft: border, borderBottomLeftRadius: 6 }} />;
    case 'BR':
      return <div style={{ ...base, bottom: 4, right: 4, borderBottom: border, borderRight: border, borderBottomRightRadius: 6 }} />;
  }
}

// Side grip indicator — spans the middle portion of its edge. Width matches the actual hit zone
// (middle 20% of the edge length when corners take 40% each side), so what the user sees is
// what's pinchable.
function SideHandle({ side, active }: { side: 'T' | 'B' | 'L' | 'R'; active?: boolean }) {
  const color = active ? ACCENT : IDLE;
  const thick = active ? 3 : 2;
  // Middle 40% of the edge — matches the overlapping side zone in WindowManager (fx in [0.4, 0.6]
  // for T/B; fy in [0.4, 0.6] for L/R). Visually prominent so users aim at it.
  const spanPct = 40;
  const base = {
    position: 'absolute' as const,
    pointerEvents: 'none' as const,
    transition: 'all 120ms ease',
    filter: active ? 'drop-shadow(0 0 8px rgba(124,200,255,0.9))' : undefined,
    backgroundColor: color,
    borderRadius: 2,
  };
  switch (side) {
    case 'T':
      return <div style={{ ...base, top: 4, left: `${50 - spanPct / 2}%`, width: `${spanPct}%`, height: thick }} />;
    case 'B':
      return <div style={{ ...base, bottom: 4, left: `${50 - spanPct / 2}%`, width: `${spanPct}%`, height: thick }} />;
    case 'L':
      return <div style={{ ...base, left: 4, top: `${50 - spanPct / 2}%`, height: `${spanPct}%`, width: thick }} />;
    case 'R':
      return <div style={{ ...base, right: 4, top: `${50 - spanPct / 2}%`, height: `${spanPct}%`, width: thick }} />;
  }
}
