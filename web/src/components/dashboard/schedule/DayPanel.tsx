import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { AnimatePresence, motion, useAnimate, useReducedMotion, type Variants } from "framer-motion";
import type { AvailabilityDay } from "@/types";
import { Avatar } from "@/components/Avatar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { CalendarIcon, ClockIcon, StethoscopeIcon, PawIcon, XIcon } from "@/components/ui/icons";
import { formatTime, fromDayKey, relativeDayLabel } from "@/lib/calendar";
import { DURATION, EASE_GLIDE, EASE_OUT } from "@/lib/motion";
import { cn, formatCurrency, formatRange } from "@/lib/utils";
import type { Engagement } from "./engagement";

/**
 * The day's content slides in from the side the viewer moved towards — a
 * later day from the right, an earlier one from the left — and its entries
 * arrive one after another.
 */
const content: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 32 }),
  center: {
    opacity: 1,
    x: 0,
    transition: {
      duration: DURATION.fast,
      ease: EASE_OUT,
      when: "beforeChildren",
      staggerChildren: 0.06,
    },
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction * -32,
    transition: { duration: 0.15, ease: EASE_OUT },
  }),
};

const entry: Variants = {
  enter: { opacity: 0, y: 12 },
  center: { opacity: 1, y: 0, transition: { duration: DURATION.fast, ease: EASE_OUT } },
};

/** How long the day box takes to fly down and become the panel. */
const FLIGHT = 0.6;
/**
 * Lift, then settle: slow off the day, quick through the middle, easing into
 * place — so the box is seen to travel rather than snap open.
 */
const FLIGHT_EASE = [0.5, 0, 0.2, 1] as const;
/** The selected day's colour — the box the flight starts as. */
const INK = "#1B3B36";

/**
 * The pressed day box, lifted off the calendar: it flies to where the panel
 * opens, growing to the panel's size and turning from ink to white on the
 * way, then fades as the real panel appears under it — so the box reads as
 * having become the panel.
 *
 * Drawn in a portal at `position: fixed`, because the panel's own container
 * clips while it unfolds and the box starts above it. Coordinates are the
 * viewport's, taken at the click; the page does not scroll until it lands.
 */
