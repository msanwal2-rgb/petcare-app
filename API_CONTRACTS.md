# API Contracts — Pet Care Marketplace

Every endpoint the app exposes. Each function in `/lib/api/*` wraps exactly one
of these, and pages call **only** those functions.

- **Base URL:** `/api`
- **Auth:** enforced server-side in the route handlers, not in the client. Each
  table below names the rule. `401` when signed out, `403` when signed in as
  the wrong person, `409` on an illegal state transition.
- **Content type:** `application/json`
- **Types:** every shape below is defined in [`/types/index.ts`](./types/index.ts).
  `CaretakerWithUser` / `VetWithUser` are the profile joined with its `User`
  plus computed `priceRange` / `distanceMiles`.
- **Money:** booking and appointment prices are USD floats (legacy); everything
  in the store is **integer cents**.

---

## Users — `/lib/api/users.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/users/:id` | public | **`PublicUser`** · 404 — name, avatar, roles, city/state. It used to return the whole record, email and home coordinates included, against ids that count upward from `u1` |
| GET | `/api/users?ids=a,b,c` | signed in | `PublicUser[]`, capped at 50 ids |
| GET | `/api/users` | signed in, **development only** | `User[]` — returns every email, so it is refused in production |
| GET | `/api/me` | signed in | the authenticated `User` |
| POST | `/api/signup` | public | `User` (201) · 409 if the email is taken. The only way to create an account: hashes a password and sends a verification link |
| PATCH | `/api/users/:id` | self only | `User`. Accepts name, phone, avatar, roles and address — **not** `verified` (that was self-service privilege escalation) and not `email` (no re-verification flow exists) |

## Pets — `/lib/api/pets.ts`

| Method | Path | Request | Response | Called by |
|---|---|---|---|---|
| GET | `/api/owners/:ownerId/pets` | — | `Pet[]` | `/dashboard` (owner), `/booking/new` |
| GET | `/api/pets/:id` | — | `Pet` · 404 | the owner, or a caretaker/vet currently looking after it. Was public, and returned medications, allergies, behaviour notes and the household vet's phone |
| GET | `/api/pets?ids=a,b,c` | query `ids` (csv, max 50) | `Pet[]` — filtered to the ones you may see | `/booking/[id]`, caretaker request view |
| POST | `/api/owners/:ownerId/pets` | `PetInput` (`Pet` w/o `id`) | `Pet` (201) | `/dashboard/pets/new` |
| PATCH | `/api/pets/:id` | `Partial<PetInput>` | `Pet` | `/dashboard/pets/[id]` |

## Caretakers — `/lib/api/caretakers.ts`

| Method | Path | Request | Response | Called by |
|---|---|---|---|---|
| GET | `/api/caretakers/search` | query `{ lat?, lng?, radiusMiles?, serviceType?, species?, startDate?, endDate?, minPrice?, maxPrice? }` | `CaretakerWithUser[]` (sorted by distance when lat/lng given, else rating) | `/search` |
| GET | `/api/caretakers/:id` | — | `CaretakerWithUser` · 404 → `null` | `/caretaker/[id]`, `/booking/new`, `/booking/[id]` |
| GET | `/api/users/:userId/caretaker-profile` | — | `CaretakerProfile` · 404 → `null` | `/dashboard/caretaker-profile`, `/dashboard` |
| PATCH | `/api/caretakers/:id` (POST if none) | `Partial<CaretakerProfile>` | `CaretakerProfile` | `/dashboard/caretaker-profile` |

**Search notes for backend:** `startDate`/`endDate` filter to caretakers with at
least one open availability slot in range. `minPrice`/`maxPrice` compare against
the caretaker's price range across all services. When `lat`/`lng` provided,
compute distance (PostGIS radius query recommended per foundation §6) and sort
ascending; otherwise sort by rating descending.

## Bookings — `/lib/api/bookings.ts`

