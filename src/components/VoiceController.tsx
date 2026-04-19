import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { parseCommand, type ParseOptions, type VoiceCommand } from '@/lib/voiceCommands';
import { APPS, APP_ORDER } from '@/apps/registry';
import { SUGGESTION_LABELS } from '@/apps/GoogleMock/data';
import { useWindowStore } from '@/stores/windowStore';
import { useGoogleSearchStore } from '@/stores/googleSearchStore';
import { VoiceCtx, useVoice, type VoiceContextValue, type VoiceOutcome } from './VoiceContext';

// Build ParseOptions from the live app registry so the parser stays in sync if apps are added.
// App aliases default to {id, name} lowercased; extend here if we get apps whose names speech
// recognition mis-transcribes.
function buildParseOptions(): ParseOptions {
  return {
    apps: APP_ORDER.map((id) => ({
      appId: id,
      aliases: [id.toLowerCase(), APPS[id]?.name.toLowerCase() ?? id.toLowerCase()].filter(
        (v, i, a) => a.indexOf(v) === i,
      ),
    })),
    searchLabels: SUGGESTION_LABELS,
  };
}

// Top-level voice provider. Owns the single SpeechRecognition instance (via the hook), parses
// final transcripts into commands, and dispatches them to the relevant zustand stores. Children
// render mic buttons / status via `useVoice()` (from VoiceContext).
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { supported, listening, interim, finalTranscript, error, start, stop } =
    useSpeechRecognition();
  const [lastOutcome, setLastOutcome] = useState<VoiceOutcome | null>(null);

  const openApp = useWindowStore((s) => s.openApp);
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const setQuery = useGoogleSearchStore((s) => s.setQuery);

  // Read-through ref for focusOrder so the close-command can grab the top window without making
  // the dispatch effect re-subscribe every time focus changes.
  const focusOrderRef = useRef(useWindowStore.getState().focusOrder);
  useEffect(() => {
    focusOrderRef.current = useWindowStore.getState().focusOrder;
    return useWindowStore.subscribe((s) => {
      focusOrderRef.current = s.focusOrder;
    });
  }, []);

  const parseOpts = useMemo(buildParseOptions, []);

  // Dispatch on each new final transcript. Keyed on `seq` so the same phrase repeated still fires.
  useEffect(() => {
    if (!finalTranscript) return;
    const cmd = parseCommand(finalTranscript.text, parseOpts);
    const action = describeOutcome(cmd, focusOrderRef.current);
    setLastOutcome({ heard: finalTranscript.text, action, seq: finalTranscript.seq });

    if (!cmd) return;
    switch (cmd.type) {
      case 'open':
        openApp(cmd.appId);
        break;
      case 'close': {
        const top = focusOrderRef.current[focusOrderRef.current.length - 1];
        if (top) closeWindow(top);
        break;
      }
      case 'search':
        openApp('google');
        setQuery(cmd.matchedLabel ?? cmd.query);
        break;
    }
  }, [finalTranscript, parseOpts, openApp, closeWindow, setQuery]);

  // Auto-dismiss the toast after a short window.
  useEffect(() => {
    if (!lastOutcome) return;
    const id = window.setTimeout(() => {
      setLastOutcome((cur) => (cur?.seq === lastOutcome.seq ? null : cur));
    }, 3200);
    return () => window.clearTimeout(id);
  }, [lastOutcome]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  const value = useMemo<VoiceContextValue>(
    () => ({ supported, listening, interim, lastOutcome, error, start, stop, toggle }),
    [supported, listening, interim, lastOutcome, error, start, stop, toggle],
  );

  return (
    <VoiceCtx.Provider value={value}>
      {children}
      <VoiceStatusToast />
    </VoiceCtx.Provider>
  );
}

// Human-readable description of what we did with a command. Used for the toast label.
function describeOutcome(cmd: VoiceCommand | null, focusOrder: readonly string[]): string {
  if (!cmd) return 'unrecognized command';
  switch (cmd.type) {
    case 'open':
      return `open ${APPS[cmd.appId]?.name ?? cmd.appId}`;
    case 'close': {
      const top = focusOrder[focusOrder.length - 1];
      return top ? `close ${APPS[top]?.name ?? top}` : 'no window to close';
    }
    case 'search':
      return cmd.matchedLabel
        ? `search “${cmd.matchedLabel}”`
        : `search “${cmd.query}” (no canned match)`;
  }
}

// Fixed toast at the top-center of the screen showing what was heard and what happened.
function VoiceStatusToast() {
  const { listening, interim, lastOutcome, error, supported } = useVoice();
  if (!supported) return null;
  const showInterim = listening && interim;
  const show = showInterim || lastOutcome || error;
  if (!show) return null;
  return (
    <div
      className="pointer-events-none fixed left-1/2 top-14 z-50 -translate-x-1/2 rounded-lg border border-jarvis-stroke bg-black/70 px-3 py-1.5 text-xs text-white/85 backdrop-blur"
      style={{ maxWidth: '80vw' }}
    >
      {error ? (
        <span className="text-red-300">voice error: {error}</span>
      ) : showInterim ? (
        <span className="italic text-white/60">“{interim}”</span>
      ) : lastOutcome ? (
        <span>
          <span className="text-white/55">heard:</span>{' '}
          <span className="text-white/90">“{lastOutcome.heard}”</span>
          <span className="mx-2 text-white/30">→</span>
          <span className="text-jarvis-accent">{lastOutcome.action}</span>
        </span>
      ) : null}
    </div>
  );
}
