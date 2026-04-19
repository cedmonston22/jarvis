import { useEffect, useState } from 'react';

export interface FpsHudProps {
  fpsRef: { current: number };
}

// Throttled bridge from per-frame ref to React. Updates 1/s — cheap.
export function FpsHud({ fpsRef }: FpsHudProps) {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setFps(Math.round(fpsRef.current)), 1000);
    return () => window.clearInterval(id);
  }, [fpsRef]);

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-50 rounded-md border border-white/30 bg-black/70 px-2.5 py-1 font-mono text-sm text-jarvis-accent shadow-lg backdrop-blur">
      {fps} fps
    </div>
  );
}
