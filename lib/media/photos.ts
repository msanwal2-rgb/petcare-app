/**
 * Curated, hand-picked Unsplash photography (brief §3).
 *
 * This is production code, not fixtures: `unsplash()` builds every remote
 * image URL the app renders, and BLUR_DATA_URL is the placeholder behind all
 * of them. It lives outside /lib/seed-data for that reason.
 * Every URL below was verified to resolve — we reference specific photo
 * IDs (not the randomized Source endpoint) so imagery stays consistent
 * and on-brand. `unsplash()` builds a fixed-size, face-aware crop so
 * next/image can render it with a stable aspect ratio and no layout shift.
 */

const BASE = "https://images.unsplash.com";

/** Build a sized, cropped Unsplash URL. Fixed w/h ⇒ no layout shift. */
export function unsplash(
  id: string,
  w: number,
  h: number,
  crop: "faces" | "entropy" = "entropy"
): string {
  return `${BASE}/${id}?w=${w}&h=${h}&fit=crop&crop=${crop}&auto=format&q=75`;
}

/**
 * A soft sage-grey blur placeholder shared by every image. next/image needs
 * an explicit blurDataURL for remote images; this reads as our `fog`/`mist`
 * palette while the real photo streams in — never a blank box.
 */
export const BLUR_DATA_URL =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#c8d6c6"/></svg>`
  ).toString("base64");

export const HERO_PHOTO = "photo-1450778869180-41d0601e046e"; // person walking a dog outdoors
export const CTA_PHOTO = "photo-1568640347023-a616a30bc3bd"; // person hugging a dog

export const DOG_PHOTOS = [
  "photo-1517849845537-4d257902454a",
  "photo-1543466835-00a7907e9de1",
  "photo-1552053831-71594a27632d",
  "photo-1601758228041-f3b2795255f1",
  "photo-1587300003388-59208cc962cb",
  "photo-1518717758536-85ae29035b6d",
  "photo-1477884213360-7e9d7dcc1e48",
  "photo-1561037404-61cd46aa615b",
  "photo-1583337130417-3346a1be7dee",
  "photo-1534361960057-19889db9621e",
  "photo-1583512603805-3cc6b41f3edb",
  "photo-1583795128727-6ec3642408f8",
  "photo-1596492784531-6e6eb5ea9993",
  "photo-1583524505974-6facd53f4597",
];

export const CAT_PHOTOS = [
  "photo-1514888286974-6c03e2ca1dba",
  "photo-1495360010541-f48722b34f7d",
  "photo-1518791841217-8f162f1e1131",
  "photo-1573865526739-10659fec78a5",
  "photo-1592194996308-7b43878e84a6",
  "photo-1533738363-b7f9aef128ce",
  "photo-1596854407944-bf87f6fdd49e",
  "photo-1591871937573-74dbba515c4c",
];

export const OTHER_PHOTOS = [
  "photo-1425082661705-1834bfd09dca", // rabbit
  "photo-1444212477490-ca407925329e", // bird
  "photo-1535930891776-0c2dfb7fda1a",
  "photo-1478098711619-5ab0b478d6e6",
  "photo-1517423440428-a5a00ad493e8",
];

/** 15 diverse caretaker headshots. */
export const HEADSHOTS = [
  "photo-1494790108377-be9c29b29330",
  "photo-1500648767791-00dcc994a43e",
  "photo-1438761681033-6461ffad8d80",
  "photo-1507003211169-0a1dd7228f2d",
  "photo-1544005313-94ddf0286df2",
  "photo-1552058544-f2b08422138a",
  "photo-1534528741775-53994a69daeb",
  "photo-1506794778202-cad84cf45f1d",
  "photo-1573497019940-1c28c88b4f3e",
  "photo-1580489944761-15a19d654956",
  "photo-1519085360753-af0119f7cbe7",
  "photo-1607746882042-944635dfe10e",
  "photo-1508214751196-bcfd4ca60f91",
  "photo-1531123897727-8f129e1688ce",
  "photo-1487412720507-e7ab37603c6f",
];
