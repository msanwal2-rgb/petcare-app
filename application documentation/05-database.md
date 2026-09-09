# 5. The database

Neon serverless Postgres, Prisma **6.19.3**, 32 models, 15 migrations,
`pgvector` for the assistant's corpus.

```
POSTGRES_PRISMA_URL       pooled  — the app
POSTGRES_URL_NON_POOLING  direct  — migrations (directUrl)
```

## 5.1 Four conventions that are not negotiable

Read these before writing any query. They are stated in the schema header and
enforced everywhere.

**1. Every timestamp is an ISO-8601 `String`, not `DateTime`.** The frontend
produces and consumes them, ISO-8601 sorts lexicographically *and*
chronologically, and there is no timezone drift on the wire. So
`createdAt: { gte: "2026-01-01T00:00:00.000Z" }` is a plain indexed string
comparison and works exactly as a date range. `nowIso()` in `lib/server/ids.ts`
is the single producer. **Never introduce a `DateTime` column** — sorting would
silently split into two regimes.

**2. There are no Prisma enums.** Roles, statuses, species, categories are
`String` or `String[]`, validated by Zod at the API boundary
(`lib/validation/schemas.ts`) and typed as unions in `types/index.ts`. Adding a
status means editing the Zod enum and the TS union, not a migration. The cost:
the database will accept anything a bug lets through, so the Zod schema *is* the
constraint.

**3. Money is split by domain, deliberately.** The store is **integer cents**
(`priceCents`, `subtotalCents`, `totalCents`); bookings and vet consults are
**Float USD** (`Booking.priceTotal`, `VetAppointment.fee`). `formatCents` in
`lib/utils.ts` is the only `/100` in the codebase. Do not "unify" these — the
Prisma schema documents the split as load-bearing, and payouts (unbuilt) span
both.

**4. Every domain function takes `db: PrismaClient = defaultPrisma` last.**
This is what makes the unit suite possible; see §12.

## 5.2 The models, by subsystem

| Subsystem | Models |
|---|---|
| Identity | `User`, `VerificationToken` |
| Pets & records | `Pet`, `MedicalRecord` |
| Caretaking | `CaretakerProfile`, `PricingEntry`, `AvailabilityDay`, `Booking`, `Message` |
| Vet care | `VetProfile`, `VetAvailabilityDay`, `VetAppointment` |
| Reviews | `Review` (one table, two subjects) |
| Store | `Product`, `Order`, `OrderItem`, `OrderEvent` |
| Payments | `Payment`, `Refund`, `Plan`, `Subscription`, `WebhookEvent` |
| Adoption | `ShelterProfile`, `AdoptionListing`, `AdoptionApplication` |
| Assistant | `AssistantConversation`, `AssistantMessage`, `KnowledgeChunk` |
| Platform | `Notification`, `AdminAuditLog`, `SystemSetting`, `RateLimitHit` |

## 5.3 The columns that carry the most weight

### `Pet.ownedSince String @default("1970-01-01T00:00:00.000Z")`

The authorization input for every non-owner grant. `canViewPet` and
`canAccessPetRecords` both add `createdAt: { gte: pet.ownedSince }` to the
booking/appointment lookup, so a grant counts only if the engagement was made
under the *current* owner.

**Why `ownedSince` rather than comparing `Booking.ownerId` to `Pet.ownerId`:**
decoupling. An `ownerId` match makes authorization depend on a *mutable*
column, so any future decision to backfill `VetAppointment.ownerId` would
silently reopen the hole. `createdAt` is written once and never touched.

**Why the epoch default:** seeded engagements carry fixed 2025–2026 dates.
Backfilled to `now()`, every non-owner grant in the seed would evaporate and the
demo would break. The epoch says honestly "we don't know when these began, so
grandfather them."

It is **server-only** — not on `toPet`, not on the `Pet` API type, because
putting it there would make `PetInput` demand it from `PetForm`. "At the shelter
since" is `AdoptionListing.intakeAt` instead.

