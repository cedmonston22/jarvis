import { PinchTarget } from '@/components/PinchTarget';
import { SUGGESTION_LABELS } from './data';

export interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
}

const GOOGLE_LETTERS: { letter: string; color: string }[] = [
  { letter: 'G', color: '#4285F4' },
  { letter: 'o', color: '#EA4335' },
  { letter: 'o', color: '#FBBC05' },
  { letter: 'g', color: '#4285F4' },
  { letter: 'l', color: '#34A853' },
  { letter: 'e', color: '#EA4335' },
];

export function SearchBar({ query, onQueryChange }: SearchBarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-center pt-1">
        <div className="flex select-none font-sans text-3xl font-medium tracking-tight">
          {GOOGLE_LETTERS.map((l, i) => (
            <span key={i} style={{ color: l.color }}>
              {l.letter}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white/85">
        <span className="text-white/50">⌕</span>
        <span className="flex-1 truncate">
          {query || <span className="italic text-white/40">pick a suggestion below…</span>}
        </span>
        {query && (
          <PinchTarget
            className="h-6 w-6 border-none bg-transparent p-0 text-center text-xs leading-6 text-white/60"
            onClick={() => onQueryChange('')}
          >
            ×
          </PinchTarget>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {SUGGESTION_LABELS.map((label) => {
          const active = label === query;
          return (
            <PinchTarget
              key={label}
              className={
                'px-3 py-1 text-xs ' +
                (active
                  ? 'border-jarvis-accent bg-jarvis-accent/25 text-white'
                  : 'text-white/75')
              }
              onClick={() => onQueryChange(label)}
            >
              {label}
            </PinchTarget>
          );
        })}
      </div>
    </div>
  );
}
