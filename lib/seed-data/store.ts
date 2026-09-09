/**
 * Seed data for the store: catalog, plus a few orders mid-journey so the
 * tracking page has something real to render on day one.
 *
 * Same rules as the rest of /lib/mock-data — nothing outside the seeder and
 * the API layer imports this, and every timestamp is hard-coded around the
 * demo "today" (2026-07-08) so the UI is deterministic.
 *
 * Money is integer cents. Product art is generated, on-brand SVG served from
 * /public/products (see scripts/generate-product-art.mjs) — local files can't
 * 404 the way a hotlinked photo can.
 */

import type { Order, OrderEvent, OrderItem, Product } from "@/types";
import type { SeedUser } from "./types";
import { HEADSHOTS, unsplash } from "@/lib/media/photos";
import { taxFor } from "@/lib/pricing";

/**
 * Staff accounts. `staffRoles` is not a marketplace role — it never appears in
 * `roles` or the role toggle; it unlocks the internal consoles.
 *
 * Two accounts rather than one, deliberately: Rosa can move parcels and nothing
 * else, which is what makes it possible to demonstrate that the role boundaries
 * are real. An "admin" who is the only staff member proves nothing.
 */
export const opsUser: SeedUser = {
  id: "u21",
  name: "Rosa Delgado",
  email: "rosa.delgado@example.com",
  phone: "(512) 555-0900",
  avatarUrl: unsplash(HEADSHOTS[8], 240, 240, "faces"),
  roles: ["owner"],
  address: { city: "Austin", state: "TX", lat: 30.2711, lng: -97.7437 },
  verified: true,
  createdAt: "2025-08-01T08:00:00Z",
  staffRoles: ["ops"],
};

/** Platform administrator: every console, including staff-role changes. */
export const adminUser: SeedUser = {
  id: "u22",
  name: "Priya Raman",
  email: "priya.raman@example.com",
  phone: "(512) 555-0901",
  avatarUrl: unsplash(HEADSHOTS[9], 240, 240, "faces"),
  roles: ["owner"],
  address: { city: "Austin", state: "TX", lat: 30.2669, lng: -97.7502 },
  verified: true,
  createdAt: "2025-07-15T08:00:00Z",
  staffRoles: ["admin"],
};

/** Support and finance without administration — the middle of the ladder. */
export const supportUser: SeedUser = {
  id: "u23",
  name: "Tom Okafor",
  email: "tom.okafor@example.com",
  phone: "(512) 555-0902",
  avatarUrl: unsplash(HEADSHOTS[10], 240, 240, "faces"),
  roles: ["owner"],
  address: { city: "Austin", state: "TX", lat: 30.2705, lng: -97.7401 },
  verified: true,
  createdAt: "2025-07-20T08:00:00Z",
  staffRoles: ["support", "finance"],
};

/** Everyone with staff privileges, for the seeder to insert in one pass. */
export const staffUsers: SeedUser[] = [opsUser, adminUser, supportUser];

const art = (slug: string) => `/products/${slug}.svg`;

/** Terse constructor so the catalog below reads as a table, not a wall of JSON. */
function product(
  p: Omit<Product, "imageUrl" | "active" | "createdAt" | "compareAtPriceCents"> &
    Partial<Pick<Product, "compareAtPriceCents" | "active" | "createdAt">>
): Product {
  return {
    imageUrl: art(p.slug),
    active: true,
    createdAt: "2026-04-01T09:00:00Z",
    compareAtPriceCents: null,
    ...p,
  };
}

