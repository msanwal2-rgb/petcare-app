import { useLocation } from "react-router";
import { EmptyState } from "./EmptyState";
import { UserIcon } from "./ui/icons";

/**
 * The gate a page shows itself when it needs a session and finds none.
 *
 * Most guarded routes never reach it — `RequireAuth` redirects first — but a
 * page that reads the session directly (the dashboard does, to pick a role)
 * still needs an answer for "nobody is signed in", and this is the reference
 * project's.
 *
 * It carries the current page as `callbackUrl` so signing in returns you here
 * rather than dumping you on the dashboard. That's the same parameter
 * `RequireAuth` sets, so both kinds of gate behave identically.
 *
 * `callbackPath` only needs passing when the query string is part of where you
 * were — /vets/book?vetId=… is meaningless without the vet.
 */
export function AuthRequired({
  message = "Log in to view this page.",
  callbackPath,
}: {
  message?: string;
  /** Defaults to the current pathname. */
  callbackPath?: string;
}) {
  const { pathname } = useLocation();
  const target = callbackPath ?? pathname;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <EmptyState
        icon={<UserIcon width={40} height={40} />}
        title="You’re not logged in"
        description={message}
        actionLabel="Log in"
        actionHref={`/login?callbackUrl=${encodeURIComponent(target)}`}
      />
    </div>
  );
}
