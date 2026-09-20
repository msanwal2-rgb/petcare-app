# Leash — Requirements Specification

The durable functional specification for the fresh build: **.NET 10 API +
React (Vite) SPA + PostgreSQL**.

**How to use this document.** It states *what* the system must do. `BUILD_PLAN.md`
states *how and when* to build it. Where a requirement is ambiguous, the
existing Next.js project at the repository root is the reference implementation
— it is working, tested code for every rule here, and `lib/server/<domain>.ts`
is the authoritative answer.

**Scope:** full parity with the existing application **minus the AI support
assistant**.

---

## 1. The product

Leash is a pet-care marketplace with four domains built around **one shared pet
health record**:

1. **Caretakers** — owners book walking, sitting, boarding and daycare.
2. **Vets** — owners book licensed vets, who write into the animal's permanent
   health record.
3. **Store** — pet food and supplies, where **prescription-only products are
   unlocked by the prescriptions a vet wrote into that record**.
4. **Shelter adoption** — shelters list animals; on completion **the entire
   health record transfers with the animal**.

Plus three cross-cutting systems: **Leash Plus** membership, an **admin/ops
console**, and **notifications**.

**The health record is the point.** Every domain reads or writes the same `Pet`.
The seams between them — a prescription unlocking a product, an adoption
carrying a vaccination history — are the requirements that matter most and the
ones to test hardest.

---

## 2. Cross-cutting requirements

These apply to every module. Settle them in M0; everything inherits them.

### 2.1 Error envelope

Every error response uses one shape. The frontend's fetch layer parses it.

```jsonc
{ "error": "Validation failed",
  "issues": [{ "path": "items.0.quantity", "message": "Expected number" }] }
```

| Status | Meaning | Extra fields |
|---|---|---|
| 400 | Validation failed | `issues[]` |
| 401 | Not signed in, or session no longer valid | — |
| 403 | Signed in, not permitted | — |
| 404 | Not found | — |
| 409 | Illegal state transition, or request no longer satisfiable | `quote`, `productId` |
| 502 | Payment provider failed | `orderId` |
| 503 | Feature not configured | — |

Deviating from this breaks forms and the cart across the whole app in ways that
present as unrelated UI bugs.

### 2.2 Money

- **Integer cents everywhere in storage.** Never `double`/`float` for money.
- The API may emit USD decimals at the DTO boundary where the existing contract
  does so (`Booking.priceTotal`, `VetAppointment.fee`).
- **The server owns the truth about money.** Client-supplied prices are never
  trusted; totals are always recomputed server-side from the live catalog.

### 2.3 Timestamps

- Stored as `timestamptz` (or `date` for calendar-only fields such as
  `Pet.dob` and `AvailabilityDay.date`).
- **Serialised as `yyyy-MM-ddTHH:mm:ss.fffZ`** — exactly matching JavaScript's
  `toISOString()`. The frontend performs string comparisons on these values.

### 2.4 Enum-like values

Stored as `text` / `text[]`, validated at the API boundary. **No PostgreSQL
`ENUM` types** — that would turn every new value into a schema change.

### 2.5 Pagination

Every list endpoint supports cursor pagination. No endpoint loads an unbounded
result set or filters in memory.

### 2.6 Authorization

Enforced in the API on every request. The client is never trusted. Authorization
is re-checked on every write, never inferred from a previous request.

### 2.7 API versioning

All routes are under `/api/v1/`. Required from the first endpoint — mobile
binaries cannot be force-updated.

---

## 3. M1 — Identity & Authentication

### 3.1 Entities

**User**: id, name, email (unique), phone, avatarUrl, roles[], staffRoles[],
addressCity, addressState, lat, lng, verified, passwordHash (nullable),
googleId (unique, nullable), status, suspendedAt, suspendedReason, deletedAt,
lastLoginAt, sessionsValidFrom, stripeCustomerId, createdAt.

**VerificationToken**: id, identifier, tokenHash (unique), type, expiresAt,
createdAt.

### 3.2 Requirements

