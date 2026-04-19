import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal shape of the browser's SpeechRecognition API. Not in lib.dom.d.ts across all TS targets,
// so declared locally rather than pulling in @types/dom-speech-recognition. We only touch the
// fields/events we actually use.
interface RecResultAlt {
  transcript: string;
}

interface RecResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecResultAlt;
}

interface RecResultList {
  readonly length: number;
  readonly [index: number]: RecResult;
}

interface RecEvent {
  readonly resultIndex: number;
  readonly results: RecResultList;
}

interface RecErrorEvent {
  readonly error: string;
}

interface SpeechRecLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: RecErrorEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecCtor = new () => SpeechRecLike;

function getCtor(): SpeechRecCtor | null {
  if (typeof window === 'undefined') return null;
  const g = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

export interface FinalTranscript {
  text: string;
  // Incrementing per-utterance counter. Downstream effects `useEffect`-on-this-object so the same
  // phrase spoken twice still triggers (string-identity comparison wouldn't).
  seq: number;
}

export interface UseSpeechRecognitionResult {
  supported: boolean;
  listening: boolean;
  // Live interim transcript — updates many times per utterance, cleared when the utterance
  // finalizes. For the "I'm hearing X" affordance in the UI.
  interim: string;
  // Final transcript bumped each time the engine commits an utterance.
  finalTranscript: FinalTranscript | null;
  error: string | null;
  start: () => void;
  stop: () => void;
}

// Thin React wrapper around window.SpeechRecognition. Chromium-only; on unsupported browsers
// (Firefox, Safari desktop) `supported` is false and start/stop no-op.
//
// Behavior:
// - Continuous + interim results.
// - Auto-restarts on `onend` while the caller has it "on" — Chromium's engine ends sessions every
//   ~60s of silence and without this the button would silently go dead.
// - Ignores "no-speech" and "aborted" errors on auto-restart paths.
// - Cleans up the instance on unmount.
export function useSpeechRecognition(): UseSpeechRecognitionResult {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [finalTranscript, setFinalTranscript] = useState<FinalTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecLike | null>(null);
  // Mirrors `listening` for use inside the stable `onend` handler — setState is async so reading
  // the state var there would race.
  const wantListeningRef = useRef(false);
  const seqRef = useRef(0);

  useEffect(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = 'en-US';

    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) {
          const trimmed = t.trim();
          if (trimmed) {
            seqRef.current += 1;
            setFinalTranscript({ text: trimmed, seq: seqRef.current });
          }
        } else {
          interimText += t;
        }
      }
      setInterim(interimText.trim());
    };

    rec.onerror = (e) => {
      // "no-speech" fires after a silent window; "aborted" fires on our own stop() call. Neither
      // is actionable to the user, and both resolve on the next auto-restart cycle.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(e.error);
    };

    rec.onstart = () => {
      setError(null);
    };

    rec.onend = () => {
      setInterim('');
      if (wantListeningRef.current) {
        // Engine closed a session — restart silently. Chrome throws if start() runs too close to
        // onend; swallow and the next onend will retry.
        try {
          rec.start();
        } catch {
          /* noop */
        }
      } else {
        setListening(false);
      }
    };

    recRef.current = rec;

    return () => {
      wantListeningRef.current = false;
      rec.onresult = null;
      rec.onerror = null;
      rec.onstart = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* noop */
      }
      recRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    wantListeningRef.current = true;
    setListening(true);
    try {
      rec.start();
    } catch {
      // InvalidStateError — already running. That's fine.
    }
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    wantListeningRef.current = false;
    setListening(false);
    setInterim('');
    try {
      rec.stop();
    } catch {
      /* noop */
    }
  }, []);

  return { supported, listening, interim, finalTranscript, error, start, stop };
}
