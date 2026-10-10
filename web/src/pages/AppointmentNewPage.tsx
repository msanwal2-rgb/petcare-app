import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { ConsultMode, Pet } from "@/types";
import { getVet, type VetWithUser } from "@/api/vets";
import { createAppointment } from "@/api/appointments";
import { listMyPets } from "@/api/pets";
import { ApiError } from "@/api/_client";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { CONSULT_MODE_LABELS, SPECIES_LABELS, formatCurrency } from "@/lib/utils";

/** The minimum notice the server enforces for a standard customer. */
const LEAD_TIME_HOURS = 24;

/** A consultation is booked as a slot, not a span. */
const DEFAULT_MINUTES = 30;

/**
 * Book a vet appointment.
 *
 * ── The fee on this page is an estimate ──
 *
 * It is the clinic's published `consultFee`, shown so the customer knows what
 * they are agreeing to, and it is **not sent** — `CreateAppointmentInput` has
 * no fee field. The server reads the same profile, applies whatever membership
 * discount the caller holds, and records all three numbers. If the two ever
 * disagree, the server's is the real one and it comes back in the response.
 *
 * ── Why the pet list is filtered ──
 *
 * Only animals this clinic actually treats are offered, because the server
 * refuses the rest with a 409 and an owner should not have to discover that by
 * submitting. The filter is a courtesy; the refusal is the rule.
 */
export default function AppointmentNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const vetId = params.get("vetId") ?? "";

  const [vet, setVet] = useState<VetWithUser | null | undefined>(undefined);
  const [pets, setPets] = useState<Pet[]>([]);

  const [chosenMode, setChosenMode] = useState<ConsultMode | "">("");
  const [petId, setPetId] = useState("");
  const [reason, setReason] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [start, setStart] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  useEffect(() => {
    getVet(vetId).then(setVet).catch(() => setVet(null));
    listMyPets().then(setPets).catch(() => setPets([]));
  }, [vetId]);

  if (vet === undefined) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (vet === null) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Vet not found</h1>
      </div>
    );
  }

  const { profile } = vet;

  // The first mode they offer, until the customer picks another — so the form
  // is usable without a choice being forced first.
  const mode: ConsultMode | "" = chosenMode || profile.consultModes[0] || "";

  const treatable = pets.filter((p) => profile.acceptedSpecies.includes(p.species));
  const untreatable = pets.length - treatable.length;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setIssues({});

    try {
      const startsAt = new Date(start);
      const appointment = await createAppointment({
        vetId,
        petId,
        mode: mode as ConsultMode,
        reason,
        symptoms: symptoms
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        startDateTime: startsAt.toISOString(),
        endDateTime: new Date(
          startsAt.getTime() + DEFAULT_MINUTES * 60_000,
        ).toISOString(),
        notes,
      });
      navigate(`/appointment/${appointment.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.issues?.length) {
        setIssues(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Book {vet.user.name}</h1>
      <p className="mt-1 mb-8 text-sm text-charcoal/60">
        {profile.clinicName}. They will see this as a request and can confirm or
        decline it.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
          >
            {error}
          </p>
        )}

        <Field label="Consultation" htmlFor="mode" error={issues.mode}>
          <Select
            id="mode"
            value={mode}
            onChange={(e) => setChosenMode(e.target.value as ConsultMode)}
          >
            {profile.consultModes.map((m) => (
              <option key={m} value={m}>
                {CONSULT_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Pet"
          hint={`treats ${profile.acceptedSpecies.map((s) => SPECIES_LABELS[s]).join(", ").toLowerCase()}`}
          htmlFor="petId"
          error={issues.petId}
        >
          {treatable.length === 0 ? (
            <p className="rounded-xl border border-dashed border-mist p-4 text-sm text-charcoal/65">
              {pets.length === 0
                ? "Add a pet first — an appointment has to be for somebody."
                : "This clinic doesn't treat any of your animals."}
            </p>
          ) : (
            <>
              <Select
                id="petId"
                value={petId}
                onChange={(e) => setPetId(e.target.value)}
                required
              >
                <option value="">Choose a pet</option>
                {treatable.map((pet) => (
                  <option key={pet.id} value={pet.id}>
                    {pet.name} · {pet.breed}
                  </option>
                ))}
              </Select>
              {untreatable > 0 && (
                <p className="mt-1.5 text-xs text-charcoal/55">
                  {untreatable === 1 ? "One pet is" : `${untreatable} pets are`} not
                  shown — this clinic doesn't treat{" "}
                  {untreatable === 1 ? "that species" : "those species"}.
                </p>
              )}
            </>
          )}
        </Field>

        <Field label="What's the visit for?" htmlFor="reason" error={issues.reason}>
          <Input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Limping on the front right leg"
            required
          />
        </Field>

        <Field
          label="Symptoms"
          hint="comma separated, optional"
          htmlFor="symptoms"
          error={issues.symptoms}
        >
          <Input
            id="symptoms"
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            placeholder="Limping, reduced appetite"
          />
        </Field>

        <Field
          label="When"
          hint={`${LEAD_TIME_HOURS}h notice · ${DEFAULT_MINUTES} minute slot`}
          htmlFor="start"
          error={issues.startDateTime}
        >
          <Input
            id="start"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </Field>

        <Field label="Anything else they should know?" htmlFor="notes" error={issues.notes}>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Started after a long hike at the weekend. Otherwise bright."
          />
        </Field>

        <div className="rounded-xl border border-mist bg-white p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-charcoal/70">Consultation fee</span>
            <span className="text-lg font-semibold text-ink">
              {formatCurrency(profile.consultFee)}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-charcoal/55">
            An estimate. The final fee is calculated by the server from this same
            profile, with any membership discount applied.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button
            type="submit"
            variant="cta"
            disabled={saving || !petId || !start || !reason}
          >
            {saving ? "Sending…" : "Request appointment"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