### `Review.bookingId` — the name lies, on purpose

One table serves both marketplaces. The column stores a `Booking` id *or* a
`VetAppointment` id, depending on `kind`. The serializer renames it:

```ts
// lib/server/serialize.ts — the column is still called bookingId;
// `kind` says what it points at.
subjectId: r.bookingId,
```

So **`subjectId` is the API name and `bookingId` is the storage name.** This is
the single most confusing naming seam in the codebase.

Deliberately **not** a foreign key: reviews outlive the engagement.

### `Payment.providerRef @unique`

The reconciliation key. `applyIntentState` keys on it, which is why the payment
ledger needs no change to support a new `Payment.kind` (adoption fees were added
without touching it). See §4.

### `KnowledgeChunk.embedding Unsupported("public.vector(1536)")?`

Two things about this line are load-bearing:

- **`public.` is required.** Prisma's *schema engine* sets `search_path` to the
  target schema alone, so an unqualified `vector` dies with
  `type "vector" does not exist` on any push into `test`.
- **Nullable is required.** A *required* `Unsupported` column strips `create`
  and `update` off the generated client for the whole model.

Note the *query* engine behaves differently: `?schema=x` leaves `search_path` as
`"$user", public`, which is why raw SQL on `knowledge_chunks` must be
hand-qualified or a test run silently reads and writes production.

## 5.4 Relations and deletion

Real FKs with `onDelete: Cascade`: `Pet → User`, `Message → Booking`,
`MedicalRecord → Pet`, `OrderItem/OrderEvent → Order`, `Notification → User`,
`AssistantMessage → AssistantConversation`.

`MedicalRecord.appointmentId → VetAppointment` is **`SetNull`** — the record
outlives the visit.

**Deliberately not FKs:** `Review.bookingId`, `AdoptionApplication.listingId`,
`Message.fromUserId`, `MedicalRecord.vetId`/`authorUserId`. Each is a loose
indexed `String` so that closing an account does not erase the counterparty's
record of what happened. `AdoptionApplication` also denormalises
`petName`/`petPhotoUrl` for the same reason.

⚠️ `Pet.owner` is `onDelete: Cascade`, so **hard-deleting a shelter would take
its unadopted animals**. Latent only — admin deletion is soft (`status`), not a
row delete.

## 5.5 Migrations

`prisma/migrations/00000000000000_init` … `00000000000014_adoption_fee_payments`.

Generated with:

```
prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ... --script
```

into a new folder, then `npm run db:migrate` (`migrate deploy`). The diff route
exists to avoid Neon's shadow-database problem.

⚠️ **Every migration from 07 onward carries a header warning that
`prisma migrate diff` wants to drop `knowledge_chunks_embedding_idx`. Never
accept that drop.** It is a hand-written pgvector HNSW index that Prisma cannot
represent, so the diff sees it as drift on every single run.

## 5.6 Seeding

`npm run db:seed` → `prisma/seed.ts` → `lib/server/seed.ts` + `lib/seed-data/*`.

Ids are stable and human-readable: `u1`–`u25` users, `p1`–`p13`+ pets, `b*`
bookings, `a*` appointments, `o*` orders, `mr*` records. **Tests assert on these
ids**, so seed *additively* — `getPetsByOwner("u1") === ["p1","p2"]` is a real
assertion.

Demo password: any seed email + the value of `DEMO_PASSWORD`. Staff accounts use
`STAFF_PASSWORD`, which is deliberately not published in the README.

⚠️ **Seed data must leave each feature reachable.** Vet and caretaker reviews
both nearly shipped undemonstrable because every completed engagement was
already reviewed; `b17` and `a8` exist purely so a demo account can open those
forms.

⚠️ **Seed staleness is a known issue.** Orders, memberships and payments are
timed relative to seed time. Bookings, appointments and medical records are
still pinned to a fixed `TODAY = 2026-07-08`, so seeded "upcoming" items drift
into the past.

