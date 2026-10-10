import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { CartQuote, Pet } from "@/types";
import { quote as quoteCart } from "@/api/orders";
import { listMyPets } from "@/api/pets";
import { EmptyState } from "@/components/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { AlertIcon, BagIcon, TrashIcon } from "@/components/ui/icons";
import { useSession } from "@/store/session";
import { MAX_PER_LINE, cartToLines, displaySubtotalCents, useCart } from "@/store/cart";
import {
  DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS,
  shippingFor,
  taxFor,
} from "@/lib/pricing";
import { cn, formatCents } from "@/lib/utils";

/**
 * The cart.
 *
 * ── Two sets of numbers, and which one wins ──
 *
 * Signed out, the cart shows an **estimate** from its own snapshot and
 * `lib/pricing.ts`. Signed in, it asks the server for a **quote**, which
 * re-reads every product and applies the real threshold, stock, the
 * prescription gate and the allergen check — so a blocked line is visible
 * here, against the line, rather than as a surprise at the payment step. When
 * there is a quote, every figure on this page is the quote's.
 *
 * ── Why the pet is chosen here ──
 *
 * The pet decides two things only the server can answer: whether an Rx-only
 * line is authorised, and whether anything in the basket contains something
 * the animal reacts to. Choosing it here means both answers are on screen
 * before checkout.
 */
