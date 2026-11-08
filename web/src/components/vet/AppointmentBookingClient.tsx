import { Link, useNavigate, useSearchParams } from "react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { ConsultMode } from "@/types";
import { getVet } from "@/api/vets";
import { listMyPets } from "@/api/pets";
import { createAppointment } from "@/api/appointments";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { fromDateTimeInputs } from "@/lib/calendar";
import { utcOffsetMinutesAt } from "@/lib/availability";
import { AuthRequired } from "@/components/AuthRequired";
import { Avatar } from "@/components/Avatar";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ProgressLeash } from "@/components/ui/ProgressLeash";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  CONSULT_MODE_LABELS,
  SPECIES_LABELS,
  cn,
  formatCurrency,
  formatRange,
} from "@/lib/utils";

const STEPS = ["Details", "Review", "Confirm"];

/** Common presenting signs, offered as chips so owners don't face a blank box. */
const COMMON_SYMPTOMS = [
  "Vomiting",
  "Diarrhoea",
  "Reduced appetite",
  "Lethargy",
  "Limping",
  "Itching",
  "Coughing",
  "Bad breath",
  "Weight loss",
];

/**
 * A calendar day and a "HH:MM" wall time, as the instant that is where the
 * owner is.
 *
 * Published hours are the clinic's wall clock, and the owner and the clinic
 * share a zone in a local marketplace. The reference read the time as UTC —
 * `${date}T${time}:00.000Z` — so a "09:00" slot was booked for 09:00 UTC and
 * the appointment page then showed it in the owner's zone as some other hour
 * (2:00 PM at UTC+5).
 */
function isoAt(date: string, time: string): string {
  return fromDateTimeInputs(date, time)!;
}

/**
 * Request a vet visit — the reference's three-step flow. The fee shown is the
 * clinic's published one and is not sent: the server reads `consultFee` and
 * records base, discount and charged amounts itself.
 */