export const products: Product[] = [
  /* ── Dry food ─────────────────────────────────────────────────────── */
  product({
    id: "prod1",
    slug: "summit-trail-salmon-dry-dog",
    name: "Salmon & Sweet Potato Dry Dog Food",
    brand: "Summit Trail",
    description:
      "Single-protein salmon recipe for dogs who do better away from poultry and beef. Cold-water salmon is the first ingredient, with sweet potato for steady energy and omega-3s for coat condition.",
    category: "dry_food",
    species: ["dog"],
    lifeStage: ["adult", "senior"],
    sizeLabel: "24 lb bag",
    weightLbs: 24,
    priceCents: 6499,
    compareAtPriceCents: 7299,
    ingredients: ["Deboned salmon", "Salmon meal", "Sweet potato", "Peas", "Flaxseed", "Fish oil"],
    allergens: ["Fish"],
    requiresPrescription: false,
    stockQty: 42,
    rating: 4.8,
    reviewCount: 312,
  }),
  product({
    id: "prod2",
    slug: "summit-trail-lamb-dry-dog",
    name: "Lamb & Brown Rice Dry Dog Food",
    brand: "Summit Trail",
    description:
      "A gentle everyday recipe built around pasture-raised lamb. Brown rice and oatmeal keep it easy on sensitive stomachs.",
    category: "dry_food",
    species: ["dog"],
    lifeStage: ["adult"],
    sizeLabel: "24 lb bag",
    weightLbs: 24,
    priceCents: 5999,
    ingredients: ["Deboned lamb", "Lamb meal", "Brown rice", "Oatmeal", "Beet pulp"],
    allergens: ["Lamb"],
    requiresPrescription: false,
    stockQty: 30,
    rating: 4.6,
    reviewCount: 188,
  }),
  product({
    id: "prod3",
    slug: "meadowlark-chicken-dry-dog",
    name: "Chicken & Brown Rice Dry Dog Food",
    brand: "Meadowlark",
    description:
      "The classic kitchen-cupboard recipe: farm-raised chicken, brown rice, and a full vitamin panel. Great value for multi-dog homes.",
    category: "dry_food",
    species: ["dog"],
    lifeStage: ["adult"],
    sizeLabel: "30 lb bag",
    weightLbs: 30,
    priceCents: 5499,
    ingredients: ["Chicken", "Chicken meal", "Brown rice", "Barley", "Chicken fat"],
    allergens: ["Chicken", "Certain grains"],
    requiresPrescription: false,
    stockQty: 55,
    rating: 4.4,
    reviewCount: 421,
  }),
  product({
    id: "prod4",
    slug: "hearthstone-beef-barley-dry-dog",
    name: "Beef & Barley Dry Dog Food",
    brand: "Hearthstone",
    description:
      "Hearty beef recipe for active adult dogs, slow-cooked and kibble-baked in small batches.",
    category: "dry_food",
    species: ["dog"],
    lifeStage: ["adult"],
    sizeLabel: "22 lb bag",
    weightLbs: 22,
    priceCents: 5799,
    ingredients: ["Beef", "Beef meal", "Barley", "Peas", "Sunflower oil"],
    allergens: ["Beef"],
    requiresPrescription: false,
    stockQty: 24,
    rating: 4.5,
    reviewCount: 156,
  }),
  product({
    id: "prod5",
    slug: "summit-trail-puppy-dry",
    name: "Puppy Growth Formula Dry Food",
    brand: "Summit Trail",
    description:
      "Higher protein and DHA from fish oil for brain and eye development through the first year.",
    category: "dry_food",
    species: ["dog"],
    lifeStage: ["puppy"],
    sizeLabel: "15 lb bag",
    weightLbs: 15,
    priceCents: 4899,
    ingredients: ["Deboned chicken", "Chicken meal", "Oatmeal", "Fish oil (DHA)", "Egg"],
    allergens: ["Chicken"],
    requiresPrescription: false,
    stockQty: 38,
    rating: 4.7,
    reviewCount: 203,
  }),
  product({
    id: "prod6",
    slug: "silverpaw-senior-dry-dog",
    name: "Senior Mobility Dry Dog Food",
    brand: "Silverpaw",
    description:
      "Lower calorie density with added glucosamine and chondroitin for dogs slowing down but still showing up for the walk.",
    category: "dry_food",
    species: ["dog"],
    lifeStage: ["senior"],
    sizeLabel: "20 lb bag",
    weightLbs: 20,
    priceCents: 6199,
    ingredients: ["Turkey", "Turkey meal", "Brown rice", "Glucosamine", "Chondroitin", "Green-lipped mussel"],
    allergens: ["Turkey"],
    requiresPrescription: false,
    stockQty: 19,
    rating: 4.6,
    reviewCount: 97,
  }),
  product({
    id: "prod7",
    slug: "willowbrook-grain-free-cat-dry",
    name: "Grain-Free Whitefish Dry Cat Food",
    brand: "Willowbrook",
    description:
      "No grains, no poultry, no filler — a clean whitefish recipe for cats with food sensitivities.",
    category: "dry_food",
    species: ["cat"],
    lifeStage: ["adult", "senior"],
    sizeLabel: "10 lb bag",
    weightLbs: 10,
    priceCents: 4599,
    ingredients: ["Deboned whitefish", "Whitefish meal", "Peas", "Chickpeas", "Taurine"],
    allergens: ["Fish"],
    requiresPrescription: false,
    stockQty: 47,
    rating: 4.7,
    reviewCount: 264,
  }),
  product({
    id: "prod8",
    slug: "meadowlark-chicken-dry-cat",
    name: "Indoor Chicken Dry Cat Food",
    brand: "Meadowlark",
    description:
      "Hairball-control formula with a moderate calorie load for indoor cats.",
    category: "dry_food",
    species: ["cat"],
    lifeStage: ["adult"],
    sizeLabel: "12 lb bag",
    weightLbs: 12,
    priceCents: 3899,
    ingredients: ["Chicken", "Chicken meal", "Brewers rice", "Corn gluten meal", "Beet pulp"],
    allergens: ["Chicken", "Certain grains"],
    requiresPrescription: false,
    stockQty: 61,
    rating: 4.2,
    reviewCount: 340,
  }),
  product({
    id: "prod9",
    slug: "willowbrook-kitten-dry",
    name: "Kitten Whitefish & Egg Dry Food",
    brand: "Willowbrook",
    description: "Small kibble, high protein, and DHA for kittens through twelve months.",
    category: "dry_food",
    species: ["cat"],
    lifeStage: ["kitten"],
    sizeLabel: "6 lb bag",
    weightLbs: 6,
    priceCents: 3399,
    ingredients: ["Whitefish", "Egg", "Chickpeas", "Fish oil (DHA)", "Taurine"],
    allergens: ["Fish", "Egg"],
    requiresPrescription: false,
    stockQty: 33,
    rating: 4.8,
    reviewCount: 121,
  }),

  /* ── Wet food ─────────────────────────────────────────────────────── */
  product({
    id: "prod10",
    slug: "harborline-tuna-pate-cat",
    name: "Tuna Paté Wet Cat Food",
    brand: "Harborline",
    description:
      "Smooth paté in a broth base — high moisture, which is how most cats prefer to drink.",
    category: "wet_food",
    species: ["cat"],
    lifeStage: ["all"],
    sizeLabel: "24 × 3 oz cans",
    weightLbs: 4.5,
    priceCents: 4299,
    ingredients: ["Tuna", "Fish broth", "Sunflower oil", "Taurine"],
    allergens: ["Fish"],
    requiresPrescription: false,
    stockQty: 72,
    rating: 4.5,
    reviewCount: 508,
  }),
  product({
    id: "prod11",
    slug: "harborline-turkey-shreds-cat",
    name: "Turkey Shreds in Gravy Wet Cat Food",
    brand: "Harborline",
    description: "Shredded turkey in a light gravy for cats who turn their nose up at paté.",
    category: "wet_food",
    species: ["cat"],
    lifeStage: ["all"],
    sizeLabel: "24 × 3 oz cans",
    weightLbs: 4.5,
    priceCents: 4499,
    ingredients: ["Turkey", "Turkey broth", "Rice starch", "Taurine"],
    allergens: ["Turkey"],
    requiresPrescription: false,
    stockQty: 58,
    rating: 4.4,
    reviewCount: 276,
  }),
  product({
    id: "prod12",
    slug: "copperkettle-beef-stew-dog",
    name: "Beef Stew Wet Dog Food",
    brand: "Copper Kettle",
    description: "Chunky beef and vegetable stew — a topper that gets picky eaters to the bowl.",
    category: "wet_food",
    species: ["dog"],
    lifeStage: ["adult", "senior"],
    sizeLabel: "12 × 12.5 oz cans",
    weightLbs: 9.4,
    priceCents: 3899,
    ingredients: ["Beef", "Beef broth", "Carrots", "Peas", "Potato"],
    allergens: ["Beef"],
    requiresPrescription: false,
    stockQty: 41,
    rating: 4.6,
    reviewCount: 189,
  }),

  /* ── Treats ───────────────────────────────────────────────────────── */
  product({
    id: "prod13",
    slug: "barkside-peanut-butter-biscuits",
    name: "Peanut Butter Biscuits",
    brand: "Barkside",
    description: "Oven-baked biscuits with five ingredients and nothing you can't pronounce.",
    category: "treats",
    species: ["dog"],
    lifeStage: ["all"],
    sizeLabel: "16 oz box",
    weightLbs: 1,
    priceCents: 1299,
    ingredients: ["Whole wheat flour", "Peanut butter", "Oats", "Egg", "Honey"],
    allergens: ["Peanut", "Certain grains", "Egg"],
    requiresPrescription: false,
    stockQty: 120,
    rating: 4.7,
    reviewCount: 634,
  }),
  product({
    id: "prod14",
    slug: "barkside-salmon-training-treats",
    name: "Salmon Training Treats",
    brand: "Barkside",
    description:
      "Pea-sized, soft, and high value — sized for a hundred repetitions without wrecking a daily calorie budget.",
    category: "treats",
    species: ["dog"],
    lifeStage: ["all"],
    sizeLabel: "6 oz pouch",
    weightLbs: 0.4,
    priceCents: 1499,
    ingredients: ["Salmon", "Sweet potato", "Vegetable glycerin", "Mixed tocopherols"],
    allergens: ["Fish"],
    requiresPrescription: false,
    stockQty: 95,
    rating: 4.9,
    reviewCount: 812,
  }),
  product({
    id: "prod15",
    slug: "whiskerwell-catnip-crunchies",
    name: "Catnip Crunchies",
    brand: "Whiskerwell",
    description: "Crunchy outside, soft centre, dusted with organic catnip.",
    category: "treats",
    species: ["cat"],
    lifeStage: ["all"],
    sizeLabel: "3 oz pouch",
    weightLbs: 0.2,
    priceCents: 899,
    ingredients: ["Chicken", "Catnip", "Brewers rice", "Natural flavor"],
    allergens: ["Chicken", "Certain grains"],
    requiresPrescription: false,
    stockQty: 140,
    rating: 4.6,
    reviewCount: 391,
  }),

  /* ── Supplements ──────────────────────────────────────────────────── */
  product({
    id: "prod16",
    slug: "vitalcoat-omega-3-softgels",
    name: "Omega-3 Skin & Coat Softgels",
    brand: "VitalCoat",
    description:
      "Wild fish oil softgels for dry skin and dull coats. Puncture and squeeze over food for dogs who won't take a capsule.",
    category: "supplements",
    species: ["dog", "cat"],
    lifeStage: ["all"],
    sizeLabel: "90 softgels",
    weightLbs: 0.6,
    priceCents: 2699,
    ingredients: ["Wild fish oil", "EPA", "DHA", "Vitamin E"],
    allergens: ["Fish"],
    requiresPrescription: false,
    stockQty: 66,
    rating: 4.5,
    reviewCount: 228,
  }),
  product({
    id: "prod17",
    slug: "jointwell-hip-joint-chews",
    name: "Hip & Joint Soft Chews",
    brand: "JointWell",
    description:
      "Glucosamine, chondroitin, and MSM in a soft chew. Built for large breeds and older dogs.",
    category: "supplements",
    species: ["dog"],
    lifeStage: ["adult", "senior"],
    sizeLabel: "120 chews",
    weightLbs: 1.3,
    priceCents: 3499,
    ingredients: ["Glucosamine HCl", "Chondroitin sulfate", "MSM", "Turmeric", "Chicken liver"],
    allergens: ["Chicken"],
    requiresPrescription: false,
    stockQty: 52,
    rating: 4.4,
    reviewCount: 173,
  }),
  product({
    id: "prod18",
    slug: "calmpaws-probiotic-powder",
    name: "Digestive Probiotic Powder",
    brand: "CalmPaws",
    description:
      "A daily sachet of probiotics and prebiotic fibre for pets with unsettled digestion — including after a course of antibiotics.",
    category: "supplements",
    species: ["dog", "cat"],
    lifeStage: ["all"],
    sizeLabel: "30 sachets",
    weightLbs: 0.3,
    priceCents: 2999,
    ingredients: ["Probiotic blend", "Inulin", "Pumpkin powder"],
    allergens: [],
    requiresPrescription: false,
    stockQty: 74,
    rating: 4.6,
    reviewCount: 145,
  }),

  /* ── Prescription diets (vet authorisation required) ──────────────── */
  product({
    id: "prod19",
    slug: "vetline-hypoallergenic-cat-dry",
    name: "Hypoallergenic Hydrolysed Protein Dry Cat Food",
    brand: "VetLine",
    description:
      "A therapeutic elimination diet. The protein is hydrolysed into fragments too small for the immune system to react to, which is why it needs a vet's authorisation.",
    category: "prescription_diet",
    species: ["cat"],
    lifeStage: ["adult", "senior"],
    sizeLabel: "8 lb bag",
    weightLbs: 8,
    priceCents: 8999,
    ingredients: ["Hydrolysed soy protein", "Rice starch", "Vegetable oil", "Taurine"],
    allergens: [],
    requiresPrescription: true,
    stockQty: 15,
    rating: 4.7,
    reviewCount: 88,
  }),
  product({
    id: "prod20",
    slug: "vetline-hydrolyzed-protein-dog-dry",
    name: "Hydrolysed Protein Dry Dog Food",
    brand: "VetLine",
    description:
      "Therapeutic diet for dogs with confirmed food-responsive skin or gut disease. Prescribed as part of a supervised elimination trial.",
    category: "prescription_diet",
    species: ["dog"],
    lifeStage: ["adult", "senior"],
    sizeLabel: "17.6 lb bag",
    weightLbs: 17.6,
    priceCents: 11499,
    ingredients: ["Hydrolysed chicken liver", "Rice starch", "Vegetable oil", "Fish oil"],
    allergens: [],
    requiresPrescription: true,
    stockQty: 12,
    rating: 4.8,
    reviewCount: 64,
  }),
  product({
    id: "prod21",
    slug: "vetline-urinary-so-cat-wet",
    name: "Urinary Care Wet Cat Food",
    brand: "VetLine",
    description:
      "Therapeutic diet formulated to dissolve struvite stones and reduce recurrence. Vet authorisation required.",
    category: "prescription_diet",
    species: ["cat"],
    lifeStage: ["adult", "senior"],
    sizeLabel: "24 × 3 oz cans",
    weightLbs: 4.5,
    priceCents: 7499,
    ingredients: ["Pork by-products", "Chicken", "Rice", "DL-methionine", "Taurine"],
    allergens: ["Chicken", "Pork"],
    requiresPrescription: true,
    stockQty: 20,
    rating: 4.6,
    reviewCount: 51,
  }),

  /* ── Dental ───────────────────────────────────────────────────────── */
  product({
    id: "prod22",
    slug: "freshgrin-dental-chews-dog",
    name: "Daily Dental Chews",
    brand: "FreshGrin",
    description:
      "A ridged chew shaped to reach the gum line. One a day between professional cleanings.",
    category: "dental",
    species: ["dog"],
    lifeStage: ["adult", "senior"],
    sizeLabel: "30 chews",
    weightLbs: 2.1,
    priceCents: 2799,
    ingredients: ["Rice flour", "Gelatin", "Glycerin", "Sodium tripolyphosphate", "Parsley"],
    allergens: ["Certain grains"],
    requiresPrescription: false,
    stockQty: 88,
    rating: 4.5,
    reviewCount: 302,
  }),
  product({
    id: "prod23",
    slug: "freshgrin-water-additive",
    name: "Dental Water Additive",
    brand: "FreshGrin",
    description:
      "A capful in the water bowl for pets who will not tolerate a toothbrush. Tasteless once diluted.",
    category: "dental",
    species: ["dog", "cat"],
    lifeStage: ["all"],
    sizeLabel: "16 fl oz",
    weightLbs: 1.1,
    priceCents: 1899,
    ingredients: ["Purified water", "Zinc gluconate", "Sodium citrate", "Green tea extract"],
    allergens: [],
    requiresPrescription: false,
    stockQty: 64,
    rating: 4.1,
    reviewCount: 118,
  }),

  /* ── Accessories ──────────────────────────────────────────────────── */
  product({
    id: "prod24",
    slug: "trailmate-reflective-leash",
    name: "Reflective Trail Leash, 6 ft",
    brand: "Trailmate",
    description:
      "Tubular webbing with a reflective core and a padded traffic handle — the leash our caretakers keep asking about.",
    category: "accessories",
    species: ["dog"],
    lifeStage: ["all"],
    sizeLabel: "6 ft · 1 in webbing",
    weightLbs: 0.5,
    priceCents: 3299,
    ingredients: [],
    allergens: [],
    requiresPrescription: false,
    stockQty: 45,
    rating: 4.9,
    reviewCount: 417,
  }),
  product({
    id: "prod25",
    slug: "hearth-slow-feeder-bowl",
    name: "Slow Feeder Bowl",
    brand: "Hearth",
    description:
      "A maze-bottom bowl that turns a thirty-second inhale into a five-minute meal. Dishwasher safe.",
    category: "accessories",
    species: ["dog", "cat"],
    lifeStage: ["all"],
    sizeLabel: "Medium · 4 cup",
    weightLbs: 0.9,
    priceCents: 2199,
    compareAtPriceCents: 2799,
    ingredients: [],
    allergens: [],
    requiresPrescription: false,
    stockQty: 0, // deliberately out of stock — exercises the sold-out path
    rating: 4.6,
    reviewCount: 259,
  }),
];

