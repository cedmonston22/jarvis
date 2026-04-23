import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraCanvas } from './CameraCanvas';
import { FpsHud } from './FpsHud';
import { HandOverlay } from './HandOverlay';
import { GestureHud } from './GestureHud';
import { WindowManager } from './window/WindowManager';
import { Dock } from './Dock';
import { useGestures } from '@/hooks/useGestures';
import { GestureBusProvider } from '@/gestures/BusContext';
import { VoiceProvider } from './VoiceController';
import { OnboardingProvider } from './OnboardingOverlay';
import { useOnboarding } from './OnboardingContext';
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
//   - H: toggle the onboarding / gesture-reference overlay.
//   - Shift+F: dump current landmarks to clipboard as JSON for fixture capture (see CLAUDE.md).
export function Stage() {
  const fpsRef = useRef(0);
  const landmarksRef = useRef<Hands>([]);
  const lumaRef = useRef(0.5);
  const darkModeRef = useRef(false);
  const { bus, modeRef, tapStateRef, pinchDistRef, passivePoseRef } = useGestures(landmarksRef);

  const [showDebug, setShowDebug] = useState(true);
  const [hint, setHint] = useState<string | null>(null);

  const flashHintRef = useRef<(msg: string) => void>(() => {});

  // Voice-driven fixture capture. `label` is already sanitized to kebab-case by the parser, so we
  // just suffix a timestamp to avoid collisions when iterating on the same pose. Download runs in
  // the browser — no server write — so the user drops the file into src/test/fixtures/ manually.
  const handleCapture = useCallback((label: string) => {
    const hands = landmarksRef.current;
    if (!hands.length) {
      flashHintRef.current(`capture "${label}" skipped — no hand visible`);
      return;
    }
    const payload = JSON.stringify(hands, null, 2);
    const filename = `${label}-${Date.now()}.json`;
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    flashHintRef.current(`captured ${hands.length} hand(s) → ${filename}`);
  }, []);

  useEffect(() => {
    const flashHint = (msg: string) => {
      setHint(msg);
      window.setTimeout(() => setHint(null), 1500);
    };
    flashHintRef.current = flashHint;
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
      <VoiceProvider onCapture={handleCapture}>
        <OnboardingProvider>
          <OnboardingHotkey />
          <div className="relative h-full w-full overflow-hidden">
            <CameraCanvas
              fpsRef={fpsRef}
              landmarksRef={landmarksRef}
              lumaRef={lumaRef}
              darkModeRef={darkModeRef}
            />
            <WindowManager />
            <Dock />
            <HandOverlay landmarksRef={landmarksRef} modeRef={modeRef} visible={showDebug} />
            <FpsHud fpsRef={fpsRef} />
            <GestureHud
              modeRef={modeRef}
              tapStateRef={tapStateRef}
              pinchDistRef={pinchDistRef}
              passivePoseRef={passivePoseRef}
              lumaRef={lumaRef}
              darkModeRef={darkModeRef}
              bus={bus}
            />
            <DebugLegend showDebug={showDebug} />
            {hint && (
              <div className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-md border border-jarvis-stroke bg-black/70 px-3 py-1 font-mono text-xs text-jarvis-accent">
                {hint}
              </div>
            )}
          </div>
        </OnboardingProvider>
      </VoiceProvider>
    </GestureBusProvider>
  );
}

// Listens for the H key and toggles the onboarding overlay. Split out so it can live inside
// <OnboardingProvider> and use the context; the main Stage keydown handler handles D / Shift+F.
function OnboardingHotkey() {
  const { toggle } = useOnboarding();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(e.target.tagName))
      ) {
        return;
      }
      if ((e.key === 'h' || e.key === 'H') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  return null;
}

function DebugLegend({ showDebug }: { showDebug: boolean }) {
  return (
    <div className="pointer-events-none fixed left-3 top-3 z-50 rounded-md border border-white/20 bg-black/60 px-2.5 py-1 font-mono text-xs text-white/70 backdrop-blur">
      <span className="text-white/50">D</span> debug {showDebug ? 'on' : 'off'}
      <span className="mx-2 text-white/25">·</span>
      <span className="text-white/50">H</span> help
      <span className="mx-2 text-white/25">·</span>
      <span className="text-white/50">Shift+F</span> copy landmarks
    </div>
  );
}
