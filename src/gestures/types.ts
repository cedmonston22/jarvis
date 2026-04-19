// Shared gesture-input types. Landmarks are stored as plain arrays (not MediaPipe's internal
// NormalizedLandmark) so the gesture detectors remain pure, serializable, and fixture-testable.

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

// 21 landmarks per hand, ordered per the MediaPipe hand topology:
//   0: wrist
//   1..4: thumb (CMC -> TIP)
//   5..8: index (MCP -> TIP)
//   9..12: middle
//   13..16: ring
//   17..20: pinky
export type Hand = Landmark[];

// Zero or more detected hands. Left-to-right ordering is MediaPipe's — we don't rely on handedness
// labels. Empty array means no hand visible this frame.
export type Hands = Hand[];
