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
| GET | `/api/users/:id` | public | `User` · 404 |
| GET | `/api/users?ids=a,b,c` | signed in | `User[]` |
| GET | `/api/users` | signed in, **development only** | `User[]` — returns every email, so it is refused in production |
| GET | `/api/me` | signed in | the authenticated `User` |
| POST | `/api/signup` | public | `User` (201) · 409 if the email is taken. The only way to create an account: hashes a password and sends a verification link |
| PATCH | `/api/users/:id` | self only | `User` |

## Pets — `/lib/api/pets.ts`

| Method | Path | Request | Response | Called by |
|---|---|---|---|---|
| GET | `/api/owners/:ownerId/pets` | — | `Pet[]` | `/dashboard` (owner), `/booking/new` |
| GET | `/api/pets/:id` | — | `Pet` · 404 → `null` | `/dashboard/pets/[id]`, `/booking/[id]` |
| GET | `/api/pets?ids=a,b,c` | query `ids` (csv) | `Pet[]` | `/booking/[id]`, caretaker request view |
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
| POST | `/api/bookings` | `CreateBookingInput` | `Booking` (201, status=`requested`) | `/booking/new` |
| PATCH | `/api/bookings/:id/status` | `{ status: BookingStatus }` | `Booking` | `/booking/[id]`, `/dashboard` (accept/decline), Confirm & Pay |

**Status lifecycle:** `requested → accepted → in_progress → completed`, with
`declined` (caretaker) and `cancelled` (either party) as terminal branches. The
mock "Confirm & Pay" step transitions `accepted → in_progress` — a real build
would authorize/hold payment here (foundation §3, §5; Stripe Connect escrow).

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

## Out of scope for this frontend build (foundation §5, §9)

These are **not** represented in `/lib/api` yet; the backend will own them:

- **Auth** — real login/OAuth/JWT, phone (SMS OTP) verification. Mock only.
- **Payments** — Stripe Connect: authorization holds, capture on completion,
  platform fee, caretaker payouts. The UI has a mock "Confirm & Pay" step only.
- **Messaging** — `Message` entity (foundation §4) hangs off `Booking`; no
  endpoints built.
- **Trust & safety** — background checks (Checkr), ID verification (Stripe
  Identity). `backgroundCheckStatus` is display-only here.
- **Notifications** — push/SMS/email preferences.


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
| POST | `/api/appointments` | signed in, `ownerId` = you, pet is yours | `VetAppointment` (201, `requested`). **No `fee`** — the server reads it off the vet's profile. 400 if the vet doesn't treat that species or offer that format |
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
| POST | `/api/orders` | signed in | `Order` (201). The body carries items and an address, **never prices**. 409 with the quote when a line is unavailable, or with `productId` when stock ran out mid-checkout |
| GET | `/api/orders` | signed in | your `Order[]`, newest first |
| GET | `/api/orders/:id` | the customer, or ops | `Order` with items and the tracking timeline |
| POST | `/api/orders/:id/cancel` | the customer | `Order` · 409 once shipped. Returns the stock |
| PATCH | `/api/orders/:id/status` | **ops only** | `Order` · 409 illegal transition. Appends the tracking event |
| GET | `/api/ops/orders` | **ops only** | the fulfilment queue, oldest first |

Lifecycle: `pending_payment → paid → processing → packed → shipped →
out_for_delivery → delivered`, with `cancelled` and `refunded` as terminal
branches. Cancelling or refunding returns stock to the catalog.
