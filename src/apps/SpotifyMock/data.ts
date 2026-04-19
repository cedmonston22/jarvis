export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  gradient: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  gradient: string;
  trackIds: string[];
}

export const TRACKS: readonly Track[] = [
  {
    id: 't-midnight-city',
    title: 'Midnight City',
    artist: 'M83',
    album: 'Hurry Up, We’re Dreaming',
    durationSec: 244,
    gradient: 'linear-gradient(135deg, #f6d365, #fda085)',
  },
  {
    id: 't-svefn-g-englar',
    title: 'Svefn-g-Englar',
    artist: 'Sigur Rós',
    album: 'Ágætis Byrjun',
    durationSec: 603,
    gradient: 'linear-gradient(135deg, #4facfe, #00f2fe)',
  },
  {
    id: 't-an-ending',
    title: 'An Ending (Ascent)',
    artist: 'Brian Eno',
    album: 'Apollo: Atmospheres and Soundtracks',
    durationSec: 265,
    gradient: 'linear-gradient(135deg, #232526, #414345)',
  },
  {
    id: 't-protection',
    title: 'Protection',
    artist: 'Massive Attack',
    album: 'Protection',
    durationSec: 466,
    gradient: 'linear-gradient(135deg, #434343, #000000)',
  },
  {
    id: 't-teardrop',
    title: 'Teardrop',
    artist: 'Massive Attack',
    album: 'Mezzanine',
    durationSec: 331,
    gradient: 'linear-gradient(135deg, #1e3c72, #2a5298)',
  },
  {
    id: 't-intro',
    title: 'Intro',
    artist: 'The xx',
    album: 'xx',
    durationSec: 127,
    gradient: 'linear-gradient(135deg, #000428, #004e92)',
  },
  {
    id: 't-star-guitar',
    title: 'Star Guitar',
    artist: 'The Chemical Brothers',
    album: 'Come with Us',
    durationSec: 306,
    gradient: 'linear-gradient(135deg, #ff9966, #ff5e62)',
  },
  {
    id: 't-nude',
    title: 'Nude',
    artist: 'Radiohead',
    album: 'In Rainbows',
    durationSec: 255,
    gradient: 'linear-gradient(135deg, #5f2c82, #49a09d)',
  },
  {
    id: 't-little-fluffy-clouds',
    title: 'Little Fluffy Clouds',
    artist: 'The Orb',
    album: 'The Orb’s Adventures Beyond the Ultraworld',
    durationSec: 271,
    gradient: 'linear-gradient(135deg, #8edce6, #f6f6f6)',
  },
  {
    id: 't-windowlicker',
    title: 'Windowlicker',
    artist: 'Aphex Twin',
    album: 'Windowlicker',
    durationSec: 366,
    gradient: 'linear-gradient(135deg, #ff0844, #ffb199)',
  },
];

export const PLAYLISTS: readonly Playlist[] = [
  {
    id: 'pl-deep-focus',
    name: 'Deep Focus',
    description: 'Quiet music for thinking.',
    gradient: 'linear-gradient(135deg, #1e3c72, #2a5298)',
    trackIds: ['t-an-ending', 't-svefn-g-englar', 't-intro', 't-nude'],
  },
  {
    id: 'pl-late-night',
    name: 'Late Night Drive',
    description: 'Neon highways and bass.',
    gradient: 'linear-gradient(135deg, #f6d365, #fda085)',
    trackIds: ['t-midnight-city', 't-star-guitar', 't-teardrop', 't-windowlicker'],
  },
  {
    id: 'pl-ambient',
    name: 'Ambient Essentials',
    description: 'Beds of sound, no drums.',
    gradient: 'linear-gradient(135deg, #8edce6, #f6f6f6)',
    trackIds: ['t-little-fluffy-clouds', 't-an-ending', 't-protection'],
  },
];

const TRACK_BY_ID: Record<string, Track> = Object.fromEntries(TRACKS.map((t) => [t.id, t]));

export function getTrack(id: string): Track | undefined {
  return TRACK_BY_ID[id];
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
