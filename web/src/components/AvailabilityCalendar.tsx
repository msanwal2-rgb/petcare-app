import type { AvailabilityDay } from "@/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function dayNum(iso: string) {
  return Number(iso.slice(8, 10));
}
function weekday(iso: string) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * Visual availability calendar (brief §6). Shows open vs. fully-booked days as
 * a weekly grid; open days are selectable in the booking flow. Selecting a day
 * reveals its concrete time slots below.
 */
export function AvailabilityCalendar({
  availability,
  selectedDate,
  onSelectDate,
  onSelectSlot,
  selectedSlot,
  emptyLabel = "This caretaker hasn’t published their availability yet.",
  className,
}: {
  availability: AvailabilityDay[];
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
  /** When provided, the time slots become selectable rather than decorative. */
  onSelectSlot?: (slot: { start: string; end: string }) => void;
  selectedSlot?: { start: string; end: string };
  emptyLabel?: string;
  className?: string;
}) {
  if (availability.length === 0) {
    return (
      <p className="rounded-[12px] border border-dashed border-mist bg-white/60 px-4 py-6 text-center text-sm text-charcoal/60">
        {emptyLabel}
      </p>
    );
  }

  // Pad the first week so dates line up under the correct weekday column.
  const lead = weekday(availability[0].date);
  const cells: (AvailabilityDay | null)[] = [
    ...Array<null>(lead).fill(null),
    ...availability,
  ];

  const selected = availability.find((d) => d.date === selectedDate);

  return (
    <div className={cn("rounded-[12px] border border-mist bg-white p-4", className)}>
      <div className="mb-2 grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            className="text-center font-mono text-[10px] uppercase tracking-wide text-charcoal/40"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} />;
          const open = cell.slots.length > 0;
          const isSelected = cell.date === selectedDate;
          const interactive = open && !!onSelectDate;
          return (
            <button
              key={cell.date}
              type="button"
              disabled={!interactive}
              onClick={() => interactive && onSelectDate!(cell.date)}
              aria-pressed={isSelected}
              aria-label={`${cell.date}, ${open ? "available" : "fully booked"}`}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-lg border text-xs font-mono transition-colors",
                isSelected
                  ? "border-leash bg-leash text-white"
                  : open
                    ? "border-[#2F6F5E]/25 bg-[#2F6F5E]/8 text-ink hover:bg-[#2F6F5E]/16"
                    : "border-mist bg-fog text-charcoal/35",
                interactive ? "cursor-pointer" : "cursor-default"
              )}
            >
              <span>{dayNum(cell.date)}</span>
              <span
                className={cn(
                  "mt-0.5 h-1 w-1 rounded-full",
                  isSelected ? "bg-white" : open ? "bg-[#2F6F5E]" : "bg-transparent"
                )}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4 border-t border-mist pt-3 text-[11px] text-charcoal/60">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#2F6F5E]/40" /> Open
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-mist" /> Booked
        </span>
      </div>

      {selected && selected.slots.length > 0 && (
        <div className="mt-3 border-t border-mist pt-3">
          <p className="mb-2 text-xs font-medium text-ink">
            Times on {selected.date}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {selected.slots.map((s, i) => {
              const chosen =
                selectedSlot?.start === s.start && selectedSlot?.end === s.end;
              const label = `${s.start}–${s.end}`;
              return onSelectSlot ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelectSlot(s)}
                  aria-pressed={chosen}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
                    chosen
                      ? "border-leash bg-leash text-white"
                      : "border-mist bg-fog text-charcoal hover:border-ink"
                  )}
                >
                  {label}
                </button>
              ) : (
                <span
                  key={i}
                  className="rounded-full border border-mist bg-fog px-2.5 py-1 font-mono text-[11px] text-charcoal"
                >
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
