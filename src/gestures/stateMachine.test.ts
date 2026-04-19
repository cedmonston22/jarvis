import { describe, it, expect } from 'vitest';
import {
  reduce,
  createInitialState,
  DEFAULT_TUNING,
  type State,
  type Frame,
  type Tuning,
} from './stateMachine';
import { fistHand, openHand, pointingHand } from '@/test/fixtures/makeHand';
import type { Hand } from './types';

// Small tuning for tests: 2-frame freeze window so streaks are quick to reach.
const TUNING: Tuning = {
  ...DEFAULT_TUNING,
  pinchFreezeFrames: 2,
  pointingMinFrames: 2,
  zoomMinFrames: 2,
};

const VIEWPORT = { width: 1000, height: 1000 };

function frame(hand: Hand | null, t: number): Frame {
  return { hand, t, viewport: VIEWPORT };
}

// Run a sequence of hands through the reducer and collect all emitted events.
function run(hands: (Hand | null)[], startT = 0, dtMs = 33, tuning = TUNING) {
  let state: State = createInitialState();
  const allEvents: { frame: number; events: ReturnType<typeof reduce>['events'] }[] = [];
  hands.forEach((hand, i) => {
    const result = reduce(state, frame(hand, startT + i * dtMs), tuning);
    state = result.state;
    if (result.events.length) allEvents.push({ frame: i, events: result.events });
  });
  return { state, allEvents };
}

describe('reduce — IDLE → POINTING', () => {
  it('enters POINTING after pointingMinFrames of the pose', () => {
    const { state } = run([pointingHand(), pointingHand(), pointingHand()]);
    expect(state.mode).toBe('POINTING');
  });

  it('emits pointer:move on POINTING entry and on subsequent frames', () => {
    const { allEvents } = run([pointingHand(), pointingHand(), pointingHand(), pointingHand()]);
    const moves = allEvents.flatMap((e) => e.events).filter((e) => e.type === 'pointer:move');
    expect(moves.length).toBeGreaterThanOrEqual(2);
  });

  it('does not enter POINTING from a fist', () => {
    const { state } = run([fistHand(), fistHand(), fistHand()]);
    expect(state.mode).toBe('IDLE');
  });

  it('stays in POINTING through a brief non-pointer stumble (grace window)', () => {
    // 3 frames to enter POINTING, 1 stumble, 1 back to pointer — should NOT drop to IDLE.
    const { state } = run([
      pointingHand(), pointingHand(), pointingHand(),
      fistHand(),       // 1-frame stumble
      pointingHand(),
    ]);
    expect(state.mode).toBe('POINTING');
  });

  it('exits POINTING after pointerExitFrames consecutive non-pointer frames', () => {
    const stumbleFrames = Array(DEFAULT_TUNING.pointerExitFrames + 1).fill(fistHand());
    const { state } = run([
      pointingHand(), pointingHand(), pointingHand(),
      ...stumbleFrames,
    ]);
    expect(state.mode).toBe('IDLE');
  });
});

describe('reduce — pinch lifecycle', () => {
  it('POINTING → PINCH_PENDING freezes the cursor', () => {
    const sequence = [
      pointingHand(), pointingHand(), pointingHand(), // enter POINTING
      pointingHand(0.01),                              // start pinch (pinchDist < pinchIn)
    ];
    const { state } = run(sequence);
    expect(state.mode).toBe('PINCH_PENDING');
    expect(state.frozenCursor).not.toBeNull();
  });

  it('emits pinch:down after freeze window elapses', () => {
    const sequence = [
      pointingHand(), pointingHand(), pointingHand(),       // POINTING
      pointingHand(0.01), pointingHand(0.01), pointingHand(0.01), // freeze + commit
    ];
    const { state, allEvents } = run(sequence);
    expect(state.mode).toBe('PINCH_DOWN');
    const flat = allEvents.flatMap((e) => e.events);
    expect(flat.some((e) => e.type === 'pinch:down')).toBe(true);
  });

  it('emits pinch:down at the cursor latched at pinch-start, not drifting with the fingertip', () => {
    let state: State = createInitialState();
    // Enter POINTING.
    for (let i = 0; i < 3; i++) {
      state = reduce(state, frame(pointingHand(), i * 33), TUNING).state;
    }
    // Transition to PINCH_PENDING on frame 3. frozenCursor is captured here.
    state = reduce(state, frame(pointingHand(0.01), 3 * 33), TUNING).state;
    expect(state.mode).toBe('PINCH_PENDING');
    const frozen = state.frozenCursor;
    expect(frozen).not.toBeNull();

    // Shift the hand dramatically while still pinching. pinch:down fires after the freeze window;
    // its coords must match the latched cursor, not the new fingertip position.
    const shifted = pointingHand(0.01).map((p) => ({ x: p.x + 0.3, y: p.y - 0.15, z: 0 }));
    for (let i = 4; i < 8; i++) {
      const r = reduce(state, frame(shifted, i * 33), TUNING);
      state = r.state;
      const down = r.events.find((e) => e.type === 'pinch:down');
      if (down && down.type === 'pinch:down') {
        expect(down.x).toBeCloseTo(frozen!.x, 0);
        expect(down.y).toBeCloseTo(frozen!.y, 0);
        return;
      }
    }
    throw new Error('expected pinch:down event');
  });

  it('releasing before the freeze window cancels without emitting pinch:down', () => {
    const sequence = [
      pointingHand(), pointingHand(), pointingHand(),
      pointingHand(0.01),          // enter PINCH_PENDING
      pointingHand(0.4),           // release (pinchDist > pinchOut)
      pointingHand(),
    ];
    const { allEvents } = run(sequence);
    const flat = allEvents.flatMap((e) => e.events);
    expect(flat.some((e) => e.type === 'pinch:down')).toBe(false);
    expect(flat.some((e) => e.type === 'pinch:up')).toBe(false);
  });

  it('emits pinch:up when pinch releases after commit', () => {
    const sequence = [
      pointingHand(), pointingHand(), pointingHand(),     // POINTING
      pointingHand(0.01), pointingHand(0.01), pointingHand(0.01),  // freeze + down
      pointingHand(0.6),                                   // release
    ];
    const { allEvents } = run(sequence);
    const flat = allEvents.flatMap((e) => e.events);
    expect(flat.some((e) => e.type === 'pinch:down')).toBe(true);
    expect(flat.some((e) => e.type === 'pinch:up')).toBe(true);
  });
});

