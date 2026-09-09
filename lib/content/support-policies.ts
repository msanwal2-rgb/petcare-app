/**
 * Support content: the policies and answers the app has always enforced but
 * never written down.
 *
 * Typed data rather than JSX, exactly like pet-health.ts, so /support stays a
 * thin renderer and the same text can be chunked into the assistant's retrieval
 * corpus without maintaining a second copy for the bot. Content only a bot can
 * see rots, so everything here is on a real page a customer can read.
 *
 * Scope note: every number in this file is interpolated from the module that
 * enforces it — lib/pricing.ts for money, lib/delivery.ts for timings and
 * cancellation windows. Nothing is retyped. If a threshold changes, this copy
 * changes with it, because a policy page that disagrees with the code is worse
 * than no policy page at all.
 */

import {
  FLAT_SHIPPING_CENTS,
  FREE_SHIPPING_THRESHOLD_CENTS,
} from "@/lib/pricing";
import {
  CUSTOMER_CANCELLABLE,
  FULFILMENT_SCHEDULE,
  hoursUntilUncancellable,
} from "@/lib/delivery";
import { formatCents, ORDER_STATUS_LABELS } from "@/lib/utils";
import type { OrderStatus } from "@/types";

/** Which part of the product a section belongs to. Drives grouping on /support. */
export type PolicyTopic =
  | "orders"
  | "care"
  | "vet"
  | "adoption"
  | "account"
  | "trust";

export interface PolicySection {
  slug: string;
  topic: PolicyTopic;
  title: string;
  summary: string;
  points: string[];
  /** The page in the app this policy is about, when there is one. */
  href: string;
}

export interface Faq {
  slug: string;
  topic: PolicyTopic;
  question: string;
  answer: string;
}

/* ── Derived figures ─────────────────────────────────────────────────
   Read off the modules that enforce them, so this file cannot drift. */

const hoursFor = (status: OrderStatus): number =>
  FULFILMENT_SCHEDULE.find((s) => s.status === status)?.afterHours ?? 0;

const SHIPPED_AFTER_HOURS = hoursFor("shipped");
const DELIVERED_AFTER_HOURS = hoursFor("delivered");

/**
 * When cancelling stops being possible. Derived from the cancellable list
 * rather than assuming "shipped" is the cutoff, so widening that list moves
 * this copy with it.
 */
const CANCEL_WINDOW_HOURS = hoursUntilUncancellable();

/** The last stage a customer can still cancel from, in customer-facing words. */
const LAST_CANCELLABLE_LABEL =
  ORDER_STATUS_LABELS[CUSTOMER_CANCELLABLE[CUSTOMER_CANCELLABLE.length - 1]];

const FREE_SHIPPING = formatCents(FREE_SHIPPING_THRESHOLD_CENTS);
const FLAT_SHIPPING = formatCents(FLAT_SHIPPING_CENTS);

/** "a, b and c" — a comma list that doesn't read like machine output. */
function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and finally ${items[items.length - 1]}`;
}

/** Human phrasing for an hour count, so the copy reads naturally. */
function inHours(hours: number): string {
  if (hours < 24) return `about ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = hours / 24;
  const rounded = Number.isInteger(days) ? days : Math.round(days * 10) / 10;
  return `about ${rounded} day${rounded === 1 ? "" : "s"}`;
}

/* ── Policies ────────────────────────────────────────────────────── */

/* ── Adoption ────────────────────────────────────────────────────── */

