import { Link } from "react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { ApplicationStatus, User } from "@/types";
import {
  completeAdoption,
  getShelterApplications,
  searchListings,
  setApplicationStatus,
  type AdoptionApplicationWithApplicant,
} from "@/api/adoptions";
import { getShelterByUserId } from "@/api/shelters";
import { listMyPets } from "@/api/pets";
import { ApiError } from "@/api/_client";
import { useAsync } from "@/hooks/useAsync";
import { Panel, Stat } from "@/components/ui/Panel";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCents, formatDate } from "@/lib/utils";

/**
 * The shelter's side: who has applied, and what needs doing about it — the
 * reference's `components/dashboard/ShelterDashboard.tsx`. Ordered oldest
 * first, because it is a queue and somebody has been waiting.
 *
 * One change in the wiring: the reference recognised the live-engagement
 * refusal by matching words in the error message. The API names it with
 * `code: "live_engagements"`, and that is what is checked here.
 */

const TONE: Record<ApplicationStatus, StatusTone> = {
  submitted: "pending",
  under_review: "progress",
  approved: "active",
  completed: "done",
  rejected: "muted",
  withdrawn: "muted",
};

const LABEL: Record<ApplicationStatus, string> = {
  submitted: "New",
  under_review: "Reviewing",
  approved: "Approved",
  completed: "Adopted",
  rejected: "Declined",
  withdrawn: "Withdrawn",
};

