import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types";
import { RatingStars } from "@/components/RatingStars";
import { AlertIcon, PillIcon } from "@/components/ui/icons";
import { CATEGORY_LABELS, formatCents } from "@/lib/utils";

/**
 * Catalog card. Same silhouette as the caretaker and vet cards so the store
 * reads as part of the same product rather than a bolted-on shop.
 *
 * `allergenWarning` is set when the shopper is browsing for a specific pet and
 * this product contains something that pet reacts to — surfaced rather than
 * hidden, because an owner may still be buying for a different animal.
 */
export function ProductCard({
  product,
  allergenWarning,
}: {
  product: Product;
  allergenWarning?: string;
}) {
  const soldOut = product.stockQty === 0;
  const onSale =
    product.compareAtPriceCents != null &&
    product.compareAtPriceCents > product.priceCents;

  return (
    <Link
      href={`/store/${product.slug}`}
      className="group flex flex-col rounded-[12px] border border-mist bg-white shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-lg hover:shadow-ink/5 focus-visible:-translate-y-1"
    >
      <div className="relative aspect-square overflow-hidden rounded-t-[12px] bg-fog">
        <Image
          src={product.imageUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
        {product.requiresPrescription && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-[#946412] shadow-sm backdrop-blur">
            <PillIcon width={13} height={13} />
            Vet Rx
          </span>
        )}
        {soldOut && (
          <span className="absolute inset-x-0 bottom-0 bg-ink/85 py-1.5 text-center text-xs font-medium text-white backdrop-blur">
            Sold out
          </span>
        )}
        {!soldOut && onSale && (
          <span className="absolute right-3 top-3 rounded-full bg-leash px-2.5 py-1 text-[11px] font-medium text-white">
            Sale
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-charcoal/45">
          {product.brand} · {CATEGORY_LABELS[product.category]}
        </p>
        <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-ink">
          {product.name}
        </h3>
        <p className="mt-0.5 text-xs text-charcoal/60">{product.sizeLabel}</p>

        <div className="mt-2 flex items-center gap-2">
          <RatingStars rating={product.rating} size="sm" />
          <span className="font-mono text-[11px] text-charcoal/45">
            ({product.reviewCount})
          </span>
        </div>

        {allergenWarning && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-leash/8 px-2 py-1.5 text-[11px] text-[#a83c27]">
            <AlertIcon width={13} height={13} className="mt-px shrink-0" />
            {allergenWarning}
          </p>
        )}

        <div className="mt-auto flex items-baseline gap-2 pt-3">
          <span className="font-mono text-lg font-semibold text-ink">
            {formatCents(product.priceCents)}
          </span>
          {onSale && (
            <span className="font-mono text-xs text-charcoal/45 line-through">
              {formatCents(product.compareAtPriceCents!)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