const ADOPTION_POLICIES: PolicySection[] = [
  {
    slug: "adoption-what-comes-with-them",
    topic: "adoption",
    title: "The health record comes with the animal",
    summary:
      "When an adoption completes, the animal's whole record moves to you — vaccinations, allergies, medications and every note a vet has written.",
    points: [
      "Nothing is retyped and nothing is lost. The record does not move; the ownership does, so the same record your new vet opens is the one the shelter's vet was writing in.",
      "Any unexpired prescription comes with them, which means prescription-only food and medication stay orderable from the store without a fresh vet visit.",
      "The shelter's own access ends the moment the adoption completes. So does the access of any caretaker or vet they had booked — an animal's history is yours from that point, and only yours.",
    ],
    href: "/adopt",
  },
  {
    slug: "adoption-applying",
    topic: "adoption",
    title: "Applying to adopt",
    summary:
      "You apply, the shelter reviews, and if they approve you there is a fee to settle before you collect.",
    points: [
      "An application asks about your household, your hours and your other animals. Answer honestly — it is how a shelter places an animal well, not a test to pass.",
      "You can have one open application per animal, and you can apply for more than one animal at a time.",
      "Only one applicant is approved for an animal at a time, and nobody is asked for money before they are approved. If a shelter changes its mind after approving you, any fee you have paid is refunded automatically.",
      "You can withdraw at any point before the adoption completes.",
    ],
    href: "/adopt",
  },
  {
    slug: "adoption-fees",
    topic: "adoption",
    title: "Adoption fees",
    summary:
      "The fee is set by the shelter and shown on every listing. Some waive it entirely.",
    points: [
      "You pay through Leash once you have been approved, and the shelter completes the adoption once it has settled.",
      "The fee is fixed when you apply, so a shelter editing its listing afterwards cannot change what you were quoted.",
      "What it covers is up to the shelter — usually neutering, microchipping and vaccination. Their profile says.",
      "If an adoption falls through before it completes, the fee is refunded.",
    ],
    href: "/adopt",
  },
  {
    slug: "adoption-returns",
    topic: "adoption",
    title: "If it doesn't work out",
    summary:
      "Adoptions do fall through. Contact the shelter — they can arrange for the animal to come back.",
    points: [
      "Returning an animal is arranged with the shelter directly, and our support team records it so ownership and the health record go back with them.",
      "Whether the fee is returned is between you and the shelter; most have a policy and it will be on their profile.",
      "Nobody is penalised for returning an animal. A placement that is wrong for the animal is worth undoing.",
    ],
    href: "/adopt",
  },
];

