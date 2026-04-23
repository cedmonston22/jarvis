import { PinchTarget } from './PinchTarget';
import { APPS, APP_ORDER } from '@/apps/registry';
import { useWindowStore } from '@/stores/windowStore';
import { useVoice } from './VoiceContext';
import { useOnboarding } from './OnboardingContext';

// Fixed-left launcher. Each icon opens (or focuses, if already open) an app via the window
// store. Layout is vertically centered on the left edge; the whole column sits above the windows
// (z=40) so it can't get occluded by a maximized window.
//
// A mic toggle is appended below (with a subtle divider) so voice control is discoverable
// and dismissable from the same surface as app launching.
export function Dock() {
  const openApp = useWindowStore((s) => s.openApp);
  const openIds = useWindowStore((s) => s.focusOrder);

  return (
    <div
      className="pointer-events-none fixed left-6 top-1/2 -translate-y-1/2"
      style={{ zIndex: 40 }}
    >
      <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-2xl border border-jarvis-stroke bg-black/50 px-2 py-3 backdrop-blur-md">
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
                  className="pointer-events-none absolute right-0 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full"
                  style={{ backgroundColor: manifest.accent ?? '#ffffff' }}
                />
              )}
            </PinchTarget>
          );
        })}

        <div className="my-1 h-px w-8 bg-white/15" />

        <MicButton />
        <HelpButton />
      </div>
    </div>
  );
}

// Reopens the onboarding overlay. Placed at the tail of the dock so returning users have a
// persistent entry point to the gesture reference even after they've dismissed the first-run guide.
function HelpButton() {
  const { show } = useOnboarding();
  return (
    <PinchTarget
      className="relative flex h-12 w-12 items-center justify-center"
      onClick={show}
    >
      <span className="font-mono text-xl font-semibold text-white/85" title="How to use Jarvis">
        ?
      </span>
    </PinchTarget>
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
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
        style={{ color: listening ? '#7cc8ff' : '#ffffff' }}
        aria-label={
          disabled
            ? 'Voice unsupported in this browser (Chromium only)'
            : listening
              ? 'Listening — pinch to stop'
              : 'Pinch to start listening'
        }
      >
        <title>
          {disabled
            ? 'Voice unsupported in this browser (Chromium only)'
            : listening
              ? 'Listening — pinch to stop'
              : 'Pinch to start listening'}
        </title>
        <rect x={9} y={3} width={6} height={11} rx={3} fill={listening ? 'currentColor' : 'none'} />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
        <path d="M8 21h8" />
      </svg>
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
