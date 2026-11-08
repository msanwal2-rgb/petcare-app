import { Link } from "react-router";

/**
 * The provider's own listing, small, at the foot of the dashboard — the
 * "Your clinic" panel the client asked to move out of the way. Name, place,
 * the tags owners filter on, and a way to edit it.
 */
export function ProfileStrip({
  label,
  name,
  place,
  tags,
  facts,
  editHref,
}: {
  label: string;
  name: string;
  place?: string;
  tags: string[];
  facts: string[];
  editHref: string;
}) {
  return (
    <aside className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-mist bg-white/70 px-4 py-3 text-sm">
      <span className="font-mono text-[10px] uppercase tracking-wider text-charcoal/50">{label}</span>
      <span className="font-medium text-ink">{name}</span>
      {place && <span className="text-charcoal/60">{place}</span>}
      {tags.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-mist bg-fog px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-charcoal"
            >
              {t}
            </span>
          ))}
        </span>
      )}
      {facts.map((f) => (
        <span key={f} className="text-xs text-charcoal/60">
          {f}
        </span>
      ))}
      <Link
        to={editHref}
        className="ml-auto text-xs font-medium text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
      >
        Edit profile &amp; availability
      </Link>
    </aside>
  );
}