| Method | Path | Request | Response | Called by |
|---|---|---|---|---|
| GET | `/api/owners/:ownerId/bookings` | — | `Booking[]` (newest first) | `/dashboard` (owner) |
| GET | `/api/caretakers/:caretakerId/bookings` | — | `Booking[]` (newest first) | `/dashboard` (caretaker) |
| GET | `/api/bookings/:id` | — | `Booking` · 404 → `null` | `/booking/[id]` |
| POST | `/api/bookings` | `CreateBookingInput` — **no price** | `Booking` (201, status=`requested`) · 400 unknown caretaker/service/dates | `/booking/new` |
| PATCH | `/api/bookings/:id/status` | `{ status: BookingStatus }` | `Booking` | `/booking/[id]`, `/dashboard` (accept/decline), Confirm & Pay |

**Status lifecycle:** `requested → accepted → in_progress → completed`, with
`declined` (caretaker) and `cancelled` (either party) as terminal branches.

Two things are enforced separately, as they always were for appointments:
`TRANSITIONS` says what is reachable and `ACTOR_ALLOWED` says who may do it.
Accepting, declining, starting and completing belong to the **caretaker**;
either party may cancel. Without the second check an owner could accept and
complete their own booking, which feeds `refreshResponseRate` and unlocks the
review form.

`priceTotal` is **computed by the server** from the caretaker's `PricingEntry`
multiplied by the duration. It used to arrive in the request body as a bare
`z.number()`, so a booking could be created for $0 or a negative amount.

## Reviews — `/lib/api/reviews.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/users/:id/reviews[?kind=]` | public | `Review[]`, newest first. `kind` (`booking` \| `vet_appointment`) separates someone's caretaker reviews from their vet reviews |
| GET | `/api/bookings/:id/reviews` | public | `Review[]` |
| POST | `/api/bookings/:id/reviews` | a participant | `Review` (201) · 403 wrong author or recipient · 409 not complete / already reviewed. Bookings are reviewed **both ways** |

Who may review whom is re-derived from the subject, never trusted from the
body: the subject must exist and be `completed`, the author must have taken
part, the recipient must be the other party, and one author gets one review.
A posted rating is folded into the recipient's profile as a running average —
`reviewCount` includes reputation that predates this database, so recounting
from the rows would erase it.

---

---

## Vet care

### Vets — `/lib/api/vets.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/vets/search` | public | `VetWithUser[]`, sorted by distance when `lat`/`lng` are given, else rating. Filters: `specialty`, `species`, `mode`, `emergencyOnly`, `radiusMiles` |
| GET | `/api/vets/:id` | public | `VetWithUser` · 404 |
| GET | `/api/users/:id/vet-profile` | public | `VetProfile` · `null` |
| PATCH | `/api/users/:id/vet-profile` | self only | `VetProfile` (upsert). `rating`, `reviewCount` and `responseRatePct` are not accepted — they are derived |

### Appointments — `/lib/api/appointments.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| POST | `/api/appointments` | signed in, pet is yours | `VetAppointment` (201, `requested`). **No `fee` and no `ownerId`** — the fee comes off the vet's profile and the owner is whoever is signed in. 400 if the vet doesn't treat that species or offer that format; 409 `lead_time` if the slot is sooner than the caller may book |
| GET | `/api/appointments/:id` | participant | `VetAppointment` · 404 |
| PATCH | `/api/appointments/:id/status` | participant | `VetAppointment` · 409 illegal transition · 403 wrong party. Owner may `cancel`; only the vet may `confirm`, `decline`, start or complete |
| GET | `/api/owners/:ownerId/appointments` | self only | `VetAppointment[]` |
| GET | `/api/vets/:id/appointments` | that vet only | `VetAppointment[]` |

Lifecycle: `requested → confirmed → in_progress → completed`, with `declined`
and `cancelled` as terminal branches.

### Reviews — `/lib/api/reviews.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/appointments/:id/reviews` | public | `Review[]` |
| POST | `/api/appointments/:id/reviews` | the pet's owner | `Review` (201) · 403 wrong author or recipient · 409 not complete / already reviewed. **One direction only** — a vet cannot review the client back |

