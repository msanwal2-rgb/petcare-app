import { Navigate, useLocation, useParams } from "react-router";

/**
 * A retired URL, sent to where its content lives now.
 *
 * Bookmarks, emailed links and browser history all outlive a route rename, so
 * every old path redirects rather than 404s. `:name` segments in `to` are
 * filled from the old URL's params, and the query string and hash are carried
 * across — `/appointment/new?vetId=v3` means nothing as `/vets/book` without
 * the vet.
 */
export function Moved({ to }: { to: string }) {
  const params = useParams();
  const { search, hash } = useLocation();
  const path = to.replace(/:(\w+)/g, (_, name: string) => params[name] ?? "");
  return <Navigate to={`${path}${search}${hash}`} replace />;
}
