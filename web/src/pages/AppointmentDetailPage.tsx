import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import type {
  AppointmentStatus,
  MedicalRecord,
  MedicalRecordType,
  Pet,
  Review,
  VetAppointment,
} from "@/types";
import {
  completeVisit,
  createAppointmentReview,
  getAppointment,
  getAppointmentReviews,
  updateAppointmentStatus,
  type VisitSummaryEntry,
} from "@/api/appointments";
import { getVet, type VetWithUser } from "@/api/vets";
import { getPetById } from "@/api/pets";
import { ApiError } from "@/api/_client";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useSession } from "@/store/session";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONE,
  CONSULT_MODE_LABELS,
  RECORD_TYPE_LABELS,
  RECORD_TYPE_OPTIONS,
  formatCurrency,
  formatDateTime,
} from "@/lib/utils";

/**
 * One appointment: its details, whatever action is next, and — once the visit
 * has happened — the summary the vet wrote and the owner's review.
 *
 * ── The buttons mirror the server's rules, and do not replace them ──
 *
 * Which transitions appear depends on the appointment's state and on which side
 * of it you are: the same two tables the API enforces (REQUIREMENTS.md **§11.2**
 * — `confirmed`, not `accepted`). Showing an owner a Confirm button they would
 * be refused is a worse experience than not showing it. But the check that
 * matters happens server-side on every request: this is UX, and the 403 behind
 * it is the security.
 *
 * ── Completing is not a status button ──
 *
 * A vet finishes a visit by writing its summary, not by pressing "complete".
 * That is deliberate, and it matches the API: the summary endpoint is what
 * moves the appointment to `completed`, in one transaction with the records it
 * writes. A visit that could be marked done without a summary would leave a
 * consultation with no clinical record of having happened.
 */
export default function AppointmentDetailPage() {
  const { id = "" } = useParams();
  const { currentUser } = useSession();

  const [appointment, setAppointment] = useState<VetAppointment | null | undefined>(
    undefined,
  );
  const [vet, setVet] = useState<VetWithUser | null>(null);
  const [pet, setPet] = useState<Pet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getAppointment(id).then(setAppointment).catch(() => setAppointment(null));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!appointment) return;
    getVet(appointment.vetId).then(setVet).catch(() => setVet(null));
    // A vet reading this may see the pet; an owner always may. Either way the
    // server decides, and a refusal simply leaves the name out.
    getPetById(appointment.petId).then(setPet).catch(() => setPet(null));
  }, [appointment]);

  if (appointment === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-12 sm:px-6">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (appointment === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Appointment not found</h1>
        <p className="mt-2 text-sm text-charcoal/60">
          It may not exist, or it may not be yours.
        </p>
      </div>
    );
  }

  const isOwner = currentUser?.id === appointment.ownerId;
  const isVet = vet !== null && currentUser?.id === vet.user.id;

  async function move(status: AppointmentStatus) {
    setError(null);
    try {
      setAppointment(await updateAppointmentStatus(id, status));
    } catch (err) {
      // A 409 means the appointment moved under us; a 403 means the wrong
      // party. Both carry a message worth showing verbatim.
      setError(
        err instanceof ApiError ? err.message : "Could not update this appointment",
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <section className="rounded-2xl border border-mist bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">
              {CONSULT_MODE_LABELS[appointment.mode]}
              {vet && <span className="text-charcoal/55"> with {vet.user.name}</span>}
            </h1>
            <p className="mt-1 text-sm text-charcoal/60">
              {formatDateTime(appointment.startDateTime)}
              {pet && ` · ${pet.name}`}
            </p>
          </div>
          <StatusBadge
            tone={APPOINTMENT_STATUS_TONE[appointment.status]}
            label={APPOINTMENT_STATUS_LABELS[appointment.status]}
          />
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <Detail label="Reason" value={appointment.reason} />
          <Detail label="Fee" value={formatCurrency(appointment.fee)} />
          {appointment.symptoms.length > 0 && (
            <Detail label="Symptoms" value={appointment.symptoms.join(", ")} />
          )}
          <Detail label="Requested" value={formatDateTime(appointment.createdAt)} />
          {appointment.notes && <Detail label="Notes" value={appointment.notes} />}
        </dl>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
          >
            {error}
          </p>
        )}

        <Actions
          status={appointment.status}
          isOwner={isOwner}
          isVet={isVet}
          onMove={move}
        />
      </section>

      {isVet && appointment.status === "in_progress" && (
        <VisitSummaryForm
          appointmentId={id}
          petName={pet?.name}
          onComplete={(result) => setAppointment(result)}
        />
      )}

      {appointment.status === "completed" && isOwner && pet && (
        <p className="rounded-2xl border border-mist bg-white p-6 text-sm text-charcoal/70">
          The visit summary is in{" "}
          <Link
            to={`/dashboard/pets/${appointment.petId}`}
            className="font-medium text-ink underline underline-offset-2"
          >
            {pet.name}'s health record
          </Link>
          , along with any prescriptions.
        </p>
      )}

      {appointment.status === "completed" && vet && (
        <ReviewPanel
          appointmentId={id}
          isOwner={isOwner}
          currentUserId={currentUser?.id ?? ""}
          vetUserId={vet.user.id}
        />
      )}
    </div>
  );
}

