import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { VetAppointment } from "@/types";
import { rescheduleAppointment } from "@/api/appointments";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { XIcon } from "@/components/ui/icons";
import { fromDateTimeInputs, toDateInput, toTimeInput } from "@/lib/calendar";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { formatRange } from "@/lib/utils";

const LENGTHS = [15, 20, 30, 45, 60, 90, 120, 180];

/**
 * The vet moves a visit to a new time. Date, start time and length — the
 * length defaults to the visit's own, so moving a 30-minute consult keeps it
 * 30 minutes. The server checks everything again: vet only, requested or
 * confirmed only, in the future; the owner is told in the app and by email.
 */
export function RescheduleDialog({
  appointment,
  ownerName,
  onClose,
  onDone,
}: {
  appointment: VetAppointment;
  ownerName: string;
  onClose: () => void;
  onDone: (moved: VetAppointment) => void;
}) {
  const originalMinutes = Math.round(
    (Date.parse(appointment.endDateTime) - Date.parse(appointment.startDateTime)) / 60_000,
  );
  const [date, setDate] = useState(() => toDateInput(appointment.startDateTime));
  const [time, setTime] = useState(() => toTimeInput(appointment.startDateTime));
  const [minutes, setMinutes] = useState(originalMinutes > 0 ? originalMinutes : 30);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Focus once, on opening — not whenever the parent re-renders.
  useEffect(() => {
    document.getElementById("reschedule-date")?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lengths = LENGTHS.includes(minutes) ? LENGTHS : [...LENGTHS, minutes].sort((a, b) => a - b);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const start = fromDateTimeInputs(date, time);
    if (!start) return setError("Choose a date and a start time.");
    if (Date.parse(start) <= Date.now()) return setError("The new time has to be in the future.");
    const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();

    setBusy(true);
    setError(null);
    try {
      const moved = await rescheduleAppointment(appointment.id, {
        startDateTime: start,
        endDateTime: end,
      });
      toast.success("Appointment moved", {
        description: `${ownerName} has been told about the new time.`,
      });
      onDone(moved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t move it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <motion.div
        className="absolute inset-0 bg-ink/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: DURATION.fast }}
        onClick={onClose}
        aria-hidden
      />
      <motion.form
        role="dialog"
        aria-modal="true"
        aria-labelledby="reschedule-title"
        onSubmit={submit}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.fast, ease: EASE_OUT }}
        className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 id="reschedule-title" className="text-lg font-semibold text-ink">
            Reschedule appointment
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal/60 hover:bg-fog hover:text-ink"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>
        <p className="text-sm text-charcoal/65">
          {appointment.reason} with {ownerName}. Now{" "}
          <span className="font-mono text-xs">
            {formatRange(appointment.startDateTime, appointment.endDateTime)}
          </span>
          .
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="New date" htmlFor="reschedule-date" className="col-span-2 sm:col-span-1">
            <Input
              id="reschedule-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Start time" htmlFor="reschedule-time" className="col-span-1">
            <Input
              id="reschedule-time"
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
          <Field label="Length" htmlFor="reschedule-length" className="col-span-1 sm:col-span-2">
            <select
              id="reschedule-length"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-full rounded-xl border border-mist bg-white px-3.5 py-2.5 text-sm text-charcoal focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
            >
              {lengths.map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? "" : "s"}`}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <p className="mt-3 text-xs text-charcoal/55">
          {ownerName} gets a notification and an email. The appointment keeps its status; if the
          new time doesn&rsquo;t work for them, they can cancel.
        </p>

        {error && (
          <p className="mt-3 text-sm text-leash" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Keep the current time
          </Button>
          <Button type="submit" variant="cta" size="sm" disabled={busy}>
            {busy ? "Moving…" : "Move appointment"}
          </Button>
        </div>
      </motion.form>
    </div>,
    document.body,
  );
}
