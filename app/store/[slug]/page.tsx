"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { getProductBySlug } from "@/lib/api/products";
import { getPetsByOwner } from "@/lib/api/pets";
import { getRecordsForPet } from "@/lib/api/medical-records";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { useCart } from "@/lib/store/cart";
import { FeedingGuide } from "@/components/store/FeedingGuide";
import { EmptyState } from "@/components/EmptyState";
import { RatingStars } from "@/components/RatingStars";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { Reveal } from "@/components/ui/Reveal";
import { AlertIcon, CheckIcon, PillIcon, TruckIcon } from "@/components/ui/icons";
import {
  CATEGORY_LABELS,
  LIFE_STAGE_LABELS,
  SPECIES_LABELS,
  cn,
  formatCents,
  formatDate,
} from "@/lib/utils";
import { FREE_SHIPPING_THRESHOLD_CENTS } from "@/lib/pricing";

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { currentUser } = useSession();
  const { add, setPet: setCartPet } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [petId, setPetId] = useState("");

  const { data: product, loading } = useAsync(() => getProductBySlug(slug), [slug]);
  const { data: pets } = useAsync(
    () => (currentUser ? getPetsByOwner(currentUser.id) : Promise.resolve([])),
    [currentUser?.id]
  );
  // Only fetched when a pet is chosen and the product actually needs a script.
  const { data: records } = useAsync(
    () =>
      petId && product?.requiresPrescription
        ? getRecordsForPet(petId)
        : Promise.resolve([]),
    [petId, product?.requiresPrescription]
  );

  if (loading) return <ProductSkeleton />;

  if (!product) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Product not found"
          description="It may have been discontinued. Have a look at what else we stock."
          actionLabel="Back to store"
          actionHref="/store"
        />
      </div>
    );
  }

  const pet = (pets ?? []).find((p) => p.id === petId);
  const soldOut = product.stockQty === 0;
  const onSale =
    product.compareAtPriceCents != null &&
    product.compareAtPriceCents > product.priceCents;

  const prescription = (records ?? []).find(
    (r) =>
      r.type === "prescription" &&
      r.productSlugs.includes(product.slug) &&
      r.refillsLeft !== 0 &&
      (!r.expiresAt || new Date(r.expiresAt) > new Date())
  );
  const rxSatisfied = !product.requiresPrescription || Boolean(prescription);

  const allergenHit = pet
    ? product.allergens.find((pa) =>
        pet.allergies.some((a) => {
          const x = pa.toLowerCase();
          const y = a.toLowerCase();
          return x.includes(y) || y.includes(x);
        })
      )
    : undefined;

  function addToCart() {
    if (!product) return;
    add(product, quantity);
    if (petId) setCartPet(petId);
    toast.success(`${product.name} added to your cart`, {
      description: `${quantity} × ${formatCents(product.priceCents)}`,
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <Link
        href="/store"
        className="text-sm text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
      >
        ← Back to store
      </Link>

      <div className="mt-4 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_380px]">
        <div>
          <Reveal className="overflow-hidden rounded-3xl border border-mist bg-fog">
            <div className="relative aspect-square">
              <Image
                src={product.imageUrl}
                alt={product.name}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 640px"
                className="object-cover"
              />
            </div>
          </Reveal>

          <Reveal className="mt-8 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-ink">About this product</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-charcoal/85">
                {product.description}
              </p>
            </div>

            {product.ingredients.length > 0 && (
              <Panel title="Ingredients">
                <p className="text-sm leading-relaxed text-charcoal/80">
                  {product.ingredients.join(", ")}.
                </p>
                {product.allergens.length > 0 && (
                  <p className="mt-3 border-t border-mist pt-3 text-sm text-charcoal/70">
                    <span className="font-medium text-ink">Common allergens:</span>{" "}
                    {product.allergens.join(", ")}
                  </p>
                )}
              </Panel>
            )}

            <FeedingGuide product={product} pet={pet} />

            <Panel title="Suitable for">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-4 border-b border-mist/70 pb-2">
                  <dt className="text-charcoal/65">Species</dt>
                  <dd className="text-ink">
                    {product.species.map((s) => `${SPECIES_LABELS[s]}s`).join(", ")}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-mist/70 pb-2">
                  <dt className="text-charcoal/65">Life stage</dt>
                  <dd className="text-ink">
                    {product.lifeStage.map((s) => LIFE_STAGE_LABELS[s]).join(", ")}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-charcoal/65">Size</dt>
                  <dd className="text-ink">{product.sizeLabel}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-charcoal/65">Category</dt>
                  <dd className="text-ink">{CATEGORY_LABELS[product.category]}</dd>
                </div>
              </dl>
            </Panel>
          </Reveal>
        </div>

        {/* Buy box */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-mist bg-white p-6 shadow-sm">
            <p className="font-mono text-[10px] uppercase tracking-wide text-charcoal/45">
              {product.brand}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
              {product.name}
            </h1>
            <p className="mt-0.5 text-sm text-charcoal/60">{product.sizeLabel}</p>

            <div className="mt-3 flex items-center gap-2">
              <RatingStars rating={product.rating} reviewCount={product.reviewCount} />
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-semibold text-ink">
                {formatCents(product.priceCents)}
              </span>
              {onSale && (
                <span className="font-mono text-sm text-charcoal/45 line-through">
                  {formatCents(product.compareAtPriceCents!)}
                </span>
              )}
            </div>

            <p className="mt-2 flex items-center gap-1.5 text-sm text-charcoal/65">
              <TruckIcon width={15} height={15} />
              {product.priceCents >= FREE_SHIPPING_THRESHOLD_CENTS
                ? "Free shipping on this item"
                : `Free shipping over ${formatCents(FREE_SHIPPING_THRESHOLD_CENTS)}`}
            </p>

            {/* Pet picker — drives allergen warnings and the Rx check. */}
            {(pets ?? []).length > 0 && (
              <div className="mt-5 border-t border-mist pt-4">
                <p className="mb-2 text-sm font-medium text-ink">Buying for</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPetId("")}
                    aria-pressed={petId === ""}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      petId === ""
                        ? "border-ink bg-ink text-white"
                        : "border-mist bg-white text-charcoal hover:border-ink/40"
                    )}
                  >
                    Not specified
                  </button>
                  {(pets ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPetId(p.id)}
                      aria-pressed={petId === p.id}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        petId === p.id
                          ? "border-ink bg-ink text-white"
                          : "border-mist bg-white text-charcoal hover:border-ink/40"
                      )}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {allergenHit && pet && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-leash/8 px-3 py-2.5 text-sm text-[#a83c27]">
                <AlertIcon width={16} height={16} className="mt-0.5 shrink-0" />
                <span>
                  Contains <strong>{allergenHit.toLowerCase()}</strong>, which{" "}
                  {pet.name} reacts to.
                </span>
              </p>
            )}

            {/* The prescription gate */}
            {product.requiresPrescription && (
              <div
                className={cn(
                  "mt-4 rounded-xl px-3 py-3 text-sm",
                  rxSatisfied ? "bg-[#2F6F5E]/10" : "bg-marigold/12"
                )}
              >
                <p className="flex items-center gap-2 font-medium text-ink">
                  {rxSatisfied ? (
                    <CheckIcon width={16} height={16} className="text-[#215144]" />
                  ) : (
                    <PillIcon width={16} height={16} className="text-[#946412]" />
                  )}
                  {rxSatisfied ? "Prescription on file" : "Vet prescription required"}
                </p>
                {rxSatisfied && prescription ? (
                  <p className="mt-1 text-charcoal/75">
                    Prescribed for {pet?.name}
                    {prescription.expiresAt &&
                      ` · valid until ${formatDate(prescription.expiresAt)}`}
                    {prescription.refillsLeft != null &&
                      ` · ${prescription.refillsLeft} refills left`}
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-charcoal/75">
                      {petId
                        ? `${pet?.name ?? "This pet"} doesn't have a current prescription for this. A vet has to add one before you can buy it.`
                        : "Choose the pet this is for. It unlocks once their vet has added the prescription to their health record."}
                    </p>
                    <ButtonLink href="/vets" variant="outline" size="sm" className="mt-3">
                      Book a vet visit
                    </ButtonLink>
                  </>
                )}
              </div>
            )}

            <div className="mt-5 flex items-center gap-3">
              <label htmlFor="qty" className="text-sm text-charcoal/70">
                Qty
              </label>
              <select
                id="qty"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                disabled={soldOut}
                className="rounded-xl border border-mist bg-white px-3 py-2 text-sm"
              >
                {Array.from(
                  { length: Math.min(product.stockQty, 10) || 1 },
                  (_, i) => i + 1
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {product.stockQty > 0 && product.stockQty <= 5 && (
                <span className="text-xs text-[#a83c27]">
                  Only {product.stockQty} left
                </span>
              )}
            </div>

            <Button
              variant="cta"
              size="lg"
              className="mt-4 w-full"
              disabled={soldOut || !rxSatisfied}
              onClick={addToCart}
            >
              {soldOut
                ? "Sold out"
                : !rxSatisfied
                  ? "Prescription needed"
                  : "Add to cart"}
            </Button>

            <p className="mt-3 text-center text-xs text-charcoal/50">
              Tracked from our shelf to your door.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_380px]">
        <Skeleton className="aspect-square w-full rounded-3xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    </div>
  );
}
