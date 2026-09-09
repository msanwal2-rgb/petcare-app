# 2. What the application does

Leash is a marketplace for pet care built on one premise: **a single pet health
record** that a caretaker reads, a vet writes into, the store honours
prescriptions from, and an adopted animal carries with it to its new home.

Everything below is *Confirmed* — traced to code — unless marked otherwise.

## 2.1 The six subsystems

| # | Subsystem | What an owner can do | Status |
|---|---|---|---|
| 1 | **Caretaker bookings** | Search sitters by service, location, price; request a booking; message the caretaker; review after completion | Complete, no money moves |
| 2 | **Vet care** | Search vets by specialty and consult mode; book an appointment; get a visit summary, vaccinations and prescriptions written to the record | Complete, no money moves |
| 3 | **Health record** | One timeline per pet: visit notes, vaccinations, prescriptions, lab results, weights, allergies | Complete |
| 4 | **Store** | Browse 25 products, filter by species/life stage/brand/price, shop "for" a specific pet, cart, checkout, track delivery, cancel | Complete, real money via Stripe once keys exist |
| 5 | **Leash Plus** | A paid membership: free shipping, a vet consult discount, a 2-hour booking lead time instead of 24 | Complete, needs Stripe |
| 6 | **Shelter adoption** | Browse listings, apply, pay the fee, receive the animal **and its whole record** by ownership transfer | Complete, newest |

Plus a **support assistant** (§9) and an **admin console** (§11).

## 2.2 Roles

`UserRole` = `owner | caretaker | vet | shelter`. A user may hold several; the
header's `RoleToggle` switches which dashboard they see. Roles are
self-declared at onboarding — **holding `vet` does not by itself grant record
access**; a `VetProfile` plus an appointment for that pet does.

`StaffRole` = `ops | support | finance | admin` is a *separate* array, never
self-declared, and `admin` implies all of the others.

## 2.3 The seams — where subsystems touch

These are the parts that make Leash more than four apps in one repo, and they
are where changes break things.

**Prescription → store.** A `MedicalRecord` of type `prescription`, unexpired
and with refills remaining, carries `productSlugs[]`. `authorizedProductSlugs`
folds every active prescription for a pet into a `Set`, and `quoteCart` blocks
any `requiresPrescription` product whose slug is not in it. No pet selected
means every Rx product is blocked — it fails closed. See §5 and the finding in
§13.

**Allergies → recommendations.** `allergy` records filter product
recommendations for a pet.

**Membership → three places.** `lib/pricing.ts` (free shipping),
`lib/pricing-vet.ts` (consult discount), `lib/booking-priority.ts` (lead time).
All three are dependency-free modules so the browser and the server share one
definition.

**Adoption → everything.** Completing an adoption rewrites `Pet.ownerId` and
`Pet.ownedSince`. Because every access predicate reads those two columns, that
single write moves the record, severs the shelter's vets and caretakers, and
grants the adopter — atomically, with no revocation pass. See §3 and §14.

**Status machines → notifications.** Bookings, appointments, orders,
subscriptions and adoptions all announce through the single `notify()` function,
which also mirrors to email.

## 2.4 What is deliberately absent

Not gaps — decisions, each documented at its site:

- **Nobody is paid out.** Money comes in; caretakers, vets and shelters receive
  nothing and Leash takes no commission. Bookings and appointments *record* a
  price and charge no one.
- **No shelter ratings.** `ShelterProfile` has no `rating`/`reviewCount`
  because `Review.kind` has no `"adoption"` arm yet. Shipping the column first
  is the mistake `backgroundCheckStatus` already made.
- **No review edit or delete.** Ratings fold into a running average with no
  inverse.
- **No foster model.** A fostered animal is a pet under a long boarding
  booking, which is why completing an adoption refuses while one is open.
- **No SMS or push.** Email only.

---

# 2.5 Feature-by-feature detail

Each entry: what it does · where the code is · what state it is in.

## Caretaker bookings

**Owner side.** Search at `/search` by service type, location + radius, species,
dates and price. Open a caretaker at `/caretaker/[id]` — profile, rate card,
availability calendar, reviews. Book at `/booking/new` (a three-step draft in
`useBookingDraft`). Track at `/booking/[id]`, message the caretaker, review once
complete.