---

# 5.7 Full model reference

All 32 models, every column. Relation navigation fields are omitted except
where the FK behaviour matters. `?` = nullable. Every `String` timestamp is
ISO-8601.

## Identity

### `User` → `users`
| Column | Type | Notes |
|---|---|---|
| `id` | String @id | seeded as `u1`…`u25` |
| `name`, `email @unique`, `phone`, `avatarUrl` | String | |
| `roles` | String[] | `owner \| caretaker \| vet \| shelter` |
| `addressCity`, `addressState` | String | |
| `lat`, `lng` | Float | |
| `verified` | Boolean | email verified |
| `createdAt` | String | |
| `passwordHash` | String? | **null for accounts created purely via Google** |
| `isOps` | Boolean | ⚠️ **superseded by `staffRoles`**, read only through it; kept for one release |
| `staffRoles` | String[] | `ops \| support \| finance \| admin`; **never self-editable**, never in the role toggle |
| `googleId` | String? @unique | Google's stable subject id; unique so two accounts cannot claim one identity |
| `status` | String | `active \| suspended \| deleted` — checked in `requireUser()` |
| `suspendedAt`, `suspendedReason` | String?/String | |
| `deletedAt` | String? | **soft delete** — the row stays so orders, payments and reviews keep their author; personal data is scrubbed |
| `lastLoginAt` | String? | |
| `sessionsValidFrom` | String? | ⚠️ **the only revocation mechanism** with JWT sessions and no adapter. Bumped on password reset, suspension, and admin force-signout |
| `stripeCustomerId` | String? @unique | so a returning member is not billed as a stranger |

Index: `status`.

### `VerificationToken` → `verification_tokens`
`id` · `identifier` (userId for `verify_email`, **email** for `reset_password`) ·
`tokenHash @unique` · `type` · `expiresAt` · `createdAt`. Index: `identifier`.

Only the hash is stored — the token itself exists only in the email.

## Pets and records

### `Pet` → `pets`
| Column | Type | Notes |
|---|---|---|
| `id` | String @id | `p1`…`p13`+ |
| `ownerId` → `User` | String | **`onDelete: Cascade`** ⚠️ §5.4 |
| `ownedSince` | String @default(epoch) | **authorization input** — see §5.3 |
| `name`, `breed`, `sex`, `dob` | String | |
| `species` | String | `dog \| cat \| other` |
| `weightLbs` | Int | drives the feeding guide |
| `photoUrl`, `vaccinated` | String / Boolean | |
| `allergies` | String[] | **matched against `Product.allergens`** |
| `medications` | String[] | free text, distinct from `MedicalRecord` |
| `behaviorNotes`, `feedingInstructions` | String | |
| `vetName`, `vetPhone` | String | the household vet, free text — not a `VetProfile` link |

Index: `ownerId`.

### `MedicalRecord` → `medical_records`
| Column | Type | Notes |
|---|---|---|
| `petId` → `Pet` | String | Cascade |
| `appointmentId` → `VetAppointment?` | String? | **`SetNull`** — the record outlives the visit |
| `vetId` | String? | loose `VetProfile.id`, set when authored by a vet |
| `authorUserId` | String | loose; **only the author may delete** |
| `type` | String | `visit_note \| vaccination \| prescription \| lab_result \| weight \| allergy` |
| `title`, `details` | String | |
| `occurredAt` | String | the timeline sort key (desc) |
| `nextDueAt` | String? | drives "Coming due" within 60 days |
| **`medicationName`, `dosage`** | String? | prescription-only |
| **`refillsLeft`** | Int? | ⚠️ **never decremented** — §13.4.1 |
| **`expiresAt`** | String? | null = no end date, which **counts as valid** |
| **`productSlugs`** | String[] | ⚠️ **the entire store authorisation**; no FK to `Product.slug`, unvalidated |
| `createdAt` | String | |

