import { SearchResults } from "@/components/search/SearchResults";

/**
 * Caretaker search — the reference's `app/search/page.tsx`. Its `Suspense`
 * boundary existed for Next's `useSearchParams`; React Router needs none.
 */
export default function SearchPage() {
  return <SearchResults />;
}