| # | Requirement |
|---|---|
| A1 | Sign up with email + password. Password hashed with bcrypt. Sends a verification email. |
| A2 | Email verification via a tokenised link. Resend supported. Tokens are stored **hashed** and expire. |
| A3 | Sign in with email + password. Sets an HttpOnly, Secure, SameSite cookie. |
| A4 | Sign out clears the session. |
| A5 | Password reset by emailed token. **Completing a reset invalidates all existing sessions.** |
| A6 | Google OAuth, optional — the button is hidden until `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are both set, and appears automatically once they are. |
| A7 | **Google sign-in must refuse to merge into an existing password account at the same email.** That direction is account pre-hijacking. Linking is a deliberate action from account settings by someone who already holds the account. |
| A8 | Google identity is keyed on the provider's stable subject id, not the email. |
| A9 | Rate limiting on sign-in: per email address **and** per client. A correct password clears the counter. |
| A10 | Rate-limit failures must not reveal whether an account exists. |
| A11 | Marketplace roles: `owner`, `caretaker`, `vet`, `shelter`. One account may hold several; a role toggle selects the active one. |
| A12 | Staff roles: `ops`, `support`, `finance`, `admin` — orthogonal to marketplace roles, **never self-editable**, never shown in the role toggle. `admin` satisfies every staff check. |
| A13 | Account status: `active`, `suspended`, `deleted`. |
| A14 | **Session revocation.** `sessionsValidFrom` invalidates sessions issued before it. Bumped on password reset, on suspension, and by an admin forcing sign-out. Checked on **every** authenticated request. |
| A15 | A suspended or deleted account is refused with **401** (not 403) — the correct client response is to sign out, not retry. |
| A16 | Soft delete keeps the row so orders, payments and reviews retain their author; personal data on it is scrubbed. |
| A17 | Email address changes are **not** supported (no re-verification flow exists). Do not accept `email` in profile updates. |
| A18 | **Dual auth:** alongside the cookie, issue a rotating JWT access + refresh pair for mobile clients, from the same endpoints, selected by client header. |

### 3.3 Endpoints

```
POST   /api/v1/auth/signup
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/verify-email
POST   /api/v1/auth/resend-verification
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
GET    /api/v1/auth/google            → redirect
GET    /api/v1/auth/google/callback
POST   /api/v1/auth/refresh           → mobile token rotation
GET    /api/v1/me
GET    /api/v1/config                 → public, unauthenticated
GET    /api/v1/users            /{id}  GET, PATCH
```

`GET /api/v1/config` returns `{ signupsOpen, maintenanceBanner,
demoLoginVisible, googleEnabled }`. Public by design — nothing that gates access
is decided from it.

### 3.4 Acceptance

Sign up → receive verification email → verify → sign in → reach a guarded
endpoint. Reset a password → the previous session is refused on its next
request. Suspend an account → its session is refused on the next request.

---

## 4. M2 — Authorization core ★

No endpoints. Pure predicates, used by every other module. **Port
`lib/server/access.ts` and `tests/access.test.ts` in full before anything
depends on them. Requires human review, not just green tests.**

| Predicate | Rule |
|---|---|
| `OwnsPet(uid, petId)` | The pet's `ownerId` is the caller |
| `CanViewPet(uid, petId)` | Owner, **or** a caretaker/vet with a qualifying engagement |
| `CanAccessPetRecords(uid, petId)` | Owner, **or** a vet with a qualifying appointment |
| `IsBookingParticipant(uid, bookingId)` | The booking's owner or its caretaker |
| `IsAppointmentParticipant(uid, apptId)` | The appointment's owner or its vet |
| `OwnsCaretakerProfile` / `OwnsVetProfile` / `OwnsShelterProfile` | The profile's `userId` is the caller |
| `HasStaffRole(uid, role)` | `staffRoles` contains the role, or `admin` |

### `Pet.ownedSince` — an authorization input, not a display field

It is what makes a caretaker's or a vet's record access **end** when a pet
changes hands. Both engagement-based predicates require the engagement granting
access to have been **created at or after** `ownedSince`.

It was deliberately chosen over matching the engagement's `ownerId` to the pet's
`ownerId`: that version depends on a *mutable* column someone may reasonably
backfill one day, which would silently restore every grant this exists to end.
`createdAt` is written once and never touched.

**Known limitation (carry forward, do not regress):** this ends access that
outlives *ownership*, not access that outlives *time*. Under a single owner, a
vet who saw a pet once years ago retains record access — which includes writing
prescriptions that unlock Rx products. A trailing window on
`CanAccessPetRecords` is the fix if it is ever prioritised.

---

## 5. M3 — Pets & Health Records

### 5.1 Entities

**Pet**: id, ownerId, ownedSince, name, species, breed, sex, dob, weightLbs,
photoUrl, vaccinated, allergies[], medications[], behaviorNotes,
feedingInstructions, vetName, vetPhone.

**MedicalRecord**: id, petId, appointmentId (nullable), vetId (nullable),
authorUserId, type, title, details, occurredAt, nextDueAt (nullable),
medicationName, dosage, refillsLeft, expiresAt, productSlugs[], createdAt.

### 5.2 Requirements

| # | Requirement |
|---|---|
| P1 | Owners create, read, update and delete their own pets. |
| P2 | `ownedSince` is set at creation and **reset on adoption transfer**. |
| P3 | Record types: `visit_note`, `vaccination`, `prescription`, `lab_result`, `weight`, `allergy`. |
| P4 | Vets write records against a pet; owners read them. Authorization via `CanAccessPetRecords`. |
| P5 | `nextDueAt` drives "booster due" reminders (e.g. rabies). |
| P6 | Prescription records carry medicationName, dosage, refillsLeft, expiresAt, productSlugs[]. |
| P7 | **A prescription is "active"** when it has not expired. This determines which Rx-only products are purchasable for the pet. |
| P8 | ⚠ **Implement "is this prescription active?" exactly once, server-side.** The existing code has four implementations and only the SQL one gates money. |
| P9 | ⚠ **Decide `refillsLeft` semantics.** Today it is displayed and never decremented, so a prescription authorises unlimited purchases until `expiresAt`. Either decrement on purchase or remove it from the UI. Do not ship the current inconsistency. |
| P10 | Product recommendations for a pet derived from its record (species, life stage, allergies, prescriptions). |
| P11 | Allergen awareness: a product's `allergens[]` matched against the pet's `allergies[]` produces a warning. |

### 5.3 Endpoints

```
GET    /api/v1/pets                          → the caller's pets
POST   /api/v1/pets
GET    /api/v1/pets/{id}      PATCH  DELETE
GET    /api/v1/pets/{id}/medical-records
POST   /api/v1/pets/{id}/medical-records
DELETE /api/v1/medical-records/{id}
GET    /api/v1/pets/{id}/appointments
GET    /api/v1/pets/{id}/recommendations
```

### 5.4 Acceptance

An owner adds a pet with allergies. A vet who has seen it can read and write its
records; a vet who has not is refused with 403. A prescription written today
appears in the pet's timeline and marks its linked products purchasable.

---

## 6. M4 — Caretakers & Bookings

### 6.1 Entities

**CaretakerProfile**: id, userId, bio, servicesOffered[], serviceRadiusMiles,
acceptedSpecies[], fencedYard, hasOtherPets, smokeFree, certifications[],
backgroundCheckStatus, rating, reviewCount, responseRatePct.

**PricingEntry**: id, caretakerId, serviceType, unit (`hour`|`day`), rate.
**AvailabilityDay**: id, caretakerId, date, slots (jsonb).
**Booking**: id, ownerId, caretakerId, petIds[], serviceType, startDateTime,
endDateTime, notes, status, priceTotal, createdAt.
**Message**: id, bookingId, fromUserId, body, createdAt, readAt.
**Review**: id, bookingId, kind, fromUserId, toUserId, rating, comment, createdAt.

### 6.2 Requirements

| # | Requirement |
|---|---|
| C1 | Service types: `walking`, `sitting`, `boarding`, `daycare`. |
| C2 | Caretakers set per-service pricing, hourly or daily. |
| C3 | Availability is a calendar of days with time slots. |
| C4 | Search filters by location/distance, service type, species, date, price and rating. **Executed in SQL with cursor pagination** — not filtered in memory. |
| C5 | **Booking price is computed server-side** from the caretaker's pricing and the requested duration. Never accepted from the client. |
| C6 | A booking may cover multiple pets. |
| C7 | Status machine and actor rules — §11.1. **An illegal transition returns 409.** |
| C8 | ⚠ **Both matter:** what is reachable *and* who may do it. An owner cannot accept their own booking. |
| C9 | Messaging per booking, between the two parties only. |
| C10 | ⚠ **Marking messages read is an explicit `POST`.** Do not reproduce the existing `GET` that mutates before serialising — it makes an unread inbound message unreturnable. |
| C11 | Reviews are **bidirectional** — one per booking per direction, only after completion. |
| C12 | Reputation: rating is a running average; `responseRatePct` is derived from how the caretaker answered requests. |
| C13 | Leash Plus `priority_booking` shortens the minimum lead time before a booking may start. |
| C14 | A published cancellation window governs when a booking may still be cancelled. |

### 6.3 Endpoints

```
GET    /api/v1/caretakers/search
GET    /api/v1/caretakers/{id}
GET    /api/v1/caretakers/{id}/bookings
GET    /api/v1/users/{id}/caretaker-profile     PATCH
POST   /api/v1/bookings
GET    /api/v1/bookings/{id}
PATCH  /api/v1/bookings/{id}/status
GET    /api/v1/bookings/{id}/messages     POST
POST   /api/v1/bookings/{id}/messages/read
GET    /api/v1/bookings/{id}/reviews      POST
GET    /api/v1/owners/{ownerId}/bookings
GET    /api/v1/users/{id}/reviews
```

### 6.4 Acceptance

Search → request a booking → the caretaker accepts → both exchange messages →
caretaker completes → both leave reviews → the caretaker's rating updates. An
owner attempting to accept their own booking is refused.

---

## 7. M5 — Vets & Appointments

### 7.1 Entities

**VetProfile**: id, userId, clinicName, bio, specialties[], licenseNumber,
licenseState, verificationStatus, yearsExperience, acceptedSpecies[],
consultModes[], consultFee, emergencyAvailable, clinicCity, clinicState, lat,
lng, rating, reviewCount, responseRatePct.

**VetAppointment**: id, ownerId, vetId, petId, mode, reason, symptoms[],
startDateTime, endDateTime, status, baseFee, discountPct, priority, fee, notes,
createdAt.

### 7.2 Requirements

| # | Requirement |
|---|---|
| V1 | Specialties: `general`, `dermatology`, `dentistry`, `surgery`, `emergency`, `nutrition`, `behavior`, `exotics`. |
| V2 | Consult modes: `in_clinic`, `video`, `home_visit`. |
| V3 | Search filters by distance, specialty, species, consult mode and emergency availability. Paginated in SQL. |
| V4 | **Fee computed server-side** from the vet's `consultFee` and the member discount. `baseFee`, `discountPct` and the final `fee` are all recorded. |
| V5 | Leash Plus `vet_consult_discount` reduces the fee; the discount percentage comes from the plan. |
| V6 | Status machine and actor rules — §11.2. **An owner cannot confirm their own appointment.** |
| V7 | A vet completing an appointment writes a **visit summary**: one or more medical records against the pet. |
| V8 | ⚠ **Validate `appointmentId` against the pet and the vet** when creating a record. The existing code does not, so a record can be stamped with an unrelated appointment's id. |
| V9 | The visit-summary form must offer every record type the server accepts — including `allergy`, which the existing form omits. |
| V10 | Reviews are **one-way**: the owner reviews the vet. |
| V11 | Vet profiles carry a licence number, state and a verification status set by staff. |

### 7.3 Endpoints

```
GET    /api/v1/vets/search
GET    /api/v1/vets/{id}
GET    /api/v1/vets/{id}/appointments
GET    /api/v1/users/{id}/vet-profile      PATCH
POST   /api/v1/appointments
GET    /api/v1/appointments/{id}
PATCH  /api/v1/appointments/{id}/status
GET    /api/v1/appointments/{id}/reviews   POST
GET    /api/v1/owners/{ownerId}/appointments
```

### 7.4 Acceptance

Book a vet → the vet confirms → completes with a visit summary containing a
prescription → **that prescription appears in the pet's permanent health
record** and is visible to the owner.

---

## 8. M6 — Store & Orders

### 8.1 Entities

**Product**: id, slug (unique), name, brand, description, category, species[],
lifeStage[], sizeLabel, weightLbs, priceCents, compareAtPriceCents, imageUrl,
ingredients[], allergens[], requiresPrescription, stockQty, active, rating,
reviewCount, createdAt.

**Order**: id, userId, status, paymentStatus, paymentRef, subtotalCents,
shippingCents, taxCents, totalCents, shipping address fields,
deliveryInstructions, carrier, trackingNumber, placedAt, estimatedDeliveryAt,
deliveredAt, reservationExpiresAt, benefitsApplied[].

**OrderItem**: id, orderId, productId, name, brand, imageUrl, slug,
unitPriceCents, quantity, lineTotalCents — **a snapshot at purchase**.

**OrderEvent**: id, orderId, status, label, description, location, occurredAt.

### 8.2 Requirements

| # | Requirement |
|---|---|
| S1 | Categories: `dry_food`, `wet_food`, `treats`, `supplements`, `prescription_diet`, `dental`, `accessories`. Life stages: `puppy`, `kitten`, `adult`, `senior`, `all`. |
| S2 | Catalog search by category, species, life stage, brand and price, with sorting (`featured`, `price_asc`, `price_desc`, `rating`, `newest`). **In SQL, paginated.** |
| S3 | Cart lives client-side and stores product ids, quantities and a display snapshot. **Its prices are display-only.** |
| S4 | **Quote** re-reads every product, recomputes line totals, shipping and tax, and checks stock and the Rx gate. |
| S5 | Shipping/tax rules shared by one module: free shipping at subtotal ≥ **$49.00**, flat **$5.99** otherwise, tax **8.25%**. Leash Plus `free_shipping` always qualifies. |
| S6 | A member is never told to "spend more for free delivery". |
| S7 | **Rx gate:** a product with `requiresPrescription` may only be bought when the selected pet holds an **active prescription** naming it. |
| S8 | **Allergen warnings:** product `allergens[]` matched against the pet's `allergies[]`. |
| S9 | ⚠ **`POST /orders` must check `OwnsPet`.** The existing implementation does not while `quote` does — so a stranger's `petId` buys Rx products, and the 201-vs-409 difference reveals which prescriptions that pet holds. **This is the one High-severity defect in the reference implementation. It must not be reproduced.** |
| S10 | **The create-order request carries no price field at all.** The server recomputes and charges its own total. |
| S11 | Line items snapshot name, brand, image, slug and unit price at purchase, so history never rewrites itself. |
| S12 | Stock is reserved with an expiry. A sold-out race returns **409** with the offending `productId`. |
| S13 | Status machine — §11.3. Once shipped, the only route back is a refund. |
| S14 | Every status change writes a customer-visible `OrderEvent` with a label, description and location. |
| S15 | Cancellation permitted within a published window before fulfilment passes a defined stage. |
| S16 | Fulfilment advances from the ops console **and** from a daily background job that moves each order to the stage its age has earned. Both write the same events and notifications. |
| S17 | A payment-setup failure returns **502** with the `orderId`, so the client retries the payment step rather than the whole cart. |
| S18 | ⚠ **Allergen matching: one implementation.** The existing code has three. |

### 8.3 Endpoints

```
GET    /api/v1/products          /{slug}
GET    /api/v1/brands
POST   /api/v1/orders/quote
GET    /api/v1/orders            POST
GET    /api/v1/orders/{id}
PATCH  /api/v1/orders/{id}/status
POST   /api/v1/orders/{id}/cancel
POST   /api/v1/orders/{id}/payment/sync
GET    /api/v1/ops/orders                    → staff: ops
```

### 8.4 Acceptance

A pet with an active prescription can buy its Rx-only food; the same product is
refused for a pet without one. Tampering with cart prices changes nothing about
what is charged. Two concurrent buyers of the last unit: one succeeds, one gets
409.

---

## 9. M7 — Payments & Membership

### 9.1 Entities

**Payment**: id, userId, kind, orderId, subscriptionId, adoptionApplicationId,
provider, providerRef (unique), providerCustomerId, status, amountCents,
amountRefundedCents, currency, methodBrand, methodLast4, failureCode,
failureMessage, lastEventAt, createdAt, updatedAt, succeededAt.

**Refund**: id, paymentId, providerRef, amountCents, status, reason,
initiatedBy, note, createdAt, settledAt.

**Plan**: id, key (unique), name, description, priceCents, currency, interval,
stripeProductId, stripePriceId, entitlements[], consultDiscountPct, active.

**Subscription**: id, userId, planId, provider, providerRef (unique),
providerCustomerId, status, currentPeriodStart, currentPeriodEnd,
cancelAtPeriodEnd, canceledAt, endedAt, graceEndsAt, latestInvoiceRef.

**WebhookEvent**: id, provider, type, apiVersion, eventAt, payload, status,
attempts, lockedAt, error, receivedAt, processedAt.

### 9.2 Requirements

| # | Requirement |
|---|---|
| M1 | A provider seam chosen by configuration: `demo` or `stripe`. |
| M2 | **Fails closed** — `stripe` without a secret key throws at startup rather than quietly taking pretend money for real orders. |
| M3 | The demo provider settles inline **through the same reconciler the webhook uses**. One code path, not two. |
| M4 | A payment ledger covering orders, subscriptions and adoption fees. |
| M5 | The client secret is returned in exactly one response and never stored. |
| M6 | The webhook **verifies the signature** and **refuses every request** when the signing secret is unset. |
| M7 | **Claim protocol:** `WebhookEvent` rows carry status, attempts and `lockedAt` so each event is processed exactly once under concurrency. |
| M8 | Refunds, full or partial, staff-initiated, recorded and audited. `amountRefundedCents` tracks partials. |
| M9 | Payment statuses: `unpaid`, `pending`, `requires_action`, `processing`, `authorized`, `paid`, `partially_refunded`, `refunded`, `failed`, `disputed`. |
| M10 | Subscription statuses use **Stripe's own vocabulary** — `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `unpaid`, `canceled`. No parallel vocabulary. |
| M11 | Entitlements: `free_shipping`, `vet_consult_discount`, `priority_booking`. **Enforced server-side at the point of use, never a badge.** |
| M12 | A grace period while a failed renewal is retried; entitlements persist during it. |
| M13 | Membership operations: checkout, cancel (at period end), resume, billing portal, sync. |
| M14 | With no provider configured, membership checkout returns **503** rather than pretending. |
| M15 | A returning member reuses their stored `stripeCustomerId` rather than being billed as a stranger. |