Indexes: `petId`, `appointmentId`.

## Caretaking

### `CaretakerProfile` → `caretaker_profiles`
`id` · `userId @unique` → `User` (Cascade) · `bio` · `servicesOffered[]` ·
`serviceRadiusMiles` · `acceptedSpecies[]` · `fencedYard` · `hasOtherPets` ·
`smokeFree` · `certifications[]` · `backgroundCheckStatus`
(`verified|pending|none` — ⚠️ **display-only, no vendor behind it**) ·
`rating` Float · `reviewCount` Int · `responseRatePct` Int.

⚠️ `rating` is stored at **full float precision** deliberately — rounding a
stored accumulator lets a 127-review profile absorb unlimited 1-stars without
moving. `RatingStars` does the `toFixed(1)`.

### `PricingEntry` → `pricing_entries`
`caretakerId` → Cascade · `serviceType` · `unit` (`hour|day`) · `rate` Float.

### `AvailabilityDay` → `availability_days`
`caretakerId` → Cascade · `date` · `slots` **Json** `{start, end}[]`.

### `Booking` → `bookings`
| Column | Type | Notes |
|---|---|---|
| `ownerId` | String | loose |
| `caretakerId` | String | ⚠️ **`CaretakerProfile.id`, not a `User.id`, and not a FK** |
| `petIds` | String[] | array, not a join table — `has petId` is the access lookup |
| `serviceType` | String | `walk \| sit \| board \| daycare` |
| `startDateTime`, `endDateTime` | String | |
| `notes` | String | |
| `status` | String | `requested \| accepted \| declined \| in_progress \| completed \| cancelled` |
| `priceTotal` | **Float USD** | ⚠️ not cents — §5.1 |
| `createdAt` | String | ⚠️ **compared against `Pet.ownedSince`** to decide caretaker access |

Indexes: `ownerId`, `caretakerId`.

### `Message` → `messages`
`bookingId` → `Booking` **Cascade** (the only real FK of the four social
subsystems) · `fromUserId` (loose) · `body` · `createdAt` · `readAt?`
(⚠️ dead — §13.4.2). Index: `bookingId`.

**There is no message model for appointments, adoptions or orders.**

## Vet care

### `VetProfile` → `vet_profiles`
`id` · `userId @unique` → Cascade · `clinicName` · `bio` · `specialties[]` ·
`licenseNumber` · `licenseState` · `verificationStatus` (@default `none`) ·
`yearsExperience` · `acceptedSpecies[]` · `consultModes[]` · `consultFee`
**Float** · `emergencyAvailable` · `clinicCity` · `clinicState` · `lat` · `lng` ·
`rating` · `reviewCount` · `responseRatePct`.

### `VetAvailabilityDay` → `vet_availability_days`
`vetId` → Cascade · `date` · `slots` Json.

### `VetAppointment` → `vet_appointments`
| Column | Type | Notes |
|---|---|---|
| `ownerId` | String | ⚠️ **a snapshot, written once, never reconciled** — this is precisely why `ownedSince` does not compare against it |
| `vetId` → `VetProfile` | String | real FK, Cascade |
| `petId` → `Pet` | String | real FK, Cascade |
| `mode` | String | `in_person \| video \| chat` |
| `reason` | String | ⚠️ **user-controlled free text, interpolated into email HTML** — §11.7 S-2 |
| `symptoms` | String[] | |
| `startDateTime`, `endDateTime` | String | |
| `status` | String | `requested \| confirmed \| declined \| completed \| cancelled` |
| `baseFee`, `fee` | **Float USD** | `fee` is the charged figure after the member discount |
| `discountPct` | Int | the Leash Plus consult benefit, snapshotted |
| `priority` | Boolean | booked inside the member lead time |
| `createdAt` | String | ⚠️ **compared against `Pet.ownedSince`** to decide vet record access |

