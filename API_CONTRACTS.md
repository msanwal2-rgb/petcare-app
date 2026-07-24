# API Contracts — Pet Care Marketplace

This is the checklist the backend team builds from. Every function in
`/lib/api/*` is a stand-in for one real HTTP endpoint. The frontend calls
**only** these functions (never the mock data directly), so replacing each
mock body with a real `fetch` is a one-file change per domain — no page or
component code changes.

- **Base URL (proposed):** `/api`
- **Auth:** all endpoints except search/detail assume an authenticated user
  (JWT/session). Not enforced in the mock.
- **Content type:** `application/json`
- **Types:** every shape below is defined in [`/types/index.ts`](./types/index.ts).
  `CaretakerWithUser` is `CaretakerProfile` joined with its `User`, plus a
  computed `priceRange` and optional `distanceMiles`.
- **Latency:** the mock simulates ~600ms so loading skeletons are exercised.

---

## Users — `/lib/api/users.ts`

| Method | Path | Request | Response | Called by |
|---|---|---|---|---|
| GET | `/api/users/:id` | — | `User` · 404 → `null` | `/caretaker/[id]`, `/booking/[id]`, `/dashboard` |
| GET | `/api/users?ids=a,b,c` | query `ids` (csv) | `User[]` | dashboards, lists resolving several users |
| GET | `/api/users` | — (dev/demo only) | `User[]` | Dev account switcher |
| POST | `/api/users` | `{ name, email, phone?, roles? }` | `User` (201) | `/signup` (mock — real build uses auth provider) |
| PATCH | `/api/users/:id` | `Partial<User>` | `User` | `/onboarding` (role selection), profile edits |

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

| Method | Path | Request | Response | Called by |
|---|---|---|---|---|
| GET | `/api/users/:userId/reviews` | — | `Review[]` (about this user, newest first) | `/caretaker/[id]`, profiles |
| GET | `/api/bookings/:bookingId/reviews` | — | `Review[]` | `/booking/[id]` |
| POST | `/api/bookings/:bookingId/reviews` | `{ fromUserId, toUserId, rating, comment }` | `Review` (201) | `/booking/[id]` |

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
