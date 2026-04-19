// Synthetic hand constructor for unit tests. Builds 21 landmarks parametrically so each pose
// produces deterministic values for the primitives in src/gestures/fingers.ts. Real captured
// fixtures (via the Shift+F dump in dev) can be added as JSON later; these synthetic hands are
// enough to prove the reducer logic end-to-end.
//
// Layout:
//   - wrist at (0.5, 0.9)
//   - fingers radiate upward from wrist at fanned-out angles
//   - MCPs at distance 0.10 from wrist (0.08 for thumb)
//   - TIPs at 0.30 from wrist when "extended", 0.08 when "folded"
//   - PIP/DIP linearly interpolated between MCP and TIP

import type { Hand, Landmark } from '@/gestures/types';

export type Ext = [boolean, boolean, boolean, boolean, boolean];

const BASE_FINGER_OFFSETS: readonly number[] = [
  -Math.PI / 3.0, // thumb (upper-left)
  -Math.PI / 9,   // index
  -Math.PI / 30,  // middle
   Math.PI / 22,  // ring
   Math.PI / 10,  // pinky
];
const CENTER_ANGLE = -Math.PI / 2;

const MCP_DIST = 0.1;
const THUMB_MCP_DIST = 0.07;
const TIP_EXT = 0.3;
// A folded finger: PIP extends a bit past the MCP, then TIP bends back toward the palm so the
// (MCP→PIP) and (PIP→TIP) vectors oppose — exactly what the angle-based extension check needs
// to classify as "not extended".
const PIP_FOLD_EXT = 0.04;   // how far PIP pokes past MCP along the finger's base angle
const TIP_FOLD_BEND = 0.045; // PIP→TIP distance after bending back

export interface MakeHandOptions {
  wrist?: Landmark;
  extensions?: Ext;
  // Overrides the thumb-tip position to land a given 2D distance from the index tip. Used to
  // simulate pinch / release without otherwise disturbing the hand shape.
  pinchSeparation?: number;
  // Multiplies each finger's angular offset from straight-up. >1 fans the fingers wider apart
  // (simulates opening a "zoom" gesture); <1 bunches them together. Default 1.
  fingerAngleScale?: number;
}

export function makeHand(opts: MakeHandOptions = {}): Hand {
  const wrist: Landmark = opts.wrist ?? { x: 0.5, y: 0.9, z: 0 };
  const ext: Ext = opts.extensions ?? [false, false, false, false, false];

  const hand: Landmark[] = Array.from({ length: 21 }, () => ({ ...wrist }));
  hand[0] = { ...wrist };

  // Per-finger base landmark index: thumb starts at 1, index at 5, ...
  const BASE = [1, 5, 9, 13, 17];
  const angleScale = opts.fingerAngleScale ?? 1;

  for (let f = 0; f < 5; f++) {
    const angle = CENTER_ANGLE + BASE_FINGER_OFFSETS[f] * angleScale;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const mcpD = f === 0 ? THUMB_MCP_DIST : MCP_DIST;

    const mcp = { x: wrist.x + cos * mcpD, y: wrist.y + sin * mcpD, z: 0 };

    let pip: Landmark;
    let dip: Landmark;
    let tip: Landmark;

    if (ext[f]) {
      // Extended: straight line from MCP outward to TIP at TIP_EXT distance from wrist.
      tip = { x: wrist.x + cos * TIP_EXT, y: wrist.y + sin * TIP_EXT, z: 0 };
      pip = { x: mcp.x + (tip.x - mcp.x) * 0.33, y: mcp.y + (tip.y - mcp.y) * 0.33, z: 0 };
      dip = { x: mcp.x + (tip.x - mcp.x) * 0.66, y: mcp.y + (tip.y - mcp.y) * 0.66, z: 0 };
    } else {
      // Folded: PIP pokes out a bit, then TIP bends 180° back so the (MCP→PIP) and (PIP→TIP)
      // unit vectors are anti-parallel — classic curled-finger geometry.
      pip = { x: mcp.x + cos * PIP_FOLD_EXT, y: mcp.y + sin * PIP_FOLD_EXT, z: 0 };
      tip = { x: pip.x - cos * TIP_FOLD_BEND, y: pip.y - sin * TIP_FOLD_BEND, z: 0 };
      dip = { x: (pip.x + tip.x) / 2, y: (pip.y + tip.y) / 2, z: 0 };
    }

    const base = BASE[f];
    if (f === 0) {
      // Thumb: CMC, MCP, IP, TIP
      hand[base] = {
        x: wrist.x + cos * mcpD * 0.4,
        y: wrist.y + sin * mcpD * 0.4,
        z: 0,
      };
      hand[base + 1] = mcp;
      hand[base + 2] = pip;
      hand[base + 3] = tip;
    } else {
      // Non-thumb: MCP, PIP, DIP, TIP
      hand[base] = mcp;
      hand[base + 1] = pip;
      hand[base + 2] = dip;
      hand[base + 3] = tip;
    }
  }

  // Optional pinch override: place thumb tip at a given separation from the index tip along x.
  if (opts.pinchSeparation !== undefined) {
    const indexTip = hand[8];
    hand[4] = { x: indexTip.x + opts.pinchSeparation, y: indexTip.y + 0.002, z: 0 };
  }

  return hand;
}

// Canonical presets
export const pointingHand = (pinchSeparation?: number) =>
  makeHand({ extensions: [false, true, false, false, false], pinchSeparation });

export const fistHand = () => makeHand({ extensions: [false, false, false, false, false] });

// `cameraScale` simulates moving the hand toward or away from the camera — multiplies all
// landmarks relative to the wrist. `fingerAngleScale` fans the fingers apart (zoom-in-ish).
export const openHand = (cameraScale = 1, fingerAngleScale = 1) => {
  const h = makeHand({ extensions: [true, true, true, true, true], fingerAngleScale });
  if (cameraScale === 1) return h;
  const wrist = h[0];
  return h.map((p) => ({
    x: wrist.x + (p.x - wrist.x) * cameraScale,
    y: wrist.y + (p.y - wrist.y) * cameraScale,
    z: 0,
  }));
};
