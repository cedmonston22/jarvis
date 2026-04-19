import { useRef, useState } from 'react';
import { PinchTarget } from './PinchTarget';

interface TileSpec {
  id: string;
  label: string;
  icon: string;
  position: { left: string; top: string };
}

const TILES: TileSpec[] = [
  { id: 'google',   label: 'Google',   icon: 'G', position: { left: '8%',  top: '28%' } },
  { id: 'spotify',  label: 'Spotify',  icon: 'S', position: { left: '8%',  top: '52%' } },
  { id: 'calendar', label: 'Calendar', icon: 'C', position: { left: '84%', top: '28%' } },
  { id: 'notes',    label: 'Notes',    icon: 'N', position: { left: '84%', top: '52%' } },
];

// Temporary M6/M7 demo: four floating tiles arranged around the stage perimeter. Each responds to
// the fingertip — hover glows, air-tap click increments a counter, and pinch-and-drag moves the
// tile. These get replaced by real windows + app launcher in M8.
export function DemoTiles() {
  return (
    <>
      {TILES.map((tile) => (
        <DemoTile key={tile.id} tile={tile} />
      ))}
    </>
  );
}

function DemoTile({ tile }: { tile: TileSpec }) {
  // committed offset = where the tile settles between drags. liveDelta = the in-flight drag delta
  // since pinch-start, or null when not dragging. Rendered position = committed + live.
  const [committed, setCommitted] = useState({ x: 0, y: 0 });
  const [liveDelta, setLiveDelta] = useState<{ dx: number; dy: number } | null>(null);
  const [clicks, setClicks] = useState(0);
  // Ref mirrors liveDelta for use inside onDragEnd (avoids a stale-closure commit).
  const liveRef = useRef<{ dx: number; dy: number } | null>(null);

  const rendered = liveDelta
    ? { x: committed.x + liveDelta.dx, y: committed.y + liveDelta.dy }
    : committed;

  return (
    <PinchTarget
      style={{
        position: 'fixed',
        left: tile.position.left,
        top: tile.position.top,
        zIndex: liveDelta ? 25 : 20, // lift while dragging so it's above siblings
        transform: 'translate(-50%, -50%)',
      }}
      className="flex h-28 w-28 flex-col items-center justify-center gap-1 text-white"
      dragOffset={rendered}
      onClick={() => setClicks((c) => c + 1)}
      onDragStart={() => {
        liveRef.current = { dx: 0, dy: 0 };
        setLiveDelta({ dx: 0, dy: 0 });
      }}
      onDragDelta={(dx, dy) => {
        liveRef.current = { dx, dy };
        setLiveDelta({ dx, dy });
      }}
      onDragEnd={() => {
        const live = liveRef.current;
        if (live) {
          setCommitted((prev) => ({ x: prev.x + live.dx, y: prev.y + live.dy }));
        }
        liveRef.current = null;
        setLiveDelta(null);
      }}
    >
      <div className="font-mono text-4xl font-semibold text-jarvis-accent">{tile.icon}</div>
      <div className="text-xs text-white/75">{tile.label}</div>
      <div className="font-mono text-[10px] text-white/50">
        {clicks ? `clicks ${clicks}` : '—'}
      </div>
    </PinchTarget>
  );
}
