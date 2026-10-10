import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { CartQuote, ShippingAddress } from "@/types";
import { createOrder, quote as quoteCart, syncPayment } from "@/api/orders";
import { ApiError } from "@/api/_client";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSession } from "@/store/session";
import { cartToLines, useCart } from "@/store/cart";
import { formatCents } from "@/lib/utils";

/**
 * Checkout.
 *
 * ── What this page does not send ──
 *
 * A price. The request is ids, quantities, an address and optionally a pet; the
 * server re-quotes from the live catalogue and charges its own total
 * (REQUIREMENTS.md S10). The total shown here is the server's quote, fetched
 * when the page opened — and the order may still come back different if the
 * catalogue moved in between, which is what the 409 handling below is for.
 *
 * ── The three ways placing an order can fail, and what each means ──
 *
 *  - **409 with a quote** — something in the basket can no longer be sold as
 *    it stands (sold out, withdrawn, prescription). Nothing was created. Back to
 *    the cart, which shows the problem against the line.
 *  - **409 with a productId** — somebody bought the last one in the instant
 *    between our quote and our purchase. Nothing was created. Same answer.
 *  - **502 with an orderId** — the order **exists** and holds its stock; only
 *    starting the payment failed. The fix is to retry the payment for *that
 *    order*. Placing the order again would reserve the stock a second time,
 *    which is why the button changes rather than the form being resubmitted.
 *
 * The payment itself is the demo provider until M7, which settles inline — so
 * a successful submit lands on a paid order. M7 brings the card form; this
 * page's shape does not need to change for it.
 */