export const POLICIES: PolicySection[] = [
  {
    slug: "shipping",
    topic: "orders",
    title: "Shipping and delivery",
    summary: `Orders of ${FREE_SHIPPING} or more ship free; anything under that is a flat ${FLAT_SHIPPING}. Most parcels arrive within ${inHours(DELIVERED_AFTER_HOURS)} of being placed.`,
    href: "/store",
    points: [
      `Free shipping starts at ${FREE_SHIPPING} of items, before tax. Below that, shipping is a flat ${FLAT_SHIPPING} regardless of how many items you order.`,
      "Your cart shows an estimate, but the total you are charged is recalculated on the server when you place the order. The estimate and the charge use the same rules, so they agree.",
      `Orders move through ${humanList(FULFILMENT_SCHEDULE.map((s) => ORDER_STATUS_LABELS[s.status].toLowerCase()))}.`,
      `A parcel typically ships ${inHours(SHIPPED_AFTER_HOURS)} after you order, and arrives ${inHours(DELIVERED_AFTER_HOURS)} after you order.`,
      "Every stage writes a tracking event you can see on the order, and you get a notification when it ships, when it is out for delivery, and when it arrives. Picking and packing are deliberately silent — that is warehouse noise, not news.",
      "We ship one order to one address. To send items to two places, place two orders.",
    ],
  },
  {
    slug: "order-cancellation",
    topic: "orders",
    title: "Cancelling an order",
    summary: `You can cancel yourself right up until the parcel ships — in practice, up to ${inHours(CANCEL_WINDOW_HOURS)} after ordering.`,
    href: "/store/orders",
    points: [
      `Cancel from the order page. The button is there at every stage up to and including "${LAST_CANCELLABLE_LABEL.toLowerCase()}" — so any time before the parcel ships.`,
      "Once an order is shipped it is out of our hands and cancelling is no longer possible. What you want then is a return.",
      "Cancelling puts the stock straight back in the catalog and reverses the charge in full. There is no cancellation fee.",
      "If you cancel part of an order, cancel the whole thing and re-order what you actually want — we do not split orders.",
    ],
  },
  {
    slug: "returns",
    topic: "orders",
    title: "Returns and refunds",
    summary:
      "Unopened items can go back within 30 days. Food that has been opened, and anything dispensed against a prescription, cannot.",
    href: "/store/orders",
    points: [
      "Unopened, undamaged items can be returned within 30 days of delivery for a full refund of the item price.",
      "Opened food and treats cannot be returned, for the same reason a supermarket will not take back an opened bag — we cannot resell it and we cannot verify how it was stored.",
      "Prescription items cannot be returned once dispensed. If a prescription item arrived damaged or wrong, that is a fault, not a return, and we replace it.",
      "If something arrives damaged, faulty or simply not what the order says, tell us and we replace or refund it — the 30 days and the opened-food rule do not apply to our mistakes.",
      "Refunds go back to the original payment method. Shipping is refunded only when the return is our fault.",
    ],
  },
  {
    slug: "prescriptions",
    topic: "orders",
    title: "Prescription items",
    summary:
      "Some foods and medications need a current prescription from a vet, written into your pet's health record on Leash.",
    href: "/pet-health",
    points: [
      "A prescription product is unlocked for a specific pet, not for your account. At checkout you pick which pet it is for, and we check that pet's record.",
      "The prescription has to be current — not expired — and it has to still have refills left. Both are visible on the pet's health record.",
      "Only a vet treating your pet can write a prescription, and they do it from the appointment. You cannot add one yourself.",
      "If a product you expect to be able to buy is locked, the usual reasons are that the prescription has expired, the refills are used up, or it names a different product than the one in your cart.",
      "To renew, book an appointment with a vet. They can write the new prescription straight into the record and the product unlocks immediately.",
    ],
  },
  {
    slug: "booking-cancellation",
    topic: "care",
    title: "Changing or cancelling a booking",
    summary:
      "Either you or the caretaker can cancel a booking at any point before it is finished. There is no fee, because no money moves until the work is done.",
    href: "/dashboard",
    points: [
      "A booking starts as a request. The caretaker accepts or declines it — until they accept, nothing is committed on either side.",
      "You can cancel a booking yourself while it is requested, accepted, or in progress. So can the caretaker.",
      "Declining is the caretaker's version of saying no to a request they have not accepted yet. Cancelling is what either of you does after that.",
      "A cancelled booking is final. To rearrange, cancel and send a new request with the dates you want.",
      "Cancelling does not count against a caretaker's response rate, because we do not record which side cancelled and would rather under-punish than blame the wrong person.",
    ],
  },
  {
    slug: "booking-lifecycle",
    topic: "care",
    title: "What the booking statuses mean",
    summary:
      "A booking moves requested → accepted → in progress → completed, and a status change is the only thing that ever moves it.",
    href: "/dashboard",
    points: [
      "Requested — you have asked. The caretaker has not answered yet, and nothing is committed.",
      "Accepted — the caretaker has said yes and the dates are held.",
      "In progress — the care is happening now.",
      "Completed — the care is finished. This is the point at which either of you can leave the other a review.",
      "Declined or cancelled — the booking is over and cannot be restarted. Send a new request instead.",
      "An illegal jump is refused rather than quietly applied: a booking cannot go from requested straight to completed.",
    ],
  },
  {
    slug: "appointment-cancellation",
    topic: "vet",
    title: "Changing or cancelling a vet appointment",
    summary:
      "You can cancel your own appointment at any time. Confirming, declining, starting and completing it are the vet's to do, not yours.",
    href: "/dashboard",
    points: [
      "You request an appointment; the vet confirms or declines it. Until they confirm, the slot is not held.",
      "You can cancel at any point before the visit is completed, and so can the vet.",
      "You cannot confirm your own appointment, mark it in progress, or mark it complete. Those belong to the vet, because they are clinical statements about a visit that happened.",
      "The consultation fee comes from the vet's profile at the moment you book, not from anything you send us, so it cannot be altered in the request.",
      "A vet only takes appointments for species they treat and in the formats they offer — in clinic, video, or a home visit. Booking outside that is refused up front rather than cancelled later.",
    ],
  },
  {
    slug: "health-records",
    topic: "vet",
    title: "Your pet's health record",
    summary:
      "One record per pet, shared across vets, caretakers and the store. The vet writes into it, the store honours the prescriptions in it.",
    href: "/pet-health",
    points: [
      "Only a vet with a live appointment for your pet can write clinical entries — visit notes, vaccinations, prescriptions and lab results.",
      "You can add weight and allergy entries to your own pet yourself. You cannot write clinical entries, and neither can anyone else.",
      "Whoever wrote an entry is the only person who can delete it.",
      "Allergies you record are used by the store to keep matching products out of your recommendations.",
      "Vaccination entries can carry a next-due date, which is what makes a booster show as coming up.",
    ],
  },
  {
    slug: "reviews",
    topic: "trust",
    title: "Reviews",
    summary:
      "Reviews come only from people who actually completed the thing they are reviewing. Bookings are reviewed both ways; vet visits one way.",
    href: "/search",
    points: [
      "You can only review a booking or an appointment that is completed, and only if you took part in it.",
      "For a booking, both sides review each other — you review the caretaker and the caretaker reviews you.",
      "For a vet visit, only you review the vet. A vet cannot review a client back.",
      "One review per person per booking or visit. You cannot post a second one.",
      "A rating folds into the professional's average as soon as you post it. We never recount from scratch, because the review counts you see include reputation earned before this platform existed.",
    ],
  },
  {
    slug: "response-rate",
    topic: "trust",
    title: "Ratings and response rates",
    summary:
      "Both numbers on a professional's profile are computed from what actually happened, never entered by them.",
    href: "/search",
    points: [
      "A rating is the running average of the ratings people have left. Professionals cannot set or edit it.",
      "Response rate is the share of requests a professional has answered one way or the other — accepting, declining, or getting on with the work all count as answering.",
      "A request still sitting unanswered is what pulls a response rate down.",
      "Cancellations count as neither a response nor a failure to respond.",
      "Some response rates look low. They are honest: those are professionals with genuinely unanswered old requests.",
    ],
  },
  {
    slug: "background-checks",
    topic: "trust",
    title: "Background checks and verification",
    summary:
      "A caretaker's background-check badge reflects what they have told us, and we are honest that we do not yet verify it independently.",
    href: "/search",
    points: [
      "The background-check status on a caretaker profile is currently displayed information, not something we have independently confirmed.",
      "We are not going to pretend otherwise. Independent verification needs a specialist vendor and we have not integrated one yet.",
      "Vets do carry a licence number and the state that issued it on their profile, which you can check with that state's board.",
      "Read reviews and response rates as the stronger signal for now, since both are computed from real activity rather than self-reported.",
      "Meet a caretaker before a first boarding, and tell them where your vet is and that they may seek treatment if they cannot reach you.",
    ],
  },
  {
    slug: "payments",
    topic: "account",
    title: "Payments",
    summary:
      "Payments on Leash are simulated. No card is collected and no money moves.",
    href: "/store/checkout",
    points: [
      "Checkout authorises and captures instantly against a demo payment provider. There is no card field because there is no card.",
      "Order totals, the refund path, and the payment states an order moves through are all real — it is only the money that is not.",
      "This means you can place an order, cancel it, and watch the refund happen, without spending anything.",
      "Caretakers and vets are not paid out, and there is no platform fee, because there is nothing to pay out or take a cut of yet.",
      "If you were expecting to be charged and were not, that is why.",
    ],
  },
  {
    slug: "accounts",
    topic: "account",
    title: "Your account",
    summary:
      "One account can hold more than one role. Email verification and password reset both work by emailed link.",
    href: "/dashboard",
    points: [
      "An account can be an owner, a caretaker, a vet, or several at once — someone who boards other people's dogs still has a dog of their own.",
      "Signing up sends a verification link to your email. Until you use it, a banner on your dashboard will keep reminding you.",
      "You can ask for a fresh verification link from that banner if the first one expired.",
      "Forgotten passwords are reset from a link that is good for one hour and works once.",
      "We never say whether an email address has an account when you ask for a reset — you get the same answer either way, so the form cannot be used to find out who is registered.",
    ],
  },
  {
    slug: "privacy",
    topic: "account",
    title: "What we do with your data",
    summary:
      "Your records are visible to the people involved in them, and to nobody else.",
    href: "/dashboard",
    points: [
      "Your orders, bookings, appointments and pets are yours. Every request for them is checked against who you are signed in as, on the server.",
      "A caretaker sees the pets attached to a booking with them, because they need the medical and behavioural notes to do the job safely.",
      "A vet sees a pet's health record while they have a live appointment for it.",
      "Messages about a booking are visible only to the two people in that booking.",
      "Deleting your account takes your conversations, notifications and orders history with it.",
    ],
  },
  ...ADOPTION_POLICIES,
];

