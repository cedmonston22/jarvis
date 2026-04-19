import { createContext, useContext } from 'react';

// Public shape of the voice context. VoiceProvider (in VoiceController.tsx) populates this.
// Lives in its own file so React Fast Refresh can still hot-reload the provider component — mixing
// non-component exports with component exports disables HMR for the whole file.
export interface VoiceContextValue {
  supported: boolean;
  listening: boolean;
  // Live interim transcript — what the engine is currently hearing mid-utterance.
  interim: string;
  // Most recent parse+dispatch result, held for ~3s so the UI can flash what was heard and done.
  lastOutcome: VoiceOutcome | null;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export interface VoiceOutcome {
  heard: string;
  action: string;
  seq: number;
}

export const VoiceCtx = createContext<VoiceContextValue | null>(null);

export function useVoice(): VoiceContextValue {
  const v = useContext(VoiceCtx);
  if (!v) throw new Error('useVoice must be used inside <VoiceProvider>');
  return v;
}