export default function CartPage() {
  const { lines, setQuantity, remove, petId, setPet, hasHydrated } = useCart();
  const { currentUser } = useSession();

  const [pets, setPets] = useState<Pet[]>([]);

  /**
   * The last answer from the server, and which basket it answered. "Quoting"
   * is derived — the basket on screen is not the one the answer is for — so
   * nothing has to be set synchronously when the basket changes.
   */
  const [result, setResult] = useState<{
    key: string;
    quote: CartQuote | null;
    error: string | null;
  }>({ key: "", quote: null, error: null });

  const basketKey = JSON.stringify([cartToLines(lines), petId, currentUser?.id ?? null]);

  useEffect(() => {
    if (!currentUser) return;
    listMyPets().then(setPets).catch(() => setPets([]));
  }, [currentUser]);

  // Re-quote whenever the basket or the pet changes. The `live` flag stops a
  // slow quote for the old basket overwriting a fast one for the new.
  useEffect(() => {
    if (!currentUser || lines.length === 0) return;

    let live = true;
    quoteCart(cartToLines(lines), petId)
      .then((quote) => live && setResult({ key: basketKey, quote, error: null }))
      .catch((e: Error) => live && setResult((r) => ({ key: basketKey, quote: r.quote, error: e.message })));

    return () => {
      live = false;
    };
    // basketKey is derived from exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, petId, currentUser]);

  const quoting = !!currentUser && lines.length > 0 && result.key !== basketKey;
  const quoteError = result.key === basketKey ? result.error : null;

  // A pet the customer no longer owns (or a different account's leftover
  // selection) would be refused by the server with a 403; drop it instead.
  useEffect(() => {
    if (petId && pets.length > 0 && !pets.some((p) => p.id === petId)) setPet(null);
  }, [petId, pets, setPet]);

  if (!hasHydrated) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          icon={<BagIcon width={40} height={40} />}
          title="Your cart is empty"
          description="Food, treats, supplements, and the therapeutic diets your vet prescribed."
          actionLabel="Browse the store"
          actionHref="/store"
        />
      </div>
    );
  }

  // While a new quote is in flight the previous one stays on screen, dimmed —
  // better than the totals blinking to an estimate and back. Signed out, there
  // is no quote at all.
  const quote = currentUser ? result.quote : null;

  const estimate = displaySubtotalCents(lines);
  const subtotal = quote?.subtotalCents ?? estimate;
  const shipping = quote?.shippingCents ?? shippingFor(estimate, DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS);
  const tax = quote?.taxCents ?? taxFor(estimate);
  const total = quote?.totalCents ?? estimate + shipping + tax;

  const problemFor = (productId: string) => quote?.problems.find((p) => p.productId === productId);
  const warningFor = (productId: string) =>
    quote?.allergenWarnings.find((w) => w.productId === productId);

  const blocked = (quote?.problems.length ?? 0) > 0;
  const hasRx = lines.some((l) => l.requiresPrescription);
  const petName = pets.find((p) => p.id === petId)?.name;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your cart</h1>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          {currentUser && pets.length > 0 && (
            <Field
              label="Shopping for"
              hint={hasRx ? "needed for prescription items" : "for allergy warnings"}
              htmlFor="pet"
              className="rounded-2xl border border-mist bg-white p-4"
            >
              <Select id="pet" value={petId ?? ""} onChange={(e) => setPet(e.target.value || null)}>
                <option value="">No particular pet</option>
                {pets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {lines.map((line) => {
            const problem = problemFor(line.productId);
            const warning = warningFor(line.productId);
            return (
              <div
                key={line.productId}
                className={cn(
                  "flex gap-4 rounded-2xl border bg-white p-4",
                  problem ? "border-leash/40" : "border-mist",
                )}
              >
                <Link
                  to={`/store/${line.slug}`}
                  className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-fog"
                >
                  <img src={line.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                </Link>

                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-charcoal/45">
                    {line.brand}
                  </p>
                  <Link
                    to={`/store/${line.slug}`}
                    className="block truncate text-sm font-medium text-ink hover:underline"
                  >
                    {line.name}
                  </Link>
                  <p className="mt-0.5 font-mono text-sm text-charcoal/70">
                    {formatCents(line.unitPriceCents)} each
                  </p>

                  {problem && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-[#a83c27]">
                      <AlertIcon width={13} height={13} className="mt-px shrink-0" />
                      <span>
                        {problem.message}
                        {problem.code === "prescription_required" && (
                          <>
                            {" "}
                            {petId ? (
                              <Link to="/vets" className="font-medium underline">
                                Book a vet
                              </Link>
                            ) : (
                              "Choose the pet it's for above."
                            )}
                          </>
                        )}
                      </span>
                    </p>
                  )}

                  {warning && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-marigold/10 px-2 py-1.5 text-xs text-[#7a5410]">
                      <AlertIcon width={13} height={13} className="mt-px shrink-0" />
                      Contains {warning.allergens.join(", ").toLowerCase()} — {petName ?? "your pet"}{" "}
                      is listed as allergic.
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-3">
                    <label htmlFor={`qty-${line.productId}`} className="sr-only">
                      Quantity for {line.name}
                    </label>
                    <select
                      id={`qty-${line.productId}`}
                      value={line.quantity}
                      onChange={(e) => setQuantity(line.productId, Number(e.target.value))}
                      className="rounded-lg border border-mist bg-white px-2.5 py-1.5 text-sm"
                    >
                      {Array.from({ length: MAX_PER_LINE }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => remove(line.productId)}
                      className="flex items-center gap-1 text-xs text-charcoal/60 hover:text-leash"
                    >
                      <TrashIcon width={13} height={13} />
                      Remove
                    </button>
                  </div>
                </div>

                <p className="shrink-0 font-mono text-sm font-medium text-ink">
                  {formatCents(line.unitPriceCents * line.quantity)}
                </p>
              </div>
            );
          })}
        </div>

        <aside className="h-fit rounded-2xl border border-mist bg-white p-6 lg:sticky lg:top-24">
          <h2 className="text-base font-semibold text-ink">Summary</h2>

          <dl className={cn("mt-4 space-y-2 text-sm", quoting && "opacity-60")}>
            <Row label="Subtotal" value={formatCents(subtotal)} />
            <Row label="Shipping" value={shipping === 0 ? "Free" : formatCents(shipping)} />
            <Row label="Tax" value={formatCents(tax)} />
            <div className="flex justify-between border-t border-mist pt-3 text-base font-semibold text-ink">
              <dt>Total</dt>
              <dd className="font-mono">{formatCents(total)}</dd>
            </div>
          </dl>

          {quote && quote.amountToFreeShippingCents > 0 && (
            <p className="mt-3 text-xs text-charcoal/65">
              Spend {formatCents(quote.amountToFreeShippingCents)} more for free shipping.
            </p>
          )}

          {!quote && (
            <p className="mt-3 text-xs text-charcoal/55">
              {currentUser
                ? quoteError ?? "Checking prices…"
                : "An estimate. Sign in to see your final price, including prescription items."}
            </p>
          )}

          <div className="mt-6">
            {currentUser ? (
              <ButtonLink
                to="/store/checkout"
                variant="cta"
                className={cn("w-full justify-center", (blocked || !quote) && "pointer-events-none opacity-50")}
                aria-disabled={blocked || !quote}
              >
                Checkout
              </ButtonLink>
            ) : (
              <ButtonLink to={`/login?callbackUrl=${encodeURIComponent("/store/cart")}`} variant="cta" className="w-full justify-center">
                Sign in to check out
              </ButtonLink>
            )}
          </div>

          {blocked && (
            <p className="mt-3 text-xs text-[#a83c27]">
              Sort out the items marked above before checking out.
            </p>
          )}

          <ButtonLink to="/store" variant="ghost" size="sm" className="mt-3 w-full justify-center">
            Keep shopping
          </ButtonLink>
        </aside>
      </div>
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