### Health records — `/lib/api/medical-records.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/pets/:id/medical-records` | pet's owner, or a vet with a live appointment for it | `MedicalRecord[]` |
| POST | `/api/pets/:id/medical-records` | as above; a treating vet may write any type, an owner only `weight` and `allergy` | `MedicalRecord` (201) |
| DELETE | `/api/medical-records/:id` | the record's author only | 204 |

An unexpired `prescription` record with refills left is what authorises the
product slugs it names in the store.

---

## Store

### Catalog — `/lib/api/products.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/products` | public | `ProductPage` — filters `q`, `category`, `species`, `lifeStage`, `brand`, `minPriceCents`, `maxPriceCents`; `sort`; `limit`/`offset` |
| GET | `/api/products/:slug` | public | `Product` · 404 |
| GET | `/api/brands` | public | `string[]` |
| GET | `/api/pets/:id/recommendations` | pet's owner | `Product[]` — right species and life stage, allergens excluded, no Rx items |

### Orders — `/lib/api/orders.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| POST | `/api/orders/quote` | signed in; `petId` must be yours | `CartQuote` — server-side re-pricing plus the prescription check |
| POST | `/api/orders` | signed in | `PlacedOrder` (201) — the order plus a `payment` block carrying the `clientSecret` the browser needs. The body carries items and an address, **never prices**. 409 with the quote when a line is unavailable, or with `productId` when stock ran out mid-checkout; 502 `payment_setup_failed` with the `orderId` when the provider could not be reached |
| GET | `/api/orders` | signed in | your `Order[]`, newest first |
| GET | `/api/orders/:id` | the customer, or ops | `Order` with items and the tracking timeline |
| POST | `/api/orders/:id/cancel` | the customer | `Order` · 409 once shipped. Returns the stock |
| PATCH | `/api/orders/:id/status` | **ops only** | `Order` · 409 illegal transition. Appends the tracking event |
| POST | `/api/orders/:id/payment/sync` | the customer | `Order` — re-checks with the provider. The confirmation page calls it because the browser knowing a card went through is not the same as the server knowing |
| GET | `/api/ops/orders` | **ops only** | the fulfilment queue, oldest first. Excludes `pending_payment`: an unpaid basket is not a parcel |

Lifecycle: `pending_payment → paid → processing → packed → shipped →
out_for_delivery → delivered`, with `cancelled` and `refunded` as terminal
branches.

`pending_payment` is where an order now *starts*. Checkout reserves the stock
and creates the order before any money moves, then creates a payment intent; the
order becomes `paid` when the provider says so, on a webhook. The previous order
of operations — charge, then write the row — meant a crash in between left a
real charge with no order and no trace of it anywhere.

Cancelling or refunding returns stock to the catalogue **only if the order never
shipped**; `delivered → refunded` is legal, and restocking it would credit
inventory for goods sitting in someone's house. Cancelling a paid order now also
refunds it, which it previously did not.

---

## Notifications — `/lib/api/notifications.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/notifications` | signed in | `{ items, unread }` — your own, newest first, capped at 30 |
| POST | `/api/notifications` | signed in | `{ unread }`. Body `{ id? }` — omit `id` to mark everything read. Scoped to you, so an id you don't own matches nothing |

Notifications are written only by the status machines, never by a client. The
owner hears when a caretaker accepts or declines, when a vet confirms, declines
or finishes a visit, and when an order ships, goes out for delivery or arrives.
Picking and packing are warehouse noise and are deliberately silent. Each one
carries an `href` to the thing it is about, and mirrors to email when
`RESEND_API_KEY` is set — best-effort, since a mail outage must not roll back
the thing being announced.

## Support assistant — `/lib/api/assistant.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| POST | `/api/assistant/chat` | **public** — a session changes what it can do, not whether it answers | A UI message stream (`text/event-stream`). 429 over the rate limit, 503 with no model credential or when `ASSISTANT_ENABLED=false` |
| GET | `/api/assistant/conversations/:id` | the thread's owner, or the anonymous client that made it | the conversation with its messages · 404 |
| DELETE | `/api/assistant/conversations/:id` | as above | 204 · 404 |

