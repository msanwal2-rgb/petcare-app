"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart, cartToLines, displaySubtotalCents } from "@/lib/store/cart";
import { quoteCart } from "@/lib/api/orders";
import { getPetsByOwner } from "@/lib/api/pets";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { EmptyState } from "@/components/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { AlertIcon, BagIcon, TrashIcon } from "@/components/ui/icons";
import { amountToFreeShipping } from "@/lib/pricing";
import { cn, formatCents } from "@/lib/utils";

export default function CartPage() {
  const { lines, setQuantity, remove, petId, setPet, clear } = useCart();
  const { currentUser, hasHydrated } = useSession();

  const { data: pets } = useAsync(
    () => (currentUser ? getPetsByOwner(currentUser.id) : Promise.resolve([])),
    [currentUser?.id]
  );

  // The server's arithmetic, not ours — including the prescription check, so a
  // blocked item is visible here rather than at the payment step.
  const { data: quote, loading: quoting } = useAsync(
    () =>
      currentUser && lines.length > 0
        ? quoteCart(cartToLines(lines), petId ?? undefined)
        : Promise.resolve(null),
    [lines, petId, currentUser?.id]
  );

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
          description="Food, treats, supplements and the therapeutic diets your vet prescribed."
          actionLabel="Browse the store"
          actionHref="/store"
        />
      </div>
    );
  }

  const displaySubtotal = displaySubtotalCents(lines);
  const toFreeShipping = amountToFreeShipping(quote?.subtotalCents ?? displaySubtotal);
  const problemFor = (productId: string) =>
    quote?.problems.find((p) => p.productId === productId);
  const blocked = (quote?.problems.length ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your cart</h1>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          {lines.map((line) => {
            const problem = problemFor(line.productId);
            return (
              <div
                key={line.productId}
                className={cn(
                  "flex gap-4 rounded-2xl border bg-white p-4",
                  problem ? "border-leash/40" : "border-mist"
                )}
              >
                <Link
                  href={`/store/${line.slug}`}
                  className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-fog"
                >
                  <Image
                    src={line.imageUrl}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                </Link>

                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-charcoal/45">
                    {line.brand}
                  </p>
                  <Link
                    href={`/store/${line.slug}`}
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
                      {problem.message}
                      {problem.code === "prescription_required" && (
                        <Link href="/vets" className="ml-1 font-medium underline">
                          Book a vet
                        </Link>
                      )}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-3">
                    <label htmlFor={`qty-${line.productId}`} className="sr-only">
                      Quantity for {line.name}
                    </label>
                    <select
                      id={`qty-${line.productId}`}
                      value={line.quantity}
                      onChange={(e) =>
                        setQuantity(line.productId, Number(e.target.value))
                      }
                      className="rounded-lg border border-mist bg-white px-2.5 py-1.5 text-sm"
                    >
                      {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => remove(line.productId)}
                      className="flex items-center gap-1 text-xs text-charcoal/55 transition-colors hover:text-leash"
                    >
                      <TrashIcon width={14} height={14} />
                      Remove
                    </button>
                  </div>
                </div>

                <p className="font-mono text-sm font-semibold text-ink">
                  {formatCents(line.unitPriceCents * line.quantity)}
                </p>
              </div>
            );
          })}

          <button
            onClick={clear}
            className="text-xs text-charcoal/55 underline-offset-2 hover:text-ink hover:underline"
          >
            Empty cart
          </button>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-mist bg-white p-6">
            <h2 className="text-sm font-semibold text-ink">Summary</h2>

            {/* Choosing a pet is what unlocks their prescription items. */}
            {(pets ?? []).length > 0 && (
              <div className="mt-4 border-b border-mist pb-4">
                <label
                  htmlFor="cart-pet"
                  className="mb-1.5 block text-sm font-medium text-ink"
                >
                  This order is for
                </label>
                <select
                  id="cart-pet"
                  value={petId ?? ""}
                  onChange={(e) => setPet(e.target.value || null)}
                  className="w-full rounded-xl border border-mist bg-white px-3 py-2 text-sm"
                >
                  <option value="">Not specified</option>
                  {(pets ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-charcoal/55">
                  Required for prescription items.
                </p>
              </div>
            )}

            <dl className="mt-4 space-y-2 text-sm">
              <Row
                label="Subtotal"
                value={formatCents(quote?.subtotalCents ?? displaySubtotal)}
              />
              <Row
                label="Shipping"
                value={
                  quote
                    ? quote.shippingCents === 0
                      ? "Free"
                      : formatCents(quote.shippingCents)
                    : "—"
                }
              />
              <Row label="Tax" value={quote ? formatCents(quote.taxCents) : "—"} />
              <div className="flex justify-between border-t border-mist pt-3 text-base font-semibold text-ink">
                <dt>Total</dt>
                <dd className="font-mono">
                  {quote ? formatCents(quote.totalCents) : "—"}
                </dd>
              </div>
            </dl>

            {toFreeShipping > 0 && (
              <p className="mt-3 rounded-xl bg-fog px-3 py-2 text-xs text-charcoal/70">
                Add {formatCents(toFreeShipping)} more for free shipping.
              </p>
            )}

            {!currentUser ? (
              <ButtonLink href="/login" variant="cta" size="lg" className="mt-5 w-full">
                Log in to check out
              </ButtonLink>
            ) : (
              <ButtonLink
                href="/store/checkout"
                variant="cta"
                size="lg"
                className={cn("mt-5 w-full", (blocked || quoting) && "pointer-events-none opacity-50")}
                aria-disabled={blocked || quoting}
              >
                {quoting ? "Checking availability…" : "Check out"}
              </ButtonLink>
            )}

            {blocked && (
              <p className="mt-3 text-center text-xs text-[#a83c27]">
                Sort out the flagged items above to continue.
              </p>
            )}

            <Button
              variant="ghost"
              className="mt-2 w-full"
              onClick={() => window.history.back()}
            >
              Keep shopping
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-charcoal/65">{label}</dt>
      <dd className="font-mono text-ink">{value}</dd>
    </div>
  );
}
