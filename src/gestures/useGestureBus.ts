import { useContext } from 'react';
import { BusContext } from './BusContext';
import type { GestureBus } from './bus';

export function useGestureBus(): GestureBus {
  const bus = useContext(BusContext);
  if (!bus) throw new Error('useGestureBus called outside <GestureBusProvider>');
  return bus;
}