describe('reduce — drag lifecycle', () => {
  it('promotes PINCH_DOWN → DRAGGING once midpoint travels beyond threshold', () => {
    // Settle into PINCH_DOWN.
    const pinchSeq: Hand[] = [
      pointingHand(), pointingHand(), pointingHand(),
      pointingHand(0.01), pointingHand(0.01), pointingHand(0.01),
    ];
    let state: State = createInitialState();
    pinchSeq.forEach((h, i) => {
      state = reduce(state, frame(h, i * 33), TUNING).state;
    });
    expect(state.mode).toBe('PINCH_DOWN');

    // Now translate the entire hand to move the pinch midpoint > dragThreshold normalized.
    const shifted = pointingHand(0.01).map((p) => ({ x: p.x + 0.2, y: p.y, z: 0 }));
    const r = reduce(state, frame(shifted, 200), TUNING);
    expect(r.state.mode).toBe('DRAGGING');
    expect(r.events.some((e) => e.type === 'drag:start')).toBe(true);
  });
});

describe('reduce — zoom gesture', () => {
  it('enters ZOOMING when all 5 fingers are extended for zoomMinFrames', () => {
    const { state } = run([openHand(), openHand(), openHand()]);
    expect(state.mode).toBe('ZOOMING');
  });

  it('emits zoom:delta when finger spread changes beyond deadband', () => {
    // openHand(cameraScale, fingerAngleScale). Fan the fingers wider while keeping the hand at
    // the same camera distance — this changes handSpread and should trigger zoom:delta.
    let state: State = createInitialState();
    state = reduce(state, frame(openHand(1, 1.0), 0), TUNING).state;
    state = reduce(state, frame(openHand(1, 1.0), 33), TUNING).state;
    state = reduce(state, frame(openHand(1, 1.0), 66), TUNING).state;
    expect(state.mode).toBe('ZOOMING');
    const r = reduce(state, frame(openHand(1, 1.4), 99), TUNING);
    const delta = r.events.find((e) => e.type === 'zoom:delta');
    expect(delta).toBeDefined();
    if (delta && delta.type === 'zoom:delta') {
      expect(Math.abs(delta.delta)).toBeGreaterThan(TUNING.zoomDeadband);
    }
  });
});

describe('reduce — hand lost', () => {
  it('resets to IDLE after lostGraceFrames consecutive null frames', () => {
    let state: State = createInitialState();
    // Reach POINTING
    for (let i = 0; i < 3; i++) {
      state = reduce(state, frame(pointingHand(), i * 33), TUNING).state;
    }
    expect(state.mode).toBe('POINTING');
    // Lose the hand for longer than grace window
    for (let i = 0; i < DEFAULT_TUNING.lostGraceFrames + 1; i++) {
      state = reduce(state, frame(null, 1000 + i * 33), TUNING).state;
    }
    expect(state.mode).toBe('IDLE');
  });

  it('fires pinch:up if the hand vanishes mid-pinch', () => {
    let state: State = createInitialState();
    const seq: Hand[] = [
      pointingHand(), pointingHand(), pointingHand(),
      pointingHand(0.01), pointingHand(0.01), pointingHand(0.01),
    ];
    seq.forEach((h, i) => (state = reduce(state, frame(h, i * 33), TUNING).state));
    expect(state.mode).toBe('PINCH_DOWN');

    const events: string[] = [];
    for (let i = 0; i < DEFAULT_TUNING.lostGraceFrames + 1; i++) {
      const r = reduce(state, frame(null, 1000 + i * 33), TUNING);
      state = r.state;
      r.events.forEach((e) => events.push(e.type));
    }
    expect(events).toContain('pinch:up');
    expect(state.mode).toBe('IDLE');
  });
});