Indexes: `ownerId`, `vetId`, `petId`.

## Reviews

### `Review` → `reviews`
| Column | Type | Notes |
|---|---|---|
| `bookingId` | String | ⚠️ **the name lies** — holds a `Booking` id *or* a `VetAppointment` id. Serialized as `subjectId`. Not a FK: reviews outlive the engagement |
| `kind` | String | `booking \| vet_appointment` — says what `bookingId` points at |
| `fromUserId`, `toUserId` | String | loose |
| `rating` | Float | ⚠️ schema accepts `0` and non-integers (§11.8) |
| `comment` | String | no minimum length |
| `createdAt` | String | |

Indexes: `toUserId`, `bookingId`. ⚠️ Neither the subject lookup nor the
duplicate check filters on `kind` — B-13.

## Store

### `Product` → `products`
`id` · `slug @unique` · `name` · `brand` · `description` · `category` ·
`species[]` · `lifeStage[]` · `sizeLabel` · `weightLbs` Float ·
**`priceCents` Int** · `compareAtPriceCents` Int? (drives the "Sale" pill) ·
`imageUrl` · `ingredients[]` · **`allergens[]`** (matched against
`Pet.allergies`) · **`requiresPrescription`** · `stockQty` ·
`active` · `rating` · `reviewCount` · `createdAt`.

Indexes: `category`, `active`.

### `Order` → `orders`
| Column | Type | Notes |
|---|---|---|
| `userId` → `User` | String | Cascade |
| `status` | String | `pending_payment \| paid \| processing \| packed \| shipped \| out_for_delivery \| delivered \| cancelled \| refunded` |
| `paymentStatus` | String | `unpaid \| paid \| refunded \| partially_refunded \| failed` — **distinct from `status`** |
| `paymentRef` | String? | the provider intent id |
| `subtotalCents`, `shippingCents`, `taxCents`, `totalCents` | Int | server-computed, never client |
| `shipName` … `shipPhone`, `deliveryInstructions` | String | flattened address; the serializer rebuilds it nested |
| `carrier`, `trackingNumber` | String? | |
| `placedAt` | String | **the fulfilment clock** — `earnedStatus` reads it |
| `estimatedDeliveryAt`, `deliveredAt` | String? | |
| `reservationExpiresAt` | String? | the abandoned-checkout sweep; the Hobby-cron reclaimable design |
| `benefitsApplied` | String[] | e.g. membership free shipping, for the receipt |

Indexes: `userId`, `status`, **`[status, reservationExpiresAt]`** (the sweep).

### `OrderItem` → `order_items`
`orderId` → Cascade · `productId` → **`onDelete: Restrict`** (a product with
order history cannot be deleted) · `name`, `brand`, `imageUrl`, `slug`,
`unitPriceCents`, `quantity`, `lineTotalCents` — **denormalised at purchase**, so
a later price or rename does not rewrite history.

### `OrderEvent` → `order_events`
`orderId` → Cascade · `status` · `label` · `description` · `location?` ·
`occurredAt`. Drives the tracking timeline.

## Payments

### `Payment` → `payments`
| Column | Type | Notes |
|---|---|---|
| `userId` → `User` | String | Cascade |
| `kind` | String | `order \| subscription \| adoption_fee` |
| `orderId`, `subscriptionId` | String? | |
| `adoptionApplicationId` | String? **@unique** | one fee per application |
| `provider` | String | `stripe \| demo` |
| **`providerRef`** | String **@unique** | ⚠️ **the reconciliation key** — `applyIntentState` keys on this alone, which is why new payment kinds need no ledger change |
| `status` | String | `unpaid \| pending \| paid \| failed \| refunded \| partially_refunded` |
| `amountCents`, `amountRefundedCents`, `currency` | | |
| `methodBrand`, `methodLast4` | String | ⚠️ **PII — purged by the cron** |
| `failureCode`, `failureMessage` | String | |
| `lastEventAt` | String | orders webhook events |
| `createdAt`, `updatedAt`, `succeededAt?` | | |

