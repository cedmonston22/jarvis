// Single-frame pointer-pose detector. Index is extended, middle/ring/pinky are not. Thumb is
// don't-care so the user can pinch (thumb+index) without leaving pointer mode — the pinch
// detector handles that axis independently.

import { fingerExtensions } from '../fingers';
import type { Hand } from '../types';

export function isPointerPose(hand: Hand): boolean {
  const [, index, middle, ring, pinky] = fingerExtensions(hand);
  return index && !middle && !ring && !pinky;
}
