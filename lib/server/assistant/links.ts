/**
 * Deep links: the assistant's answer to anything it must not do itself.
 *
 * The rule this file exists to enforce is that the assistant never spends
 * money and never creates a commitment. Placing an order, booking a caretaker,
 * booking a vet, writing a health record — none of those have a tool. Instead
 * the assistant composes a link into the form the customer would have used
 * anyway, with the fields it already knows filled in, and the customer presses
 * the button.
 *
 * That is a deliberate trade. It is slightly less impressive in a demo and
 * substantially harder to get badly wrong: a hallucinated tool call produces a
 * dead link, not a booking someone did not ask for.
 *
 * Two things make the links themselves trustworthy:
 * - every id is validated against the database before it appears in a URL, so
 *   a link is never a 404;
 * - every destination is either a validated-id route or a member of a fixed
 *   enum, so the model cannot invent a path.
 */

import type { AssistantContext } from "./context";
import { refuse, requireSignedIn, assertOwnsPet, type Refusal } from "./guards";
import { getCaretakerById } from "@/lib/server/caretakers";
import { getVetById } from "@/lib/server/vets";
import type { ServiceType } from "@/types";

export interface DeepLink {
  kind: "deep_link";
  href: string;
  /** Button text. */
  label: string;
  /** One line the assistant should say alongside it. */
  summary: string;
}

function link(href: string, label: string, summary: string): DeepLink {
  return { kind: "deep_link", href, label, summary };
}

/**
 * Pages the assistant may send someone to with no parameters. An enum rather
 * than a free-text path, so a hallucinated URL is unrepresentable.
 */
export const KNOWN_PAGES = {
  home: "/",
  findCare: "/search",
  findVet: "/vets",
  store: "/store",
  cart: "/store/cart",
  orders: "/store/orders",
  petHealth: "/pet-health",
  support: "/support",
  dashboard: "/dashboard",
  addPet: "/dashboard/pets/new",
} as const;

export type KnownPage = keyof typeof KNOWN_PAGES;

const PAGE_LABELS: Record<KnownPage, string> = {
  home: "Home",
  findCare: "Find care",
  findVet: "Find a vet",
  store: "Browse the store",
  cart: "Your cart",
  orders: "Your orders",
  petHealth: "Pet health guides",
  support: "Help and policies",
  dashboard: "Your dashboard",
  addPet: "Add a pet",
};

export function openPage(page: KnownPage): DeepLink {
  return link(KNOWN_PAGES[page], PAGE_LABELS[page], `Opens ${PAGE_LABELS[page].toLowerCase()}.`);
}

/** Checkout. The assistant never places the order itself. */
export function startCheckout(ctx: AssistantContext): DeepLink | Refusal {
  const uid = requireSignedIn(ctx);
  if (typeof uid !== "string") return uid;
  return link(
    "/store/checkout",
    "Go to checkout",
    "Checkout is ready when you are — you place the order yourself, so nothing is charged until you do.",
  );
}

export async function startCaretakerBooking(
  ctx: AssistantContext,
  input: {
    caretakerId: string;
    serviceType?: ServiceType;
    startDateTime?: string;
    endDateTime?: string;
    petId?: string;
  },
): Promise<DeepLink | Refusal> {
  const uid = requireSignedIn(ctx);
  if (typeof uid !== "string") return uid;

  const caretaker = await getCaretakerById(input.caretakerId, ctx.db);
  if (!caretaker) return refuse("not_found", "No caretaker with that id.");

  if (input.petId) {
    const owns = await assertOwnsPet(ctx, input.petId);
    if (typeof owns !== "string") return owns;
  }

  const params = new URLSearchParams({ caretakerId: caretaker.id });
  if (input.serviceType) params.set("serviceType", input.serviceType);
  if (input.startDateTime) params.set("start", input.startDateTime);
  if (input.endDateTime) params.set("end", input.endDateTime);
  if (input.petId) params.set("petId", input.petId);

  return link(
    `/booking/new?${params.toString()}`,
    `Request ${caretaker.user.name}`,
    `This opens the booking form with what we discussed filled in. ${caretaker.user.name} still has to accept, and nothing is committed until they do.`,
  );
}

export async function startVetAppointment(
  ctx: AssistantContext,
  input: { vetId: string; date?: string; petId?: string },
): Promise<DeepLink | Refusal> {
  const uid = requireSignedIn(ctx);
  if (typeof uid !== "string") return uid;

  const vet = await getVetById(input.vetId, ctx.db);
  if (!vet) return refuse("not_found", "No vet with that id.");

  if (input.petId) {
    const owns = await assertOwnsPet(ctx, input.petId);
    if (typeof owns !== "string") return owns;
  }

  const params = new URLSearchParams({ vetId: vet.id });
  if (input.date) params.set("date", input.date);
  if (input.petId) params.set("petId", input.petId);

  return link(
    `/vets/book?${params.toString()}`,
    `Request ${vet.user.name}`,
    `This opens the appointment form, pre-filled. ${vet.user.name} confirms or declines it — booking it is their call, not mine.`,
  );
}

/** Sign-in, carrying the page the customer is on so they come back to it. */
export function signInLink(ctx: AssistantContext): DeepLink {
  return link(
    `/login?callbackUrl=${encodeURIComponent(ctx.path)}`,
    "Log in",
    "Signing in brings you back to this page, and then I can look that up.",
  );
}
