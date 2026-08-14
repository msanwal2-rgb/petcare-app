"use client";

import { usePathname } from "next/navigation";
import { EmptyState } from "./EmptyState";
import { UserIcon } from "./ui/icons";

/**
 * The gate shown on pages that need a session but sit outside `proxy.ts`'s
 * matcher — checkout, order history, the appointment booking flow.
 *
 * It carries the current page as `callbackUrl` so signing in returns you here
 * rather than dumping you on the dashboard. Someone three steps into checkout
 * should not lose their place because their session expired. That's the same
 * parameter the middleware sets for guarded routes, so both kinds of gate
 * behave identically and `navigateAfterAuth` handles both.
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
  const pathname = usePathname();
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
