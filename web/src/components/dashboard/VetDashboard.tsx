import { Link } from "react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { AppointmentStatus, User, VetAppointment } from "@/types";
import { getVetProfileForUser } from "@/api/vets";
import { listVetAppointments, updateAppointmentStatus } from "@/api/appointments";
import { getVetStats } from "@/api/dashboard";
import { getPetsByIds } from "@/api/pets";
import { getUsersByIds } from "@/api/users";
import { useAsync } from "@/hooks/useAsync";
import { Avatar } from "@/components/Avatar";
import { AppointmentStatusBadge } from "@/components/vet/AppointmentStatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { Skeleton } from "@/components/ui/Skeleton";
import { CalendarIcon, ClockIcon, WalletIcon } from "@/components/ui/icons";
import { startOfTodayIso } from "@/lib/calendar";
import {
  CONSULT_MODE_LABELS,
  SPECIALTY_LABELS,
  formatCents,
  formatCurrency,
  formatRange,
} from "@/lib/utils";
import { ProfileStrip } from "./schedule/ProfileStrip";
import { RescheduleDialog } from "./schedule/RescheduleDialog";
import { ScheduleOverview } from "./schedule/ScheduleOverview";
import { StatCards } from "./schedule/StatCards";
import { vetSource } from "./schedule/sources";

const NOUN = { one: "appointment", many: "appointments" };

/**
 * The vet's dashboard — the same layout as the caretaker's (the client's
 * call): three cards, the requests and the schedule, the upcoming list beside
 * an interactive calendar, past visits, and the clinic's listing small at the
 * foot. The vet can also move a requested or confirmed visit to a new time.
 */