**Caretaker side.** `/dashboard` (caretaker role) lists requests; accept or
decline; `/dashboard/caretaker-profile` edits the profile, rate card and
availability.

| Layer | Files |
|---|---|
| Pages | `app/search`, `app/caretaker/[id]`, `app/booking/new`, `app/booking/[id]`, `app/dashboard/caretaker-profile` |
| Components | `CaretakerCard`, `AvailabilityCalendar`, `booking/BookingNewClient`, `booking/MessageThread`, `dashboard/CaretakerDashboard`, `search/SearchResults` |
| API | `/api/caretakers/search`, `/api/caretakers/[id]`, `/api/bookings`, `/api/bookings/[id]{,/status,/messages,/reviews}` |
| Server | `lib/server/caretakers.ts`, `bookings.ts`, `messages.ts` |
| Tests | `caretakers.test.ts`, `bookings.test.ts`, `messages.test.ts` |

**Status: complete, with two caveats.** No money moves — `Booking.priceTotal` is
server-authoritative but nobody is charged and nobody is paid. Search filters
**in memory** with no text search and no pagination. Read receipts are dead
(§13.4.2), and the route guard has no test.

## Vet care

Search at `/vets` by specialty, consult mode (`in_person | video | chat`),
species and location. Book at `/vets/book`. The appointment page
`/appointments/[id]` is where a vet writes the visit summary — and that write is
the whole point of the subsystem: a `visit_note`, a `vaccination` with a
`nextDueAt`, or a **`prescription` carrying `productSlugs`**, which is what
unlocks Rx products in the store.

| Layer | Files |
|---|---|
| Pages | `app/vets`, `app/vets/[id]`, `app/vets/book`, `app/appointments/[id]`, `app/dashboard/vet-profile` |
| Components | `vet/VetCard`, `VetSearchResults`, `AppointmentBookingClient`, **`VisitSummaryForm`**, `VetProfileForm`, `dashboard/VetDashboard` |
| API | `/api/vets/search`, `/api/vets/[id]`, `/api/appointments`, `/api/appointments/[id]{,/status,/reviews}`, `/api/vets/[id]/appointments` |
| Server | `lib/server/vets.ts`, `appointments.ts`, `pricing-vet.ts` |
| Tests | `vets.test.ts`, `appointments.test.ts`, `entitlements.test.ts` |

**Status: complete.** Fees are **Float USD**, not cents (§5.1). Nobody is
charged. The member consult discount and the 2-hour lead time are both enforced
and tested. ⚠️ `VisitSummaryForm` has three real defects — B-10.

## The pet health record

One timeline per pet at `/dashboard/pets/[id]`. Six record types:
`visit_note | vaccination | prescription | lab_result | weight | allergy`.

**Who may write what** is two gates: `canAccessPetRecords` decides *whether*
(owner, or a vet with a qualifying appointment made under the current owner),
and the route decides *what* — **an owner may author only `weight` and
`allergy`**; the treating vet may author all six.

**Who may delete:** the **author**, not the owner. *"A health record its subject
can rewrite is not a record."*

| Layer | Files |
|---|---|
| Pages | `app/dashboard/pets/[id]`, `app/dashboard/pets/new`, `app/pet-health` |
| Components | `vet/HealthRecordSection`, `vet/MedicalRecordCard`, `PetForm` |
| API | `/api/pets/[id]/medical-records`, `/api/medical-records/[id]`, `/api/pets/[id]/appointments` |
| Server | `lib/server/medical-records.ts`, `access.ts` |
| Tests | `medical-records.test.ts`, `access.test.ts` |

**Status: complete, with one thing that looks finished and is not.**
`refillsLeft` is displayed and never decremented (§13.4.1).

## The store

25 seeded products. Browse `/store`, filter by category, species, life stage,
brand and price, and **shop "for" a pet** — which sets `petId` on the cart and
turns on both the allergen warning and the prescription gate. `/store/[slug]`,
`/store/cart`, `/store/checkout`, `/store/orders`, `/store/orders/[id]`.

Fulfilment is time-based: `FULFILMENT_SCHEDULE` in `lib/delivery.ts` earns
`processing` at 1 h, `packed` at 6 h, `shipped` at 24 h, `out_for_delivery` at
48 h, `delivered` at 60 h, advanced by the daily cron. Ops can override at
`/dashboard/orders`.

