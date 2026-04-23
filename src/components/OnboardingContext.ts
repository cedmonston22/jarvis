import { createContext, useContext } from 'react';

// Context for the onboarding overlay. Lives in its own file (no component exports) so React Fast
// Refresh can hot-reload OnboardingOverlay.tsx cleanly.
export interface OnboardingContextValue {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

export const OnboardingCtx = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const v = useContext(OnboardingCtx);
  if (!v) throw new Error('useOnboarding must be used inside <OnboardingProvider>');
  return v;
}

export const ONBOARDING_STORAGE_KEY = 'jarvis.onboarded.v1';
