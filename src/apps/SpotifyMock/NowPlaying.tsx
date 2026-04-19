import { PinchTarget } from '@/components/PinchTarget';
import { formatTime, type Track } from './data';

export interface NowPlayingProps {
  track: Track;
  progressSec: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function NowPlaying({
  track,
  progressSec,
  isPlaying,
  onPlayPause,
  onPrev,
  onNext,
}: NowPlayingProps) {
  const pct = Math.min(100, (progressSec / track.durationSec) * 100);
  return (
    <div className="flex gap-3 rounded-xl border border-white/10 bg-black/30 p-3">
      <div
        className="flex h-20 w-20 shrink-0 items-end justify-start overflow-hidden rounded-lg p-2 text-sm font-semibold text-white/90 shadow-inner"
        style={{ background: track.gradient }}
      >
        <span className="drop-shadow">{track.album.slice(0, 1)}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{track.title}</div>
          <div className="truncate text-xs text-white/60">{track.artist}</div>
          <div className="truncate text-[11px] text-white/40">{track.album}</div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#1db954]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-white/50">
            <span>{formatTime(progressSec)}</span>
            <span>{formatTime(track.durationSec)}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 pt-1">
          <PinchTarget
            className="flex h-7 w-7 items-center justify-center border-none bg-transparent p-0 text-sm text-white/80"
            onClick={onPrev}
          >
            ⏮
          </PinchTarget>
          <PinchTarget
            className="flex h-9 w-9 items-center justify-center bg-white/15 p-0 text-base text-white"
            onClick={onPlayPause}
          >
            {isPlaying ? '⏸' : '▶'}
          </PinchTarget>
          <PinchTarget
            className="flex h-7 w-7 items-center justify-center border-none bg-transparent p-0 text-sm text-white/80"
            onClick={onNext}
          >
            ⏭
          </PinchTarget>
        </div>
      </div>
    </div>
  );
}
