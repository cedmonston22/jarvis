import { PinchTarget } from './PinchTarget';
import { APPS, APP_ORDER } from '@/apps/registry';
import { useWindowStore } from '@/stores/windowStore';
import { useVoice } from './VoiceContext';

// Fixed-bottom launcher. Each icon opens (or focuses, if already open) an app via the window
// store. Layout is horizontally centered; the whole row sits above the windows (z=40) so it
// can't get occluded by a maximized window.
//
// A mic toggle is appended on the right (with a subtle divider) so voice control is discoverable
// and dismissable from the same surface as app launching.
export function Dock() {
  const openApp = useWindowStore((s) => s.openApp);
  const openIds = useWindowStore((s) => s.focusOrder);

  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2"
      style={{ zIndex: 40 }}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-jarvis-stroke bg-black/50 px-3 py-2 backdrop-blur-md">
        {APP_ORDER.map((appId) => {
          const manifest = APPS[appId];
          if (!manifest) return null;
          const isOpen = openIds.includes(appId);
          return (
            <PinchTarget
              key={appId}
              className="flex h-12 w-12 items-center justify-center"
              onClick={() => openApp(appId)}
            >
              <span
                className="font-mono text-xl font-semibold"
                style={{ color: manifest.accent ?? '#ffffff' }}
              >
                {manifest.icon}
              </span>
              {isOpen && (
                <span
                  className="pointer-events-none absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                  style={{ backgroundColor: manifest.accent ?? '#ffffff' }}
                />
              )}
            </PinchTarget>
          );
        })}

        <div className="mx-1 h-8 w-px bg-white/15" />

        <MicButton />
      </div>
    </div>
  );
}

// System-level mic toggle. Lives in the dock but isn't an app — it's the entry point for voice
// control. On browsers without SpeechRecognition support (Firefox / Safari desktop) it renders
// disabled-looking and is a no-op; we still show it so users understand the feature exists.
function MicButton() {
  const { listening, supported, toggle } = useVoice();
  const disabled = !supported;
  return (
    <PinchTarget
      className={
        'relative flex h-12 w-12 items-center justify-center ' +
        (disabled ? 'opacity-40' : '')
      }
      onClick={disabled ? undefined : toggle}
    >
      <span
        className="font-mono text-xl"
        style={{ color: listening ? '#7cc8ff' : '#ffffff' }}
        title={
          disabled
            ? 'Voice unsupported in this browser (Chromium only)'
            : listening
              ? 'Listening — pinch to stop'
              : 'Pinch to start listening'
        }
      >
        {listening ? '◉' : '⏺'}
      </span>
      {listening && (
        <span
          className="pointer-events-none absolute inset-0 rounded-2xl border border-jarvis-accent/70"
          style={{
            boxShadow: '0 0 0 2px rgba(124,200,255,0.25), 0 0 12px rgba(124,200,255,0.6)',
            animation: 'voicePulse 1.4s ease-in-out infinite',
          }}
        />
      )}
    </PinchTarget>
  );
}
