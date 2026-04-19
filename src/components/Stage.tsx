import { useEffect, useRef, useState } from 'react';
import { CameraCanvas } from './CameraCanvas';
import { FpsHud } from './FpsHud';
import { HandOverlay } from './HandOverlay';
import { GestureHud } from './GestureHud';
import { WindowManager } from './window/WindowManager';
import { Dock } from './Dock';
import { useGestures } from '@/hooks/useGestures';
import { GestureBusProvider } from '@/gestures/BusContext';
import { VoiceProvider } from './VoiceController';
import type { Hands } from '@/gestures/types';

// Top-level container. Owns the per-frame refs that multiple children read from:
//   - fpsRef: updated by the camera loop, sampled by the HUD 1/s.
//   - landmarksRef: updated by the camera loop, drawn by the hand overlay, consumed by useGestures.
//   - gestures bus + modeRef: produced by useGestures, consumed by overlay + HUD.
// No cursor DOM element — the fingertip IS the cursor. HandOverlay encodes gesture mode via the
// index-fingertip rendering.
//
// Keyboard shortcuts:
//   - D: toggle the debug landmark overlay.
//   - Shift+F: dump current landmarks to clipboard as JSON for fixture capture (see CLAUDE.md).
export function Stage() {
  const fpsRef = useRef(0);
  const landmarksRef = useRef<Hands>([]);
  const { bus, modeRef, tapStateRef, pinchDistRef } = useGestures(landmarksRef);

  const [showDebug, setShowDebug] = useState(true);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const flashHint = (msg: string) => {
      setHint(msg);
      window.setTimeout(() => setHint(null), 1500);
    };
    const onKey = async (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(e.target.tagName))
      ) {
        return;
      }
      if ((e.key === 'd' || e.key === 'D') && !e.shiftKey) {
        setShowDebug((s) => !s);
        return;
      }
      if (e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        try {
          const payload = JSON.stringify(landmarksRef.current, null, 2);
          await navigator.clipboard.writeText(payload);
          flashHint(`copied ${landmarksRef.current.length} hand(s) to clipboard`);
        } catch {
          flashHint('clipboard write failed');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <GestureBusProvider bus={bus}>
      <VoiceProvider>
        <div className="relative h-full w-full overflow-hidden">
          <CameraCanvas fpsRef={fpsRef} landmarksRef={landmarksRef} />
          <WindowManager />
          <Dock />
          <HandOverlay landmarksRef={landmarksRef} modeRef={modeRef} visible={showDebug} />
          <FpsHud fpsRef={fpsRef} />
          <GestureHud
            modeRef={modeRef}
            tapStateRef={tapStateRef}
            pinchDistRef={pinchDistRef}
            bus={bus}
          />
          <DebugLegend showDebug={showDebug} />
          {hint && (
            <div className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-md border border-jarvis-stroke bg-black/70 px-3 py-1 font-mono text-xs text-jarvis-accent">
              {hint}
            </div>
          )}
        </div>
      </VoiceProvider>
    </GestureBusProvider>
  );
}

function DebugLegend({ showDebug }: { showDebug: boolean }) {
  return (
    <div className="pointer-events-none fixed left-3 top-3 z-50 rounded-md border border-white/20 bg-black/60 px-2.5 py-1 font-mono text-xs text-white/70 backdrop-blur">
      <span className="text-white/50">D</span> debug {showDebug ? 'on' : 'off'}
      <span className="mx-2 text-white/25">·</span>
      <span className="text-white/50">Shift+F</span> copy landmarks
    </div>
  );
}