### 9.3 Endpoints

```
GET    /api/v1/membership
POST   /api/v1/membership/checkout
POST   /api/v1/membership/cancel
POST   /api/v1/membership/resume
POST   /api/v1/membership/portal
POST   /api/v1/membership/sync
POST   /api/v1/webhooks/stripe            → unauthenticated; signature is the gate
```

### 9.4 Acceptance

Buy Leash Plus → free shipping applies at checkout and the consult discount
applies when booking a vet. Deliver the same webhook event twice → it is
processed once. Refund an order → both the ledger and the customer's view
reflect it.

---

## 10. M8–M10

### 10.1 M8 — Notifications & Background Jobs

**Notification**: id, userId, kind, title, body, href, readAt, createdAt.

| # | Requirement |
|---|---|
| N1 | **One `Notify()` gate** every notification passes through. |
| N2 | Kinds: `booking_accepted`, `booking_declined`, `appointment_confirmed`, `appointment_declined`, `appointment_completed`, `order_shipped`, `order_out_for_delivery`, `order_delivered`, `order_payment_failed`, `membership_started`, `membership_payment_failed`, `membership_cancelled`, `membership_ended`, `adoption_application_received`, `adoption_under_review`, `adoption_approved`, and the remaining adoption kinds. |
| N3 | **Build a channel abstraction now** — in-app / email / **push** — even with push unimplemented. |
| N4 | Email via Resend when configured; logs otherwise. |
| N5 | ⚠ **Escape all user-controlled text in email HTML.** The existing code interpolates `title`, `body` and `user.name` unescaped, and `appointment.reason` and `application.petName` are user-controlled. |
| N6 | ⚠ **Do not fire email without awaiting it.** Use an outbox table drained by a background service. |
| N7 | A notification bell with an unread count; marking read affects only what was actually seen. |
| N8 | A daily background job advances order fulfilment. A hosted service, not a public cron URL. |
| N9 | Each notification carries an `href` deep-linking to the thing it concerns. |

