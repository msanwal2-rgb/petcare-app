import type { ReactNode } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import type { AvailabilityDay } from "@/types";
import { Avatar } from "@/components/Avatar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { CalendarIcon, ClockIcon, StethoscopeIcon, PawIcon, XIcon } from "@/components/ui/icons";
import { formatTime, fromDayKey, relativeDayLabel } from "@/lib/calendar";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { formatCurrency, formatRange } from "@/lib/utils";
import type { Engagement } from "./engagement";

/**
 * The floating panel under the calendar: everything on the selected day, in
 * full — when, who, which animal, what for, what it costs — with whatever
 * actions the dashboard attaches. A provider also sees the hours they
 * published for that day.
 */
export function DayPanel({
  day,
  items,
  loading,
  availability,
  renderActions,
  onClose,
  noun,
}: {
  day: string;
  items: Engagement[];
  loading: boolean;
  availability?: AvailabilityDay;
  renderActions?: (e: Engagement) => ReactNode;
  onClose: () => void;
  noun: { one: string; many: string };
}) {
  const date = fromDayKey(day);

  return (
    <motion.section
      key={day}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
      aria-label={`Schedule for ${relativeDayLabel(date)}`}
      className="relative mt-3 rounded-2xl border border-mist bg-white p-4 shadow-lg shadow-ink/5 sm:p-5"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">{relativeDayLabel(date)}</h3>
          <p className="text-xs text-charcoal/60">
            {loading
              ? "Loading…"
              : items.length === 0
                ? `No ${noun.many}`
                : `${items.length} ${items.length === 1 ? noun.one : noun.many}`}
            {availability && availability.slots.length > 0 && (
              <>
                {" · Open "}
                {availability.slots.map((s) => `${s.start}–${s.end}`).join(", ")}
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal/60 hover:bg-fog hover:text-ink"
        >
          <XIcon width={16} height={16} />
        </button>
      </div>

      {loading ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-mist px-4 py-6 text-center text-sm text-charcoal/60">
          Nothing on this day.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((e) => (
            <li key={e.kind + e.id}>
              <EngagementDetail engagement={e} actions={renderActions?.(e)} />
            </li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}

function EngagementDetail({ engagement: e, actions }: { engagement: Engagement; actions?: ReactNode }) {
  const KindIcon = e.kind === "appointment" ? StethoscopeIcon : PawIcon;
  const sameDayTimes = new Date(e.start).toDateString() === new Date(e.end).toDateString();

  return (
    <article className="rounded-xl border border-mist p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-mono text-xs text-charcoal/60">
            <ClockIcon width={13} height={13} />
            {sameDayTimes
              ? `${formatTime(e.start)} – ${formatTime(e.end)}`
              : formatRange(e.start, e.end)}
          </p>
          <Link
            to={e.href}
            className="mt-1 flex items-center gap-1.5 font-semibold text-ink hover:underline"
          >
            <KindIcon width={15} height={15} className="shrink-0 text-charcoal/50" />
            <span className="truncate">{e.title}</span>
          </Link>
          <p className="mt-0.5 text-xs text-charcoal/60">{e.modeLabel}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge tone={e.tone} label={e.statusLabel} />
          {e.price !== null && (
            <span className="font-mono text-sm font-medium text-ink">{formatCurrency(e.price)}</span>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {e.counterpart && (
          <div className="flex items-center gap-2.5 rounded-lg bg-fog/60 px-3 py-2">
            {e.counterpart.avatarUrl && <Avatar src={e.counterpart.avatarUrl} size={32} />}
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wide text-charcoal/50">
                {e.counterpart.role}
              </p>
              <p className="truncate text-sm font-medium text-ink">{e.counterpart.name}</p>
              {e.counterpart.place && (
                <p className="truncate text-xs text-charcoal/55">{e.counterpart.place}</p>
              )}
            </div>
          </div>
        )}
        {e.pets.length > 0 && (
          <div className="flex items-center gap-2.5 rounded-lg bg-fog/60 px-3 py-2">
            <span className="flex -space-x-2">
              {e.pets.slice(0, 3).map((p) => (
                <Avatar key={p.id} src={p.photoUrl} size={32} className="ring-2 ring-white" />
              ))}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wide text-charcoal/50">
                {e.pets.length === 1 ? "Pet" : "Pets"}
              </p>
              <p className="truncate text-sm font-medium text-ink">
                {e.pets.map((p) => p.name).join(", ")}
              </p>
            </div>
          </div>
        )}
      </div>

      {e.detail && (
        <p className="mt-3 rounded-lg bg-white text-sm text-charcoal/75">
          <span className="text-charcoal/50">
            {e.kind === "appointment" && e.appointment?.symptoms.length ? "Symptoms: " : "Notes: "}
          </span>
          {e.detail}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {actions}
        <Link
          to={e.href}
          className="ml-auto inline-flex items-center gap-1 text-sm text-charcoal/60 hover:text-ink"
        >
          <CalendarIcon width={14} height={14} />
          Open {e.kind === "appointment" ? "appointment" : "booking"}
        </Link>
      </div>
    </article>
  );
}
