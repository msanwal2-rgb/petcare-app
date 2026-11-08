import { useState } from "react";
import { useAsync } from "@/hooks/useAsync";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Avatar } from "@/components/Avatar";
import { daysFromToday, formatTime, formatWeekdayShort, startOfTodayIso } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import { bySoonest, type Engagement, type EngagementPage, type EngagementSource } from "./engagement";

const PAGE = 20;
const STEP = 5;

/**
 * Everything still to come, soonest first, from every source the dashboard
 * has — one for a vet or caretaker, two for an owner.
 *
 * Several cursor pages merged into one order need care: an item from source A
 * can only be shown once every source that still has pages has been read past
 * it, or a later page of B could hold something sooner. So the list shows up
 * to the earliest "last item" among the sources that are not finished, and
 * "Show more" reads on when it runs out.
 *
 * Pressing an item opens its day on the calendar.
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

  const canShowMore = ordered.length > shown || unfinished.length > 0;

  async function showMore() {
    if (ordered.length > shown + STEP || unfinished.length === 0) {
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

  return (
    <section className="flex flex-col rounded-2xl border border-mist bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Upcoming</h3>
        {!loading && ordered.length > 0 && (
          <span className="rounded-full bg-fog px-2 py-0.5 font-mono text-xs text-charcoal/70">
            {unfinished.length > 0 ? `${ordered.length}+` : ordered.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : error ? (
        <p className="text-sm text-charcoal/60">Couldn&rsquo;t load your upcoming {noun.many}.</p>
      ) : ordered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-mist px-4 py-8 text-center text-sm text-charcoal/60">
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {ordered.slice(0, shown).map((e) => {
            const start = new Date(e.start);
            return (
              <li key={e.kind + e.id}>
                <button
                  type="button"
                  onClick={() => onSelect(e)}
                  className="flex w-full items-center gap-3 rounded-xl border border-mist px-3 py-2.5 text-left transition-colors hover:border-ink/40"
                >
                  <span className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-fog py-1">
                    <span className="font-mono text-[10px] uppercase text-charcoal/55">
                      {formatWeekdayShort(start)}
                    </span>
                    <span className="font-mono text-base font-semibold leading-tight text-ink">
                      {start.getDate()}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {e.pets[0] ? `${e.pets.map((p) => p.name).join(", ")} — ` : ""}
                      {e.title}
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-charcoal/60">
                      {e.counterpart?.avatarUrl && (
                        <Avatar src={e.counterpart.avatarUrl} size={16} />
                      )}
                      <span className="truncate">
                        {shortDay(start)} · {formatTime(e.start)}
                        {e.counterpart ? ` · ${e.counterpart.name}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="hidden shrink-0 sm:block">
                    <StatusBadge tone={e.tone} label={e.statusLabel} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && canShowMore && (
        <button
          type="button"
          onClick={showMore}
          disabled={loadingMore}
          className={cn(
            "mt-3 self-center rounded-full px-4 py-1.5 text-sm font-medium text-ink hover:bg-fog",
            loadingMore && "opacity-60",
          )}
        >
          {loadingMore ? "Loading…" : "Show more"}
        </button>
      )}
    </section>
  );
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long" });

/** "Today", "Tomorrow", a weekday within the week, else "Dec 20" — never an ambiguous weekday. */
function shortDay(d: Date): string {
  const n = daysFromToday(d);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n > 1 && n < 7) return WEEKDAY.format(d);
  return SHORT_DATE.format(d);
}