The chat endpoint is the one route in this app that is deliberately reachable
signed out, because a pre-sale question is worth answering. `proxy.ts` does not
match `/api/*`, so nothing upstream is enforcing anything here: the handler
resolves the session itself, and a null user id produces a **smaller tool set**
rather than a refusal. Every tool that touches an account re-checks ownership
against the database on every call.

Nothing the assistant can do creates a commitment. There is no tool that places
an order, creates a booking or appointment, writes a health record, posts a
review or touches fulfilment — those are returned as pre-filled links for the
customer to submit. The four write tools it does have all cancel something, and
each returns the domain function's own result, so a refused transition is
reported rather than narrated away.

A conversation belonging to someone else reads as 404, not 403, so ids cannot be
probed. Rate limits are counted in Postgres over a sliding window: 10/hour and
30/day for anonymous visitors keyed on a salted hash of IP and user agent,
40/hour and 200/day for signed-in customers keyed on their user id.


---

## Membership — `/lib/api/membership.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/membership` | signed in | `MembershipView` — what you're entitled to, and the plan you could buy |
| POST | `/api/membership/checkout` | signed in | `{ url }` — hosted checkout. 409 if already a member, 503 when the provider or the price isn't configured |
| POST | `/api/membership/cancel` | signed in | `{ ok, endsAt }` — at the end of the period already paid for |
| POST | `/api/membership/resume` | signed in | `{ ok }` — undo a cancellation that hasn't taken effect |
| POST | `/api/membership/portal` | signed in | `{ url }` — the provider's billing portal, for cards and invoices |
| POST | `/api/membership/sync` | signed in | `Membership` — for a slow or lost webhook |

**Leash Plus** grants three things, and all three are enforced server-side
rather than displayed:

- **free shipping** — `quoteCart` reads the membership itself and passes a
  boolean to `shippingFor`. There is no membership field in `quoteCartSchema` or
  `createOrderSchema`, so there is nothing for a client to claim.
- **a consultation discount** — `createAppointment` snapshots `baseFee`,
  `discountPct` and `fee`, so a membership that lapses later cannot rewrite what
  somebody was quoted.
- **priority booking** — members may request a slot 2 hours out; everyone else
  24. Same-day appointments are the benefit, not a badge.

Membership is **never a session claim**. Sessions are JWTs with no adapter, so
there is no row to invalidate: a `plus: true` claim would keep asserting itself
after a cancellation for the token's full thirty-day life, and the user decides
when to re-authenticate. Every pricing path reads the database.

Benefits survive a failed renewal for a grace window (`DUNNING_GRACE_DAYS`)
while the provider retries — a card expiring should not strip someone's free
shipping mid-order.

## Administration — `/lib/api/admin.ts`

Every endpoint opens with `requireStaff(role)`; every mutation writes an
`AdminAuditLog` row through `recordAdminAction()`, which is the only thing that
writes one.

| Method | Path | Role | Response |
|---|---|---|---|
| GET | `/api/admin/stats` | support | `AdminStats` |
| GET | `/api/admin/users` | support | `AdminUserPage` — `q`, `role`, `staffRole`, `status`, `verified`, `authMethod`, `sort`, `limit`/`offset` |
| GET | `/api/admin/users/:id` | support | `AdminUserDetail` — the account, its counts, its recent orders and its professional profiles in one round trip |
| PATCH | `/api/admin/users/:id` | support | `User`. One action per request: `verify`, `suspend`, `reactivate`, `sign_out`, `set_roles`, `set_staff_roles` (**admin**) |
| DELETE | `/api/admin/users/:id` | admin | soft delete — the row survives, the person is scrubbed |
| GET | `/api/admin/payments` | finance | `AdminPaymentPage`, with captured/refunded totals over the filtered set |
| POST | `/api/admin/payments/:id/refund` | finance | full or partial refund, through the same `requestRefund` a cancellation uses |
| GET | `/api/admin/subscriptions` | finance | `AdminSubscriptionPage`, with active count and normalised MRR |
| PATCH | `/api/admin/subscriptions/:id` | finance | `cancel` (at period end, or immediately) · `extend_grace` |
| GET | `/api/admin/audit` | admin | every privileged action, filterable by actor, action and target |
| GET/PATCH | `/api/admin/settings` | admin | `SystemSettings` |

