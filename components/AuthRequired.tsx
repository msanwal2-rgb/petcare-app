import { EmptyState } from "./EmptyState";
import { UserIcon } from "./ui/icons";

/** Friendly gate shown on protected pages when there's no session (mock auth). */
export function AuthRequired({
  message = "Log in to view this page. You can use the Dev account switcher (bottom-left) to try it instantly.",
}: {
  message?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <EmptyState
        icon={<UserIcon width={40} height={40} />}
        title="You’re not logged in"
        description={message}
        actionLabel="Log in"
        actionHref="/login"
      />
    </div>
  );
}