### 10.2 M9 — Admin Console

**AdminAuditLog**: id, actorUserId, action, targetType, targetId, summary,
metadata, ip, createdAt. **SystemSetting**: key, value, updatedAt, updatedBy.

| Screen | Capability | Role |
|---|---|---|
| Dashboard | platform statistics | any staff |
| Users | list, search, detail, suspend, soft-delete, force sign-out, edit roles | `support` |
| Professionals | set verification status for caretakers, vets, shelters | `support` |
| Payments | ledger, issue full or partial refunds | `finance` |
| Subscriptions | list, cancel, resume | `finance` |
| Settings | `signupsOpen`, `maintenanceBanner`, `demoLoginVisible` | `admin` |
| Audit log | every staff action with actor, target and IP | `admin` |

| # | Requirement |
|---|---|
| D1 | **Every endpoint re-checks `RequireStaff(role)`.** Hiding links in the UI is courtesy only. |
| D2 | A user who is not staff receives **403** with an explanation, not a 404 — route existence is not a secret. |
| D3 | Every staff action writes an audit entry. |
| D4 | Staff roles are never self-editable. |
| D5 | Forcing a sign-out bumps `sessionsValidFrom`. |
| D6 | Reviews cannot be edited or deleted — ratings fold into a running average and there is no arithmetic that un-folds one. Suspending the author is the available remedy. |