**Staff roles** are `User.staffRoles` — `"ops" | "support" | "finance" |
"admin"`, replacing the single `isOps` boolean. `admin` satisfies every other
role, stated once in `hasStaffRole` rather than remembered at each call site.
Two refusals are enforced in the domain, not the route: nobody may edit their
own staff roles, and the last active admin cannot be demoted or deleted.

Deletion is deliberately **soft**. `OrderItem.product` is `onDelete: Restrict`
while most relations cascade, so a hard delete would either fail or take the
customer's order history, their reviews and the other side of their bookings
with it. Identity is erased; the financial and reputational skeleton stays.

## Webhooks

| Method | Path | Auth | Response |
|---|---|---|---|
| POST | `/api/webhooks/stripe` | the provider's signature over the raw body | `{ received: true }` · 400 unsigned or invalid · 403 when `STRIPE_WEBHOOK_SECRET` is unset |

The one route that must **not** use `parseBody`: verification is computed over
the exact bytes sent, and parsing then re-serialising produces a different
string. It reads `request.text()` and verifies before looking at the contents.
With no secret configured it refuses everything, the same posture the cron takes
without `CRON_SECRET`.

Idempotency is a `WebhookEvent` table keyed on the provider's event id, with a
claim protocol rather than dedupe-on-insert — inserting `received`, crashing,
and then returning 200 to the retry loses the event permanently. Claims are
`new`, `duplicate`, `retry` (a stale lock, so a previous attempt died),
`in_flight` (→ 500, come back later) and `exhausted`.

Ordering is by `event.created`, never arrival: subscription payloads carry
complete state, so last-writer-wins is only correct if "last" means most
recently created. A delayed `past_due` landing after a later `invoice.paid`
would otherwise strip a paying member's benefits.

**Business-level refusals answer 200** — an unhandled type, an unresolvable
subject, a stale event, an illegal transition. None of them become possible on a
retry, and a 500 buys three days of redelivery for an event that will be refused
identically every time. Only a genuine failure answers 500.

## Scheduled jobs

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/cron/advance-orders` | `Authorization: Bearer $CRON_SECRET` | `{ scanned, advanced }` |

Moves in-flight orders to the stage their age has earned, writing every
intermediate tracking event and notification on the way. **Time-based, not
one-step-per-run**: Vercel's Hobby plan fires a cron at most once a day, and a
step-per-run job would take most of a week to deliver one parcel. Computing the
stage from elapsed time instead makes it idempotent and correct at any
interval. Schedule lives in `vercel.json`. With no `CRON_SECRET` set the
endpoint refuses everything rather than falling open.

## What is simulated

Everything above is real: real accounts, sessions, records and rules. One thing
is deliberately not:

- **Fulfilment.** There is no warehouse. Orders advance either from the ops
  console at `/dashboard/orders` or from the cron at
  `POST /api/cron/advance-orders`, and each advance writes the same
  customer-visible tracking event a real carrier integration would.

**Payments are real when configured.** `lib/server/payments.ts` chooses a
provider from `LEASH_PAYMENTS` and **fails closed**: `stripe` with no secret key
throws at startup rather than taking pretend money for real orders. The demo
provider remains, settling inline through the *same* reconciler the webhook
uses, so the seeded data and most of the test suite run with no credential —
one code path, not two.

Not simulated, despite what an older version of this file claimed:
authentication (Auth.js with real sessions and password hashing), email
verification and password reset (`lib/server/mailer.ts` sends via Resend when
`RESEND_API_KEY` is set and logs the link otherwise), and booking-scoped
messaging (`GET`/`POST /api/bookings/:id/messages`).

Genuinely absent, and out of scope: background checks and ID verification —
`backgroundCheckStatus` is display-only — and any SMS or push channel.
