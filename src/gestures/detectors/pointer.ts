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
// only come from POINTING). Middle/ring/pinky count as extended only when straightness > 0.85.
// Real-world fixture data shows pointing poses captured near the frame edge or close to the
// camera land with middle-finger straightness in the 0.80–0.87 range — tighter thresholds
// rejected them as "not pointing" even though the user was clearly pointing. 0.85 keeps the
// open-palm wave (all fingers ~1.00) rejected while accepting natural pointing with relaxed
// neighbors. Prior values: 0.55 (too strict, broke normal clicks), 0.75 (fixed common poses but
// rejected edge-of-frame / close-to-camera pointing).
const INDEX_EXT_THRESHOLD_2D = 0.3;
const OTHER_EXT_THRESHOLD_2D = 0.88;

export function isPointerPose(hand: Hand): boolean {
  const index = fingerStraightness2D(hand, 1) > INDEX_EXT_THRESHOLD_2D;
  const middleExt = fingerStraightness2D(hand, 2) > OTHER_EXT_THRESHOLD_2D;
  const ringExt = fingerStraightness2D(hand, 3) > OTHER_EXT_THRESHOLD_2D;
  const pinkyExt = fingerStraightness2D(hand, 4) > OTHER_EXT_THRESHOLD_2D;
  return index && !middleExt && !ringExt && !pinkyExt;
}