export function VetDashboard({ user }: { user: User }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [moving, setMoving] = useState<{ appointment: VetAppointment; ownerName: string } | null>(
    null,
  );
  const refresh = () => setVersion((v) => v + 1);

  const { data: profile, loading: loadingProfile } = useAsync(
    () => getVetProfileForUser(user.id),
    [user.id]
  );

  const { data, loading } = useAsync(async () => {
    if (!profile) return null;
    // The request queue and the past list read the newest hundred, as
    // before. The cards and the calendar are counted and windowed by the API.
    const { items: appointments } = await listVetAppointments(profile.id, { limit: 100 });
    const [pets, owners] = await Promise.all([
      getPetsByIds([...new Set(appointments.map((a) => a.petId))]),
      getUsersByIds([...new Set(appointments.map((a) => a.ownerId))]),
    ]);
    return {
      appointments,
      pets: new Map(pets.map((p) => [p.id, p])),
      owners: new Map(owners.map((o) => [o.id, o])),
    };
  }, [profile?.id, version]);

  const stats = useAsync(
    async () => (profile ? getVetStats(profile.id, startOfTodayIso()) : null),
    [profile?.id, version],
  );

  const sources = useMemo(() => (profile ? [vetSource(profile.id)] : []), [profile]);

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
      refresh();
    } catch (e) {
      toast.error("Couldn't update that appointment", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  /** The vet's moves on one appointment — the same buttons wherever it is shown. */
  function actionsFor(appointment: VetAppointment, ownerName: string) {
    const busy = busyId === appointment.id;
    const canMove = appointment.status === "requested" || appointment.status === "confirmed";
    return (
      <>
        {appointment.status === "requested" && (
          <>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => act(appointment.id, "confirmed", "Appointment confirmed")}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
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
            disabled={busy}
            onClick={() => act(appointment.id, "in_progress", "Visit started")}
          >
            Start
          </Button>
        )}
        {canMove && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setMoving({ appointment, ownerName })}
          >
            Reschedule
          </Button>
        )}
        {appointment.status === "in_progress" && (
          <ButtonLink to={`/appointments/${appointment.id}`} size="sm" variant="cta">
            Write summary
          </ButtonLink>
        )}
      </>
    );
  }

  function row(appointment: VetAppointment) {
    const pet = data?.pets.get(appointment.petId);
    const owner = data?.owners.get(appointment.ownerId);
    return (
      <div
        key={appointment.id}
        className="flex flex-wrap items-center gap-4 rounded-2xl border border-mist bg-white p-4"
      >
        <Avatar src={pet?.photoUrl ?? ""} size={48} className="bg-fog" />

        <div className="min-w-0 flex-1">
          <Link
            to={`/appointments/${appointment.id}`}
            className="block truncate font-medium text-ink hover:underline"
          >
            {pet?.name ?? "Patient"} — {appointment.reason}
          </Link>
          <p className="truncate text-sm text-charcoal/65">
            {owner?.name ?? "Owner"} · {CONSULT_MODE_LABELS[appointment.mode]}
            {appointment.fee !== undefined && ` · ${formatCurrency(appointment.fee)}`}
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

        <div className="flex flex-wrap items-center gap-2">
          <AppointmentStatusBadge status={appointment.status} />
          {actionsFor(appointment, owner?.name ?? "The owner")}
        </div>
      </div>
    );
  }

  return (
    <RevealGroup className="space-y-10">
      <RevealItem>
        <StatCards
          loading={stats.loading && !stats.data}
          failed={!!stats.error}
          cards={[
            {
              label: "Total appointments",
              value: String(stats.data?.total ?? 0),
              hint: "Every visit booked with you, less declined and cancelled",
              icon: <CalendarIcon width={18} height={18} />,
            },
            {
              label: "Upcoming",
              value: String(stats.data?.upcoming ?? 0),
              hint: "Requested, confirmed or under way — today or later",
              icon: <ClockIcon width={18} height={18} />,
            },
            {
              label: "Earned",
              value: formatCents(stats.data?.earnedCents ?? 0),
              hint: "Completed visits at the fee quoted — settled with the owner, not through Leash",
              icon: <WalletIcon width={18} height={18} />,
            },
          ]}
        />
      </RevealItem>

      <RevealItem>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink">
          Requests
          {requests.length > 0 && (
            <span className="rounded-full bg-leash px-2 py-0.5 font-mono text-xs text-white">
              {requests.length}
            </span>
          )}
        </h2>
        {loading && !data ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : requests.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-mist bg-white/60 px-4 py-8 text-center text-sm text-charcoal/60">
            No requests waiting. Owners booking you will appear here first.
          </p>
        ) : (
          <div className="space-y-3">{requests.map(row)}</div>
        )}
      </RevealItem>

      <RevealItem>
        <h2 className="mb-3 text-lg font-semibold text-ink">Schedule</h2>
        {scheduled.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-mist bg-white/60 px-4 py-8 text-center text-sm text-charcoal/60">
            Nothing scheduled yet.
          </p>
        ) : (
          <div className="space-y-3">{scheduled.map(row)}</div>
        )}
      </RevealItem>

      <RevealItem>
        <h2 className="mb-3 text-lg font-semibold text-ink">Calendar</h2>
        <ScheduleOverview
          sources={sources}
          version={version}
          availability={profile.availability}
          noun={NOUN}
          emptyUpcoming="Nothing coming up. New requests appear here as soon as they arrive."
          renderActions={(e) =>
            e.appointment ? actionsFor(e.appointment, e.counterpart?.name ?? "The owner") : null
          }
        />
      </RevealItem>

      {history.length > 0 && (
        <RevealItem>
          <h2 className="mb-3 text-lg font-semibold text-ink">Past appointments</h2>
          <div className="space-y-3">{history.slice(0, 8).map(row)}</div>
        </RevealItem>
      )}

      <RevealItem>
        <ProfileStrip
          label="Your clinic"
          name={profile.clinicName}
          place={`${profile.clinic.city}, ${profile.clinic.state}`}
          tags={profile.specialties.map((s) => SPECIALTY_LABELS[s])}
          facts={[`${formatCurrency(profile.consultFee)} consult`]}
          editHref="/dashboard/vet-profile"
        />
      </RevealItem>

      {moving && (
        <RescheduleDialog
          appointment={moving.appointment}
          ownerName={moving.ownerName}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            refresh();
          }}
        />
      )}
    </RevealGroup>
  );
}
