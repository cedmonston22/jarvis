import { describe, it, expect } from 'vitest';
import { parseCommand, fuzzyMatchLabel, type ParseOptions } from './voiceCommands';

const OPTS: ParseOptions = {
  apps: [
    { appId: 'google', aliases: ['google'] },
    { appId: 'spotify', aliases: ['spotify'] },
  ],
  searchLabels: [
    'mediapipe hand tracking',
    'apple vision pro gestures',
    'best pizza nyc 2026',
    'webgl gaussian blur shader',
    'tailwind dark glass ui',
  ],
};

describe('parseCommand', () => {
  it('opens an app', () => {
    expect(parseCommand('open google', OPTS)).toEqual({ type: 'open', appId: 'google' });
    expect(parseCommand('launch spotify', OPTS)).toEqual({ type: 'open', appId: 'spotify' });
    expect(parseCommand('show spotify', OPTS)).toEqual({ type: 'open', appId: 'spotify' });
  });

  it('handles filler words in the open command', () => {
    expect(parseCommand('open the google app', OPTS)).toEqual({ type: 'open', appId: 'google' });
    expect(parseCommand('please open spotify', OPTS)).toEqual({ type: 'open', appId: 'spotify' });
  });

  it('closes the focused window', () => {
    expect(parseCommand('close', OPTS)).toEqual({ type: 'close' });
    expect(parseCommand('close window', OPTS)).toEqual({ type: 'close' });
    expect(parseCommand('close the window', OPTS)).toEqual({ type: 'close' });
  });

  it('does not fire close if the phrase also asks to open something', () => {
    expect(parseCommand('close spotify and open google', OPTS)).not.toEqual({ type: 'close' });
  });

  it('routes "google <query>" to search, not open', () => {
    const result = parseCommand('google best pizza', OPTS);
    expect(result?.type).toBe('search');
    if (result?.type === 'search') {
      expect(result.query).toBe('best pizza');
      expect(result.matchedLabel).toBe('best pizza nyc 2026');
    }
  });

  it('matches a canned label by token overlap', () => {
    const result = parseCommand('search for vision pro gestures', OPTS);
    expect(result).toEqual({
      type: 'search',
      query: 'vision pro gestures',
      matchedLabel: 'apple vision pro gestures',
    });
  });

  it('returns matchedLabel=null when the query has no canned match', () => {
    const result = parseCommand('search for flight status to tokyo', OPTS);
    expect(result?.type).toBe('search');
    if (result?.type === 'search') {
      expect(result.query).toBe('flight status to tokyo');
      expect(result.matchedLabel).toBeNull();
    }
  });

  it('accepts "look up" as a search verb', () => {
    const result = parseCommand('look up webgl blur', OPTS);
    expect(result?.type).toBe('search');
    if (result?.type === 'search') {
      expect(result.matchedLabel).toBe('webgl gaussian blur shader');
    }
  });

  it('ignores trailing punctuation and extra whitespace', () => {
    expect(parseCommand('  Open, Google!  ', OPTS)).toEqual({ type: 'open', appId: 'google' });
  });

  it('returns null for unrelated phrases', () => {
    expect(parseCommand('what time is it', OPTS)).toBeNull();
    expect(parseCommand('', OPTS)).toBeNull();
    expect(parseCommand('hello there', OPTS)).toBeNull();
  });

  it('returns null for "open" without a recognized app', () => {
    expect(parseCommand('open notepad', OPTS)).toBeNull();
  });
});

describe('fuzzyMatchLabel', () => {
  const labels = OPTS.searchLabels;

  it('matches on substring', () => {
    expect(fuzzyMatchLabel('hand tracking', labels)).toBe('mediapipe hand tracking');
  });

  it('matches on token overlap above threshold', () => {
    expect(fuzzyMatchLabel('pizza nyc', labels)).toBe('best pizza nyc 2026');
  });

  it('rejects weak single-token overlap below threshold', () => {
    // "pro" appears in "apple vision pro gestures" (4 meaningful tokens) but "pro setup" is not a
    // substring of any label → falls through to token scoring: 1/4 = 0.25 < 0.34 threshold.
    expect(fuzzyMatchLabel('pro setup', labels)).toBeNull();
  });

  it('ignores stopwords when scoring', () => {
    // Only "compile" is meaningful — it doesn't appear in any label, so overlap = 0 → null.
    expect(fuzzyMatchLabel('the compile step', labels)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(fuzzyMatchLabel('', labels)).toBeNull();
    expect(fuzzyMatchLabel('   ', labels)).toBeNull();
  });
});
