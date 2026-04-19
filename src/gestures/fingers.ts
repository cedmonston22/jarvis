// Pure geometric helpers on a Hand (21 landmarks). No DOM, no time, no state — every function is
// a deterministic transformation of its inputs so they unit-test cleanly against fixtures.
//
// Landmark coordinates are MediaPipe-normalized to [0, 1] in the *viewport* frame (we x-mirror
// upstream in CameraCanvas), so distances are normalized to viewport width. Where a function
// references a hand-bounding-box-normalized quantity (pinchDistance, handSpread), it divides by
// max(bbox.width, bbox.height) so the value stays scale-invariant as the user moves toward/away
// from the camera.

import type { Hand, Landmark } from './types';
import { FINGERTIPS, WRIST } from './handTopology';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function dist2d(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function handBBox(hand: Hand): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of hand) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// Landmark triples (base, mid, tip) used to measure each finger's straightness. "Base" and "mid"
// are the two proximal joints; their direction + the mid→tip direction determine whether the
// finger is extended (vectors aligned) or curled (vectors opposing).
//
//   thumb:  MCP(2)  → IP(3)   → TIP(4)
//   index:  MCP(5)  → PIP(6)  → TIP(8)
//   middle: MCP(9)  → PIP(10) → TIP(12)
//   ring:   MCP(13) → PIP(14) → TIP(16)
//   pinky:  MCP(17) → PIP(18) → TIP(20)
const FINGER_CHAINS: readonly { base: number; mid: number; tip: number }[] = [
  { base: 2,  mid: 3,  tip: FINGERTIPS.thumb },
  { base: 5,  mid: 6,  tip: FINGERTIPS.index },
  { base: 9,  mid: 10, tip: FINGERTIPS.middle },
  { base: 13, mid: 14, tip: FINGERTIPS.ring },
  { base: 17, mid: 18, tip: FINGERTIPS.pinky },
] as const;

// Straightness threshold (cos of the angle at the mid joint). 1.0 = perfectly straight, 0.0 = 90°,
// -1.0 = fully folded. A well-extended finger sits around 0.85-1.0 in practice; a curled one is
// near -1.0. Thumb IP has more natural flex so we allow a looser threshold.
const STRAIGHTNESS_THRESHOLD: readonly number[] = [0.3, 0.55, 0.55, 0.55, 0.55];

// Finger is "extended" if the (base→mid) direction and (mid→tip) direction are nearly aligned in
// 3D. Uses all three axes so fingers pointed TOWARD the camera (z-forward) still read as extended
// — a pure 2D distance check collapses in that case and gives false negatives.
// Cosine of the angle at the finger's mid joint in 3D. 1.0 = perfectly straight, 0 = 90° bend,
// -1.0 = fully folded back. Used for pointer-pose detection so fingers pointed toward the camera
// still read as extended (z-axis information matters there).
export function fingerStraightness(hand: Hand, fingerIdx: 0 | 1 | 2 | 3 | 4): number {
  const { base, mid, tip } = FINGER_CHAINS[fingerIdx];
  const b = hand[base];
  const m = hand[mid];
  const t = hand[tip];
  const v1x = m.x - b.x, v1y = m.y - b.y, v1z = m.z - b.z;
  const v2x = t.x - m.x, v2y = t.y - m.y, v2z = t.z - m.z;
  const mag1 = Math.hypot(v1x, v1y, v1z);
  const mag2 = Math.hypot(v2x, v2y, v2z);
  if (mag1 === 0 || mag2 === 0) return 0;
  return (v1x * v2x + v1y * v2y + v1z * v2z) / (mag1 * mag2);
}

