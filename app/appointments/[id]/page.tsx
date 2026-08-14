"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { AppointmentStatus } from "@/types";
import { getAppointmentById, updateAppointmentStatus } from "@/lib/api/appointments";
import { getVetById } from "@/lib/api/vets";
import { getPetById } from "@/lib/api/pets";
import { getUserById } from "@/lib/api/users";
import { getRecordsForPet } from "@/lib/api/medical-records";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { AuthRequired } from "@/components/AuthRequired";
import { AppointmentStatusBadge } from "@/components/vet/AppointmentStatusBadge";
import { VisitSummaryForm } from "@/components/vet/VisitSummaryForm";
import { MedicalRecordCard } from "@/components/vet/MedicalRecordCard";
import { EmptyState } from "@/components/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { ProgressLeash } from "@/components/ui/ProgressLeash";
import { Skeleton } from "@/components/ui/Skeleton";
import { Reveal } from "@/components/ui/Reveal";
import { MapPinIcon, StethoscopeIcon } from "@/components/ui/icons";
import { BLUR_DATA_URL } from "@/lib/mock-data/photos";
import {
  CONSULT_MODE_LABELS,
  SPECIES_LABELS,
  formatCurrency,
  formatRange,
} from "@/lib/utils";

/** The happy path, for the leash. Terminal branches render without it. */
const JOURNEY: AppointmentStatus[] = [
  "requested",
  "confirmed",
  "in_progress",
  "completed",
];
const JOURNEY_LABELS = ["Requested", "Confirmed", "In visit", "Complete"];

