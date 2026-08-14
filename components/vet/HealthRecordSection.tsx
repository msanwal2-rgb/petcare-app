"use client";

import Link from "next/link";
import { toast } from "sonner";
import type { MedicalRecord, Pet } from "@/types";
import { deleteRecord, getRecordsForPet } from "@/lib/api/medical-records";
import { getAppointmentsByOwner } from "@/lib/api/appointments";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { MedicalRecordCard } from "./MedicalRecordCard";
import { VisitSummaryForm } from "./VisitSummaryForm";
import { AppointmentStatusBadge } from "./AppointmentStatusBadge";
import { ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { AlertIcon, SyringeIcon } from "@/components/ui/icons";
import { formatDate, formatRange } from "@/lib/utils";

/** Vaccinations due within this window are surfaced as a reminder. */
const DUE_SOON_DAYS = 60;

function dueSoon(records: MedicalRecord[], now = new Date()) {
  const horizon = new Date(now.getTime() + DUE_SOON_DAYS * 86_400_000);
  return records
    .filter((r) => r.nextDueAt && new Date(r.nextDueAt) <= horizon)
    .sort((a, b) => a.nextDueAt!.localeCompare(b.nextDueAt!));
}

function activePrescriptions(records: MedicalRecord[], now = new Date()) {
  return records.filter(
    (r) =>
      r.type === "prescription" &&
      r.refillsLeft !== 0 &&
      (!r.expiresAt || new Date(r.expiresAt) > now)
  );
}

/**
 * A pet's health record: what's due, what it's on, and the full timeline.
 *
 * The owner sees everything but may only add the self-reported entry types —
 * clinical entries come from the treating vet, which is what makes the
 * prescriptions here trustworthy enough for the store to act on.
 */
export function HealthRecordSection({ pet }: { pet: Pet }) {
  const { currentUser } = useSession();
  const { data: records, loading, reload } = useAsync(
    () => getRecordsForPet(pet.id),
    [pet.id]
  );
  const { data: appointments } = useAsync(
    () => getAppointmentsByOwner(pet.ownerId),
    [pet.ownerId]
  );

  if (loading || records === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  const due = dueSoon(records);
  const active = activePrescriptions(records);
  const petAppointments = (appointments ?? []).filter((a) => a.petId === pet.id);

  async function remove(record: MedicalRecord) {
    try {
      await deleteRecord(record.id);
      toast.success("Removed from the health record");
      reload();
    } catch (e) {
      toast.error("Couldn't remove that entry", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  const upcoming = petAppointments.filter((a) =>
    ["requested", "confirmed", "in_progress"].includes(a.status)
  );

  return (
    <div className="space-y-6">
      {due.length > 0 && (
        <div className="rounded-2xl border border-marigold/40 bg-marigold/8 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <AlertIcon width={16} height={16} className="text-[#946412]" />
            Coming due
          </p>
          <ul className="mt-2 space-y-1 text-sm text-charcoal/80">
            {due.map((r) => (
              <li key={r.id} className="flex justify-between gap-4">
                <span>{r.title}</span>
                <span className="font-mono text-charcoal/60">
                  {formatDate(r.nextDueAt!)}
                </span>
              </li>
            ))}
          </ul>
          <ButtonLink href="/vets" variant="outline" size="sm" className="mt-3">
            Book a vet
          </ButtonLink>
        </div>
      )}

      {active.length > 0 && (
        <Panel title="Active prescriptions">
          <ul className="space-y-2 text-sm">
            {active.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ink">{r.medicationName ?? r.title}</span>
                <span className="font-mono text-xs text-charcoal/60">
                  {r.refillsLeft != null && `${r.refillsLeft} refills · `}
                  {r.expiresAt ? `until ${formatDate(r.expiresAt)}` : "no expiry"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-mist pt-3 text-xs text-charcoal/60">
            Prescription-only products in the store unlock automatically for{" "}
            {pet.name} while these are valid.
          </p>
        </Panel>
      )}

      {upcoming.length > 0 && (
        <Panel title="Upcoming appointments">
          <ul className="space-y-2">
            {upcoming.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/appointments/${a.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-mist px-3 py-2.5 text-sm transition-colors hover:border-ink/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{a.reason}</span>
                    <span className="block font-mono text-xs text-charcoal/55">
                      {formatRange(a.startDateTime, a.endDateTime)}
                    </span>
                  </span>
                  <AppointmentStatusBadge status={a.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <SyringeIcon width={18} height={18} />
            Health timeline
          </h2>
          <VisitSummaryForm
            petId={pet.id}
            onCreated={reload}
            // An owner may only add what they can genuinely observe; the
            // clinical types are the treating vet's to write.
            allowedTypes={["weight", "allergy"]}
          />
        </div>

        {records.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-mist bg-white/60 px-4 py-10 text-center">
            <p className="text-sm text-charcoal/65">
              No health records yet for {pet.name}.
            </p>
            <p className="mt-1 text-sm text-charcoal/55">
              Book a vet visit and everything from it lands here automatically.
            </p>
            <ButtonLink href="/vets" variant="cta" size="sm" className="mt-4">
              Find a vet
            </ButtonLink>
          </div>
        ) : (
          <div className="space-y-3">
            {records.map((r) => (
              <MedicalRecordCard
                key={r.id}
                record={r}
                onDelete={
                  r.authorUserId === currentUser?.id ? () => remove(r) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