export function ShelterDashboard({ user }: { user: User }) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: shelter, loading: loadingShelter } = useAsync(() => getShelterByUserId(user.id), [user.id]);

  const { data: queue, loading, reload } = useAsync(async () => {
    try {
      return (await getShelterApplications()).items;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) return [];
      throw e;
    }
  }, [user.id]);

  const { data: listings, reload: reloadListings } = useAsync(
    () => (shelter ? searchListings({ shelterId: shelter.id, limit: 100 }) : Promise.resolve(null)),
    [shelter?.id]
  );

  const { data: animals, reload: reloadAnimals } = useAsync(() => listMyPets(), [user.id]);

  function refresh() {
    reload();
    reloadListings();
    reloadAnimals();
  }

  async function run(id: string, label: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      toast.success(label);
      refresh();
    } catch (e) {
      toast.error("That didn't work", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Completing can refuse because the animal still has a booking or an
   * appointment open. That refusal names them, and the shelter decides — we
   * do not cancel a sitter's arrangement without asking.
   */
  async function complete({ application: app }: AdoptionApplicationWithApplicant) {
    setBusyId(app.id);
    try {
      await completeAdoption(app.id);
      toast.success(`${app.petName} has gone home`);
      refresh();
    } catch (e) {
      const live = e instanceof ApiError && e.details?.code === "live_engagements";
      if (!live) {
        toast.error("Couldn't complete that", { description: e instanceof Error ? e.message : undefined });
        return;
      }
      const ok = window.confirm(
        `${app.petName} still has a booking or vet appointment open.\n\n` +
          "Completing now will cancel it and notify the other party. If they're " +
          "in foster that's usually what you want; if a sitter has them this week, " +
          "speak to the sitter first.\n\nCancel it and complete the adoption?"
      );
      if (!ok) return;
      try {
        await completeAdoption(app.id, true);
        toast.success(`${app.petName} has gone home`);
        refresh();
      } catch (err) {
        toast.error("Couldn't complete that", { description: err instanceof Error ? err.message : undefined });
      }
    } finally {
      setBusyId(null);
    }
  }

  if (loading || loadingShelter) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (!shelter) {
    return (
      <EmptyState
        title="Set up your shelter profile"
        description="Adopters need to know who you are before they'll apply. It takes a minute."
        actionLabel="Create profile"
        actionHref="/dashboard/shelter-profile"
      />
    );
  }

  const all = queue ?? [];
  const open = all.filter((a) => ["submitted", "under_review", "approved"].includes(a.application.status));
  const available = listings?.items ?? [];
  const unlisted = (animals ?? []).filter((p) => !available.some((l) => l.listing.petId === p.id));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Listed" value={String(available.length)} />
        <Stat label="Open applications" value={String(open.length)} />
        <Stat
          label="Awaiting you"
          value={String(all.filter((a) => a.application.status === "submitted").length)}
        />
        <Stat label="Response rate" value={`${shelter.responseRatePct}%`} />
      </div>

      <Panel title="Applications" action={<span className="font-mono text-xs text-charcoal/55">oldest first</span>}>
        {open.length === 0 ? (
          <p className="text-sm text-charcoal/55">Nothing waiting on you right now.</p>
        ) : (
          <ul className="space-y-3">
            {open.map((row) => {
              const app = row.application;
              const unpaid = app.feeCents > 0 && row.paymentStatus !== "paid";
              return (
                <li
                  key={app.id}
                  className="flex flex-wrap items-center gap-4 rounded-xl border border-mist px-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">{app.petName}</span>
                      <StatusBadge tone={TONE[app.status]} label={LABEL[app.status]} />
                      {row.paymentStatus === "paid" && <StatusBadge tone="done" label="Fee paid" />}
                    </div>
                    <p className="mt-0.5 text-sm text-charcoal/70">
                      {row.applicant.name} · {app.householdAdults} adult
                      {app.householdAdults === 1 ? "" : "s"}
                      {app.householdChildren > 0 &&
                        `, ${app.householdChildren} child${app.householdChildren === 1 ? "" : "ren"}`}
                      {" · "}
                      {app.homeType}
                      {app.hasOtherPets && " · has other pets"}
                    </p>
                    <p className="font-mono text-xs text-charcoal/50">
                      applied {formatDate(app.createdAt)}
                      {app.feeCents > 0 && ` · ${formatCents(app.feeCents)}`}
                    </p>
                    {app.message && (
                      <p className="mt-1 line-clamp-2 text-xs text-charcoal/70">“{app.message}”</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {app.status === "submitted" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === app.id}
                        onClick={() =>
                          run(app.id, "Marked as reviewing", () => setApplicationStatus(app.id, "under_review"))
                        }
                      >
                        Start review
                      </Button>
                    )}
                    {(app.status === "submitted" || app.status === "under_review") && (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busyId === app.id}
                        onClick={() =>
                          run(app.id, `${row.applicant.name} approved`, () =>
                            setApplicationStatus(app.id, "approved")
                          )
                        }
                      >
                        Approve
                      </Button>
                    )}
                    {app.status === "approved" && (
                      <Button
                        size="sm"
                        variant="cta"
                        disabled={busyId === app.id || unpaid}
                        onClick={() => complete(row)}
                        title={unpaid ? "Waiting on the adoption fee" : undefined}
                      >
                        Complete adoption
                      </Button>
                    )}
                    {app.status !== "approved" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === app.id}
                        onClick={() => {
                          const note = window.prompt("Why? The applicant will see this.");
                          if (!note) return;
                          run(app.id, "Application declined", () => setApplicationStatus(app.id, "rejected", note));
                        }}
                      >
                        Decline
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Listed animals"
        action={
          <ButtonLink to="/dashboard/pets/new" variant="ghost" size="sm">
            Add an animal
          </ButtonLink>
        }
      >
        {available.length === 0 ? (
          <p className="text-sm text-charcoal/55">Nothing listed yet. Add an animal, then publish its listing.</p>
        ) : (
          <ul className="space-y-2">
            {available.map(({ listing, pet }) => (
              <li key={listing.id}>
                <Link
                  to={`/adopt/${listing.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-mist px-3 py-2.5 transition-colors hover:border-ink/40"
                >
                  <span className="text-sm font-medium text-ink">{pet.name}</span>
                  <span className="font-mono text-xs text-charcoal/55">
                    since {formatDate(listing.intakeAt)} ·{" "}
                    {listing.feeCents === 0 ? "no fee" : formatCents(listing.feeCents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {unlisted.length > 0 && (
        <Panel title="Not yet listed">
          <p className="mb-3 text-xs text-charcoal/60">Animals in your care with no adoption listing.</p>
          <ul className="space-y-2">
            {unlisted.map((pet) => (
              <li
                key={pet.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-mist px-3 py-2.5"
              >
                <Link to={`/dashboard/pets/${pet.id}`} className="text-sm font-medium text-ink hover:underline">
                  {pet.name}
                </Link>
                <span className="font-mono text-xs text-charcoal/50">{pet.breed}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
