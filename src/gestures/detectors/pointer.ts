// Single-frame pointer-pose detector. Index is extended, middle/ring/pinky are not. Thumb is
// don't-care so the user can pinch (thumb+index) without leaving pointer mode — the pinch
// detector handles that axis independently.
//
// Uses 2D straightness (image plane only) for the core "extended" signal rather than 3D.
// Rationale: MediaPipe's z estimates get noisy when the palm faces the camera — 3D joint angles
// flicker, causing the pose check to drop in/out during steady pointing. 2D stays crisp in that
// orientation. Tradeoff: a finger pointing directly at the camera foreshortens to a near-point in
// 2D; base→mid and mid→tip vectors shrink and their cosine becomes noise-dominated — sometimes
// reading spuriously HIGH for a curled neighbor finger, which rejects a valid pointing pose. The
// 3D fingerReach metric (MCP→TIP distance / segment length) is orientation-invariant and catches
// that case: a truly curled finger has reach ≤ ~1.55 regardless of palm orientation, while an
// extended one sits at ≥ 2.15. Gated AND with 2D so both signals must agree before calling a
// non-index finger "extended" — the gate only tightens the "extended" criterion, which relaxes
// pointer acceptance.
//
// Data points from real-world fixtures (see scripts/inspect-pointer.mjs output while tuning):
//   - wave-open-palm  middle: 2D=1.00, reach=2.18  → extended (correctly rejects pointing)
//   - peace-sign      middle: 2D=1.00, reach=2.17  → extended (correctly rejects pointing)
//   - clean-point     middle: 2D=-0.99, reach=1.24 → curled (accepts pointing)
//   - point-edge-right middle: 2D=0.83, reach=1.46 → curled (accepts — 2D alone near threshold)
//   - point-loose-middle pinky: 2D=-0.96, reach=1.05 → curled
// A reach threshold of 1.85 sits in the gap between "clearly curled" (≤1.55) and "clearly
// extended" (≥2.15) across every fixture in the suite.

import { fingerReach, fingerStraightness2D } from '../fingers';
import type { Hand } from '../types';

// Index uses a loose 2D gate so a bent-while-pinching finger still reads as "extended" — otherwise
// POINTING drops to IDLE during pinch and blocks pinch entry.
const INDEX_EXT_THRESHOLD_2D = 0.3;
// For middle/ring/pinky: 2D straightness threshold. Real-world fixture data shows pointing poses
// captured near the frame edge or close to the camera land with middle-finger 2D straightness in
// the 0.80–0.87 range, so 0.88 accepts those while still rejecting an open wave (~1.00).
const OTHER_EXT_THRESHOLD_2D = 0.88;
// For middle/ring/pinky: 3D reach threshold. Sits in the gap between curled-ceiling and
// extended-floor observed across fixtures.
const OTHER_EXT_THRESHOLD_REACH = 1.85;

// A non-index finger counts as extended only if BOTH the 2D cosine AND the 3D reach clear their
// thresholds. Either-alone was the source of the front-facing inconsistency: 2D noise during
// foreshortening flipped the answer frame-to-frame; 3D alone rejected the "relaxed neighbor
// fingers" pointing pose (clean-point-left, backlit-point-loose-middle) where reach stays ~2.9
// but 2D is clearly sub-threshold.
function isOtherFingerExtended(hand: Hand, fingerIdx: 2 | 3 | 4): boolean {
  const straight2D = fingerStraightness2D(hand, fingerIdx) > OTHER_EXT_THRESHOLD_2D;
  const reaching = fingerReach(hand, fingerIdx) > OTHER_EXT_THRESHOLD_REACH;
  return straight2D && reaching;
}

export function isPointerPose(hand: Hand): boolean {
  const index = fingerStraightness2D(hand, 1) > INDEX_EXT_THRESHOLD_2D;
  return index && !isOtherFingerExtended(hand, 2) && !isOtherFingerExtended(hand, 3) && !isOtherFingerExtended(hand, 4);
}