/* ── Seed orders ───────────────────────────────────────────────────────
   Three orders for Maya (u1) at different points in the journey plus one for
   Priya (u3), so /store/orders and the tracking timeline are populated
   immediately: one delivered, one out for delivery, one just placed. */

/**
 * Orders are timed relative to when the database was seeded, unlike the rest
 * of the fixtures.
 *
 * The cron computes each order's stage from how long ago it was placed, so
 * orders pinned to a fixed date in the past would all be "overdue for
 * delivery" the first time it ran, and the tracking demo would be over before
 * anyone saw it. Placing them a few hours and days back instead means the
 * seeded status is exactly the stage its age has earned — and real time then
 * carries them forward on its own.
 */
const SEEDED_AT = Date.now();
const hoursAgo = (hours: number) =>
  new Date(SEEDED_AT - hours * 3_600_000).toISOString();
const hoursAhead = (hours: number) =>
  new Date(SEEDED_AT + hours * 3_600_000).toISOString();

const MAYA_ADDRESS = {
  shipName: "Maya Chen",
  shipLine1: "1204 Grove Street",
  shipLine2: "Apt 3B",
  shipCity: "Austin",
  shipState: "TX",
  shipPostalCode: "78704",
  shipCountry: "US",
  shipPhone: "(512) 555-0142",
};

