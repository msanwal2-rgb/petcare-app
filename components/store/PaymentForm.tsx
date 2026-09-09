"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Button } from "@/components/ui/Button";
import { formatCents } from "@/lib/utils";

/**
 * The card step.
 *
 * Card details are entered inside Stripe's own iframe and confirmed straight
 * from the browser to Stripe — they never touch a Leash server, a Leash log, or
 * a Leash database. That is not a nicety: handling them ourselves would put
 * this application in PCI scope for no benefit anyone can name.
 *
 * `redirect: "if_required"` keeps the common card flow on this page and only
 * leaves for methods that genuinely need a redirect (3-D Secure challenges,
 * bank apps). Either way the *server* learns the payment succeeded from the
 * webhook, not from us — `onPaid` just moves the customer to a page that waits
 * for it.
 */

let stripePromise: Promise<Stripe | null> | null = null;

function stripeJs(publishableKey: string): Promise<Stripe | null> {
  // Loaded once per document. `loadStripe` injects a script tag, and calling it
  // per render would add one each time.
  stripePromise ??= loadStripe(publishableKey);
  return stripePromise;
}

function CardFields({
  amountCents,
  returnUrl,
  onPaid,
  onBack,
}: {
  amountCents: number;
  returnUrl: string;
  onPaid: () => void;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pay = useCallback(async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setMessage(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });

    if (error) {
      // `card_error` and `validation_error` are safe to show the customer;
      // anything else is our problem and gets a generic line.
      setMessage(
        error.type === "card_error" || error.type === "validation_error"
          ? (error.message ?? "That card was declined.")
          : "Something went wrong taking that payment."
      );
      setBusy(false);
      return;
    }

    onPaid();
  }, [stripe, elements, returnUrl, onPaid]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-mist bg-white p-4">
        <PaymentElement options={{ layout: "tabs" }} />
      </div>

      {message && (
        <p role="alert" className="text-sm text-leash">
          {message}
        </p>
      )}

      <p className="rounded-xl bg-fog px-4 py-3 text-xs text-charcoal/70">
        Your card is handled by our payment provider and never reaches Leash.
      </p>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button variant="cta" onClick={pay} disabled={busy || !stripe}>
          {busy ? "Taking payment…" : `Pay ${formatCents(amountCents)}`}
        </Button>
      </div>
    </div>
  );
}

export function PaymentForm({
  clientSecret,
  publishableKey,
  amountCents,
  returnUrl,
  onPaid,
  onBack,
}: {
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  returnUrl: string;
  onPaid: () => void;
  onBack: () => void;
}) {
  const promise = useMemo(() => stripeJs(publishableKey), [publishableKey]);

  return (
    <Elements
      stripe={promise}
      options={{
        clientSecret,
        appearance: {
          theme: "flat",
          variables: {
            colorPrimary: "#1b3b36",
            colorText: "#22282a",
            colorDanger: "#e85c41",
            fontFamily: "var(--font-body), system-ui, sans-serif",
            borderRadius: "12px",
          },
        },
      }}
    >
      <CardFields
        amountCents={amountCents}
        returnUrl={returnUrl}
        onPaid={onPaid}
        onBack={onBack}
      />
    </Elements>
  );
}