// 2D-only variant, ignoring the z-axis. MediaPipe's z estimation degrades when the hand is small
// in the frame (far from camera), but x/y stay accurate. Used by click detection where the curl
// motion happens in the image plane anyway — more robust at distance.
export function fingerStraightness2D(hand: Hand, fingerIdx: 0 | 1 | 2 | 3 | 4): number {
  const { base, mid, tip } = FINGER_CHAINS[fingerIdx];
  const b = hand[base];
  const m = hand[mid];
  const t = hand[tip];
  const v1x = m.x - b.x, v1y = m.y - b.y;
  const v2x = t.x - m.x, v2y = t.y - m.y;
  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);
  if (mag1 === 0 || mag2 === 0) return 0;
  return (v1x * v2x + v1y * v2y) / (mag1 * mag2);
}

export function isFingerExtended(hand: Hand, fingerIdx: 0 | 1 | 2 | 3 | 4): boolean {
  return fingerStraightness(hand, fingerIdx) > STRAIGHTNESS_THRESHOLD[fingerIdx];
}

// Returns [thumb, index, middle, ring, pinky] extension flags.
export function fingerExtensions(hand: Hand): [boolean, boolean, boolean, boolean, boolean] {
  return [
    isFingerExtended(hand, 0),
    isFingerExtended(hand, 1),
    isFingerExtended(hand, 2),
    isFingerExtended(hand, 3),
    isFingerExtended(hand, 4),
  ];
}

// Thumb-tip ↔ index-tip distance as a fraction of index-finger length. Computes BOTH the 3D
// ratio and the 2D ratio and returns the minimum. Rationale:
//   - Side-facing hand: 3D is stable, 2D foreshortens (unreliable). 3D wins.
//   - Front-facing hand (palm to camera): MediaPipe's thumb-z gets occluded by the palm and
//     jumps wildly. 3D ratio becomes noise (observed: 0.1–1.6 on a stable pinch). 2D projection
//     stays crisp (thumb & index tips really are close in 2D when pinched). 2D wins.
// Taking min means "if EITHER view agrees the fingers are close, treat as close".
export function pinchDistance(hand: Hand): number {
  const tipT = hand[FINGERTIPS.thumb];
  const tipI = hand[FINGERTIPS.index];
  const mcpI = hand[5]; // index MCP — finger-length reference
  const dxTI = tipT.x - tipI.x;
  const dyTI = tipT.y - tipI.y;
  const dzTI = tipT.z - tipI.z;
  const dxIM = tipI.x - mcpI.x;
  const dyIM = tipI.y - mcpI.y;
  const dzIM = tipI.z - mcpI.z;

  const fingerLen3D = Math.hypot(dxIM, dyIM, dzIM);
  const dist3D = Math.hypot(dxTI, dyTI, dzTI);
  const ratio3D = fingerLen3D > 0 ? dist3D / fingerLen3D : Infinity;

  // Skip the 2D reading if the finger is projecting to near-nothing in 2D (pointed almost
  // exactly at the camera) — the denominator would be unreliable.
  const fingerLen2D = Math.hypot(dxIM, dyIM);
  const dist2D = Math.hypot(dxTI, dyTI);
  const ratio2D = fingerLen2D > 0.02 ? dist2D / fingerLen2D : Infinity;

  return Math.min(ratio3D, ratio2D);
}

// Normalized openness of the whole hand. Sum of fingertip-to-wrist distances divided by bbox
// long-edge. Fist ≈ 2.5-3.0 (tips near wrist), open palm ≈ 5.5-6.5 (tips extended). Used to gate
// the zoom gesture (requires all 5 fingers extended, which produces a high spread).
export function handSpread(hand: Hand): number {
  const wrist = hand[WRIST];
  const bbox = handBBox(hand);
  const scale = Math.max(bbox.width, bbox.height) || 1;
  let sum = 0;
  sum += dist2d(hand[FINGERTIPS.thumb], wrist);
  sum += dist2d(hand[FINGERTIPS.index], wrist);
  sum += dist2d(hand[FINGERTIPS.middle], wrist);
  sum += dist2d(hand[FINGERTIPS.ring], wrist);
  sum += dist2d(hand[FINGERTIPS.pinky], wrist);
  return sum / scale;
}