const PRIYA_ADDRESS = {
  shipName: "Priya Nair",
  shipLine1: "88 Larimer Court",
  shipLine2: "",
  shipCity: "Denver",
  shipState: "CO",
  shipPostalCode: "80205",
  shipCountry: "US",
  shipPhone: "(303) 555-0177",
};

type SeedOrder = Omit<Order, "items" | "events" | "shippingAddress"> &
  typeof MAYA_ADDRESS & {
    items: Omit<OrderItem, "id" | "orderId">[];
    events: Omit<OrderEvent, "id" | "orderId">[];
  };

/** Look up catalog facts so seed line items can't drift from the catalog. */
function line(slug: string, quantity: number): Omit<OrderItem, "id" | "orderId"> {
  const p = products.find((x) => x.slug === slug);
  if (!p) throw new Error(`Seed order references unknown product slug: ${slug}`);
  return {
    productId: p.id,
    name: p.name,
    brand: p.brand,
    imageUrl: p.imageUrl,
    slug: p.slug,
    unitPriceCents: p.priceCents,
    quantity,
    lineTotalCents: p.priceCents * quantity,
  };
}

function totals(items: Omit<OrderItem, "id" | "orderId">[], shippingCents: number) {
  const subtotalCents = items.reduce((sum, i) => sum + i.lineTotalCents, 0);
  const taxCents = taxFor(subtotalCents);
  return {
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
  };
}