export function AppointmentBookingClient() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const vetId = params.get("vetId") ?? "";
  const { currentUser, hasHydrated } = useSession();

  const { data: vet } = useAsync(() => (vetId ? getVet(vetId) : Promise.resolve(null)), [vetId]);
  const { data: pets } = useAsync(
    () => (currentUser ? listMyPets() : Promise.resolve([])),
    [currentUser?.id]
  );

  const [petId, setPetId] = useState("");
  const [mode, setMode] = useState<ConsultMode | "">("");
  const [reason, setReason] = useState("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [date, setDate] = useState(params.get("date") ?? "");
  const [slot, setSlot] = useState<{ start: string; end: string }>();
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  if (!hasHydrated) return <BookingSkeleton />;
  // The vet is in the query string; coming back without it is a dead end.
  if (!currentUser)
    return (
      <AuthRequired
        message="Log in to request an appointment."
        callbackPath={vetId ? `/vets/book?vetId=${vetId}` : "/vets/book"}
      />
    );

  if (!vet) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Pick a vet first"
          description="Browse licensed vets and choose one to book with."
          actionLabel="Find a vet"
          actionHref="/vets"
        />
      </div>
    );
  }

  const eligiblePets = (pets ?? []).filter((p) =>
    vet.profile.acceptedSpecies.includes(p.species)
  );
  const pet = eligiblePets.find((p) => p.id === petId);
  const canReview = Boolean(pet && mode && reason.trim() && date && slot);

  function toggleSymptom(s: string) {
    setSymptoms((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]
    );
  }

  async function submit() {
    if (!pet || !mode || !slot || !currentUser || !vet) return;
    setSubmitting(true);
    try {
      const appointment = await createAppointment({
        vetId: vet.profile.id,
        petId: pet.id,
        mode,
        reason: reason.trim(),
        symptoms,
        startDateTime: isoAt(date, slot.start),
        endDateTime: isoAt(date, slot.end),
        notes: notes.trim(),
        // So the server reads the clinic's published hours in this zone (STATUS §3-G).
        utcOffsetMinutes: utcOffsetMinutesAt(isoAt(date, slot.start)),
      });
      toast.success("Appointment requested", {
        description: `${vet.user.name} will confirm shortly.`,
      });
      navigate(`/appointments/${appointment.id}`);
    } catch (e) {
      toast.error("Couldn't request that appointment", {
        description: e instanceof Error ? e.message : undefined,
      });
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link
        to={`/vets/${vet.profile.id}`}
        className="text-sm text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
      >
        ← Back to {vet.user.name}
      </Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
        Request an appointment
      </h1>
      <p className="mt-1 text-sm text-charcoal/70">
        {vet.profile.clinicName} · {formatCurrency(vet.profile.consultFee)} per consultation
      </p>

      <ProgressLeash
        steps={STEPS}
        activeIndex={step}
        label="Appointment step"
        className="my-4"
      />

      {step === 0 && (
        <div className="space-y-6 rounded-2xl border border-mist bg-white p-6">
          <div>
            <h2 className="text-sm font-semibold text-ink">Which pet?</h2>
            {eligiblePets.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-mist bg-fog px-4 py-6 text-center text-sm text-charcoal/65">
                {(pets ?? []).length === 0 ? (
                  <>
                    You haven&apos;t added a pet yet.{" "}
                    <Link to="/dashboard/pets/new" className="font-medium text-ink underline">
                      Add one
                    </Link>{" "}
                    to book.
                  </>
                ) : (
                  <>
                    {vet.user.name} treats{" "}
                    {vet.profile.acceptedSpecies.map((s) => `${SPECIES_LABELS[s]}s`).join(", ")}{" "}
                    only.{" "}
                    <Link to="/vets" className="font-medium text-ink underline">
                      Find another vet
                    </Link>
                    .
                  </>
                )}
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {eligiblePets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPetId(p.id)}
                    aria-pressed={petId === p.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                      petId === p.id
                        ? "border-ink bg-ink/5"
                        : "border-mist bg-white hover:border-ink/40"
                    )}
                  >
                    <Avatar src={p.photoUrl} size={44} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {p.name}
                      </span>
                      <span className="block truncate text-xs text-charcoal/60">
                        {p.breed} · {p.weightLbs} lb
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Field label="Consultation format" htmlFor="a-mode">
            <Select
              id="a-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as ConsultMode)}
            >
              <option value="">Choose a format</option>
              {vet.profile.consultModes.map((m) => (
                <option key={m} value={m}>
                  {CONSULT_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="What's the reason for the visit?"
            htmlFor="a-reason"
            hint="Required"
          >
            <Input
              id="a-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Recurrent itching and hair loss"
            />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-ink">
              Any of these?{" "}
              <span className="font-normal text-charcoal/50">Optional</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_SYMPTOMS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSymptom(s)}
                  aria-pressed={symptoms.includes(s)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    symptoms.includes(s)
                      ? "border-ink bg-ink text-white"
                      : "border-mist bg-white text-charcoal hover:border-ink/40"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-ink">Pick a time</p>
            <AvailabilityCalendar
              availability={vet.profile.availability}
              selectedDate={date}
              onSelectDate={(d) => {
                setDate(d);
                setSlot(undefined);
              }}
              onSelectSlot={setSlot}
              selectedSlot={slot}
              emptyLabel="This clinic hasn't published its availability yet."
            />
          </div>

          <Field label="Anything else the vet should know?" htmlFor="a-notes">
            <Textarea
              id="a-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How long it's been going on, what you've already tried…"
            />
          </Field>

          <div className="flex justify-end">
            <Button
              variant="cta"
              disabled={!canReview}
              onClick={() => setStep(1)}
            >
              Review request
            </Button>
          </div>
        </div>
      )}

      {step === 1 && pet && slot && mode && (
        <div className="space-y-5 rounded-2xl border border-mist bg-white p-6">
          <h2 className="text-sm font-semibold text-ink">Check the details</h2>
          <dl className="divide-y divide-mist text-sm">
            <Row label="Vet" value={`${vet.user.name} · ${vet.profile.clinicName}`} />
            <Row label="Pet" value={`${pet.name} (${SPECIES_LABELS[pet.species]})`} />
            <Row label="Format" value={CONSULT_MODE_LABELS[mode]} />
            <Row
              label="When"
              value={formatRange(isoAt(date, slot.start), isoAt(date, slot.end))}
            />
            <Row label="Reason" value={reason} />
            {symptoms.length > 0 && (
              <Row label="Signs" value={symptoms.join(", ")} />
            )}
            <Row label="Fee" value={`${formatCurrency(vet.profile.consultFee)} per consultation`} />
          </dl>

          <p className="rounded-xl bg-fog px-4 py-3 text-xs text-charcoal/70">
            Requesting doesn&apos;t book the slot. {vet.user.name.split(" ").slice(-1)[0]}{" "}
            confirms first, and you can cancel any time before then.
          </p>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button variant="cta" disabled={submitting} onClick={submit}>
              {submitting ? "Sending…" : "Send request"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-charcoal/60">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

function BookingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-6 h-24 w-full rounded-2xl" />
      <Skeleton className="mt-4 h-96 w-full rounded-2xl" />
    </div>
  );
}
