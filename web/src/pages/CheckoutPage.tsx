import { Link, useNavigate } from "react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { ShippingAddress } from "@/types";
import { createOrder, quote as quoteCart, syncPayment } from "@/api/orders";
import { ApiError } from "@/api/_client";

import { listMyPets } from "@/api/pets";
import { listMyBookings } from "@/api/bookings";
import { getCaretaker } from "@/api/caretakers";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { useCart, cartToLines } from "@/store/cart";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { ProgressLeash } from "@/components/ui/ProgressLeash";
import { Skeleton } from "@/components/ui/Skeleton";
import { AlertIcon, HomeIcon } from "@/components/ui/icons";
import { cn, formatCents, formatRange } from "@/lib/utils";

/**
 * "Pay" is its own step once a card is genuinely collected — M7, with
 * `PaymentForm`. Until then the demo provider settles the order the instant it
 * is created, so that step is skipped, exactly as the reference skipped it
 * without a Stripe key.
 */
const STEPS = ["Address", "Review", "Pay"];

const EMPTY_ADDRESS: ShippingAddress = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
  phone: "",
};

/**
 * Checkout — the reference's `app/store/checkout/page.tsx`, without the Stripe
 * step (M7).
 *
 * Every figure is the server's quote; nothing here sends a price. One failure
 * the reference never had to handle is kept from this API's contract: a 502
 * carrying an `orderId` means the order **exists** and holds its stock and
 * only starting the payment failed. The button then retries that payment
 * (`syncPayment`) — placing the order again would reserve the stock twice.
 */
