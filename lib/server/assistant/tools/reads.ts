/**
 * Read tools: what the assistant may look up.
 *
 * Every tool here that touches an account opens with a guard from ../guards,
 * and none of them accept a user id — `uid` arrives in the context and is
 * captured in the closure. See ./index.ts for the full argument.
 *
 * Results go through ../present, which formats money and statuses into the
 * words the UI uses. The model never sees a raw cent value.
 */

import { tool } from "ai";
import { z } from "zod";
import type { AssistantContext } from "../context";
import {
  assertBookingParticipant,
  assertAppointmentParticipant,
  assertCanReadPetRecords,
  assertOwnsOrder,
  assertOwnsPet,
  requireSignedIn,
} from "../guards";
import {
  presentAppointment,
  presentBooking,
  presentOrder,
  presentPet,
  presentPrescription,
  presentProduct,
  presentRecord,
} from "../present";
import { searchKnowledge } from "../retrieval";
import type { EmbedFn } from "../embed";
import { getOrderById, getOrdersByUser } from "@/lib/server/orders";
import { getBookingById, getBookingsByCaretaker, getBookingsByOwner } from "@/lib/server/bookings";
import {
  getAppointmentById,
  getAppointmentsByOwner,
  getAppointmentsByVet,
} from "@/lib/server/appointments";
import { getPetById, getPetsByOwner } from "@/lib/server/pets";
import { activePrescriptions, getRecordsForPet } from "@/lib/server/medical-records";
import { getProductBySlug, recommendedForPet, searchProducts } from "@/lib/server/products";
import { searchCaretakers } from "@/lib/server/caretakers";
import { searchVets } from "@/lib/server/vets";
import { getCaretakerByUserId } from "@/lib/server/caretakers";
import { getVetByUserId } from "@/lib/server/vets";
import { listNotifications, unreadCount } from "@/lib/server/notifications";
import { formatCents } from "@/lib/utils";
import {
  FLAT_SHIPPING_CENTS,
  FREE_SHIPPING_THRESHOLD_CENTS,
} from "@/lib/pricing";
import { FULFILMENT_SCHEDULE, hoursUntilUncancellable } from "@/lib/delivery";
import { ORDER_STATUS_LABELS } from "@/lib/utils";

/** Options a caller may thread through, mainly so tests can inject an embedder. */
export interface ToolDeps {
  embed?: EmbedFn;
  schema?: string;
}