Indexes: `orderId`, `[userId, createdAt]`, `status`.

### `Refund` → `refunds`
`paymentId` → Cascade · `providerRef? @unique` · `amountCents` · `status`
(`pending|succeeded|failed`) · `reason` · `initiatedBy` (@default `system`) ·
`note` · `createdAt` · **`settledAt?`**.

⚠️ `settledAt` is what makes `settleRefund` idempotent. A past bug set it in
`requestRefund`, so the settle call saw `alreadyCounted` and totals never moved.

### `Plan` → `plans`
`key @unique` · `name` · `description` · `priceCents` · `currency` · `interval` ·
**`stripeProductId`, `stripePriceId`** (⚠️ empty until Stripe is provisioned) ·
`entitlements[]` · `consultDiscountPct` · `active` · `createdAt`.

### `Subscription` → `subscriptions`
`userId` → Cascade · `planId` → `Plan` · `provider` · **`providerRef @unique`** ·
`providerCustomerId` · `status` (`incomplete|active|past_due|canceled|unpaid`) ·
`currentPeriodStart/End` · `cancelAtPeriodEnd` · `canceledAt?` · `endedAt?` ·
**`graceEndsAt?`** (dunning — benefits survive a failed payment for a window) ·
`latestInvoiceRef` · `lastEventAt` · `createdAt` · `updatedAt`.

Indexes: `[userId, status]`, `[status, currentPeriodEnd]`.