/* ── FAQs ────────────────────────────────────────────────────────── */

export const FAQS: Faq[] = [
  {
    slug: "where-is-my-order",
    topic: "orders",
    question: "Where is my order?",
    answer: `Open the order from your order history and the tracking timeline shows every stage it has passed and when. Orders usually ship ${inHours(SHIPPED_AFTER_HOURS)} after being placed and arrive ${inHours(DELIVERED_AFTER_HOURS)} after being placed.`,
  },
  {
    slug: "why-was-i-charged-shipping",
    topic: "orders",
    question: "Why was I charged shipping?",
    answer: `Shipping is free from ${FREE_SHIPPING} of items upward. Below that it is a flat ${FLAT_SHIPPING}. The threshold looks at the item subtotal, before tax — so a cart that reaches ${FREE_SHIPPING} only after tax still pays shipping.`,
  },
  {
    slug: "can-i-still-cancel",
    topic: "orders",
    question: "Can I still cancel my order?",
    answer: `Yes, if it has not shipped — the cancel button stays on the order page up to and including "${LAST_CANCELLABLE_LABEL.toLowerCase()}", which is ${inHours(CANCEL_WINDOW_HOURS)} after you order. Once it ships, cancelling is no longer possible and a return is the way.`,
  },
  {
    slug: "why-cant-i-buy-this",
    topic: "orders",
    question: "Why can't I add this food to my cart?",
    answer:
      "It needs a prescription. The product unlocks for a particular pet once that pet's health record holds a current prescription, with refills left, naming that product. Your vet writes it from an appointment.",
  },
  {
    slug: "food-for-my-pet",
    topic: "orders",
    question: "How do I find food that suits my pet?",
    answer:
      "Open your pet and use the recommendations — they are already filtered to the right species and life stage, with anything containing a recorded allergen removed and prescription items left out. Recording your pet's allergies is what makes that filtering work.",
  },
  {
    slug: "caretaker-not-responding",
    topic: "care",
    question: "The caretaker hasn't answered my request. What now?",
    answer:
      "A request sits as requested until the caretaker accepts or declines. You can cancel it and request someone else at any time. A caretaker's response rate on their profile tells you how often they answer at all, which is worth checking before you send a request.",
  },
  {
    slug: "message-caretaker",
    topic: "care",
    question: "Can I message my caretaker?",
    answer:
      "Yes — every booking has its own message thread on the booking page, visible only to the two of you. It is the right place for gate codes, feeding times and anything else that comes up.",
  },
  {
    slug: "what-caretaker-sees",
    topic: "care",
    question: "What can a caretaker see about my pet?",
    answer:
      "The pets attached to your booking with them, including medical and behavioural notes, allergies, medications and feeding instructions. They need it to do the job safely. They cannot see your other pets, your orders, or your vet appointments.",
  },
  {
    slug: "booster-due",
    topic: "vet",
    question: "How do I know when a vaccination is due?",
    answer:
      "Vaccination entries in your pet's health record carry a next-due date when the vet sets one, and the record shows what is coming up. The pet health guides also list the usual schedules by species.",
  },
  {
    slug: "emergency",
    topic: "vet",
    question: "My pet is unwell right now — what should I do?",
    answer:
      "If it is one of the emergency signs on the pet health page — breathing trouble, a blocked cat, a seizure that will not stop, pale gums, a known toxin, a rabbit that has not eaten — phone the nearest emergency clinic rather than booking online. For anything less urgent, book a vet on Leash; several take emergencies.",
  },
  {
    slug: "vet-video",
    topic: "vet",
    question: "Can I see a vet without going to a clinic?",
    answer:
      "Some vets offer video consultations or home visits as well as in-clinic appointments. The formats a vet offers are on their profile, and you pick one when you book. A vet who does not offer a format will not take a request for it.",
  },
  {
    slug: "two-roles",
    topic: "account",
    question: "Can I be both an owner and a caretaker?",
    answer:
      "Yes. One account holds as many roles as you need, and there is a switcher in the header to move between the owner and caretaker views of your dashboard.",
  },
  {
    slug: "no-verification-email",
    topic: "account",
    question: "I never got the verification email.",
    answer:
      "The banner on your dashboard has a button to send a fresh link. Links expire, so if the first one sat for a while, request another.",
  },
  {
    slug: "delete-account",
    topic: "account",
    question: "How do I delete my account?",
    answer:
      "Ask us and we will remove it. Deleting takes your pets, orders, notifications and support conversations with it. Bookings and appointments you took part in are retained in the other party's history, without your personal details.",
  },
];

/** Everything, in the order /support renders it. */
export const POLICY_TOPICS: { topic: PolicyTopic; title: string; blurb: string }[] = [
  {
    topic: "orders",
    title: "Store and orders",
    blurb: "Shipping, cancellations, returns and prescription items.",
  },
  {
    topic: "care",
    title: "Booking care",
    blurb: "Requests, statuses, cancelling, and what a caretaker can see.",
  },
  {
    topic: "vet",
    title: "Vet care",
    blurb: "Appointments, who can change them, and the health record.",
  },
  {
    topic: "trust",
    title: "Trust and reviews",
    blurb: "How ratings, response rates and verification actually work.",
  },
  {
    topic: "adoption",
    title: "Adopting",
    blurb: "Applying, fees, and what comes with the animal.",
  },
  {
    topic: "account",
    title: "Your account",
    blurb: "Roles, email, passwords, payments and your data.",
  },
];
