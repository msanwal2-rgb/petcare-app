import { BLUR_DATA_URL } from "@/lib/photos";
import { cn } from "@/lib/utils";

/**
 * A round photo of a person.
 *
 * This is what `next/image` becomes. The 32 call sites in the reference project
 * relied on four things from it, and each one has a plain-HTML answer:
 *
 *  - `fill` + a sized parent → `absolute inset-0 h-full w-full object-cover`;
 *  - `placeholder="blur"` + `blurDataURL` → the same data URI as a CSS
 *    background on the wrapper, revealed until the image paints;
 *  - `sizes` → `width`/`height` attributes, which is what actually prevents
 *    layout shift once there is no layout-filling parent;
 *  - automatic format negotiation → already in the Unsplash URL that
 *    `lib/photos.ts` builds (`auto=format`), so nothing is lost.
 *
 * `loading="lazy"` and `decoding="async"` are the two attributes next/image set
 * for free and which are easy to forget by hand.
 */
export function Avatar({
  src,
  alt = "",
  size = 32,
  className,
}: {
  src: string;
  /** Empty by default: an avatar beside a name is decorative, and a screen reader reading the name twice is worse than silence. */
  alt?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-block shrink-0 overflow-hidden rounded-full", className)}
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${BLUR_DATA_URL}")`,
        backgroundSize: "cover",
      }}
    >
      {src && (
        <img
          src={src}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}
