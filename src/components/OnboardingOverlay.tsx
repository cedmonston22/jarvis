import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PinchTarget } from './PinchTarget';
import { OnboardingCtx, ONBOARDING_STORAGE_KEY, type OnboardingContextValue } from './OnboardingContext';

// Provider + overlay. Open state defaults to true on first visit (no localStorage flag), false
// otherwise. Dismissing via "Got it" or Escape writes the flag so returning users don't see it
// again; the help button in the dock (and H key) can always reopen it.
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
    } catch {
      // storage unavailable (private mode, quota) — overlay still closes for this session
    }
  }, []);
  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      if (!next) {
        try {
          window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({ open, show, hide, toggle }),
    [open, show, hide, toggle],
  );

  return (
    <OnboardingCtx.Provider value={value}>
      {children}
      {open && <OnboardingOverlay onDismiss={hide} />}
    </OnboardingCtx.Provider>
  );
}

// Gesture grammar card. Mirrors the two disjoint modalities called out in CLAUDE.md so what new
// users read matches what the system actually recognizes.
const INSTRUCTIONS: ReadonlyArray<{ title: string; body: string; accent: string }> = [
  {
    title: 'Pinch to click',
    body: 'Touch thumb + index together on a button, tile, or dock icon to click it. The same pinch lets you scroll inside an app.',
    accent: '#7cc8ff',
  },
  {
    title: 'Tri-pinch to grab windows',
    body: 'Thumb + index + middle together on a window edge or corner lets you drag it. Use both hands on opposite corners to resize, or in the middle of a window to zoom.',
    accent: '#c7a6ff',
  },
  {
    title: 'Voice commands',
    body: 'Tap the mic in the dock, then say "open google", "play spotify", "search dinner ideas", or "close window".',
    accent: '#9dffb5',
  },
  {
    title: 'Shortcuts',
    body: 'Press H anytime to reopen this guide. Press D to toggle the skeleton debug overlay.',
    accent: '#ffd27c',
  },
];

function OnboardingOverlay({ onDismiss }: { onDismiss: () => void }) {
  // Escape provides a keyboard fallback in addition to the pinch button — useful in demos where
  // the camera isn't ready yet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div
      // z=60 sits above windows (z≤~30), dock (z=40), and HUDs (z=50) so nothing occludes the guide.
      className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/65 backdrop-blur-sm"
      style={{ zIndex: 60 }}
      role="dialog"
      aria-modal="true"
      aria-label="How to use Jarvis"
    >
      <div className="max-w-xl rounded-3xl border border-jarvis-stroke bg-black/80 px-8 py-7 text-white shadow-2xl">
        <h2 className="text-center font-mono text-xl font-semibold tracking-wide text-jarvis-accent">
          Welcome to Jarvis
        </h2>
        <p className="mt-1 text-center text-sm text-white/60">
          Control windows with your hands and voice — no mouse, no keyboard.
        </p>

        <ul className="mt-6 space-y-4">
          {INSTRUCTIONS.map((item) => (
            <li key={item.title} className="flex gap-3">
              <span
                className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: item.accent, boxShadow: `0 0 8px ${item.accent}` }}
              />
              <div>
                <div className="font-mono text-sm font-semibold text-white/90">{item.title}</div>
                <div className="text-sm leading-relaxed text-white/65">{item.body}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex justify-center">
          <PinchTarget
            className="flex h-11 items-center justify-center px-6"
            onClick={onDismiss}
          >
            <span className="font-mono text-sm font-semibold tracking-wide text-white">
              Got it — pinch to dismiss
            </span>
          </PinchTarget>
        </div>
        <div className="mt-3 text-center text-[11px] text-white/35">
          or press Escape · reopen with H or the ? in the dock
        </div>
      </div>
    </div>
  );
}
