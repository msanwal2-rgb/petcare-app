import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type { Product } from "@/types";
import { getProduct } from "@/api/catalog";
import { RatingStars } from "@/components/RatingStars";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { PillIcon } from "@/components/ui/icons";
import { MAX_PER_LINE, useCart } from "@/store/cart";
import { BLUR_DATA_URL } from "@/lib/photos";
import {
  CATEGORY_LABELS,
  LIFE_STAGE_LABELS,
  SPECIES_LABELS,
  formatCents,
} from "@/lib/utils";

/**
 * One product.
 *
 * ── Adding an Rx item to the cart is allowed ──
 *
 * The cart is a wish list until checkout, and refusing to let somebody put a
 * prescription diet in it would only move the refusal somewhere less useful.
 * The quote is where the gate is enforced (REQUIREMENTS.md S7): it checks the
 * pet chosen at checkout for an active prescription naming this product, and
 * the cart shows the refusal against the line with a link to book a vet.
 */
export default function ProductPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const add = useCart((s) => s.add);

  const [product, setProduct] = useState<Product | null | undefined>(undefined);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    getProduct(slug).then(setProduct).catch(() => setProduct(null));
  }, [slug]);

  if (product === undefined) {
    return (
      <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-2">
        <Skeleton className="aspect-square rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  if (product === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Product not found</h1>
        <ButtonLink to="/store" variant="outline" className="mt-6">
          Back to the store
        </ButtonLink>
      </div>
    );
  }

  const soldOut = product.stockQty === 0;
  const withdrawn = !product.active;
  const purchasable = !soldOut && !withdrawn;
  const maxQty = Math.min(MAX_PER_LINE, product.stockQty);

  function addToCart() {
    add(product!, quantity);
    toast.success(`${product!.name} added to your cart`, {
      action: { label: "View cart", onClick: () => navigate("/store/cart") },
    });
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      <Link to="/store" className="text-sm text-charcoal/60 hover:text-ink">
        ← Back to the store
      </Link>

      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div
          className="relative aspect-square overflow-hidden rounded-2xl bg-fog"
          style={{ backgroundImage: `url("${BLUR_DATA_URL}")`, backgroundSize: "cover" }}
        >
          <img
            src={product.imageUrl}
            alt={product.name}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>

        <div>
          <p className="font-mono text-xs uppercase tracking-wide text-charcoal/50">
            {product.brand} · {CATEGORY_LABELS[product.category]}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{product.name}</h1>
          <p className="mt-1 text-sm text-charcoal/60">{product.sizeLabel}</p>

          <div className="mt-3">
            <RatingStars rating={product.rating} reviewCount={product.reviewCount} />
          </div>

          <div className="mt-5 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-semibold text-ink">
              {formatCents(product.priceCents)}
            </span>
            {product.compareAtPriceCents != null && product.compareAtPriceCents > product.priceCents && (
              <span className="font-mono text-base text-charcoal/45 line-through">
                {formatCents(product.compareAtPriceCents)}
              </span>
            )}
          </div>

          {product.requiresPrescription && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-marigold/40 bg-marigold/10 p-4 text-sm text-[#7a5410]">
              <PillIcon width={18} height={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Needs a current prescription</p>
                <p className="mt-0.5">
                  At checkout, choose the pet this is for. If their vet has
                  prescribed it, it goes straight through.{" "}
                  <Link to="/vets" className="font-medium underline">
                    Book a vet
                  </Link>
                </p>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {purchasable ? (
              <>
                <label htmlFor="qty" className="sr-only">
                  Quantity
                </label>
                <Select
                  id="qty"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="w-24"
                >
                  {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
                <Button variant="cta" onClick={addToCart}>
                  Add to cart
                </Button>
              </>
            ) : (
              <p className="rounded-xl border border-mist bg-white px-4 py-2.5 text-sm text-charcoal/70">
                {withdrawn ? "No longer sold." : "Sold out — check back soon."}
              </p>
            )}
          </div>

          {product.stockQty > 0 && product.stockQty <= 5 && (
            <p className="mt-2 text-xs text-[#a83c27]">Only {product.stockQty} left.</p>
          )}

          <p className="mt-8 text-sm leading-relaxed text-charcoal/80">{product.description}</p>

          <dl className="mt-8 grid gap-4 border-t border-mist pt-6 sm:grid-cols-2">
            <Detail label="For" value={product.species.map((s) => SPECIES_LABELS[s]).join(", ")} />
            <Detail
              label="Life stage"
              value={product.lifeStage.map((s) => LIFE_STAGE_LABELS[s]).join(", ")}
            />
            {product.allergens.length > 0 && (
              <Detail label="Contains" value={product.allergens.join(", ")} />
            )}
            {product.ingredients.length > 0 && (
              <Detail label="Ingredients" value={product.ingredients.join(", ")} />
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
    </div>
  );
}