### 10.3 M10 — Shelter Adoption

**ShelterProfile**: id, userId, name, bio, kind, registrationNumber,
registrationState, verificationStatus, acceptedSpecies[], websiteUrl, phone,
email, addressLine, city, state, lat, lng, adoptionPolicy, responseRatePct.

**AdoptionListing**: id, shelterId, petId (unique), status, feeCents, currency,
headline, story, goodWithKids, goodWithDogs, goodWithCats, houseTrained,
energyLevel, specialNeeds, specialNeedsNotes, spayedNeutered, microchipped,
city, state, lat, lng, intakeAt, publishedAt, closedAt.

**AdoptionApplication**: id, listingId, shelterId, petId, petName, petPhotoUrl,
applicantId, status, feeCents, householdAdults, householdChildren,
hasOtherPets, otherPetsNotes, homeType, fencedYard, ownsHome, hoursAlonePerDay,
experience, message, decisionNote, decidedAt, completedAt.

| # | Requirement |
|---|---|
| R1 | Shelter kinds: `municipal`, `rescue`, `sanctuary`, `foster_network`. |
| R2 | Tri-state fields (`goodWithKids` etc.): `yes`, `no`, `unknown`. |
| R3 | Listing status: `draft` → published → … → `closed`. |
| R4 | Application status: `submitted` → decision → `completed`. |
| R5 | The adoption fee is paid through the **same payment ledger** as orders. |
| R6 | ⚠ **On completion the pet AND its entire health record transfer to the adopter.** Vaccination history, prescriptions and notes follow the animal. `ownedSince` is reset to the transfer instant, which ends the previous owner's caretakers' and vets' access. |
| R7 | Completing an adoption is **refused while an open boarding booking exists** for the animal, with an explicit staff override. |
| R8 | Staff may reverse a completed adoption. |
| R9 | Shelters have **no rating or reviewCount** — do not add the columns until `Review.kind` supports adoptions and reputation can actually write them. `responseRatePct` is wired because it is computable. |