function Flight({
  from,
  target,
  onDone,
}: {
  from: DOMRect;
  target: RefObject<HTMLElement | null>;
  onDone: () => void;
}) {
  const [scope, animate] = useAnimate<HTMLDivElement>();

  // Before the first paint, so the box never shows anywhere but on its day.
  useLayoutEffect(() => {
    const el = scope.current;
    const to = target.current;
    if (!el || !to) {
      onDone();
      return;
    }
    const r = to.getBoundingClientRect();
    const controls = animate(
      el,
      {
        left: [from.left, r.left],
        top: [from.top, r.top],
        width: [from.width, r.width],
        // The panel's natural height — its container is still unfolding.
        height: [from.height, to.offsetHeight],
        borderRadius: [12, 16],
        // Stays the day's colour for the first half of the trip, then turns into the panel.
        backgroundColor: [INK, INK, "#ffffff"],
        opacity: [1, 1, 1, 0],
      },
      {
        duration: FLIGHT,
        ease: FLIGHT_EASE,
        backgroundColor: { duration: FLIGHT, times: [0, 0.45, 1], ease: "easeInOut" },
        opacity: { duration: FLIGHT + 0.12, times: [0, 0.55, 0.8, 1], ease: "linear" },
      }
    );
    controls.then(onDone);
    return () => controls.stop();
    // Runs once, for the flight it was mounted for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      ref={scope}
      aria-hidden
      className="pointer-events-none fixed z-40 shadow-xl shadow-ink/20"
      style={{
        left: from.left,
        top: from.top,
        width: from.width,
        height: from.height,
        borderRadius: 12,
        backgroundColor: INK,
      }}
    />,
    document.body
  );
}

/**
 * The floating panel under the calendar: everything on the selected day, in
 * full — when, who, which animal, what for, what it costs — with whatever
 * actions the dashboard attaches. A provider also sees the hours they
 * published for that day.
 *
 * ── How it moves ──
 *
 * It unfolds from under the calendar, a pointer on its top edge aimed at the
 * selected day's column. Moving to another day does not close and reopen it:
 * the pointer glides across, the height follows the new content, and the
 * content slides in from the direction of travel. Closing folds it away. The
 * app's motion vocabulary throughout — gliding, never bouncing — and reduced
 * motion is honoured globally (`MotionConfig` in PageTransition).
 */
export function DayPanel({
  day,
  column,
  direction,
  origin,
  items,
  loading,
  availability,
  renderActions,
  onClose,
  noun,
}: {
  day: string;
  /** The selected day's weekday column, 0–6, for the pointer. */
  column: number;
  /** +1 when the selection moved to a later day, -1 to an earlier one. */
  direction: number;
  /** The day box this panel was opened from, on screen — it flies out of it. */
  origin?: DOMRect | null;
  items: Engagement[];
  loading: boolean;
  availability?: AvailabilityDay;
  renderActions?: (e: Engagement) => ReactNode;
  onClose: () => void;
  noun: { one: string; many: string };
}) {
  const date = fromDayKey(day);
  const sectionRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  // The flight runs once, when the panel opens from a day box — not for
  // anyone who asked their system for less motion.
  const reduceMotion = useReducedMotion();
  const [openedByFlight] = useState(() => !!origin && !reduceMotion);
  const [flying, setFlying] = useState(openedByFlight);
  const flew = useRef(openedByFlight);

  // The height follows the content, so switching to a busier or quieter day
  // grows or shrinks the panel smoothly instead of snapping.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Bring the panel to the eye when it lands off-screen, by no more than it
  // takes — after it has unfolded, so the two motions run in turn rather than
  // against each other. Re-checked when its content arrives, because a panel
  // that opened as a short skeleton can grow past the bottom of the screen.
  // A panel already in full view does not move the page.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const el = sectionRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const header = 72; // the sticky site header
      const fits = r.height <= window.innerHeight - header;
      if (r.top < header || r.bottom > window.innerHeight) {
        el.scrollIntoView({ behavior: "smooth", block: fits ? "nearest" : "start" });
      }
    }, (flew.current ? FLIGHT + 0.1 : DURATION.base) * 1000 + 60);
    flew.current = false;
    return () => window.clearTimeout(id);
  }, [day, loading]);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{
        // In step with the flight, so the page makes room as the box arrives.
        height: { duration: openedByFlight ? FLIGHT : DURATION.base, ease: EASE_GLIDE },
        opacity: { duration: DURATION.fast, ease: EASE_OUT },
      }}
      // Room either side and below for the shadow, which the fold would clip.
      className="-mx-2 overflow-hidden"
    >
      <div ref={innerRef} className="px-2 pb-4 pt-1">
        <motion.section
          ref={sectionRef}
          // Under a flight, the real panel appears as the box lands on it.
          initial={openedByFlight ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ delay: openedByFlight ? FLIGHT * 0.6 : 0, duration: 0.25, ease: EASE_OUT }}
          aria-label={`Schedule for ${relativeDayLabel(date)}`}
          aria-live="polite"
          className="relative mt-3 scroll-mt-24 scroll-mb-6 rounded-2xl border border-mist bg-white p-4 shadow-lg shadow-ink/5 [--pad:1rem] sm:p-5 sm:[--pad:1.25rem]"
        >
          {/* The pointer: aimed at the selected day's column, gliding between them. */}
          <span
            aria-hidden
            className="absolute -top-[7px] z-10 h-3.5 w-3.5 border-l border-t border-mist bg-white transition-[left] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
            style={{
              left: `calc(var(--pad) + (100% - 2 * var(--pad)) * ${(column + 0.5) / 7})`,
              transform: "translateX(-50%) rotate(45deg)",
            }}
          />

          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={day}
              custom={direction}
              variants={content}
              initial="enter"
              animate="center"
              exit="exit"
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
                  className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal/60 transition-transform hover:rotate-90 hover:bg-fog hover:text-ink"
                >
                  <XIcon width={16} height={16} />
                </button>
              </div>

              {loading ? (
                <Skeleton className="h-28 w-full rounded-xl" />
              ) : items.length === 0 ? (
                <motion.p
                  variants={entry}
                  className="rounded-xl border border-dashed border-mist px-4 py-6 text-center text-sm text-charcoal/60"
                >
                  Nothing on this day.
                </motion.p>
              ) : (
                <ul className={cn("grid grid-cols-1 gap-3", items.length > 1 && "lg:grid-cols-2")}>
                  {items.map((e) => (
                    <motion.li key={e.kind + e.id} variants={entry}>
                      <EngagementDetail engagement={e} actions={renderActions?.(e)} />
                    </motion.li>
                  ))}
                </ul>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.section>
      </div>
      {/* After the panel, so its ref is attached by the time the flight measures it. */}
      {flying && origin && (
        <Flight from={origin} target={sectionRef} onDone={() => setFlying(false)} />
      )}
    </motion.div>
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
