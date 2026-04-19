import { PinchTarget } from '@/components/PinchTarget';
import { PLAYLISTS, getTrack, formatTime, type Playlist } from './data';

export interface LibraryProps {
  activePlaylistId: string;
  activeTrackId: string;
  onSelectPlaylist: (id: string) => void;
  onSelectTrack: (id: string) => void;
}

export function Library({
  activePlaylistId,
  activeTrackId,
  onSelectPlaylist,
  onSelectTrack,
}: LibraryProps) {
  const playlist =
    PLAYLISTS.find((p) => p.id === activePlaylistId) ?? PLAYLISTS[0];
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] font-medium uppercase tracking-widest text-white/45">
        Your library
      </div>

      <div className="flex flex-wrap gap-2">
        {PLAYLISTS.map((p) => (
          <PlaylistChip
            key={p.id}
            playlist={p}
            active={p.id === playlist.id}
            onClick={() => onSelectPlaylist(p.id)}
          />
        ))}
      </div>

      <div className="mt-1 flex items-center gap-3">
        <div
          className="h-10 w-10 shrink-0 rounded-md"
          style={{ background: playlist.gradient }}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{playlist.name}</div>
          <div className="truncate text-[11px] text-white/50">{playlist.description}</div>
        </div>
      </div>

      <ul className="flex flex-col">
        {playlist.trackIds.map((id, i) => {
          const track = getTrack(id);
          if (!track) return null;
          const active = id === activeTrackId;
          return (
            <li key={id}>
              <PinchTarget
                className={
                  'flex w-full items-center gap-3 border-none bg-transparent px-2 py-1.5 text-left text-xs ' +
                  (active ? 'text-[#1db954]' : 'text-white/80')
                }
                onClick={() => onSelectTrack(id)}
              >
                <span className="w-5 text-right text-[11px] text-white/40">
                  {active ? '♪' : i + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{track.title}</span>
                  <span className="truncate text-[11px] text-white/50">{track.artist}</span>
                </span>
                <span className="text-[11px] text-white/40">{formatTime(track.durationSec)}</span>
              </PinchTarget>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlaylistChip({
  playlist,
  active,
  onClick,
}: {
  playlist: Playlist;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <PinchTarget
      className={
        'flex items-center gap-2 px-2.5 py-1 text-xs ' +
        (active ? 'border-jarvis-accent text-white' : 'text-white/75')
      }
      onClick={onClick}
    >
      <span
        className="h-3.5 w-3.5 rounded-sm"
        style={{ background: playlist.gradient }}
      />
      <span>{playlist.name}</span>
    </PinchTarget>
  );
}
