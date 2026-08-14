/**
 * Generates the store's product artwork into /public/products.
 *
 * Why generated art rather than stock photography: the catalog is seed data,
 * and a hotlinked photo that stops resolving leaves a broken storefront. These
 * are deterministic, on-brand SVGs — small, local, and impossible to 404. Each
 * product gets a packaging silhouette chosen by category and a colour picked
 * from the brand palette by hashing its slug, so the shelf looks varied
 * without anyone hand-picking 25 images.
 *
 * Run:  npx tsx scripts/generate-product-art.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { products } from "../lib/mock-data/store";
import type { ProductCategory } from "../types";

const OUT_DIR = path.join(process.cwd(), "public", "products");

/** Brand-adjacent accents. Muted enough to sit together on one grid. */
const ACCENTS = [
  { fill: "#1b3b36", tint: "#e3ece7" }, // ink
  { fill: "#e85c41", tint: "#fbe6e1" }, // leash
  { fill: "#f2a93b", tint: "#fdf1dd" }, // marigold
  { fill: "#3f6d63", tint: "#e6efec" }, // deep sage
  { fill: "#8c5a3c", tint: "#f2e8e1" }, // clay
  { fill: "#4c6b8a", tint: "#e6ecf3" }, // slate blue
];

/** Stable hash so re-running never reshuffles the shelf. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Packaging silhouette, drawn in a 0 0 400 400 viewBox. */
function silhouette(category: ProductCategory, fill: string): string {
  switch (category) {
    case "dry_food":
    case "prescription_diet":
      // Stand-up kibble bag with a gusseted top fold.
      return `
        <path d="M120 118h160a8 8 0 0 1 8 8v168a16 16 0 0 1-16 16H128a16 16 0 0 1-16-16V126a8 8 0 0 1 8-8z" fill="${fill}"/>
        <path d="M120 118l14-26a10 10 0 0 1 9-6h114a10 10 0 0 1 9 6l14 26z" fill="${fill}" opacity="0.75"/>
        <rect x="140" y="176" width="120" height="56" rx="8" fill="#ffffff" opacity="0.85"/>`;
    case "wet_food":
      // Stacked cans, seen slightly from above.
      return `
        <ellipse cx="200" cy="146" rx="86" ry="26" fill="${fill}" opacity="0.75"/>
        <path d="M114 146v112a86 26 0 0 0 172 0V146z" fill="${fill}"/>
        <rect x="114" y="184" width="172" height="44" fill="#ffffff" opacity="0.85"/>
        <ellipse cx="200" cy="146" rx="58" ry="17" fill="#ffffff" opacity="0.3"/>`;
    case "treats":
      // Resealable pouch with a rounded bottom.
      return `
        <path d="M132 112h136a10 10 0 0 1 10 10v134c0 30-26 54-58 54h-40c-32 0-58-24-58-54V122a10 10 0 0 1 10-10z" fill="${fill}"/>
        <rect x="132" y="112" width="146" height="22" rx="6" fill="${fill}" opacity="0.6"/>
        <rect x="156" y="176" width="88" height="52" rx="26" fill="#ffffff" opacity="0.85"/>`;
    case "supplements":
      // Supplement bottle with a screw cap.
      return `
        <rect x="176" y="92" width="48" height="34" rx="6" fill="${fill}" opacity="0.7"/>
        <path d="M150 126h100a14 14 0 0 1 14 14v152a18 18 0 0 1-18 18H154a18 18 0 0 1-18-18V140a14 14 0 0 1 14-14z" fill="${fill}"/>
        <rect x="156" y="182" width="88" height="62" rx="8" fill="#ffffff" opacity="0.85"/>`;
    case "dental":
      // Wide tub with a lid.
      return `
        <rect x="118" y="140" width="164" height="26" rx="10" fill="${fill}" opacity="0.7"/>
        <path d="M128 166h144l-12 128a16 16 0 0 1-16 14h-88a16 16 0 0 1-16-14z" fill="${fill}"/>
        <rect x="152" y="204" width="96" height="52" rx="8" fill="#ffffff" opacity="0.85"/>`;
    case "accessories":
      // A coiled lead — the app's own motif.
      return `
        <path d="M132 268c0-64 32-116 68-116s68 52 68 116" fill="none" stroke="${fill}" stroke-width="22" stroke-linecap="round"/>
        <circle cx="132" cy="268" r="30" fill="none" stroke="${fill}" stroke-width="22"/>
        <circle cx="268" cy="268" r="14" fill="${fill}"/>`;
  }
}

function svg(slug: string, category: ProductCategory): string {
  const accent = ACCENTS[hash(slug) % ACCENTS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="Product packaging">
  <rect width="400" height="400" fill="${accent.tint}"/>
  <circle cx="200" cy="212" r="150" fill="#ffffff" opacity="0.55"/>
  ${silhouette(category, accent.fill)}
  <!-- Leash ID-tag mark, matching the site logo -->
  <circle cx="340" cy="60" r="18" fill="${accent.fill}"/>
  <circle cx="340" cy="60" r="7" fill="none" stroke="#f2a93b" stroke-width="3"/>
</svg>
`;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const p of products) {
  writeFileSync(path.join(OUT_DIR, `${p.slug}.svg`), svg(p.slug, p.category), "utf8");
}
console.log(`Wrote ${products.length} product images to public/products`);
