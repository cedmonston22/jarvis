import type { ComponentType } from 'react';
import { GoogleMockApp } from './GoogleMock';
import { SpotifyMockApp } from './SpotifyMock';

// App manifest shape. Apps are registered here so the dock can enumerate them and the window
// manager can look up defaults/component by id.
export interface AppManifest {
  id: string;
  name: string;
  icon: string;                                      // single-letter glyph for the dock
  defaultSize: { width: number; height: number };    // px; applied on first open
  component: ComponentType;
  accent?: string;                                   // optional tailwind/hex for icon tint
}

export const APPS: Record<string, AppManifest> = {
  google: {
    id: 'google',
    name: 'Google',
    icon: 'G',
    defaultSize: { width: 480, height: 360 },
    component: GoogleMockApp,
    accent: '#7cc8ff',
  },
  spotify: {
    id: 'spotify',
    name: 'Spotify',
    icon: 'S',
    defaultSize: { width: 420, height: 520 },
    component: SpotifyMockApp,
    accent: '#1db954',
  },
};

// Ordered list for the dock. Keeps launch order stable across renders.
export const APP_ORDER: readonly string[] = ['google', 'spotify'];
