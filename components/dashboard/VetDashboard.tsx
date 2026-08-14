"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import type { AppointmentStatus, User, VetAppointment } from "@/types";
import { getVetByUserId } from "@/lib/api/vets";
import {
  getAppointmentsByVet,
  updateAppointmentStatus,
} from "@/lib/api/appointments";
import { getPetsByIds } from "@/lib/api/pets";
import { getUsersByIds } from "@/lib/api/users";
import { useAsync } from "@/lib/hooks/useAsync";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { AppointmentStatusBadge } from "@/components/vet/AppointmentStatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Panel, Stat } from "@/components/ui/Panel";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { Skeleton } from "@/components/ui/Skeleton";
import { BLUR_DATA_URL } from "@/lib/media/photos";
import {
  CONSULT_MODE_LABELS,
  SPECIALTY_LABELS,
  formatCurrency,
  formatRange,
} from "@/lib/utils";

export function VetDashboard({ user }: { user: User }) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: profile, loading: loadingProfile } = useAsync(
    () => getVetByUserId(user.id),
    [user.id]
  );

  const { data, loading, reload } = useAsync(async () => {
    if (!profile) return null;
    const appointments = await getAppointmentsByVet(profile.id);
    const [pets, owners] = await Promise.all([
      getPetsByIds(appointments.map((a) => a.petId)),
      getUsersByIds(appointments.map((a) => a.ownerId)),
    ]);
    return {
      appointments,
      pets: new Map(pets.map((p) => [p.id, p])),
      owners: new Map(owners.map((o) => [o.id, o])),
    };
  }, [profile?.id]);

  if (loadingProfile) return <Skeleton className="h-64 w-full rounded-2xl" />;

  if (!profile) {
    return (
      <EmptyState
        title="Set up your clinic profile"
        description="Add your specialties, licence, consultation fee, and availability so owners can find and book you."
        actionLabel="Create vet profile"
        actionHref="/dashboard/vet-profile"
      />
    );
  }

  const appointments = data?.appointments ?? [];
  const requests = appointments.filter((a) => a.status === "requested");
  const scheduled = appointments.filter((a) =>
    ["confirmed", "in_progress"].includes(a.status)
  );
  const history = appointments.filter((a) =>
    ["completed", "declined", "cancelled"].includes(a.status)
  );

  async function act(id: string, status: AppointmentStatus, msg: string) {
    setBusyId(id);
    try {
      await updateAppointmentStatus(id, status);
      toast.success(msg);
      reload();
    } catch (e) {
      toast.error("Couldn't update that appointment", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  function Row({ appointment }: { appointment: VetAppointment }) {
    const pet = data?.pets.get(appointment.petId);
    const owner = data?.owners.get(appointment.ownerId);
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-mist bg-white p-4">
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-fog">
          {pet && (
            <Image
              src={pet.photoUrl}
              alt=""
              fill
              sizes="48px"
              placeholder="blur"
              blurDataURL={BLUR_DATA_URL}
              className="object-cover"
            />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <Link
            href={`/appointments/${appointment.id}`}
            className="block truncate font-medium text-ink hover:underline"
          >
            {pet?.name ?? "Patient"} — {appointment.reason}
          </Link>
          <p className="truncate text-sm text-charcoal/65">
            {owner?.name ?? "Owner"} · {CONSULT_MODE_LABELS[appointment.mode]}
          </p>
          <p className="font-mono text-xs text-charcoal/55">
            {formatRange(appointment.startDateTime, appointment.endDateTime)}
          </p>
          {appointment.symptoms.length > 0 && (
            <p className="mt-1 truncate text-xs text-charcoal/60">
              {appointment.symptoms.join(" · ")}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <AppointmentStatusBadge status={appointment.status} />
          {appointment.status === "requested" && (
            <>
              <Button
                size="sm"
                variant="primary"
                disabled={busyId === appointment.id}
                onClick={() => act(appointment.id, "confirmed", "Appointment confirmed")}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === appointment.id}
                onClick={() => act(appointment.id, "declined", "Request declined")}
              >
                Decline
              </Button>
            </>
          )}
          {appointment.status === "confirmed" && (
            <Button
              size="sm"
              variant="primary"
              disabled={busyId === appointment.id}
              onClick={() => act(appointment.id, "in_progress", "Visit started")}
            >
              Start
            </Button>
          )}
          {appointment.status === "in_progress" && (
            <ButtonLink
              href={`/appointments/${appointment.id}`}
              size="sm"
              variant="cta"
            >
              Write summary
            </ButtonLink>
          )}
        </div>
      </div>
    );
  }

  return (
    <RevealGroup className="space-y-10">
      <RevealItem className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Awaiting your reply" value={String(requests.length)} />
        <Stat label="Scheduled" value={String(scheduled.length)} />
        <Stat label="Completed" value={String(history.filter((a) => a.status === "completed").length)} />
        <Stat label="Consultation fee" value={formatCurrency(profile.consultFee)} />
      </RevealItem>

      <RevealItem>
        <h2 className="mb-3 text-lg font-semibold text-ink">Requests</h2>
        {loading ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : requests.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-mist bg-white/60 px-4 py-8 text-center text-sm text-charcoal/60">
            No requests waiting. Owners booking you will appear here first.
          </p>
        ) : (
          <div className="space-y-3">
            {requests.map((a) => (
              <Row key={a.id} appointment={a} />
            ))}
          </div>
        )}
      </RevealItem>

      <RevealItem>
        <h2 className="mb-3 text-lg font-semibold text-ink">Schedule</h2>
        {scheduled.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-mist bg-white/60 px-4 py-8 text-center text-sm text-charcoal/60">
            Nothing scheduled yet.
          </p>
        ) : (
          <div className="space-y-3">
            {scheduled.map((a) => (
              <Row key={a.id} appointment={a} />
            ))}
          </div>
        )}
      </RevealItem>

      <RevealItem className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Your clinic"
          action={
            <Link
              href="/dashboard/vet-profile"
              className="text-xs text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
            >
              Edit
            </Link>
          }
        >
          <p className="text-sm font-medium text-ink">{profile.clinicName}</p>
          <p className="text-sm text-charcoal/65">
            {profile.clinic.city}, {profile.clinic.state}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {profile.specialties.map((s) => (
              <span
                key={s}
                className="rounded-full border border-mist bg-fog px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-charcoal"
              >
                {SPECIALTY_LABELS[s]}
              </span>
            ))}
          </div>
        </Panel>

        <div>
          <h3 className="mb-3 text-sm font-semibold text-ink">Your availability</h3>
          <AvailabilityCalendar
            availability={profile.availability}
            emptyLabel="You haven't published availability yet — owners can't request a time until you do."
          />
        </div>
      </RevealItem>

      {history.length > 0 && (
        <RevealItem>
          <h2 className="mb-3 text-lg font-semibold text-ink">Past appointments</h2>
          <div className="space-y-3">
            {history.slice(0, 8).map((a) => (
              <Row key={a.id} appointment={a} />
            ))}
          </div>
        </RevealItem>
      )}
    </RevealGroup>
  );
}
