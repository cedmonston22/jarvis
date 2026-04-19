// MediaPipe hand topology: 21 landmarks, 21 skeleton edges. Source of truth for any landmark
// visualization or geometry helper so everything stays consistent with the model's output.
//
//       8   12  16  20
//       |    |   |   |
//       7   11  15  19
//       |    |   |   |
//  4    6   10  14  18
//  |    |    \  |  /
//  3    5 -- 9-13-17
//   \   |     \  |  /
//    2  |      \ | /
//     \ |       \|/
//      1 ------- 0  (wrist)
//
// Finger indices (TIP landmark in parens):
//   thumb (4), index (8), middle (12), ring (16), pinky (20)

export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle (shares MCP chain with index via 5-9)
  [5, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  // Palm edge
  [0, 17],
] as const;

export const FINGERTIPS = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 } as const;
export const WRIST = 0 as const;
