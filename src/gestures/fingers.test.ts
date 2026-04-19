import { describe, it, expect } from 'vitest';
import { fingerExtensions, handSpread, pinchDistance, handBBox } from './fingers';
import { fistHand, openHand, pointingHand } from '@/test/fixtures/makeHand';

describe('fingerExtensions', () => {
  it('reports all folded for a fist', () => {
    expect(fingerExtensions(fistHand())).toEqual([false, false, false, false, false]);
  });

  it('reports all extended for an open hand', () => {
    expect(fingerExtensions(openHand())).toEqual([true, true, true, true, true]);
  });

  it('reports only index extended for a pointing hand', () => {
    expect(fingerExtensions(pointingHand())).toEqual([false, true, false, false, false]);
  });
});

describe('pinchDistance', () => {
  it('is large when thumb and index are not pinched', () => {
    // Default pointing hand has thumb folded → thumb tip far from index tip.
    expect(pinchDistance(pointingHand())).toBeGreaterThan(0.5);
  });

  it('is small when thumb is near index tip', () => {
    expect(pinchDistance(pointingHand(0.01))).toBeLessThan(0.35);
  });

  it('stays scale-invariant: same pinch pose → same value at different hand scales', () => {
    const a = pointingHand(0.01);
    const b = openHand(1.5); // wider but not pinched
    expect(pinchDistance(a)).toBeLessThan(0.2);
    // Open hand should always read as "open", even scaled up.
    expect(pinchDistance(b)).toBeGreaterThan(0.2);
  });
});

describe('handSpread', () => {
  it('fist < open palm', () => {
    const fist = handSpread(fistHand());
    const open = handSpread(openHand());
    expect(open).toBeGreaterThan(fist);
  });
});

describe('handBBox', () => {
  it('bounds all landmarks', () => {
    const b = handBBox(openHand());
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
    expect(b.minX).toBeLessThanOrEqual(b.maxX);
    expect(b.minY).toBeLessThanOrEqual(b.maxY);
  });
});