export default function CheckoutPage() {
  const navigate = useNavigate();
  const { currentUser, hasHydrated } = useSession();
  const { lines, petId, clear } = useCart();

  // Only the fields the user has actually touched are stored. Everything else
  // falls through to their account details, computed at render — so the form
  // fills itself in as the session hydrates, with no effect and no chance of
  // clobbering an edit made before the user object arrived.
  const [edits, setEdits] = useState<Partial<ShippingAddress>>({});
  const [instructions, setInstructions] = useState("");
  const [step, setStep] = useState(0);
  const [placing, setPlacing] = useState(false);
  /** Set after a 502: the order exists, and only its payment needs retrying. */
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);

  const { data: pets } = useAsync(
    () => (currentUser ? listMyPets() : Promise.resolve([])),
    [currentUser?.id]
  );

  // A boarding stay means the pet isn't home — offer to ship where it actually is.
  const { data: boarding } = useAsync(async () => {
    if (!currentUser) return null;
    const { items: bookings } = await listMyBookings({ limit: 100 });
    const stay = bookings.find(
      (b) =>
        b.serviceType === "boarding" &&
        ["accepted", "in_progress"].includes(b.status)
    );
    if (!stay) return null;
    const caretaker = await getCaretaker(stay.caretakerId);
    return caretaker ? { stay, caretaker } : null;
  }, [currentUser?.id]);

  const { data: quote, loading: quoting, reload: requote } = useAsync(
    () =>
      currentUser && lines.length > 0
        ? quoteCart(cartToLines(lines), petId).catch(() => null)
        : Promise.resolve(null),
    [JSON.stringify(cartToLines(lines)), petId, currentUser?.id]
  );

  const address: ShippingAddress = {
    ...EMPTY_ADDRESS,
    name: currentUser?.name ?? "",
    city: currentUser?.address.city ?? "",
    state: currentUser?.address.state ?? "",
    phone: currentUser?.phone ?? "",
    ...edits,
  };

  if (!hasHydrated) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!currentUser) return <AuthRequired message="Log in to check out." />;

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Nothing to check out"
          description="Your cart is empty."
          actionLabel="Browse the store"
          actionHref="/store"
        />
      </div>
    );
  }

  const pet = (pets ?? []).find((p) => p.id === petId);
  const blocked = (quote?.problems.length ?? 0) > 0;
  const addressComplete =
    address.name.trim() &&
    address.line1.trim() &&
    address.city.trim() &&
    address.state.trim() &&
    address.postalCode.trim();

  function set<K extends keyof ShippingAddress>(key: K, value: ShippingAddress[K]) {
    setEdits((e) => ({ ...e, [key]: value }));
  }

  function shipToCaretaker() {
    if (!boarding) return;
    const { caretaker } = boarding;
    setEdits((e) => ({
      ...e,
      name: `${caretaker.user.name} (for ${pet?.name ?? "my pet"})`,
      city: caretaker.user.address.city,
      state: caretaker.user.address.state,
    }));
    toast.success(`Shipping to ${boarding.caretaker.user.name}`, {
      description: "Add their street address below.",
    });
  }

  function finish(orderId: string) {
    clear();
    toast.success("Order placed", { description: "We'll start picking it now." });
    navigate(`/store/orders/${orderId}`);
  }

  async function submit() {
    setPlacing(true);
    try {
      if (pendingOrderId) {
        const placed = await syncPayment(pendingOrderId);
        finish(placed.id);
        return;
      }
      const order = await createOrder({
        items: cartToLines(lines),
        shippingAddress: address,
        deliveryInstructions: instructions.trim(),
        petId: petId ?? undefined,
      });
      finish(order.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 502 && typeof e.details?.orderId === "string") {
        // The order exists. Never let this button create a second one.
        setPendingOrderId(e.details.orderId);
      } else if (e instanceof ApiError && e.status === 409) {
        // Something sold out or lost its prescription in the meantime.
        requote();
      }
      toast.error("Couldn't place that order", {
        description: e instanceof Error ? e.message : undefined,
      });
      setPlacing(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Link
        to="/store/cart"
        className="text-sm text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
      >
        ← Back to cart
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Checkout</h1>

      <ProgressLeash
        steps={STEPS}
        activeIndex={step}
        label="Checkout step"
        className="my-4"
      />

      {blocked && (
        <div className="mb-6 rounded-2xl border border-leash/30 bg-leash/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <AlertIcon width={16} height={16} className="text-leash" />
            Some items can&apos;t be ordered
          </p>
          <ul className="mt-2 space-y-1 text-sm text-charcoal/80">
            {quote!.problems.map((p) => (
              <li key={p.productId}>{p.message}</li>
            ))}
          </ul>
          <Link
            to="/store/cart"
            className="mt-3 inline-block text-sm font-medium text-ink underline"
          >
            Back to cart
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          {step === 0 && (
            <div className="space-y-5 rounded-2xl border border-mist bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink">Delivery address</h2>
                {boarding && (
                  <button
                    type="button"
                    onClick={shipToCaretaker}
                    className="flex items-center gap-1.5 rounded-full border border-mist px-3 py-1 text-xs text-charcoal transition-colors hover:border-ink"
                  >
                    <HomeIcon width={13} height={13} />
                    Ship to {boarding.caretaker.user.name.split(" ")[0]} instead
                  </button>
                )}
              </div>

              {boarding && (
                <p className="rounded-xl bg-fog px-3 py-2 text-xs text-charcoal/70">
                  {pet?.name ?? "Your pet"} is boarding with{" "}
                  {boarding.caretaker.user.name}{" "}
                  {formatRange(boarding.stay.startDateTime, boarding.stay.endDateTime)} —
                  you can send this order there instead.
                </p>
              )}

              <Field label="Recipient name" htmlFor="c-name">
                <Input
                  id="c-name"
                  value={address.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </Field>

              <Field label="Street address" htmlFor="c-line1">
                <Input
                  id="c-line1"
                  value={address.line1}
                  onChange={(e) => set("line1", e.target.value)}
                  placeholder="1204 Grove Street"
                />
              </Field>

              <Field label="Apartment, suite, etc." htmlFor="c-line2" hint="Optional">
                <Input
                  id="c-line2"
                  value={address.line2}
                  onChange={(e) => set("line2", e.target.value)}
                />
              </Field>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <Field label="City" htmlFor="c-city">
                  <Input
                    id="c-city"
                    value={address.city}
                    onChange={(e) => set("city", e.target.value)}
                  />
                </Field>
                <Field label="State" htmlFor="c-state">
                  <Input
                    id="c-state"
                    value={address.state}
                    onChange={(e) => set("state", e.target.value)}
                    maxLength={2}
                  />
                </Field>
                <Field label="ZIP" htmlFor="c-zip">
                  <Input
                    id="c-zip"
                    value={address.postalCode}
                    onChange={(e) => set("postalCode", e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Phone" htmlFor="c-phone" hint="For delivery updates">
                <Input
                  id="c-phone"
                  value={address.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
              </Field>

              <Field label="Delivery instructions" htmlFor="c-notes" hint="Optional">
                <Textarea
                  id="c-notes"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Leave with the front desk, side gate is unlocked…"
                />
              </Field>

              <div className="flex justify-end">
                <Button
                  variant="cta"
                  disabled={!addressComplete || blocked || quoting}
                  onClick={() => setStep(1)}
                >
                  Review order
                </Button>
              </div>
            </div>
          )}

          {step === 1 && quote && (
            <div className="space-y-5 rounded-2xl border border-mist bg-white p-6">
              <h2 className="text-sm font-semibold text-ink">Check everything over</h2>

              <div>
                <p className="text-xs uppercase tracking-wide text-charcoal/50">
                  Shipping to
                </p>
                <address className="mt-1 not-italic text-sm text-charcoal/85">
                  {address.name}
                  <br />
                  {address.line1}
                  {address.line2 && (
                    <>
                      <br />
                      {address.line2}
                    </>
                  )}
                  <br />
                  {address.city}, {address.state} {address.postalCode}
                  {address.phone && (
                    <>
                      <br />
                      {address.phone}
                    </>
                  )}
                </address>
                {instructions && (
                  <p className="mt-2 text-sm text-charcoal/70">“{instructions}”</p>
                )}
              </div>

              <div className="border-t border-mist pt-4">
                <p className="text-xs uppercase tracking-wide text-charcoal/50">
                  Items
                </p>
                <ul className="mt-2 space-y-3">
                  {lines.map((line) => (
                    <li key={line.productId} className="flex items-center gap-3">
                      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-fog">
                        <img
                          src={line.imageUrl}
                          alt=""
                          width={48}
                          height={48}
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">
                          {line.name}
                        </span>
                        <span className="block font-mono text-xs text-charcoal/55">
                          {line.quantity} × {formatCents(line.unitPriceCents)}
                        </span>
                      </span>
                      <span className="font-mono text-sm text-ink">
                        {formatCents(line.unitPriceCents * line.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="rounded-xl bg-fog px-4 py-3 text-xs text-charcoal/70">
                <strong className="text-ink">Demo payment.</strong> No card is
                collected and no money moves. The order, its charges and its
                delivery tracking are otherwise real.
              </p>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button variant="cta" disabled={placing || blocked} onClick={submit}>
                  {placing
                    ? "Placing order…"
                    : pendingOrderId
                      ? "Retry payment"
                      : `Pay ${formatCents(quote.totalCents)}`}
                </Button>
              </div>
            </div>
          )}

        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-mist bg-white p-6">
            <h2 className="text-sm font-semibold text-ink">Order summary</h2>
            {pet && (
              <p className="mt-1 text-xs text-charcoal/60">For {pet.name}</p>
            )}
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-charcoal/65">Subtotal</dt>
                <dd className="font-mono text-ink">
                  {quote ? formatCents(quote.subtotalCents) : "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-charcoal/65">Shipping</dt>
                <dd className={cn("font-mono", quote?.shippingCents === 0 ? "text-[#215144]" : "text-ink")}>
                  {quote
                    ? quote.shippingCents === 0
                      ? "Free"
                      : formatCents(quote.shippingCents)
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-charcoal/65">Tax</dt>
                <dd className="font-mono text-ink">
                  {quote ? formatCents(quote.taxCents) : "—"}
                </dd>
              </div>
              <div className="flex justify-between border-t border-mist pt-3 text-base font-semibold text-ink">
                <dt>Total</dt>
                <dd className="font-mono">
                  {quote ? formatCents(quote.totalCents) : "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-charcoal/55">
              Totals are calculated on our server from the current catalog price.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
