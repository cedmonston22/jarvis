import { SearchBar } from './SearchBar';
import { Results } from './Results';
import { resultsFor } from './data';
import { useGoogleSearchStore } from '@/stores/googleSearchStore';

// Query is held in `googleSearchStore` (zustand) rather than local useState so voice commands in
// `VoiceProvider` can push a query here directly — no prop-drilling or refs needed.
export function GoogleMockApp() {
  const query = useGoogleSearchStore((s) => s.query);
  const setQuery = useGoogleSearchStore((s) => s.setQuery);
  const results = resultsFor(query);
  return (
    <div className="flex flex-col gap-5 pb-2">
      <SearchBar query={query} onQueryChange={setQuery} />
      <Results query={query} results={results} />
    </div>
  );
}
