// Single-frame pointer-pose detector. Index is extended, middle/ring/pinky are not. Thumb is
// don't-care so the user can pinch (thumb+index) without leaving pointer mode — the pinch
// detector handles that axis independently.
//
// Uses 2D straightness (image plane only) rather than 3D. Rationale: MediaPipe's z estimates get
// noisy when the palm faces the camera — 3D joint angles flicker, causing the pose check to drop
// in/out during steady pointing. 2D stays crisp in that orientation. Tradeoff: a finger pointing
// directly at the camera foreshortens to a point in 2D and reads as "not extended" — rare in
// webcam use where the user's index typically points up or sideways.

import { fingerStraightness2D } from '../fingers';
import type { Hand } from '../types';

// Asymmetric 2D thresholds. Index uses a loose gate so a bent-while-pinching finger still reads
// as "extended" — otherwise POINTING drops to IDLE during pinch and blocks pinch entry (which can
// only come from POINTING). Middle/ring/pinky stay strict so a lazily-half-curled neighbor
// doesn't falsely satisfy the "other fingers folded" requirement.
const INDEX_EXT_THRESHOLD_2D = 0.3;
const OTHER_EXT_THRESHOLD_2D = 0.55;

export function isPointerPose(hand: Hand): boolean {
  const index = fingerStraightness2D(hand, 1) > INDEX_EXT_THRESHOLD_2D;
  const middle = fingerStraightness2D(hand, 2) > OTHER_EXT_THRESHOLD_2D;
  const ring = fingerStraightness2D(hand, 3) > OTHER_EXT_THRESHOLD_2D;
  const pinky = fingerStraightness2D(hand, 4) > OTHER_EXT_THRESHOLD_2D;
  return index && !middle && !ring && !pinky;
}
