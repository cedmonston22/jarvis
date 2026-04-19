import { createContext, type ReactNode } from 'react';
import type { GestureBus } from './bus';

// Carries the gesture bus through the React tree so any component that wants hover/click without
// prop-drilling can call useGestureBus (from ./useGestureBus). Stage is the single provider.

// eslint-disable-next-line react-refresh/only-export-components
export const BusContext = createContext<GestureBus | null>(null);

export interface GestureBusProviderProps {
  bus: GestureBus;
  children: ReactNode;
}

export function GestureBusProvider({ bus, children }: GestureBusProviderProps) {
  return <BusContext.Provider value={bus}>{children}</BusContext.Provider>;
}