**`tests/adoption-transfer.test.ts` is the specification for R6.**

---

## 11. Status machines

An illegal transition returns **409**. Both the transition table and the actor
table are enforced.

### 11.1 Booking

| From | May go to |
|---|---|
| `requested` | `accepted`, `declined`, `cancelled` |
| `accepted` | `in_progress`, `cancelled` |
| `in_progress` | `completed`, `cancelled` |
| `completed` · `declined` · `cancelled` | — terminal |

**Who may drive it:** `accepted`, `declined`, `in_progress`, `completed` →
**caretaker only**. `cancelled` → **owner or caretaker**.

### 11.2 Vet appointment

| From | May go to |
|---|---|
| `requested` | `confirmed`, `declined`, `cancelled` |
| `confirmed` | `in_progress`, `cancelled` |
| `in_progress` | `completed`, `cancelled` |
| `completed` · `declined` · `cancelled` | — terminal |

**Who may drive it:** `confirmed`, `declined`, `in_progress`, `completed` →
**vet only**. `cancelled` → **owner or vet**.

### 11.3 Order

| From | May go to |
|---|---|
| `pending_payment` | `paid`, `cancelled` |
| `paid` | `processing`, `cancelled`, `refunded` |
| `processing` | `packed`, `cancelled`, `refunded` |
| `packed` | `shipped`, `cancelled`, `refunded` |
| `shipped` | `out_for_delivery`, `refunded` |
| `out_for_delivery` | `delivered`, `refunded` |
| `delivered` | `refunded` |
| `cancelled` · `refunded` | — terminal |

