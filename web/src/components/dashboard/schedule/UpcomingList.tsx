import { useState } from "react";
import { useAsync } from "@/hooks/useAsync";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { CalendarIcon } from "@/components/ui/icons";
import {
  daysFromToday,
  formatShortMonth,
  formatTime,
  formatWeekdayShort,
  startOfTodayIso,
} from "@/lib/calendar";
import { TONE_DOT } from "@/lib/statusTone";
import { cn } from "@/lib/utils";
import { bySoonest, type Engagement, type EngagementPage, type EngagementSource } from "./engagement";

const PAGE = 20;
/** One row of cards at the widest layout; "Show more" adds a row at a time. */
const STEP = 4;

/**
 * Everything still to come, soonest first, as a row of cards above the
 * calendar — the next one marked "Next up". With nothing coming it is one
 * slim line, not a tall empty box, so every dashboard keeps the same shape
 * whether it is busy or quiet.
 *
 * Several cursor pages merged into one order need care: an item from source A
 * can only be shown once every source that still has pages has been read past
 * it, or a later page of B could hold something sooner. So the list shows up
 * to the earliest "last item" among the sources that are not finished, and
 * "Show more" reads on when it runs out.
 *
 * Pressing a card opens its day on the calendar.
 */
export function UpcomingList({
  sources,
  version,
  onSelect,
  noun,
  empty,
}: {
  sources: EngagementSource[];
  version: number;
  onSelect: (e: Engagement) => void;
  noun: { one: string; many: string };
  empty: string;
}) {
  const [shown, setShown] = useState(STEP);
  // Pages read beyond the first, keyed by the version they were read under,
  // so a reload (new version) starts clean without resetting state in an effect.
  const [more, setMore] = useState<{ version: number; pages: EngagementPage[][] }>({
    version,
    pages: [],
  });
  const [loadingMore, setLoadingMore] = useState(false);

  const { data: first, loading, error } = useAsync(
    () => Promise.all(sources.map((s) => s({ from: startOfTodayIso(), only: "live", limit: PAGE }))),
    [version],
  );

  const extra = more.version === version ? more.pages : [];
  const perSource = (first ?? []).map((page, i) => {
    const later = extra.map((round) => round[i]).filter(Boolean);
    const items = [page, ...later].flatMap((p) => p.items);
    const last = later.length > 0 ? later[later.length - 1] : page;
    return { items, cursor: last.nextCursor };
  });

  const unfinished = perSource.filter((s) => s.cursor !== null && s.items.length > 0);
  const horizon = unfinished.length
    ? unfinished.map((s) => s.items[s.items.length - 1].start).sort()[0]
    : null;
  const ordered = perSource
    .flatMap((s) => s.items)
    .filter((e) => horizon === null || e.start <= horizon)
    .sort(bySoonest);

  const visible = ordered.slice(0, shown);
  const canShowMore = ordered.length > shown || unfinished.length > 0;
  const canShowLess = shown > STEP;

  async function showMore() {
    if (ordered.length >= shown + STEP || unfinished.length === 0) {
      setShown((n) => n + STEP);
      return;
    }
    setLoadingMore(true);
    try {
      const round = await Promise.all(
        perSource.map((s, i) =>
          s.cursor
            ? sources[i]({ from: startOfTodayIso(), only: "live", limit: PAGE, cursor: s.cursor })
            : Promise.resolve({ items: [], nextCursor: null }),
        ),
      );
      setMore({ version, pages: [...extra, round] });
      setShown((n) => n + STEP);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading && !first) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className={cn("h-[104px] w-full rounded-2xl", i > 0 && "hidden sm:block")} />
        ))}
      </div>
    );
  }

  if (error || ordered.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-mist bg-white/60 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fog text-charcoal/60">
          <CalendarIcon width={16} height={16} />
        </span>
        <p className="text-sm text-charcoal/65">
          {error ? (
            <>Couldn&rsquo;t load your upcoming {noun.many}.</>
          ) : (
            <>
              <span className="font-medium text-ink">Nothing coming up.</span> {empty}
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {visible.map((e, i) => (
          <li key={e.kind + e.id}>
            <UpcomingCard engagement={e} next={i === 0} onSelect={onSelect} />
          </li>
        ))}
      </ul>

      {(canShowMore || canShowLess) && (
        <div className="mt-3 flex items-center justify-center gap-2">
          {canShowMore && (
            <button
              type="button"
              onClick={showMore}
              disabled={loadingMore}
              className="rounded-full px-4 py-1.5 text-sm font-medium text-ink hover:bg-fog disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          )}
          {canShowLess && (
            <button
              type="button"
              onClick={() => setShown(STEP)}
              className="rounded-full px-4 py-1.5 text-sm font-medium text-charcoal/60 hover:bg-fog hover:text-ink"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "Today", "Tomorrow", a weekday within the week, else nothing — the date block says it. */
function whenLabel(d: Date): string {
  const n = daysFromToday(d);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  return formatWeekdayShort(d);
}

function UpcomingCard({
  engagement: e,
  next,
  onSelect,
}: {
  engagement: Engagement;
  next: boolean;
  onSelect: (e: Engagement) => void;
}) {
  const start = new Date(e.start);
  const pets = e.pets.map((p) => p.name).join(", ");

  return (
    <button
      type="button"
      onClick={() => onSelect(e)}
      className={cn(
        "group flex h-full w-full items-start gap-3 rounded-2xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
        next ? "border-ink bg-ink text-white" : "border-mist bg-white text-ink"
      )}
    >
      <span
        className={cn(
          "flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5",
          next ? "bg-white/10" : "bg-fog"
        )}
      >
        <span className={cn("font-mono text-[10px] uppercase", next ? "text-white/70" : "text-charcoal/55")}>
          {formatShortMonth(start)}
        </span>
        <span className="font-mono text-lg font-semibold leading-tight">{start.getDate()}</span>
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block font-mono text-[10px] uppercase tracking-wider",
            next ? "text-marigold" : "text-charcoal/50"
          )}
        >
          {next ? "Next up" : whenLabel(start)} · {formatTime(e.start)}
        </span>
        <span className="mt-0.5 block truncate text-sm font-medium">
          {pets ? `${pets} — ` : ""}
          {e.title}
        </span>
        <span className={cn("block truncate text-xs", next ? "text-white/70" : "text-charcoal/60")}>
          {e.counterpart?.name ?? e.modeLabel}
        </span>
        <span className="mt-1.5 block">
          {next ? (
            // The badge's own tints are made for white cards; on ink they vanish.
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-xs font-medium text-white">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TONE_DOT[e.tone] }} aria-hidden />
              {e.statusLabel}
            </span>
          ) : (
            <StatusBadge tone={e.tone} label={e.statusLabel} />
          )}
        </span>
      </span>
    </button>
  );
}
