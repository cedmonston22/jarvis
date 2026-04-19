// Single-frame spread detector. Returns the normalized hand openness scalar used by the zoom
// gesture. The state machine converts per-frame deltas of this scalar into zoom:delta events.

import { handSpread, fingerExtensions } from '../fingers';
import type { Hand } from '../types';

export interface SpreadReading {
  value: number;
  allFiveExtended: boolean;
}

export function readSpread(hand: Hand): SpreadReading {
  const ext = fingerExtensions(hand);
  return {
    value: handSpread(hand),
    allFiveExtended: ext.every(Boolean),
  };
}
