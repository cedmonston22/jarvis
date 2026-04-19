import type { SearchResult } from './data';

export interface ResultsProps {
  query: string;
  results: SearchResult[];
}

export function Results({ query, results }: ResultsProps) {
  if (!query) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-white/45">
        <div>Pick a suggested search to see results.</div>
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-white/45">
        <div>No results for “{query}”.</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="text-[11px] text-white/40">
        About {results.length * 1240000} results (0.{(results.length * 17) % 100} seconds)
      </div>
      {results.map((r, i) => (
        <article key={i} className="flex flex-col gap-1">
          <div className="truncate text-[11px] text-white/55">{r.breadcrumb}</div>
          <h3 className="text-sm font-medium leading-snug text-[#9cb6ff] hover:underline">
            {r.title}
          </h3>
          <p className="text-xs leading-relaxed text-white/70">{r.snippet}</p>
        </article>
      ))}
    </div>
  );
}
