import { useEffect, useRef, useState } from 'react';
import { NowPlaying } from './NowPlaying';
import { Library } from './Library';
import { PLAYLISTS, getTrack } from './data';

export function SpotifyMockApp() {
  const [playlistId, setPlaylistId] = useState<string>(PLAYLISTS[0].id);
  const [trackId, setTrackId] = useState<string>(PLAYLISTS[0].trackIds[0]);
  const [progressSec, setProgressSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const lastTickRef = useRef<number | null>(null);

  const playlist = PLAYLISTS.find((p) => p.id === playlistId) ?? PLAYLISTS[0];
  const track = getTrack(trackId) ?? getTrack(playlist.trackIds[0])!;

  // Advance the progress bar while playing. rAF-driven so it pauses cleanly when the tab loses
  // focus; uses wall-clock deltas so long frame gaps don't cause runaway progress.
  useEffect(() => {
    if (!isPlaying) {
      lastTickRef.current = null;
      return;
    }
    let raf = 0;
    const tick = (t: number) => {
      const last = lastTickRef.current ?? t;
      const dt = (t - last) / 1000;
      lastTickRef.current = t;
      setProgressSec((prev) => {
        const next = prev + dt;
        if (next >= track.durationSec) {
          const idx = playlist.trackIds.indexOf(track.id);
          const nextId = playlist.trackIds[(idx + 1) % playlist.trackIds.length];
          setTrackId(nextId);
          return 0;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, track.durationSec, track.id, playlist.trackIds]);

  const selectTrack = (id: string) => {
    setTrackId(id);
    setProgressSec(0);
    setIsPlaying(true);
  };

  const selectPlaylist = (id: string) => {
    const next = PLAYLISTS.find((p) => p.id === id);
    if (!next) return;
    setPlaylistId(id);
    if (!next.trackIds.includes(trackId)) {
      setTrackId(next.trackIds[0]);
      setProgressSec(0);
    }
  };

  const step = (delta: 1 | -1) => {
    const idx = playlist.trackIds.indexOf(track.id);
    const nextIdx = (idx + delta + playlist.trackIds.length) % playlist.trackIds.length;
    setTrackId(playlist.trackIds[nextIdx]);
    setProgressSec(0);
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      <NowPlaying
        track={track}
        progressSec={progressSec}
        isPlaying={isPlaying}
        onPlayPause={() => setIsPlaying((p) => !p)}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
      />
      <Library
        activePlaylistId={playlist.id}
        activeTrackId={track.id}
        onSelectPlaylist={selectPlaylist}
        onSelectTrack={selectTrack}
      />
    </div>
  );
}
