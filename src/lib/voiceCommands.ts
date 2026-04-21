// Pure voice-command parser. No DOM / browser APIs so it unit-tests cleanly.
//
// Supported grammar (case-insensitive, trailing punctuation stripped):
//   "open <app>" / "launch <app>" / "show <app>"        → { type: 'open', appId }
//   "close" / "close window" / "close the window"       → { type: 'close' }
//   "search for <query>" / "google <query>" / "look up <query>" / "search <query>"
//                                                       → { type: 'search', query, matchedLabel }
//   "capture <label>" / "save <label>" / "record <label>" (also "capture as <label>")
//                                                       → { type: 'capture', label }
//
// Search queries are fuzzy-matched against a caller-supplied list of canned labels
// (`SUGGESTION_LABELS` in practice) because GoogleMock's results are prebaked — free-form queries
// still land in the UI but with a "no results" state, which the `matchedLabel: null` signal tells
// the caller about.
//
// `capture` is a developer escape hatch for building hand-pose fixtures — the dispatcher uses the
// returned label to name a downloaded JSON of current landmarks.

export type VoiceCommand =
  | { type: 'open'; appId: string }
  | { type: 'close' }
  | { type: 'search'; query: string; matchedLabel: string | null }
  | { type: 'capture'; label: string };

export interface AppAlias {
  appId: string;
  // Lower-cased tokens that map to this app. Speech transcripts contain the app name, never the id.
  aliases: readonly string[];
}

export interface ParseOptions {
  apps: readonly AppAlias[];
  searchLabels: readonly string[];
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'to', 'of', 'on', 'in', 'me', 'please', 'some', 'and', 'at',
]);

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return text.split(' ').filter(Boolean);
}

// Fuzzy-match `query` against a list of canned labels by token overlap.
// Returns the best label if its overlap ratio (against the label's token count) beats a threshold,
// else null. Direct substring containment short-circuits the token path so queries that precisely
// restate the label always win.
export function fuzzyMatchLabel(query: string, labels: readonly string[]): string | null {
  const q = normalize(query);
  if (!q) return null;
  for (const label of labels) {
    const l = label.toLowerCase();
    if (l.includes(q) || q.includes(l)) return label;
  }
  const qTokens = new Set(tokens(q).filter((t) => t.length > 1 && !STOPWORDS.has(t)));
  if (!qTokens.size) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const label of labels) {
    const lTokens = tokens(label.toLowerCase()).filter(
      (t) => t.length > 1 && !STOPWORDS.has(t),
    );
    if (!lTokens.length) continue;
    let overlap = 0;
    for (const t of lTokens) if (qTokens.has(t)) overlap++;
    const score = overlap / lTokens.length;
    if (overlap > 0 && score > bestScore) {
      bestScore = score;
      best = label;
    }
  }
  // ≥ 1/3 of the label's meaningful tokens have to be present. Prevents spurious matches (e.g.
  // a single shared word like "mediapipe" shouldn't latch to a 4-word label).
  return bestScore >= 0.34 ? best : null;
}

// Resolve an app name fragment ("google", "the google app", "goog") to an appId via the alias list.
// Uses word-boundary matching, not substring, to avoid e.g. "open" hitting "open spotify".
function matchApp(text: string, apps: readonly AppAlias[]): string | null {
  const words = new Set(tokens(text));
  for (const app of apps) {
    for (const alias of app.aliases) {
      if (words.has(alias)) return app.appId;
    }
  }
  return null;
}

function sanitizeLabel(raw: string): string {
  // Transcripts come in with spaces and occasional filler; collapse to kebab-case and strip
  // anything that isn't safe for a filename.
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseCommand(raw: string, opts: ParseOptions): VoiceCommand | null {
  const text = normalize(raw);
  if (!text) return null;

  // Capture — ordered first so "capture as pinch" can't be eaten by other matchers. Matches
  // "capture <label>", "capture as <label>", "save <label>", "save as <label>", "record <label>".
  const captureMatch = text.match(/^(?:capture|save|record)(?:\s+as)?\s+(.+)$/);
  if (captureMatch) {
    const label = sanitizeLabel(captureMatch[1].trim());
    if (label) return { type: 'capture', label };
  }

  // Close — matches "close", "close window", "close the window", etc. Rejects phrases that also
  // contain "open" so "close then open spotify" doesn't incorrectly fire close.
  if (/\bclose\b/.test(text) && !/\bopen\b/.test(text) && !/\blaunch\b/.test(text)) {
    return { type: 'close' };
  }

  // Search — "search for X", "search X", "google X", "look up X". Ordered before open-matching so
  // "google pizza" maps to search, not opening Google.
  const searchMatch =
    text.match(/^(?:search(?:\s+for)?|look\s+up|google(?:\s+for)?)\s+(.+)$/) ??
    text.match(/^(?:find|show\s+me)\s+(.+)$/);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    if (query) {
      return {
        type: 'search',
        query,
        matchedLabel: fuzzyMatchLabel(query, opts.searchLabels),
      };
    }
  }

  // Open — "open google", "launch the google app", "show spotify"
  const openMatch = text.match(/\b(?:open|launch|start|show)\b\s+(.+)/);
  if (openMatch) {
    const appId = matchApp(openMatch[1], opts.apps);
    if (appId) return { type: 'open', appId };
  }

  return null;
}
