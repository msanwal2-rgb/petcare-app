import { Link, useParams } from "react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { ApplicationStatus } from "@/types";
import { getApplicationById, payAdoptionFee, setApplicationStatus } from "@/api/adoptions";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { PaymentForm } from "@/components/store/PaymentForm";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ProgressLeash } from "@/components/ui/ProgressLeash";
import { BLUR_DATA_URL } from "@/lib/photos";
import { STRIPE_KEY } from "@/lib/payments";
import { formatCents, formatDateTime } from "@/lib/utils";

/**
 * The applicant's view of their own application — the reference's
 * `app/adoptions/[id]/page.tsx`.
 *
 * Uses the leash-line progress motif the bookings, appointments and orders all
 * use, because from the applicant's side this is the same kind of thing: a
 * request somebody else is deciding about.
 *
 * One addition for a real card: the reference's fee button assumed the demo
 * provider, which settles inline. With Stripe configured the payment comes
 * back with a client secret, and the same card form checkout uses takes it.
 */

const STEPS = ["Applied", "Reviewing", "Approved", "Home"];

const STEP_INDEX: Record<ApplicationStatus, number> = {
  submitted: 0,
  under_review: 1,
  approved: 2,
  completed: 3,
  rejected: 0,
  withdrawn: 0,
};

const TONE: Record<ApplicationStatus, StatusTone> = {
  submitted: "pending",
  under_review: "progress",
  approved: "active",
  completed: "done",
  rejected: "failed",
  withdrawn: "muted",
};

const LABEL: Record<ApplicationStatus, string> = {
  submitted: "Sent",
  under_review: "Being reviewed",
  approved: "Approved",
  completed: "Adopted",
  rejected: "Not successful",
  withdrawn: "Withdrawn",
};

export default function AdoptionApplicationPage() {
  const { id = "" } = useParams();
  const { currentUser, hasHydrated } = useSession();
  const [busy, setBusy] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const { data: application, loading, reload } = useAsync(
    () => (currentUser ? getApplicationById(id) : Promise.resolve(null)),
    [id, currentUser?.id]
  );

  if (!hasHydrated || loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-6 h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!currentUser) return <AuthRequired message="Log in to see your application." />;

  if (!application) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="No such application"
          description="It may have been withdrawn."
          actionLabel="Browse adoptions"
          actionHref="/adopt"
        />
      </div>
    );
  }

  const closed = ["completed", "rejected", "withdrawn"].includes(application.status);
  const owesFee = application.status === "approved" && application.feeCents > 0;

  async function pay() {
    setBusy(true);
    try {
      const result = await payAdoptionFee(id);
      if (result.status === "paid") {
        toast.success("Fee paid", { description: "The shelter will be in touch about collection." });
      } else if (result.payment.clientSecret && STRIPE_KEY) {
        setClientSecret(result.payment.clientSecret);
      } else {
        toast.success("Payment started", { description: "We'll confirm as soon as it settles." });
      }
      reload();
    } catch (e) {
      toast.error("Couldn't take that payment", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (
      !window.confirm(
        `Withdraw your application for ${application!.petName}?\n\nIf you've paid the fee it will be refunded.`
      )
    )
      return;
    setBusy(true);
    try {
      await setApplicationStatus(id, "withdrawn");
      toast.success("Application withdrawn");
      reload();
    } catch (e) {
      toast.error("Couldn't withdraw that", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <Link to="/adopt" className="text-sm text-charcoal/60 underline-offset-2 hover:text-ink hover:underline">
        ← Browse adoptions
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl border border-mist bg-white p-5">
        <span
          className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-fog"
          style={{ backgroundImage: `url("${BLUR_DATA_URL}")`, backgroundSize: "cover" }}
        >
          {application.petPhotoUrl && (
            <img
              src={application.petPhotoUrl}
              alt={application.petName}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">{application.petName}</h1>
            <StatusBadge tone={TONE[application.status]} label={LABEL[application.status]} />
          </div>
          <p className="mt-1 font-mono text-xs text-charcoal/55">
            applied {formatDateTime(application.createdAt)}
            {application.feeCents > 0 && ` · fee ${formatCents(application.feeCents)}`}
          </p>
        </div>
      </div>

      {!closed && (
        <div className="mt-6">
          <ProgressLeash steps={STEPS} activeIndex={STEP_INDEX[application.status]} label="Adoption progress" />
        </div>
      )}

      {application.decisionNote && (
        <Panel title="From the shelter" className="mt-6">
          <p className="whitespace-pre-line text-sm text-charcoal/80">{application.decisionNote}</p>
        </Panel>
      )}

      {application.status === "completed" && (
        <div className="mt-6 rounded-2xl border border-[#2F6F5E]/35 bg-[#2F6F5E]/10 p-5">
          <p className="text-sm text-charcoal">
            <strong className="font-medium text-ink">{application.petName} is yours.</strong>{" "}
            Their health record has come across with them — vaccinations,
            allergies and everything a vet has written.
          </p>
          <Link
            to={`/dashboard/pets/${application.petId}`}
            className="mt-3 inline-block text-sm font-medium text-ink underline-offset-2 hover:underline"
          >
            Open their record →
          </Link>
        </div>
      )}

      {owesFee && (
        <Panel title="Adoption fee" className="mt-6">
          <p className="text-sm text-charcoal/70">
            {application.petName} is being held for you. Settling the fee is the
            last step before the shelter can complete the adoption.
          </p>
          {clientSecret ? (
            <div className="mt-4">
              <PaymentForm
                clientSecret={clientSecret}
                publishableKey={STRIPE_KEY}
                amountCents={application.feeCents}
                returnUrl={window.location.href}
                onPaid={() => {
                  setClientSecret(null);
                  toast.success("Fee paid", { description: "The shelter will be in touch about collection." });
                  reload();
                }}
                onBack={() => setClientSecret(null)}
              />
            </div>
          ) : (
            <Button variant="cta" className="mt-4" disabled={busy} onClick={pay}>
              {busy ? "Working…" : `Pay ${formatCents(application.feeCents)}`}
            </Button>
          )}
        </Panel>
      )}

      {!closed && (
        <div className="mt-6">
          <Button variant="ghost" size="sm" disabled={busy} onClick={withdraw}>
            Withdraw application
          </Button>
        </div>
      )}
    </div>
  );
}