| Layer | Files |
|---|---|
| Pages | `app/store/**`, `app/dashboard/orders` |
| Components | `store/*` (10 files) |
| API | `/api/products`, `/api/brands`, `/api/orders{,/quote,/[id],/[id]/cancel,/[id]/status,/[id]/payment/sync}`, `/api/ops/orders`, `/api/cron/advance-orders` |
| Server | `lib/server/orders.ts` (686 lines), `products.ts`, `fulfillment.ts`, `reservations.ts` |
| Shared | `lib/pricing.ts`, `lib/delivery.ts` |
| Tests | `orders.test.ts`, `products.test.ts`, `fulfillment.test.ts` |

**Status: complete and the most heavily tested subsystem.** ⚠️ It also carries
the audit's highest finding — `POST /api/orders` does not check pet ownership
(§11.7 S-1).

## Payments and Leash Plus

A `PaymentProvider` seam with an `asynchronous` flag; a demo provider settles
inline through the **same reconciler** as Stripe, so the code path is not
special-cased for the demo. The ledger (`Payment`, `Refund`) is keyed on
`providerRef`, and `applyIntentState` is the single reconciler.

**Leash Plus** buys three things, each enforced in a different dependency-free
module: free shipping (`lib/pricing.ts`), a vet consult discount
(`lib/pricing-vet.ts`), and a 2-hour booking lead time instead of 24
(`lib/booking-priority.ts`).

| Layer | Files |
|---|---|
| Pages | `app/plus`, `app/account/membership`, `app/dashboard/admin/payments`, `.../subscriptions` |
| API | `/api/membership/*`, `/api/webhooks/stripe`, `/api/admin/payments/*` |
| Server | `lib/server/payments.ts`, `payments/ledger.ts`, `payments/stripe-*.ts`, `subscriptions.ts`, `entitlements.ts`, `webhooks/stripe.ts` |
| Tests | `webhooks.test.ts`, `stripe-signature.test.ts`, `entitlements.test.ts` |

**Status: built, tested, and inactive.** Without Stripe keys the demo provider
settles orders inline and membership checkout returns **503** rather than
pretending. See §4 and §10.5.

## Shelter adoption

Browse `/adopt`, open `/adopt/[id]`, apply, pay the fee, and receive the animal
**with its entire health record** — because a shelter's animals are ordinary
`Pet` rows the shelter owns, and completing an adoption transfers ownership.

The shelter side is `/dashboard` (shelter role) and `/dashboard/shelter-profile`;
applications are at `/adoptions/[id]`.

| Layer | Files |
|---|---|
| Pages | `app/adopt`, `app/adopt/[id]`, `app/adoptions/[id]`, `app/shelters/[id]`, `app/dashboard/shelter-profile` |
| Components | `adoption/AdoptionCard`, `AdoptionResults`, `shelter/ShelterProfileForm`, `dashboard/ShelterDashboard` |
| API | `/api/shelters/*`, `/api/adoptions/listings*`, `/api/adoptions/applications*`, `/api/admin/adoptions/[id]/reverse` |
| Server | `lib/server/shelters.ts`, `adoptions/{listings,applications,payment,transfer}.ts` |
| Tests | `adoption-transfer.test.ts`, `access.test.ts` |

**Status: complete.** The transfer, the severing, the race guard, the
live-engagement override and the staff reversal route are all built and tested.
Deliberately absent: shelter ratings, a foster model, meet-and-greet scheduling
(§2.4).

## Support assistant ("Scout")

A floating chat on every page. 27 tools signed in, 23 anonymous. Answers
platform and pet-health questions, reads the signed-in customer's own records,
and cancels orders, bookings and appointments. **Never buys or books** — those
return pre-filled deep links.

Fully documented in **§9**, including eight open issues.

**Status: working, with a broken rehydration path and a stale corpus.**

## Admin console

`/dashboard/admin` — stats, users, professionals, payments, subscriptions,
settings, audit. Four staff roles (`ops | support | finance | admin`, where
`admin` implies all). **Every mutation is audited** via `recordAdminAction()`.

Fully documented in **§15.6**.

**Status: complete.**

## Auth

Password sign-in, Google OAuth (hidden until configured), email verification,
password reset, session revocation without a session table, account suspension.

Fully documented in **§3**.

**Status: complete; Google inactive pending credentials.**
