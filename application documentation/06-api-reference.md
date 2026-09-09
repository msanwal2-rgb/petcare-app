# 6. API reference

**81 route handlers** under `app/api/`. All are Node runtime; none is `edge`.

There is a fuller narrative contract document already in the repo at
`API_CONTRACTS.md` — it is accurate as of this audit with two exceptions noted
in §13. This section is the map and the rules; that file is the detail.

## 6.1 The shape every route has

```ts
export async function POST(request: Request) {
  const auth = await requireUser();               // or requireStaff("finance")
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, someSchema);
  if ("response" in parsed) return parsed.response;

  const result = await someDomainFunction(auth.uid, parsed.data);
  if (result.ok) return ok(result.thing, 201);
  if (result.code === "…") return error("…", 409);
  return forbidden();
}
```

Four rules follow from it, and they hold across all 81 routes:

1. **The route does auth, parsing and HTTP status. The domain function does the
   work.** A domain function never imports `next/server` and never returns a
   `Response`; it returns a discriminated union `{ok:true,…} | {ok:false,code}`.
   That is what makes the domain layer unit-testable (§12).
2. **Identity comes from the session, never the body.** `auth.uid` is passed as
   an argument. Where a schema once carried `ownerId`, it was removed.
3. **Helpers come from `lib/server/http.ts`:** `ok`, `error`, `badRequest`,
   `notFound`, `forbidden`, `unauthorized`, `parseBody`.
