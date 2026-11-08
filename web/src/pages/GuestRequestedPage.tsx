import { useLocation } from "react-router";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/EmptyState";
import { formatCurrency, formatRange } from "@/lib/utils";

/**
 * What a guest sees after booking (STATUS §3-G), at /booking/requested.
 *
 * A guest has no session, so there is no booking page to send them to; the
 * form hands this page what the API answered, in the navigation state. A
 * reload has no state and shows the generic version.
 */
export interface GuestRequestedState {
  what: "booking" | "visit";
  providerName: string;
  petName: string;
  /** "Dog walking", "In-clinic visit" */
  serviceLabel: string;
  startDateTime: string;
  endDateTime: string;
  /** USD. */
  price?: number;
  email: string;
  accountEmailSent: boolean;
  savedAccount: boolean;
  /** Development only. */
  devLink?: string;
}

export default function GuestRequestedPage() {
  const state = useLocation().state as GuestRequestedState | null;

  if (!state) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Your request is on its way"
          description="We emailed you the details. You’ll hear from us again when it’s accepted or declined."
          actionLabel="Back to Leash"
          actionHref="/"
        />
      </div>
    );
  }

  // A vet goes by title and surname ("Dr. Naomi Ruiz" → not "Dr."); a caretaker by first name.
  const first = state.what === "visit" ? state.providerName : state.providerName.split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-wide text-[#2F6F5E]">Request sent</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">
        We’ve sent your request to {state.providerName}
      </h1>
      <p className="mt-2 text-sm text-charcoal/70">
        Nothing is confirmed yet. {first} will accept or decline, and we’ll email{" "}
        <strong>{state.email}</strong> either way. They have your phone number if they need to reach you.
      </p>

      <dl className="mt-6 divide-y divide-mist rounded-2xl border border-mist bg-white">
        <Row label={state.what === "visit" ? "Vet" : "Caretaker"} value={state.providerName} />
        <Row label="Pet" value={state.petName} />
        <Row label={state.what === "visit" ? "Visit" : "Service"} value={state.serviceLabel} />
        <Row label="When" value={formatRange(state.startDateTime, state.endDateTime)} />
        {state.price !== undefined && (
          <Row label={state.what === "visit" ? "Fee" : "Estimated total"} value={formatCurrency(state.price)} />
        )}
      </dl>

      <div className="mt-6 rounded-2xl border border-mist bg-fog/60 p-5">
        {state.savedAccount ? (
          state.accountEmailSent ? (
            <>
              <h2 className="font-semibold text-ink">Check your email to finish your account</h2>
              <p className="mt-1 text-sm text-charcoal/70">
                We sent a link to <strong>{state.email}</strong>. Choose a password within 7 days and
                this booking and {state.petName} will be waiting in your account.
              </p>
            </>
          ) : (
            <>
              <h2 className="font-semibold text-ink">We couldn’t send the account email just now</h2>
              <p className="mt-1 text-sm text-charcoal/70">
                Your request is safe. To set a password, use “Forgot your password?” with{" "}
                {state.email} in a little while.
              </p>
            </>
          )
        ) : (
          <>
            <h2 className="font-semibold text-ink">Want to keep track of it?</h2>
            <p className="mt-1 text-sm text-charcoal/70">
              Create an account with {state.email} and this booking comes with it — we’ll email you a
              link to set a password.
            </p>
            <div className="mt-3">
              <ButtonLink to="/forgot-password?setup=1" variant="outline" size="sm">
                Set up my account
              </ButtonLink>
            </div>
          </>
        )}
        {state.devLink && (
          <p className="mt-4 break-all rounded-lg bg-white p-3 font-mono text-[11px]">
            Dev mode — set-password link:{" "}
            <a href={state.devLink} className="text-leash underline">
              {state.devLink}
            </a>
          </p>
        )}
      </div>

      <div className="mt-6 text-center">
        <ButtonLink to="/" variant="ghost" size="sm">
          Back to Leash
        </ButtonLink>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-charcoal/60">{label}</dt>
      <dd className="max-w-[65%] text-right text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}
