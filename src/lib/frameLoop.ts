// rVFC-based frame loop with RAF fallback. Keeps the per-frame hot path out of React.
// Callback receives dt in ms and an absolute timestamp. Return value from start() stops the loop.

export type FrameCallback = (dt: number, now: number) => void;

export function startFrameLoop(video: HTMLVideoElement, cb: FrameCallback): () => void {
  const hasRVFC = typeof video.requestVideoFrameCallback === 'function';
  let stopped = false;
  let last = performance.now();
  let rvfcHandle: number | undefined;
  let rafHandle: number | undefined;

  const tickRVFC = (now: number) => {
    if (stopped) return;
    const dt = now - last;
    last = now;
    cb(dt, now);
    rvfcHandle = video.requestVideoFrameCallback(tickRVFC);
  };

  const tickRAF = () => {
    if (stopped) return;
    const now = performance.now();
    const dt = now - last;
    last = now;
    cb(dt, now);
    rafHandle = requestAnimationFrame(tickRAF);
  };

  if (hasRVFC) {
    rvfcHandle = video.requestVideoFrameCallback(tickRVFC);
  } else {
    rafHandle = requestAnimationFrame(tickRAF);
  }

  return () => {
    stopped = true;
    if (rvfcHandle !== undefined) video.cancelVideoFrameCallback(rvfcHandle);
    if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
  };
}

// Rolling-average FPS tracker. Read fps.ref.current from a 1Hz interval, never per-frame.
export function makeFpsTracker(windowSize = 30) {
  const samples: number[] = [];
  const ref = { current: 0 };
  return {
    ref,
    sample(dt: number) {
      samples.push(dt);
      if (samples.length > windowSize) samples.shift();
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      ref.current = avg > 0 ? 1000 / avg : 0;
    },
  };
}