4. **Not-yours reads as not-found** wherever confirming existence would be an
   enumeration oracle (assistant conversations, other users' records).

## 6.2 Guards

| Guard | From | Meaning |
|---|---|---|
| *(none)* | — | Public. Catalog, search, public profiles. |
| `auth()` | `@/auth` | Optional session — a smaller capability set, not a 401. Only the assistant. |
| `requireUser()` | `lib/server/session.ts` | Signed in, account `active`, session not revoked. |
| `requireStaff(role)` | `lib/server/session.ts` | The above, plus that staff role (or `admin`). |
| Bearer `CRON_SECRET` | `timingSafeEqual` | `/api/cron/*`. Fails closed if unset. |
| Stripe signature | `stripe.webhooks.constructEvent` | `/api/webhooks/stripe`. |

`proxy.ts` (Next 16's renamed middleware) guards *pages*, not the API —
`/dashboard/*`, `/onboarding/*`, `/booking/*`, `/account/*`. `/api` is
**deliberately excluded**: every route guards itself, and running the edge
matcher over them would add latency for no benefit.

## 6.3 The full route table

Guard shown is the strongest one in the file.

### Auth & identity
| Route | Methods | Guard |
|---|---|---|
| `/api/auth/[...nextauth]` | — | Auth.js handler |
| `/api/signup` | POST | public |
| `/api/me` | GET | requireUser |
| `/api/users` | GET | requireUser |
| `/api/users/[id]` | GET, PATCH | requireUser |
| `/api/users/[id]/reviews` | GET | public |
| `/api/users/[id]/caretaker-profile` | GET, PATCH | requireUser |
| `/api/users/[id]/vet-profile` | GET, PATCH | requireUser |
| `/api/users/[id]/shelter-profile` | GET, PATCH | requireUser |
| `/api/verify-email` · `/api/resend-verification` | POST | public / requireUser |
| `/api/forgot-password` · `/api/reset-password` | POST | public |
| `/api/config` | GET | public — which providers are configured |

### Pets & records
| Route | Methods | Guard |
|---|---|---|
| `/api/pets` | GET | requireUser |
| `/api/pets/[id]` | GET, **PATCH** | requireUser · ⚠️ PATCH cannot change `ownerId` |
| `/api/pets/[id]/appointments` | GET | `canViewPet` — reduced serializer for non-bookers |
| `/api/pets/[id]/medical-records` | GET, POST | `canAccessPetRecords`; owners may only author `weight`/`allergy` |
| `/api/pets/[id]/recommendations` | GET | `ownsPet` |
| `/api/medical-records/[id]` | DELETE | author only |
| `/api/owners/[ownerId]/pets` | GET, POST | self only |

### Caretaking
`/api/caretakers/search` (public) · `/api/caretakers/[id]` (public) ·
`/api/caretakers/[id]/bookings` · `/api/bookings` POST ·
`/api/bookings/[id]` GET · `/api/bookings/[id]/status` PATCH ·
`/api/bookings/[id]/messages` GET/POST · `/api/bookings/[id]/reviews` GET/POST ·
`/api/owners/[ownerId]/bookings` GET.

### Vet care
`/api/vets/search` (public) · `/api/vets/[id]` (public) ·
`/api/vets/[id]/appointments` · `/api/appointments` POST ·
`/api/appointments/[id]` GET · `/api/appointments/[id]/status` PATCH ·
`/api/appointments/[id]/reviews` GET/POST ·
`/api/owners/[ownerId]/appointments` GET.

### Store
| Route | Methods | Guard |
|---|---|---|
| `/api/products` · `/api/products/[slug]` · `/api/brands` | GET | public |
| `/api/orders/quote` | POST | requireUser + **`ownsPet`** |
| `/api/orders` | GET, POST | requireUser — ⚠️ **no `ownsPet` check**, see §13 |
| `/api/orders/[id]` | GET | owner |
| `/api/orders/[id]/status` | PATCH | ops |
| `/api/orders/[id]/cancel` | POST | owner, within the window |
| `/api/orders/[id]/payment/sync` | POST | owner |
| `/api/ops/orders` | GET | ops |
| `/api/cron/advance-orders` | GET | `CRON_SECRET` |

### Payments & membership
`/api/membership` GET · `/api/membership/checkout` POST ·
`/api/membership/cancel` · `/api/membership/resume` · `/api/membership/portal` ·
`/api/membership/sync` · `/api/webhooks/stripe` POST (signature-verified).

### Adoption
`/api/shelters/search` · `/api/shelters/[id]` (both public) ·
`/api/adoptions/listings` GET/POST · `/api/adoptions/listings/[id]` GET/PATCH ·
`/api/adoptions/listings/[id]/status` PATCH ·
`/api/adoptions/applications` GET/POST · `/api/adoptions/applications/[id]` GET ·
`/api/adoptions/applications/[id]/status` PATCH ·
`/api/adoptions/applications/[id]/payment` POST — **applicant only** ·
`/api/adoptions/applications/[id]/complete` POST — **shelter only**.

The actor split is deliberate: money moves when the payer acts, handover is
recorded by the party who hands over.

### Admin — every route audited via `recordAdminAction()`
| Route | Methods | Role |
|---|---|---|
| `/api/admin/stats` | GET | support |
| `/api/admin/users` | GET | support |
| `/api/admin/users/[id]` | GET, PATCH, DELETE | support / **admin** for DELETE |
| `/api/admin/professionals` | GET | support |
| `/api/admin/professionals/[id]` | PATCH | support |
| `/api/admin/payments` | GET | finance |
| `/api/admin/payments/[id]/refund` | POST | finance |
| `/api/admin/subscriptions` | GET | finance |
| `/api/admin/subscriptions/[id]` | PATCH | finance |
| `/api/admin/settings` | GET, PATCH | admin |
| `/api/admin/audit` | GET | admin |
| `/api/admin/adoptions/[id]/reverse` | POST | support |

### Assistant
`/api/assistant/chat` POST (`auth()`, optional) ·
`/api/assistant/conversations/[id]` GET/DELETE.

## 6.4 Errors

Every failure is `{ "error": "<human sentence>" }`, sometimes with extra keys
(`{ quote }`, `{ orderId }`, `{ productId }`, `{ window }`). The client wrapper
`lib/api/_client.ts` turns that into `ApiError { message, status }`, which is why
`toast.error(..., { description: e.message })` shows the server's own sentence.

Status conventions worth knowing:

- **409, not 403, for "legitimate but early"** — reviewing an incomplete
  booking. The comment in `review-http.ts` says so explicitly.
- **502, not 500, when the payment provider fails** — the order exists and holds
  its stock; only the intent failed, and the `orderId` comes back so the client
  can retry that step.
- **404, not 403, for someone else's assistant conversation** — 403 confirms the
  id exists.

---

# 6.5 Endpoint reference

Bodies are the Zod schemas from `lib/validation/schemas.ts` and
`lib/validation/admin-schemas.ts`. Responses are the types in `types/index.ts`,
produced by `lib/server/serialize.ts`.

Where a body field duplicates the session (`ownerId`, `fromUserId`), the route
compares it and 403s on mismatch — noted as **redundant** because passing
`auth.uid` as an argument would remove the field and the check together. Newer
schemas (`createAppointmentSchema`, `adoptionApplicationSchema`) already do it
the right way and say so in a comment.

## Auth and identity

### `POST /api/signup` — public
`{ name, email, password, roles[] }` → `201 { user }`. Hashes with bcrypt,
issues a `verify_email` token. Duplicate email → 409.

### `GET /api/me` — requireUser
→ `User` (the serialized session user, including `staffRoles`). Called by
`SessionSync` on every page load. **`cache: "no-store"`.** A network failure is
treated by the client as signed out.

### `GET /api/config` — public
→ `{ googleEnabled, stripeEnabled, assistantEnabled, … }`. This is how the
"Continue with Google" button knows whether to render.

### `PATCH /api/users/[id]` — requireUser, self only
`updateUserSchema` = **partial** `{ name (min 1), phone, avatarUrl, roles[],
address }`.
⚠️ **No `email` and no `verified`.** Both were removed rather than validated —
changing the identifier an account is recovered by needs re-verification of the
new address, and there is no such flow. `tests/validation.test.ts` asserts the
field is *not accepted*, not merely stripped.

### `POST /api/forgot-password` — public
`{ email }` → **always `200`**, whether or not the address exists. Anything else
makes the user list enumerable.

### `POST /api/reset-password` — public
`{ token, password }` → `200`. Consumes the single-use token **and bumps
`sessionsValidFrom`**, so every existing session dies.

### `POST /api/verify-email` — public · `POST /api/resend-verification` — requireUser

### `GET|PATCH /api/users/[id]/{caretaker,vet,shelter}-profile`
Self only. Patch schemas are `.partial()` and **omit every derived field** —
`rating`, `reviewCount`, `responseRatePct`, `verificationStatus` are not
writable by their owner.

## Pets and records

### `GET /api/pets` — requireUser → your pets
### `POST /api/owners/[ownerId]/pets` — self only
`petInputSchema` **`.strict()`**:
```
{ name (min 1), species, breed, sex, dob, weightLbs, photoUrl,
  vaccinated, allergies[], medications[], behaviorNotes,
  feedingInstructions, vetContact: { name, phone } }
```
⚠️ **No `ownerId`** — it comes from the path, checked against the session.
`.strict()` means a client still sending the old shape gets a loud **400**, not
a silent strip. That is deliberate: the field used to be here, `updatePet` used
to write it, and `PetForm` spread it into every edit payload, so a stale prop
could rewrite ownership silently.

### `PATCH /api/pets/[id]` — owner only
`petPatchSchema` = `petInputSchema.partial().strict()` — **derived**, so
`ownerId` cannot creep back onto one side and not the other.
**Ownership changes in exactly one place: `lib/server/adoptions/transfer.ts`.**

### `GET /api/pets/[id]/appointments` — `canViewPet`
→ `VetAppointment[]`, or **`ClinicalAppointment[]`** for anyone who is not the
booker — `fee`, `baseFee`, `discountPct` and `priority` are dropped. An adopter
needs the clinical history, not what the shelter paid.

### `GET|POST /api/pets/[id]/medical-records` — `canAccessPetRecords`
`medicalRecordSchema`:
```
{ type, title (min 1), details = "", occurredAt,
  appointmentId = null, nextDueAt = null,
  medicationName = null, dosage = null,
  refillsLeft: int ≥ 0 | null = null,
  expiresAt = null, productSlugs[] = [] }
```
The route adds a second gate: **an owner may only author `weight` and
`allergy`** (`OWNER_AUTHORABLE`); the treating vet may author all six and the
record is stamped with `vetId`.
⚠️ `productSlugs` is unvalidated free text — no check that the slugs exist or
that those products are Rx-only. A vet's typo produces a prescription that
authorises nothing, discoverable only when the owner's checkout 409s.

### `DELETE /api/medical-records/[id]` — **author only**
Not the pet's owner. *"A health record its subject can rewrite is not a
record."*

### `GET /api/pets/[id]/recommendations` — `ownsPet`
Species, life stage and **allergen** filtered.

## Caretaking

### `GET /api/caretakers/search` — public
`searchQuerySchema` (query string): `location?, lat?, lng?, radiusMiles?,
serviceType?, species?, startDate?, endDate?, minPrice?, maxPrice?`.
⚠️ Filters **in memory** and sorts by distance or rating. No text search, no
pagination — §13.8.

### `POST /api/bookings` — requireUser
```
{ ownerId, caretakerId, petIds[1..10], serviceType,
  startDateTime, endDateTime, notes (≤2000) }
```
⚠️ `ownerId` is **redundant** — the route does
`if (parsed.data.ownerId !== auth.uid) return forbidden()`.
The server prices the booking from the caretaker's rate card; the body never
carries a price. Errors: `caretaker_not_found` → 404,
`service_not_offered` → 400, bad date range → 400.

### `PATCH /api/bookings/[id]/status` — participant
`{ status }`. Transition + actor tables; same-status is a no-op; notifies the
owner on `accepted` / `declined`.

### `GET|POST /api/bookings/[id]/messages` — participant
POST `{ body: 1..2000 }` → 201. `fromUserId` comes from the session.
⚠️ **GET mutates** — it calls `markMessagesRead` before serializing, so the
response can never contain an unread inbound message (§13.4.2). No pagination.

## Reviews

### `POST /api/{bookings,appointments}/[id]/reviews` — participant
`{ fromUserId, toUserId, rating: 0..5, comment }`.
⚠️ `fromUserId` is **redundant** (same check, duplicated in both handlers).
⚠️ `rating` accepts `0` and non-integers; the UI enforces 1–5.

Error mapping, from `review-http.ts`:

| Code | Status | Why |
|---|---|---|
| `not_found` | 404 | |
| `not_completed` | **409** | *"the request is legitimate, just early"* |
| `already_reviewed` | 409 | one per person per subject |
| `not_a_participant` | 403 | |
| `wrong_recipient` | 403 | |

Bookings are reviewable **both** directions; vet appointments **one** way
(owner → vet) only.

### `GET /api/users/[id]/reviews?kind=` — public
Unknown kind → `400 Unknown review kind "…"`.

## Store

### `GET /api/products` — public
`productQuerySchema`: `q?, category?, species?, lifeStage?, brand?,
maxPriceCents?, sort?, limit?, offset?`. **Done properly in Postgres** — this
is the pattern the caretaker and vet searches should copy.

### `POST /api/orders/quote` — requireUser
`{ items: CartLine[], petId? }` → `CartQuote`:
```
{ lines[], subtotalCents, shippingCents, taxCents, totalCents,
  problems: [{ productId, code, message }],
  membership: { active, planKey },
  shippingWaivedByMembership, membershipSavingsCents }
```
`userId` comes from the **session** — there is deliberately no field for a
client to claim membership with. **`ownsPet` is enforced** on `petId`.

`problems[].code` ∈ `prescription_required | out_of_stock | inactive |
not_found`.

### `POST /api/orders` — requireUser
```
{ items: CartLine[≥1], shippingAddress, deliveryInstructions?, petId? }
```
→ `201 { ...Order, payment: { clientSecret?, provider, asynchronous } }`.

⚠️ **`petId` is not checked against `ownsPet` here.** §11.7 S-1 — the highest
finding in this audit.

The `payment` block is returned to **exactly this one response and never
stored**.

| Failure | Status |
|---|---|
| `empty` | 400 |
| `unavailable` | **409 `{ quote }`** — so the client can point at the line |
| `stock_race` | **409 `{ productId }`** |
| `payment_setup_failed` | **502 `{ orderId }`** — the order exists and holds stock; retry the payment step, not the cart |

### `POST /api/orders/[id]/cancel` — owner
Allowed while `pending_payment | paid | processing | packed`. Refunds through
the ledger; **restocks only if never shipped**.

### `POST /api/orders/[id]/payment/sync` — owner
Reconciles against the provider when the browser knows the card cleared but the
webhook has not arrived. Called by `?paid=1` on the order page.

### `PATCH /api/orders/[id]/status` — **ops**
`{ status, location?, carrier?, trackingNumber? }`.
⚠️ The console offers **no "Mark paid"** — it would let staff ship an unpaid
order past the payment provider.

### `GET /api/cron/advance-orders` — `Authorization: Bearer $CRON_SECRET`
`timingSafeEqual`; **fails closed if the secret is unset**. Idempotent.

## Payments and membership

### `GET /api/membership` — requireUser
→ current `Subscription` + `Plan` + entitlements.

### `POST /api/membership/checkout` — requireUser
→ a provider checkout session, **or `503`** when Stripe is not configured. It
does not pretend.

### `POST /api/membership/{cancel,resume}` — requireUser
Sets / clears `cancelAtPeriodEnd`. Benefits run to the period end.

### `POST /api/membership/portal` — requireUser → a Stripe billing-portal URL.

### `POST /api/webhooks/stripe` — **signature only**
`stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`, then the claim
protocol (§14.6). Always answers **200** once claimed — a non-200 makes Stripe
retry an event already being handled.

## Adoption

### `GET /api/adoptions/listings` — public
`adoptionListingQuerySchema`: `lat?, lng?, radiusMiles?, species?, shelterId?,
goodWithKids="yes"?, goodWithDogs="yes"?, goodWithCats="yes"?, energyLevel?,
maxFeeCents?, q?, limit?, offset?`.

### `POST /api/adoptions/listings` — shelter owner
`adoptionListingSchema` — `petId`, `city`, `state`, `lat`, `lng` required;
everything else optional: `feeCents (0..1_000_000)`, `headline (≤200)`,
`story (≤8000)`, the four tri-states, `energyLevel`, `specialNeeds` + notes,
`spayedNeutered`, `microchipped`, `intakeAt`.
`PATCH` uses the same schema `.partial().omit({petId})` — **the animal cannot be
swapped under a listing.**

### `PATCH /api/adoptions/listings/[id]/status`
`{ status: draft|available|pending|adopted|withdrawn }`.

### `POST /api/adoptions/applications` — requireUser
```
{ listingId, householdAdults 1..20, householdChildren 0..20,
  hasOtherPets, otherPetsNotes?, homeType: house|apartment|condo|other,
  fencedYard, ownsHome, hoursAlonePerDay 0..24,
  experience?, message? }
```
**No `applicantId`** — it is the caller, and the schema says so in a comment.
`feeCents` is **snapshotted from the listing at submission**.

### `PATCH /api/adoptions/applications/[id]/status`
`{ status: under_review|approved|rejected|withdrawn, note? (≤1000) }`.
The **shelter** reviews / approves / rejects; the **applicant** withdraws.
Approving moves the listing to `pending`, and **at most one application per
listing may be approved** — which is what makes co-applicant refunds impossible.

### `POST /api/adoptions/applications/[id]/payment` — **applicant only**
Money moves when the payer acts. Zero-fee adoptions skip intent creation
entirely rather than minting a $0 intent.

### `POST /api/adoptions/applications/[id]/complete` — **shelter only**
`{ force?: boolean }`.
`force` cancels a live booking or appointment standing in the way. **Off by
default**, and the UI names the engagements first — cancelling a sitter's
booking out from under them, while the animal is in their house, from a flow
they are not party to, is worse than refusing.

Failures: not `approved` · fee unsettled · pet no longer the shelter's
(idempotency) · live engagements, **with their ids returned**.

### `POST /api/admin/adoptions/[id]/reverse` — `requireStaff("support")`
Ownership back to the shelter with a fresh `ownedSince`, listing reopened,
audited.

## Admin

All audited via `recordAdminAction()`. Queries are Postgres-side with `limit` /
`offset`.

### `GET /api/admin/users` — support
`adminUserQuerySchema`: `q?, role?, staffRole?, status?, limit?, offset?`.

### `PATCH /api/admin/users/[id]` — support
`adminUserActionSchema` — a **discriminated union on `action`**: suspend
(`reason`), reactivate, set roles, set staff roles, force sign-out (bumps
`sessionsValidFrom`).
`DELETE` requires **admin** and is a **soft delete**: the row stays so orders,
payments and reviews keep their author; personal data is scrubbed.

### `PATCH /api/admin/professionals/[id]` — support
`verificationSchema` / `backgroundCheckSchema`. Generic over caretaker, vet and
shelter.
⚠️ Sends `kind: "membership_started"` for "profile verified" — B-6.

### `GET /api/admin/payments` · `POST /api/admin/payments/[id]/refund` — finance
`refundRequestSchema` `{ amountCents?, reason?, note? }`. Partial refunds
supported; `settleRefund` updates `Order.paymentStatus` in the same transaction.

### `GET /api/admin/subscriptions` · `PATCH .../[id]` — finance
`subscriptionActionSchema`, also a discriminated union.

### `GET|PATCH /api/admin/settings` — admin
`settingsPatchSchema`. Maintenance mode lives here.

### `GET /api/admin/audit` — admin
`auditQuerySchema`: `actorUserId?, action?, targetType?, targetId?, limit?,
offset?`.

## Assistant

### `POST /api/assistant/chat` — `auth()`, **optional**
```
{ messages: [{ id?, role: user|assistant|system,
               parts: [{type, …}] (≤50) }] (1..40),
  conversationId? (≤64),
  path? (≤512) }
```
Message shapes are checked **structurally** (`.loose()`) rather than mirrored
field for field — the AI SDK's `UIMessage` evolves, and pinning it here would
break on an upgrade without making anything safer. **The caps are the first line
of cost control.**

Responses: a stream, with **`x-conversation-id`**. `503` when disabled or
credential-less; `429 { window }` on the rate limit.
⚠️ The whole `messages` array reaches the model — §11.7 S-3.

### `GET|DELETE /api/assistant/conversations/[id]`
Someone else's thread reads as **404, not 403**.
