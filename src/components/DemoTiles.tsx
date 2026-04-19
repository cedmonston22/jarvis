import { useState } from 'react';
import { PinchTarget } from './PinchTarget';

interface Tile {
  id: string;
  label: string;
  icon: string;
  position: { left: string; top: string };
}

const TILES: Tile[] = [
  { id: 'google',   label: 'Google',   icon: 'G', position: { left: '8%',  top: '28%' } },
  { id: 'spotify',  label: 'Spotify',  icon: 'S', position: { left: '8%',  top: '52%' } },
  { id: 'calendar', label: 'Calendar', icon: 'C', position: { left: '84%', top: '28%' } },
  { id: 'notes',    label: 'Notes',    icon: 'N', position: { left: '84%', top: '52%' } },
];

// Temporary M6 demo: four floating tiles arranged around the stage perimeter. Each responds to
// the fingertip: hover scales up + glows, pinch-click increments a per-tile counter and flashes.
// These get replaced by the real app launcher in M8.
export function DemoTiles() {
  const [counts, setCounts] = useState<Record<string, number>>({});

  return (
    <>
      {TILES.map((tile) => (
        <PinchTarget
          key={tile.id}
          style={{ position: 'fixed', ...tile.position, zIndex: 20, transform: 'translate(-50%, -50%)' }}
          className="pointer-events-none flex h-28 w-28 flex-col items-center justify-center gap-1 text-white"
          onClick={() => setCounts((c) => ({ ...c, [tile.id]: (c[tile.id] ?? 0) + 1 }))}
        >
          <div className="font-mono text-4xl font-semibold text-jarvis-accent">{tile.icon}</div>
          <div className="text-xs text-white/75">{tile.label}</div>
          <div className="font-mono text-[10px] text-white/50">
            {counts[tile.id] ? `clicks ${counts[tile.id]}` : '—'}
          </div>
        </PinchTarget>
      ))}
    </>
  );
}