export function readTools(ctx: AssistantContext, deps: ToolDeps = {}) {
  return {
    /* ── The customer's own records ──────────────────────────────── */

    getMyOrders: tool({
      description:
        "List the signed-in customer's recent orders, newest first. Use this for 'where is my order' before asking which one they mean — often there is only one in flight.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(10).default(5)
          .describe("How many recent orders to return."),
      }),
      execute: async ({ limit }) => {
        const uid = requireSignedIn(ctx);
        if (typeof uid !== "string") return uid;
        const orders = await getOrdersByUser(uid, ctx.db);
        return { orders: orders.slice(0, limit).map((order) => presentOrder(order)) };
      },
    }),

    getOrder: tool({
      description:
        "Full detail for one order: line items, totals, the delivery tracking timeline, and whether it can still be cancelled.",
      inputSchema: z.object({
        orderId: z.string().describe("The order id, e.g. o_abc123."),
      }),
      execute: async ({ orderId }) => {
        const uid = await assertOwnsOrder(ctx, orderId);
        if (typeof uid !== "string") return uid;
        const order = await getOrderById(orderId, ctx.db);
        if (!order) return { error: "not_found" as const };
        return presentOrder(order, { detailed: true });
      },
    }),

    getMyBookings: tool({
      description:
        "The signed-in customer's caretaker bookings. Pass as:'caretaker' when they are asking about work they are doing for other people rather than care they have booked.",
      inputSchema: z.object({
        as: z.enum(["owner", "caretaker"]).default("owner")
          .describe("Which side of the marketplace they are asking about."),
      }),
      execute: async ({ as }) => {
        const uid = requireSignedIn(ctx);
        if (typeof uid !== "string") return uid;

        if (as === "caretaker") {
          const profile = await getCaretakerByUserId(uid, ctx.db);
          if (!profile) {
            return { error: "not_allowed" as const, detail: "This account has no caretaker profile." };
          }
          const bookings = await getBookingsByCaretaker(profile.id, ctx.db);
          return { bookings: bookings.map(presentBooking) };
        }

        const bookings = await getBookingsByOwner(uid, ctx.db);
        return { bookings: bookings.map(presentBooking) };
      },
    }),

    getBooking: tool({
      description: "Detail for one booking the customer took part in.",
      inputSchema: z.object({ bookingId: z.string() }),
      execute: async ({ bookingId }) => {
        const uid = await assertBookingParticipant(ctx, bookingId);
        if (typeof uid !== "string") return uid;
        const booking = await getBookingById(bookingId, ctx.db);
        if (!booking) return { error: "not_found" as const };
        return presentBooking(booking);
      },
    }),

    getMyAppointments: tool({
      description:
        "The signed-in customer's vet appointments. Pass as:'vet' only when the account is a vet asking about their own schedule.",
      inputSchema: z.object({
        as: z.enum(["owner", "vet"]).default("owner"),
      }),
      execute: async ({ as }) => {
        const uid = requireSignedIn(ctx);
        if (typeof uid !== "string") return uid;

        if (as === "vet") {
          const profile = await getVetByUserId(uid, ctx.db);
          if (!profile) {
            return { error: "not_allowed" as const, detail: "This account has no vet profile." };
          }
          const appointments = await getAppointmentsByVet(profile.id, ctx.db);
          return { appointments: appointments.map(presentAppointment) };
        }

        const appointments = await getAppointmentsByOwner(uid, ctx.db);
        return { appointments: appointments.map(presentAppointment) };
      },
    }),

    getAppointment: tool({
      description: "Detail for one vet appointment the customer took part in.",
      inputSchema: z.object({ appointmentId: z.string() }),
      execute: async ({ appointmentId }) => {
        const uid = await assertAppointmentParticipant(ctx, appointmentId);
        if (typeof uid !== "string") return uid;
        const appointment = await getAppointmentById(appointmentId, ctx.db);
        if (!appointment) return { error: "not_found" as const };
        return presentAppointment(appointment);
      },
    }),

    getMyPets: tool({
      description:
        "The signed-in customer's pets, with age, allergies and medications. Use this to turn a name like 'Luna' into a pet id.",
      inputSchema: z.object({}),
      execute: async () => {
        const uid = requireSignedIn(ctx);
        if (typeof uid !== "string") return uid;
        const pets = await getPetsByOwner(uid, ctx.db);
        return { pets: pets.map((pet) => presentPet(pet, ctx.now)) };
      },
    }),

    getPetHealthRecord: tool({
      description:
        "A pet's health record: visits, vaccinations with next-due dates, weights and allergies. Available to the pet's owner, and to a vet currently treating it.",
      inputSchema: z.object({ petId: z.string() }),
      execute: async ({ petId }) => {
        const access = await assertCanReadPetRecords(ctx, petId);
        if ("error" in access) return access;
        const records = await getRecordsForPet(petId, ctx.db);
        return { records: records.map(presentRecord) };
      },
    }),

    getActivePrescriptions: tool({
      description:
        "Current prescriptions for a pet — what they unlock in the store, how many refills remain, and when they expire. This is the answer to 'why can't I buy this food'.",
      inputSchema: z.object({ petId: z.string() }),
      execute: async ({ petId }) => {
        const uid = await assertOwnsPet(ctx, petId);
        if (typeof uid !== "string") return uid;
        const records = await activePrescriptions(petId, ctx.now.toISOString(), ctx.db);
        return {
          prescriptions: records.map((record) => presentPrescription(record, ctx.now)),
        };
      },
    }),

    getMyNotifications: tool({
      description: "The customer's recent notifications and how many are unread.",
      inputSchema: z.object({
        unreadOnly: z.boolean().default(false),
      }),
      execute: async ({ unreadOnly }) => {
        const uid = requireSignedIn(ctx);
        if (typeof uid !== "string") return uid;
        const [items, unread] = await Promise.all([
          listNotifications(uid, ctx.db),
          unreadCount(uid, ctx.db),
        ]);
        const filtered = unreadOnly ? items.filter((item) => !item.readAt) : items;
        return {
          unread,
          notifications: filtered.slice(0, 10).map((item) => ({
            title: item.title,
            detail: item.body,
            href: item.href,
            read: Boolean(item.readAt),
          })),
        };
      },
    }),

    /* ── Public: no sign-in required ─────────────────────────────── */

    searchProducts: tool({
      description:
        "Search the store catalog. Prices and stock are live. Use this rather than describing products from memory.",
      inputSchema: z.object({
        q: z.string().optional().describe("Free text, e.g. 'grain free salmon'."),
        species: z.enum(["dog", "cat", "other"]).optional(),
        lifeStage: z.enum(["puppy", "kitten", "adult", "senior", "all"]).optional(),
        category: z
          .enum([
            "dry_food", "wet_food", "treats", "supplements",
            "prescription_diet", "dental", "accessories",
          ])
          .optional(),
        brand: z.string().optional(),
        maxPriceCents: z.number().int().positive().optional()
          .describe("Upper price bound in cents, e.g. 5000 for $50."),
        sort: z.enum(["featured", "price_asc", "price_desc", "rating", "newest"]).optional(),
        limit: z.number().int().min(1).max(6).default(4),
      }),
      execute: async (params) => {
        const page = await searchProducts(params, ctx.db);
        return {
          total: page.total,
          products: page.items.map(presentProduct),
        };
      },
    }),

    getProduct: tool({
      description: "One product by slug, with live price, stock and allergens.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => {
        const product = await getProductBySlug(slug, ctx.db);
        if (!product) return { error: "not_found" as const };
        return presentProduct(product);
      },
    }),

    recommendProductsForPet: tool({
      description:
        "Products matched to one pet: right species and life stage, recorded allergens excluded, prescription items left out.",
      inputSchema: z.object({
        petId: z.string(),
        limit: z.number().int().min(1).max(6).default(4),
      }),
      execute: async ({ petId, limit }) => {
        const uid = await assertOwnsPet(ctx, petId);
        if (typeof uid !== "string") return uid;
        const pet = await getPetById(petId, ctx.db);
        if (!pet) return { error: "not_found" as const };
        const products = await recommendedForPet(pet, limit, ctx.db);
        return { forPet: pet.name, products: products.map(presentProduct) };
      },
    }),

    searchCaretakers: tool({
      description: "Find caretakers for walking, sitting, boarding or daycare.",
      inputSchema: z.object({
        serviceType: z.enum(["walking", "sitting", "boarding", "daycare"]).optional(),
        species: z.enum(["dog", "cat", "other"]).optional(),
        maxPrice: z.number().positive().optional().describe("Max hourly or daily rate in dollars."),
        startDate: z.string().optional().describe("ISO date the care starts."),
        endDate: z.string().optional().describe("ISO date the care ends."),
      }),
      execute: async (params) => {
        const results = await searchCaretakers(params, ctx.db);
        return {
          caretakers: results.slice(0, 5).map((caretaker) => ({
            caretakerId: caretaker.id,
            name: caretaker.user.name,
            city: `${caretaker.user.address.city}, ${caretaker.user.address.state}`,
            services: caretaker.servicesOffered,
            rating: caretaker.rating.toFixed(1),
            reviews: caretaker.reviewCount,
            respondsTo: `${caretaker.responseRatePct}% of requests`,
            href: `/caretaker/${caretaker.id}`,
          })),
        };
      },
    }),

    searchVets: tool({
      description: "Find licensed vets, optionally by specialty or consultation format.",
      inputSchema: z.object({
        specialty: z
          .enum([
            "general", "dermatology", "dentistry", "surgery",
            "emergency", "nutrition", "behavior", "exotics",
          ])
          .optional(),
        species: z.enum(["dog", "cat", "other"]).optional(),
        mode: z.enum(["in_clinic", "video", "home_visit"]).optional(),
        emergencyOnly: z.boolean().optional(),
      }),
      execute: async (params) => {
        const results = await searchVets(params, ctx.db);
        return {
          vets: results.slice(0, 5).map((vet) => ({
            vetId: vet.id,
            name: vet.user.name,
            clinic: vet.clinicName,
            city: `${vet.clinic.city}, ${vet.clinic.state}`,
            specialties: vet.specialties,
            formats: vet.consultModes,
            takesEmergencies: vet.emergencyAvailable,
            fee: `$${vet.consultFee.toFixed(2)}`,
            rating: vet.rating.toFixed(1),
            href: `/vets/${vet.id}`,
          })),
        };
      },
    }),

    searchKnowledge: tool({
      description:
        "Search Leash's policies, FAQs and pet-health guides. Use this for any question about how the platform works — shipping, returns, cancellations, prescriptions, reviews, accounts — rather than answering from memory. An empty result means we have no policy on it; say so.",
      inputSchema: z.object({
        query: z.string().describe("The customer's question, in their own words."),
        topK: z.number().int().min(1).max(8).default(4),
      }),
      execute: async ({ query, topK }) => {
        const hits = await searchKnowledge(
          query,
          { topK, embed: deps.embed, schema: deps.schema },
          ctx.db,
        );
        return {
          found: hits.length,
          passages: hits.map((hit) => ({
            title: hit.title,
            text: hit.content,
            href: hit.href,
          })),
        };
      },
    }),

    getStoreFacts: tool({
      description:
        "The store's shipping thresholds, delivery timings and cancellation window. Cheap and always available — use it rather than recalling any of these numbers.",
      inputSchema: z.object({}),
      execute: async () => ({
        freeShippingFrom: formatCents(FREE_SHIPPING_THRESHOLD_CENTS),
        flatShipping: formatCents(FLAT_SHIPPING_CENTS),
        freeShippingAppliesTo: "the item subtotal, before tax",
        deliveryTimeline: FULFILMENT_SCHEDULE.map((stage) => ({
          stage: ORDER_STATUS_LABELS[stage.status],
          hoursAfterOrdering: stage.afterHours,
        })),
        cancellationWindowHours: hoursUntilUncancellable(),
        paymentsAreSimulated: true,
      }),
    }),
  };
}
