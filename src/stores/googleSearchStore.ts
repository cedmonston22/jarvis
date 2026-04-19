import { create } from 'zustand';

// Lifted GoogleMock query state. Lives outside the component so voice commands (in VoiceProvider)
// can push queries into the search UI without prop drilling or ref handles. Any component that
// wants to read or set the query just subscribes to this slice.
export interface GoogleSearchStore {
  query: string;
  setQuery: (q: string) => void;
}

export const useGoogleSearchStore = create<GoogleSearchStore>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
}));
