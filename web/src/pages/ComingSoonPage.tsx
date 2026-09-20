import { EmptyState } from "@/components/EmptyState";
import { PawIcon } from "@/components/ui/icons";

/**
 * A named placeholder for a route a later milestone fills in.
 *
 * It exists so the header's nav does not 404 on its own links. Better than
 * removing those links until their screens exist: the information architecture
 * is part of what M1 is meant to demonstrate, and a route that says which
 * milestone owns it is a more useful answer than a dead end.
 */
export default function ComingSoonPage({
  title,
  milestone,
  description,
}: {
  title: string;
  milestone: string;
  description: string;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <p className="mb-4 text-center font-mono text-xs uppercase tracking-widest text-charcoal/45">
        {milestone}
      </p>
      <EmptyState
        icon={<PawIcon width={40} height={40} />}
        title={title}
        description={description}
        actionLabel="Back to dashboard"
        actionHref="/dashboard"
      />
    </div>
  );
}
