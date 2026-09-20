import { EmptyState } from "@/components/EmptyState";
import { AlertIcon } from "@/components/ui/icons";

export default function NotFoundPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <EmptyState
        icon={<AlertIcon width={40} height={40} />}
        title="We couldn’t find that page"
        description="The link may be out of date, or the page may not exist yet."
        actionLabel="Go home"
        actionHref="/"
      />
    </div>
  );
}