Once with the carrier, the customer cancels by refusing delivery — so the only
route back from `shipped` onward is a refund.

---

## 12. Defects in the reference implementation

Found by audit of the existing code. **Fix during the build; do not reproduce.**

| Severity | Defect | Module |
|---|---|---|
| **High** | `POST /orders` performs no `OwnsPet` check while `quote` does | M6 |
| Medium | Notification email interpolates user-controlled text into HTML unescaped | M8 |
| Medium | Email fired without `await` — lost when the process is torn down | M8 |
| Low | `refillsLeft` displayed but never decremented | M3 |
| Low | Message read receipts: a `GET` that mutates before serialising | M4 |
| Low | `createRecord` does not validate `appointmentId` against the pet or vet | M5 |
| Low | Visit-summary form omits the `allergy` record type the server accepts | M5 |
| Low | Review lookups filter on `bookingId` without `kind` | M4/M5 |
| Low | A one-step progress indicator divides by zero | web |
| — | "Prescription active?" implemented 4×; only one gates money | M3/M6 |
| — | Allergen matching implemented 3× | M6 |
| — | Money split: integer cents vs `double` USD | db |
| — | Caretaker/vet search filters in memory, unpaginated | M4/M5 |

**Unverified in the original:** `activePrescriptions` filters
`NOT: { refillsLeft: 0 }` on a nullable column, and no seeded prescription has a
null value — so whether null-refill prescriptions unlock anything was never
exercised. Make the new implementation explicit.