/**
 * The moves available from here, to this person.
 *
 * A direct transcription of the two tables in REQUIREMENTS.md §11.2:
 * confirm/decline/start belong to the vet, and either side may cancel while the
 * appointment is not yet terminal. There is no Complete button — see the page
 * comment.
 */
function Actions({
  status,
  isOwner,
  isVet,
  onMove,
}: {
  status: AppointmentStatus;
  isOwner: boolean;
  isVet: boolean;
  onMove: (status: AppointmentStatus) => void;
}) {
  const vetMoves: Partial<Record<AppointmentStatus, [AppointmentStatus, string][]>> = {
    requested: [
      ["confirmed", "Confirm"],
      ["declined", "Decline"],
    ],
    confirmed: [["in_progress", "Start visit"]],
  };

  const moves = isVet ? (vetMoves[status] ?? []) : [];
  const canCancel =
    (isOwner || isVet) && ["requested", "confirmed", "in_progress"].includes(status);

  if (moves.length === 0 && !canCancel) return null;

  return (
    <div className="mt-6 flex flex-wrap gap-3 border-t border-mist pt-5">
      {moves.map(([next, label]) => (
        <Button key={next} variant="cta" size="sm" onClick={() => onMove(next)}>
          {label}
        </Button>
      ))}
      {canCancel && (
        <Button variant="ghost" size="sm" onClick={() => onMove("cancelled")}>
          Cancel appointment
        </Button>
      )}
    </div>
  );
}

/** A blank entry. `type` defaults to the one most visits start with. */
const blankEntry = (): VisitSummaryEntry => ({
  type: "visit_note",
  title: "",
  details: "",
});

/**
 * The visit summary — REQUIREMENTS.md V7.
 *
 * ── Every record type the server accepts is offered here ──
 *
 * REQUIREMENTS.md V9, and it is a real bug being fixed rather than a tidy-up.
 * The reference implementation's form offered five of the six and omitted
 * `allergy`, so a vet who found a food allergy during a consultation had
 * nowhere to record it — and the allergy list is exactly what the store's
 * recommendations read. The options come from `RECORD_TYPE_OPTIONS`, which is
 * generated from the same label map the rest of the app uses, so a seventh type
 * would appear here without anyone remembering to add it.
 *
 * Note what the form does **not** collect: no `vetId`, no `authorUserId`, no
 * `petId` and no `appointmentId`. All four are stamped by the server from the
 * appointment and from the access check that let this vet in.
 */