### `WebhookEvent` → `webhook_events`
`id` (**the provider's event id** — this is what makes the claim atomic) ·
`provider` · `type` · `apiVersion` · `eventAt` · `payload` **Json** ·
`status` (`received|processing|processed|failed`) · **`attempts`** ·
**`lockedAt?`** · `error` · `receivedAt` · `processedAt?`.

`attempts` + `lockedAt` are what distinguish **new / duplicate / retry /
in_flight / exhausted** (§14.6). ⚠️ `payload` holds customer emails and card
last-fours — the cron purge is a privacy measure.

## Adoption

### `ShelterProfile` → `shelter_profiles`
`userId @unique` → Cascade · `name` (the **shelter's**, distinct from the account
holder's) · `bio` · `kind` (`municipal|rescue|sanctuary|foster_network`) ·
`registrationNumber`, `registrationState` (the licence analogue) ·
`verificationStatus` · `acceptedSpecies[]` · `websiteUrl`, `phone`, `email` ·
`addressLine`, `city`, `state`, `lat`, `lng` · `adoptionPolicy` ·
`responseRatePct` · `createdAt`. Index: `[city, state]`.

**No `rating`/`reviewCount`, deliberately** — §2.4. **No availability relation** —
a shelter is not booked by the hour.

Shelter animals are ordinary `Pet` rows with `ownerId = shelterProfile.userId`
(the **User**, not the profile), so the transfer needs no special case.

### `AdoptionListing` → `adoption_listings`
`shelterId` · **`petId @unique`** → `Pet` Cascade (unique and **reused on
relist** — a partial unique index is not expressible in `schema.prisma` and
would become permanent `migrate diff` noise) · `status`
(`draft|available|pending|adopted|withdrawn`) · **`feeCents`**, `currency` ·
`headline`, `story` · the filters adopters actually use —
`goodWithKids|goodWithDogs|goodWithCats` (`yes|no|unknown`), `houseTrained`,
`energyLevel`, `specialNeeds` + notes, `spayedNeutered`, `microchipped` ·
its **own** `city/state/lat/lng` (where the animal *is*) · **`intakeAt`** (the
public "at the shelter since", the display counterpart to `ownedSince`) ·
`publishedAt?`, `closedAt?` · `createdAt`, `updatedAt`.

Indexes: `status`, `shelterId`.

### `AdoptionApplication` → `adoption_applications`
| Column | Notes |
|---|---|
| `listingId` | ⚠️ **a plain indexed String with no FK**, following the `Review.bookingId` precedent — a cascade from the shelter would erase an adopter's record of "I adopted Rex on 2026-09-12" when the shelter closes its account |
| `shelterId`, `petId` | loose, same reason |
| `petName`, `petPhotoUrl` | **denormalised**, same reason |
| `applicantId` → `User` | real FK, Cascade |
| `status` | `submitted \| under_review \| approved \| rejected \| withdrawn \| completed` |
| `feeCents` | **snapshotted at submission**, like `VetAppointment.baseFee` |
| `householdAdults`, `householdChildren`, `hasOtherPets`, `otherPetsNotes`, `homeType`, `fencedYard`, `ownsHome`, `hoursAlonePerDay`, `experience` | **flat columns, not `Json`** — the shelter filters its queue on them |
| `message`, `decisionNote` | |
| `decidedAt?`, `completedAt?`, `createdAt`, `updatedAt` | |

Indexes: `listingId`, `applicantId`, `[shelterId, status]`.

**At most one application per listing may be `approved`**, and approving moves
the listing to `pending` — which is what makes co-applicant refunds impossible,
because nobody pays before approval.

## Assistant

### `AssistantConversation` → `assistant_conversations`
`id` · **`userId?`** → Cascade · **`clientKey`** · `title` · `createdAt` ·
`updatedAt`. Indexes: `[userId, updatedAt]`, `[clientKey, createdAt]`.

Scope is `userId ? {userId} : {userId: null, clientKey}` — **never either
alone**, so a shared device cannot surface the previous visitor's thread.

⚠️ `title` must be **omitted** rather than set to `undefined` on update —
Prisma reads an explicit `{set: undefined}` as malformed.

### `AssistantMessage` → `assistant_messages`
`conversationId` → Cascade · `role` · `parts` **Json** · `text` · `modelId` ·
**`inputTokens`, `outputTokens`** (⚠️ always `0` — §13.4.4) · `createdAt`.

### `KnowledgeChunk` → `knowledge_chunks`
`sourceKey @unique` · `source` (`policy|faq|guide|vaccine`) · `title` · `href` ·
`species[]` (empty = all) · `content` · **`contentHash`** (SHA-256; makes ingest
idempotent) · `tokens` · **`embedding Unsupported("public.vector(1536)")?`** ·
`createdAt` · `updatedAt`. Index: `source`.

⚠️ Not in `SEED_TABLES` — deliberately, §12.1. ⚠️ The HNSW index on `embedding`
is hand-written and every `migrate diff` tries to drop it, §5.5.

## Platform

### `Notification` → `notifications`
`userId` → Cascade · `kind` (a **19-member** TS union: 2 booking, 3 appointment,
4 order, 4 membership, 6 adoption — the column is a plain `String`) · `title` ·
`body` · **`href`** (unvalidated free text; every producer builds it by hand) ·
`readAt?` · `createdAt`. Index: `[userId, createdAt]`.

### `AdminAuditLog` → `admin_audit_log`
`actorUserId` → `User` Cascade · `action` · `targetType` · `targetId` ·
`summary` · `metadata` Json? · `ip` · `createdAt`.
Indexes: `[actorUserId, createdAt]`, `[targetType, targetId]`,
`[action, createdAt]`.

### `SystemSetting` → `system_settings`
**`key` is the primary key** · `value` Json · `updatedAt` · `updatedBy`.
Maintenance mode lives here.

### `RateLimitHit` → `rate_limit_hits`
`bucket` · `key` · `createdAt`. Index: `[bucket, key, createdAt]`.

A **true sliding window**, not an hourly bucket — possible only because ISO-8601
strings compare chronologically, so `createdAt: { gte: <an hour ago> }` is a
plain indexed comparison. Purged by the cron.