export default function AppointmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser, hasHydrated } = useSession();
  const [busy, setBusy] = useState(false);

  const {
    data: appointment,
    loading,
    reload,
  } = useAsync(() => getAppointmentById(id), [id]);

  const { data: vet } = useAsync(
    () => (appointment ? getVetById(appointment.vetId) : Promise.resolve(null)),
    [appointment?.vetId]
  );
  const { data: pet } = useAsync(
    () => (appointment ? getPetById(appointment.petId) : Promise.resolve(null)),
    [appointment?.petId]
  );
  const { data: owner } = useAsync(
    () => (appointment ? getUserById(appointment.ownerId) : Promise.resolve(null)),
    [appointment?.ownerId]
  );
  const {
    data: records,
    reload: reloadRecords,
  } = useAsync(
    () => (appointment ? getRecordsForPet(appointment.petId) : Promise.resolve([])),
    [appointment?.petId]
  );

  if (!hasHydrated || loading) return <DetailSkeleton />;
  if (!currentUser) return <AuthRequired />;

  if (!appointment) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Appointment not found"
          description="It may have been cancelled, or you may not have access to it."
          actionLabel="Back to dashboard"
          actionHref="/dashboard"
        />
      </div>
    );
  }

  const isVet = vet?.userId === currentUser.id;
  const isOwner = appointment.ownerId === currentUser.id;
  const visitRecords = (records ?? []).filter((r) => r.appointmentId === appointment.id);

  const journeyIndex = JOURNEY.indexOf(appointment.status);
  const onHappyPath = journeyIndex >= 0;

  async function move(status: AppointmentStatus, message: string) {
    setBusy(true);
    try {
      await updateAppointmentStatus(id, status);
      toast.success(message);
      reload();
    } catch (e) {
      toast.error("Couldn't update the appointment", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-leash">
            Vet appointment
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {appointment.reason}
          </h1>
          <p className="mt-1 text-sm text-charcoal/70">
            {formatRange(appointment.startDateTime, appointment.endDateTime)} ·{" "}
            {CONSULT_MODE_LABELS[appointment.mode]}
          </p>
        </div>
        <AppointmentStatusBadge status={appointment.status} />
      </div>

      {onHappyPath && (
        <ProgressLeash
          steps={JOURNEY_LABELS}
          activeIndex={journeyIndex}
          label="Appointment stage"
          className="my-6"
        />
      )}

      {appointment.status === "declined" && (
        <p className="my-6 rounded-2xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-charcoal/80">
          This request was declined.{" "}
          <Link href="/vets" className="font-medium text-ink underline">
            Find another vet
          </Link>
          .
        </p>
      )}
      {appointment.status === "cancelled" && (
        <p className="my-6 rounded-2xl border border-mist bg-white px-4 py-3 text-sm text-charcoal/70">
          This appointment was cancelled.
        </p>
      )}

      {/* Actions — which party you are decides what you can do. */}
      {(isVet || isOwner) && (
        <div className="mb-8 flex flex-wrap gap-2">
          {isVet && appointment.status === "requested" && (
            <>
              <Button
                variant="cta"
                disabled={busy}
                onClick={() => move("confirmed", "Appointment confirmed")}
              >
                Confirm
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => move("declined", "Request declined")}
              >
                Decline
              </Button>
            </>
          )}
          {isVet && appointment.status === "confirmed" && (
            <Button
              variant="cta"
              disabled={busy}
              onClick={() => move("in_progress", "Visit started")}
            >
              Start visit
            </Button>
          )}
          {isVet && appointment.status === "in_progress" && (
            <Button
              variant="cta"
              disabled={busy}
              onClick={() => move("completed", "Visit completed")}
            >
              Complete visit
            </Button>
          )}
          {["requested", "confirmed"].includes(appointment.status) && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => move("cancelled", "Appointment cancelled")}
            >
              Cancel appointment
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {pet && (
          <Reveal>
            <Panel title="Patient">
              <div className="flex items-center gap-3">
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full">
                  <Image
                    src={pet.photoUrl}
                    alt=""
                    fill
                    sizes="56px"
                    placeholder="blur"
                    blurDataURL={BLUR_DATA_URL}
                    className="object-cover"
                  />
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-ink">{pet.name}</p>
                  <p className="text-sm text-charcoal/65">
                    {pet.breed} · {SPECIES_LABELS[pet.species]} · {pet.weightLbs} lb
                  </p>
                  {owner && (
                    <p className="text-xs text-charcoal/55">Owner: {owner.name}</p>
                  )}
                </div>
              </div>
              {(pet.allergies.length > 0 || pet.medications.length > 0) && (
                <dl className="mt-4 space-y-2 border-t border-mist pt-3 text-sm">
                  {pet.allergies.length > 0 && (
                    <div>
                      <dt className="text-xs text-charcoal/55">Allergies</dt>
                      <dd className="text-charcoal">{pet.allergies.join(", ")}</dd>
                    </div>
                  )}
                  {pet.medications.length > 0 && (
                    <div>
                      <dt className="text-xs text-charcoal/55">Current medication</dt>
                      <dd className="text-charcoal">{pet.medications.join("; ")}</dd>
                    </div>
                  )}
                </dl>
              )}
              <ButtonLink
                href={`/dashboard/pets/${pet.id}`}
                variant="outline"
                size="sm"
                className="mt-4 w-full"
              >
                View health record
              </ButtonLink>
            </Panel>
          </Reveal>
        )}

        {vet && (
          <Reveal>
            <Panel title="Vet">
              <div className="flex items-center gap-3">
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full">
                  <Image
                    src={vet.user.avatarUrl}
                    alt=""
                    fill
                    sizes="56px"
                    placeholder="blur"
                    blurDataURL={BLUR_DATA_URL}
                    className="object-cover"
                  />
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-ink">{vet.user.name}</p>
                  <p className="text-sm text-charcoal/65">{vet.clinicName}</p>
                  <p className="flex items-center gap-1 text-xs text-charcoal/55">
                    <MapPinIcon width={12} height={12} />
                    {vet.clinic.city}, {vet.clinic.state}
                  </p>
                </div>
              </div>
              <dl className="mt-4 space-y-2 border-t border-mist pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-charcoal/60">Consultation fee</dt>
                  <dd className="font-mono text-ink">{formatCurrency(appointment.fee)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-charcoal/60">Format</dt>
                  <dd className="text-ink">{CONSULT_MODE_LABELS[appointment.mode]}</dd>
                </div>
              </dl>
              <ButtonLink
                href={`/vets/${vet.id}`}
                variant="outline"
                size="sm"
                className="mt-4 w-full"
              >
                View profile
              </ButtonLink>
            </Panel>
          </Reveal>
        )}
      </div>

      {(appointment.symptoms.length > 0 || appointment.notes) && (
        <Reveal className="mt-6">
          <Panel title="What the owner reported">
            {appointment.symptoms.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {appointment.symptoms.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-mist bg-fog px-2.5 py-1 text-xs text-charcoal"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
            {appointment.notes && (
              <p className="mt-3 text-sm leading-relaxed text-charcoal/85">
                {appointment.notes}
              </p>
            )}
          </Panel>
        </Reveal>
      )}

      {/* The visit's clinical output — the record that outlives the appointment. */}
      <Reveal className="mt-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <StethoscopeIcon width={18} height={18} />
          Visit summary
        </h2>
        <div className="mt-3 space-y-3">
          {visitRecords.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-mist bg-white/60 px-4 py-6 text-center text-sm text-charcoal/60">
              {isVet
                ? "Nothing recorded yet. Add notes, vaccinations or a prescription below."
                : "Your vet hasn't added notes for this visit yet."}
            </p>
          ) : (
            visitRecords.map((r) => <MedicalRecordCard key={r.id} record={r} />)
          )}
        </div>

        {isVet && appointment.status !== "cancelled" && appointment.status !== "declined" && (
          <VisitSummaryForm
            petId={appointment.petId}
            appointmentId={appointment.id}
            onCreated={reloadRecords}
            className="mt-4"
          />
        )}
      </Reveal>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-6 h-24 w-full rounded-2xl" />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    </div>
  );
}