export default function CheckoutPage() {
  const navigate = useNavigate();
  const { currentUser } = useSession();
  const { lines, petId, clear, hasHydrated } = useCart();

  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [address, setAddress] = useState<ShippingAddress>({
    name: currentUser?.name ?? "",
    line1: "",
    line2: "",
    city: currentUser?.address.city ?? "",
    state: currentUser?.address.state ?? "",
    postalCode: "",
    country: "US",
    phone: currentUser?.phone ?? "",
  });
  const [instructions, setInstructions] = useState("");

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  /** Set after a 502: the order exists, and only its payment needs retrying. */
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated || lines.length === 0) return;
    quoteCart(cartToLines(lines), petId)
      .then(setQuote)
      .catch((e: Error) => setLoadError(e.message));
  }, [hasHydrated, lines, petId]);

  if (!hasHydrated || (lines.length > 0 && !quote && !loadError)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (lines.length === 0 && !pendingOrderId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Nothing to check out</h1>
        <ButtonLink to="/store" variant="outline" className="mt-6">
          Browse the store
        </ButtonLink>
      </div>
    );
  }

  if (quote && quote.problems.length > 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Your cart needs a look first</h1>
        <p className="mt-2 text-sm text-charcoal/65">
          {quote.problems.length === 1 ? "One item" : `${quote.problems.length} items`} can't be bought as
          they are.
        </p>
        <ButtonLink to="/store/cart" variant="cta" className="mt-6">
          Back to cart
        </ButtonLink>
      </div>
    );
  }

  function set<K extends keyof ShippingAddress>(key: K, value: ShippingAddress[K]) {
    setAddress((a) => ({ ...a, [key]: value }));
  }

  function finish(orderId: string) {
    clear();
    navigate(`/store/orders/${orderId}?placed=1`, { replace: true });
  }

  async function placeOrder(e: FormEvent) {
    e.preventDefault();
    setPlacing(true);
    setError(null);
    setIssues({});

    try {
      const placed = await createOrder({
        items: cartToLines(lines),
        shippingAddress: address,
        deliveryInstructions: instructions || undefined,
        petId: petId ?? undefined,
      });
      finish(placed.id);
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError("Something went wrong placing your order.");
      } else if (err.issues?.length) {
        setIssues(
          Object.fromEntries(
            err.issues.map((i) => [i.path.replace(/^shippingAddress\./, ""), i.message]),
          ),
        );
      } else if (err.status === 502 && typeof err.details?.orderId === "string") {
        // The order exists. Do not let the form create a second one.
        setPendingOrderId(err.details.orderId);
        setError(err.message);
      } else if (err.status === 409) {
        // Nothing was created. The cart is where the customer can see what
        // changed and adjust — re-quoting here would only repeat the refusal.
        setError(`${err.message} Taking you back to your cart…`);
        setTimeout(() => navigate("/store/cart"), 2200);
      } else {
        setError(err.message);
      }
    } finally {
      setPlacing(false);
    }
  }

  async function retryPayment() {
    if (!pendingOrderId) return;
    setPlacing(true);
    setError(null);
    try {
      const placed = await syncPayment(pendingOrderId);
      finish(placed.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Still couldn't start the payment.");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <Link to="/store/cart" className="text-sm text-charcoal/60 hover:text-ink">
        ← Back to cart
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Checkout</h1>

      <form onSubmit={placeOrder} noValidate className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5 rounded-2xl border border-mist bg-white p-6">
          <h2 className="text-base font-semibold text-ink">Delivery address</h2>

          {error && (
            <p role="alert" className="rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash">
              {error}
            </p>
          )}

          <Field label="Full name" htmlFor="name" error={issues.name}>
            <Input id="name" value={address.name} onChange={(e) => set("name", e.target.value)} disabled={!!pendingOrderId} />
          </Field>
          <Field label="Street address" htmlFor="line1" error={issues.line1}>
            <Input id="line1" value={address.line1} onChange={(e) => set("line1", e.target.value)} disabled={!!pendingOrderId} />
          </Field>
          <Field label="Apartment, suite" hint="optional" htmlFor="line2" error={issues.line2}>
            <Input id="line2" value={address.line2} onChange={(e) => set("line2", e.target.value)} disabled={!!pendingOrderId} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="City" htmlFor="city" error={issues.city}>
              <Input id="city" value={address.city} onChange={(e) => set("city", e.target.value)} disabled={!!pendingOrderId} />
            </Field>
            <Field label="State" htmlFor="state" error={issues.state}>
              <Input id="state" value={address.state} onChange={(e) => set("state", e.target.value)} disabled={!!pendingOrderId} />
            </Field>
            <Field label="Postal code" htmlFor="postalCode" error={issues.postalCode}>
              <Input
                id="postalCode"
                value={address.postalCode}
                onChange={(e) => set("postalCode", e.target.value)}
                disabled={!!pendingOrderId}
              />
            </Field>
          </div>
          <Field label="Phone" hint="for the courier" htmlFor="phone" error={issues.phone}>
            <Input id="phone" value={address.phone} onChange={(e) => set("phone", e.target.value)} disabled={!!pendingOrderId} />
          </Field>
          <Field label="Delivery instructions" hint="optional" htmlFor="instructions" error={issues.deliveryInstructions}>
            <Textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Leave it in the porch — the dog will bark, she's friendly."
              disabled={!!pendingOrderId}
            />
          </Field>
        </div>

        <aside className="h-fit rounded-2xl border border-mist bg-white p-6 lg:sticky lg:top-24">
          <h2 className="text-base font-semibold text-ink">Order</h2>

          {quote && (
            <>
              <ul className="mt-4 space-y-2 text-sm">
                {quote.lines.map((l) => (
                  <li key={l.productId} className="flex justify-between gap-3 text-charcoal/80">
                    <span className="min-w-0 truncate">
                      {l.quantity} × {l.name}
                    </span>
                    <span className="shrink-0 font-mono">{formatCents(l.lineTotalCents)}</span>
                  </li>
                ))}
              </ul>

              <dl className="mt-4 space-y-2 border-t border-mist pt-4 text-sm">
                <Row label="Subtotal" value={formatCents(quote.subtotalCents)} />
                <Row label="Shipping" value={quote.shippingCents === 0 ? "Free" : formatCents(quote.shippingCents)} />
                <Row label="Tax" value={formatCents(quote.taxCents)} />
                <div className="flex justify-between border-t border-mist pt-3 text-base font-semibold text-ink">
                  <dt>Total</dt>
                  <dd className="font-mono">{formatCents(quote.totalCents)}</dd>
                </div>
              </dl>

              {quote.allergenWarnings.length > 0 && (
                <p className="mt-4 rounded-lg bg-marigold/10 px-3 py-2 text-xs text-[#7a5410]">
                  {quote.allergenWarnings.length === 1 ? "One item contains" : "Some items contain"} something
                  your pet is listed as allergic to. See your cart for which.
                </p>
              )}
            </>
          )}

          {loadError && <p className="mt-4 text-sm text-leash">{loadError}</p>}

          <div className="mt-6">
            {pendingOrderId ? (
              <Button type="button" variant="cta" className="w-full justify-center" disabled={placing} onClick={retryPayment}>
                {placing ? "Retrying…" : "Try payment again"}
              </Button>
            ) : (
              <Button type="submit" variant="cta" className="w-full justify-center" disabled={placing || !quote}>
                {placing ? "Placing order…" : `Place order · ${quote ? formatCents(quote.totalCents) : ""}`}
              </Button>
            )}
          </div>

          <p className="mt-3 text-xs text-charcoal/55">
            You can cancel up until your order is handed to the carrier.
          </p>
        </aside>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-charcoal/80">
      <dt>{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