---

## 13. Acceptance — end-to-end journeys

The release criteria.

1. Sign up → verify email → onboard → add a pet
2. Search caretakers → book → accept → message → complete → both review
3. Book a vet → vet completes a visit summary → **a prescription appears in the pet's record**
4. **That prescription unlocks an Rx-only product** → cart → quote → pay → track to delivered
5. Buy Leash Plus → free shipping *and* the consult discount both apply
6. Shelter lists a pet → owner applies → approved → fee paid → **pet and full health record transfer**
7. Staff suspend a user → their session is refused on the next request
8. Staff refund an order → ledger and customer view both reflect it

**Journeys 3, 4 and 6 are the cross-module seams** — the parts that make this
one product rather than four. Test them hardest.

---

## 14. Out of scope

**Excluded from this build:** the AI support assistant (19 server files, 26
tools, hybrid retrieval), pgvector, the `AssistantConversation`,
`AssistantMessage` and `KnowledgeChunk` tables, and the `ai` / `@ai-sdk/*`
packages.

**Not built in the original either, and not required here:** payouts to
caretakers, vets and shelters (money comes in; nothing goes out — no Stripe
Connect, no platform commission); notification preferences; a full
`/notifications` page; review moderation; email address changes; real background
checks or ID verification; shelter reviews; foster placements; meet-and-greet
scheduling.