function VisitSummaryForm({
  appointmentId,
  petName,
  onComplete,
}: {
  appointmentId: string;
  petName?: string;
  onComplete: (appointment: VetAppointment) => void;
}) {
  const [entries, setEntries] = useState<VisitSummaryEntry[]>([blankEntry()]);
  const [written, setWritten] = useState<MedicalRecord[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(index: number, patch: Partial<VisitSummaryEntry>) {
    setEntries((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await completeVisit(appointmentId, entries);
      setWritten(result.records);
      onComplete(result.appointment);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the summary");
    } finally {
      setSaving(false);
    }
  }

  if (written) {
    return (
      <section className="rounded-2xl border border-mist bg-white p-6">
        <h2 className="text-lg font-semibold text-ink">Visit summary saved</h2>
        <p className="mt-1 text-sm text-charcoal/60">
          {written.length === 1 ? "One entry is" : `${written.length} entries are`} now
          in {petName ? `${petName}'s` : "the"} permanent health record.
        </p>
        <ul className="mt-5 space-y-2">
          {written.map((record) => (
            <li
              key={record.id}
              className="rounded-xl border border-mist px-4 py-3 text-sm"
            >
              <span className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
                {RECORD_TYPE_LABELS[record.type]}
              </span>
              <p className="mt-1 text-ink">{record.title}</p>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-mist bg-white p-6">
      <h2 className="text-lg font-semibold text-ink">Visit summary</h2>
      <p className="mt-1 text-sm text-charcoal/60">
        This goes into {petName ? `${petName}'s` : "the animal's"} permanent health
        record and completes the visit. A prescription here is what lets the owner
        buy the product it names.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-6" noValidate>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
          >
            {error}
          </p>
        )}

        {entries.map((entry, index) => (
          <fieldset
            key={index}
            className="space-y-4 rounded-xl border border-mist p-4"
          >
            <legend className="px-1 font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
              Entry {index + 1}
            </legend>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor={`type-${index}`}>
                <Select
                  id={`type-${index}`}
                  value={entry.type}
                  onChange={(e) =>
                    update(index, { type: e.target.value as MedicalRecordType })
                  }
                >
                  {RECORD_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {RECORD_TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Title" htmlFor={`title-${index}`}>
                <Input
                  id={`title-${index}`}
                  value={entry.title}
                  onChange={(e) => update(index, { title: e.target.value })}
                  placeholder="Soft-tissue strain, front right"
                  required
                />
              </Field>
            </div>

            <Field label="Details" htmlFor={`details-${index}`}>
              <Textarea
                id={`details-${index}`}
                value={entry.details ?? ""}
                onChange={(e) => update(index, { details: e.target.value })}
                placeholder="No swelling, full range of motion. Short lead walks for ten days."
              />
            </Field>

            {entry.type === "prescription" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Medication" htmlFor={`med-${index}`}>
                  <Input
                    id={`med-${index}`}
                    value={entry.medicationName ?? ""}
                    onChange={(e) => update(index, { medicationName: e.target.value })}
                    placeholder="Carprofen 75 mg"
                    required
                  />
                </Field>

                <Field label="Dosage" htmlFor={`dose-${index}`}>
                  <Input
                    id={`dose-${index}`}
                    value={entry.dosage ?? ""}
                    onChange={(e) => update(index, { dosage: e.target.value })}
                    placeholder="1 tablet twice daily with food"
                  />
                </Field>

                <Field
                  label="Refills"
                  hint="blank means no limit"
                  htmlFor={`refills-${index}`}
                >
                  <Input
                    id={`refills-${index}`}
                    type="number"
                    min={0}
                    value={entry.refillsLeft ?? ""}
                    onChange={(e) =>
                      update(index, {
                        refillsLeft:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>

                <Field label="Valid until" htmlFor={`expires-${index}`}>
                  <Input
                    id={`expires-${index}`}
                    type="date"
                    value={entry.expiresAt?.slice(0, 10) ?? ""}
                    onChange={(e) =>
                      update(index, {
                        expiresAt: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      })
                    }
                  />
                </Field>
              </div>
            )}

            {(entry.type === "vaccination" || entry.type === "visit_note") && (
              <Field
                label="Next due"
                hint="optional"
                htmlFor={`due-${index}`}
              >
                <Input
                  id={`due-${index}`}
                  type="date"
                  value={entry.nextDueAt?.slice(0, 10) ?? ""}
                  onChange={(e) =>
                    update(index, {
                      nextDueAt: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    })
                  }
                />
              </Field>
            )}

            {entries.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setEntries((current) => current.filter((_, i) => i !== index))
                }
              >
                Remove entry
              </Button>
            )}
          </fieldset>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEntries((current) => [...current, blankEntry()])}
          >
            Add another entry
          </Button>
          <Button
            type="submit"
            variant="cta"
            disabled={saving || entries.some((e) => !e.title.trim())}
          >
            {saving ? "Saving…" : "Save and complete visit"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * The review — REQUIREMENTS.md V10.
 *
 * **One direction.** The owner reviews the vet; the vet sees what was written
 * and has no form. That is not a missing feature: a clinician rating the client
 * is a different and much worse product, and once such a rating exists it is
 * read by whoever treats the animal next.
 */
function ReviewPanel({
  appointmentId,
  isOwner,
  currentUserId,
  vetUserId,
}: {
  appointmentId: string;
  isOwner: boolean;
  currentUserId: string;
  vetUserId: string;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getAppointmentReviews(appointmentId).then(setReviews).catch(() => setReviews([]));
  }, [appointmentId]);

  useEffect(load, [load]);

  const alreadyMine = reviews.some((r) => r.fromUserId === currentUserId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createAppointmentReview(appointmentId, {
        toUserId: vetUserId,
        rating,
        comment,
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not leave that review");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-mist bg-white p-6">
      <h2 className="text-lg font-semibold text-ink">Review</h2>
      <p className="mt-1 text-sm text-charcoal/60">
        Owners review their vet. It goes one way.
      </p>

      {reviews.length > 0 && (
        <ul className="mt-5 space-y-4">
          {reviews.map((review) => (
            <li key={review.id} className="border-l-2 border-mist pl-4">
              <p className="text-sm text-charcoal/70">
                {review.rating.toFixed(1)} ★
                <span className="text-charcoal/45">
                  {" · "}
                  {formatDateTime(review.createdAt)}
                </span>
              </p>
              {review.comment && (
                <p className="mt-1 text-sm text-ink">{review.comment}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isOwner && reviews.length === 0 && (
        <p className="mt-3 text-sm text-charcoal/60">
          Nothing yet. The owner may leave one.
        </p>
      )}

      {isOwner && !alreadyMine && (
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
            >
              {error}
            </p>
          )}

          <Field label="Rating" hint="1 to 5, half stars allowed" htmlFor="rating">
            <Input
              id="rating"
              type="number"
              min={1}
              max={5}
              step={0.5}
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
            />
          </Field>

          <Field label="Comment" htmlFor="comment">
            <Textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="She took the time to explain the plan rather than just handing me a bag."
            />
          </Field>

          <Button type="submit" disabled={saving}>
            {saving ? "Posting…" : "Post review"}
          </Button>
        </form>
      )}

      {isOwner && alreadyMine && (
        <p className="mt-3 text-xs text-charcoal/55">
          You have reviewed this visit. A review you can rewrite afterwards is a
          negotiating position, not a review.
        </p>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
    </div>
  );
}
