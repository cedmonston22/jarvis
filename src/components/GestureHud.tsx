import { useEffect, useState } from 'react';
import type { Mode } from '@/gestures/stateMachine';
import type { TapState } from '@/gestures/detectors/airTap';
import type { GestureBus, GestureEvent } from '@/gestures/bus';

export interface GestureHudProps {
  modeRef: React.MutableRefObject<Mode>;
  tapStateRef: React.MutableRefObject<TapState>;
  pinchDistRef: React.MutableRefObject<number>;
  bus: GestureBus;
}

// Tiny debug HUD: current mode + last few events + live air-tap signal. Polls refs at 10Hz
// (cheap) and subscribes to the bus for events. The tap signal helps calibrate the thresholds —
// if you see vz never going negative during a forward poke, the detector will never fire.
export function GestureHud({ modeRef, tapStateRef, pinchDistRef, bus }: GestureHudProps) {
  const [mode, setMode] = useState<Mode>('IDLE');
  const [tapPhase, setTapPhase] = useState('IDLE');
  const [minStraight, setMinStraight] = useState(1);
  const [pinchDist, setPinchDist] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setMode(modeRef.current);
      setTapPhase(tapStateRef.current.phase);
      setMinStraight(tapStateRef.current.minStraight);
      setPinchDist(pinchDistRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [modeRef, tapStateRef, pinchDistRef]);

  useEffect(() => {
    // Filter continuous streams (pointer:move, drag:move, bimanual:pinch:move) so we don't
    // re-render React 30× per second. Only discrete-moment events land in the log.
    return bus.subscribe((e) => {
      if (
        e.type === 'pointer:move' ||
        e.type === 'drag:move' ||
        e.type === 'bimanual:pinch:move' ||
        e.type === 'hand:pinch:move'
      ) return;
      setLog((prev) => [formatEvent(e), ...prev].slice(0, 5));
    });
  }, [bus]);

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 min-w-[200px] rounded-md border border-white/20 bg-black/70 p-2 font-mono text-[11px] text-white/80 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: modeColor(mode) }} />
        <span className="text-white/95">{mode}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-white/55">
        <span>curl {tapPhase.toLowerCase()}</span>
        <span className="text-white/25">|</span>
        <span className={minStraight <= 0.85 ? 'text-green-400' : 'text-white/40'}>
          min {minStraight.toFixed(2)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/55">
        <span className={pinchDist < 0.4 ? 'text-green-400' : pinchDist < 0.85 ? 'text-amber-300' : 'text-white/40'}>
          pinch {pinchDist.toFixed(2)}
        </span>
      </div>
      <div className="mt-1.5 space-y-0.5 text-white/50">
        {log.length === 0 && <div className="text-white/30">no events</div>}
        {log.map((line, i) => (
          <div key={i} className={i === 0 ? 'text-jarvis-accent' : undefined}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatEvent(e: GestureEvent): string {
  switch (e.type) {
    case 'pointer:move':
      return 'pointer:move';
    case 'click':
      return `click @ ${Math.round(e.x)},${Math.round(e.y)}`;
    case 'pinch:down':
      return `pinch:down @ ${Math.round(e.x)},${Math.round(e.y)}`;
    case 'pinch:up':
      return `pinch:up @ ${Math.round(e.x)},${Math.round(e.y)}`;
    case 'drag:start':
      return `drag:start @ ${Math.round(e.x)},${Math.round(e.y)}`;
    case 'drag:move':
      return 'drag:move';
    case 'drag:end':
      return `drag:end @ ${Math.round(e.x)},${Math.round(e.y)}`;
    case 'bimanual:pinch:start':
      return `bimanual:start`;
    case 'bimanual:pinch:move':
      return 'bimanual:move';
    case 'bimanual:pinch:end':
      return 'bimanual:end';
    case 'hand:pinch:start':
      return `hand${e.hand}:pinch:start`;
    case 'hand:pinch:move':
      return `hand${e.hand}:pinch:move`;
    case 'hand:pinch:end':
      return `hand${e.hand}:pinch:end`;
  }
}

function modeColor(mode: Mode): string {
  switch (mode) {
    case 'IDLE':
      return 'rgba(255,255,255,0.35)';
    case 'POINTING':
      return 'rgba(124,200,255,0.9)';
    case 'PINCH_PENDING':
      return 'rgba(255,210,100,0.9)';
    case 'PINCH_DOWN':
    case 'DRAGGING':
      return 'rgba(124,200,255,1)';
  }
}