const o1Items = [line("summit-trail-salmon-dry-dog", 1), line("barkside-salmon-training-treats", 2)];
const o2Items = [line("harborline-tuna-pate-cat", 1), line("whiskerwell-catnip-crunchies", 1)];
const o3Items = [line("freshgrin-dental-chews-dog", 1), line("vitalcoat-omega-3-softgels", 1)];
const o4Items = [line("vetline-hypoallergenic-cat-dry", 2)];

export const orders: SeedOrder[] = [
  {
    id: "o1",
    userId: "u1",
    status: "delivered",
    paymentStatus: "paid",
    paymentRef: "demo_pay_o1",
    ...totals(o1Items, 0),
    ...MAYA_ADDRESS,
    deliveryInstructions: "Leave with the front desk if I'm out.",
    carrier: "Leash Delivery",
    trackingNumber: "LEASH-4471-0921",
    placedAt: hoursAgo(14 * 24),
    estimatedDeliveryAt: hoursAgo(11 * 24),
    deliveredAt: hoursAgo(11 * 24 + 3),
    items: o1Items,
    events: [
      { status: "paid", label: "Payment confirmed", description: "We've received your payment.", location: null, occurredAt: hoursAgo(336) },
      { status: "processing", label: "Preparing your order", description: "Picking items in the fulfilment centre.", location: "Austin, TX", occurredAt: hoursAgo(335) },
      { status: "packed", label: "Packed", description: "Your order is boxed and labelled.", location: "Austin, TX", occurredAt: hoursAgo(330) },
      { status: "shipped", label: "Shipped", description: "Handed to the carrier.", location: "Austin, TX", occurredAt: hoursAgo(312) },
      { status: "out_for_delivery", label: "Out for delivery", description: "On the van and heading your way.", location: "Austin, TX", occurredAt: hoursAgo(288) },
      { status: "delivered", label: "Delivered", description: "Left with the front desk.", location: "1204 Grove Street, Austin, TX", occurredAt: hoursAgo(276) },
    ],
  },
  {
    id: "o2",
    userId: "u1",
    status: "out_for_delivery",
    paymentStatus: "paid",
    paymentRef: "demo_pay_o2",
    ...totals(o2Items, 599),
    ...MAYA_ADDRESS,
    deliveryInstructions: "",
    carrier: "Leash Delivery",
    trackingNumber: "LEASH-4471-1188",
    placedAt: hoursAgo(50),
    estimatedDeliveryAt: hoursAhead(10),
    deliveredAt: null,
    items: o2Items,
    events: [
      { status: "paid", label: "Payment confirmed", description: "We've received your payment.", location: null, occurredAt: hoursAgo(50) },
      { status: "processing", label: "Preparing your order", description: "Picking items in the fulfilment centre.", location: "Austin, TX", occurredAt: hoursAgo(49) },
      { status: "packed", label: "Packed", description: "Your order is boxed and labelled.", location: "Austin, TX", occurredAt: hoursAgo(44) },
      { status: "shipped", label: "Shipped", description: "Handed to the carrier.", location: "Austin, TX", occurredAt: hoursAgo(26) },
      { status: "out_for_delivery", label: "Out for delivery", description: "On the van and heading your way.", location: "Austin, TX", occurredAt: hoursAgo(2) },
    ],
  },
  {
    id: "o3",
    userId: "u1",
    status: "processing",
    paymentStatus: "paid",
    paymentRef: "demo_pay_o3",
    ...totals(o3Items, 599),
    ...MAYA_ADDRESS,
    deliveryInstructions: "",
    carrier: null,
    trackingNumber: null,
    placedAt: hoursAgo(3),
    estimatedDeliveryAt: hoursAhead(57),
    deliveredAt: null,
    items: o3Items,
    events: [
      { status: "paid", label: "Payment confirmed", description: "We've received your payment.", location: null, occurredAt: hoursAgo(3) },
      { status: "processing", label: "Preparing your order", description: "Picking items in the fulfilment centre.", location: "Austin, TX", occurredAt: hoursAgo(2) },
    ],
  },
  {
    id: "o4",
    userId: "u3",
    status: "shipped",
    paymentStatus: "paid",
    paymentRef: "demo_pay_o4",
    ...totals(o4Items, 0),
    ...PRIYA_ADDRESS,
    deliveryInstructions: "Side gate is unlocked.",
    carrier: "Leash Delivery",
    trackingNumber: "LEASH-8820-3310",
    placedAt: hoursAgo(30),
    estimatedDeliveryAt: hoursAhead(30),
    deliveredAt: null,
    items: o4Items,
    events: [
      { status: "paid", label: "Payment confirmed", description: "We've received your payment.", location: null, occurredAt: hoursAgo(30) },
      { status: "processing", label: "Preparing your order", description: "Picking items in the fulfilment centre.", location: "Denver, CO", occurredAt: hoursAgo(29) },
      { status: "packed", label: "Packed", description: "Your order is boxed and labelled.", location: "Denver, CO", occurredAt: hoursAgo(24) },
      { status: "shipped", label: "Shipped", description: "Handed to the carrier.", location: "Denver, CO", occurredAt: hoursAgo(6) },
    ],
  },
];
