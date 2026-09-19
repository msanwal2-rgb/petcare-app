# Leash — Full Project Analysis

A single-document orientation to this codebase: what the product is meant to be,
what actually exists, what technology it runs on, where every layer lives, and
what is unfinished.

Written from a direct read of the source at commit `fc9537f` (branch `main`).
Where a claim comes from the existing `application documentation/` set rather
than from code I opened myself, it is marked *(docs)*.

---

## 0. The 60-second answer

| Question | Answer |
|---|---|
| **What is it?** | "Leash" — a pet-care marketplace with four domains (caretakers, vets, store, shelter adoption) built around **one shared pet health record**. |
| **Is there a separate backend?** | **No.** It is a single Next.js application. The backend is Next.js **Route Handlers** inside the same repo, same deployment. |
| **Does the backend have APIs?** | **Yes — 81 REST route files**, ~110 endpoints, all under `app/api/`. Full contract in `API_CONTRACTS.md`. |
| **Where is the frontend?** | `app/` (44 pages), `components/` (75 components), `lib/api/` (client fetch layer), `lib/store/` (Zustand). |
| **Where is the backend?** | `app/api/**/route.ts` (thin HTTP layer) → `lib/server/**` (66 domain files, all the logic) → Prisma. |
| **Database?** | **PostgreSQL** (hosted on **Neon**) via **Prisma 6**, plus the **pgvector** extension for the AI assistant's retrieval. 32 models. |
| **Auth?** | **Auth.js v5** (`next-auth@5 beta`), JWT sessions, email+password (bcrypt) + optional Google OAuth. |
| **Payments?** | **Stripe** behind a provider seam; currently running the built-in demo provider because no keys are set. |
| **Hosting?** | **Vercel**, deployed from `main`. Production: `https://petcare-app-drab.vercel.app` *(docs)* |
| **Scale** | 440 tracked files, ~47,000 lines of TS/TSX, 28 Vitest suites, 27 commits. |
| **Maturity** | Feature-complete demo/portfolio-grade product. Real auth, real DB, real domain logic, real tests — but **no payouts, no money leaving the platform**, and a handful of known defects (§10). |

---

## 1. The product requirement

### 1.1 Where the requirement came from

The original brief lives in `docs/pet-care-marketplace-foundation.md` (v0.1). It
specified a **two-sided marketplace connecting pet owners with caretakers** for
walking, sitting, boarding and daycare — explicitly modelled on Rover / Wag /
Airbnb. The stated hard parts were *identity/trust, scheduling and payments*,
not UI.

The original spec asked for:

- **Roles**: Owner, Caretaker — one `User` account able to hold both (the doc
  recommends this over separate account types, and the build followed it).
- **Profiles**: owner (address, geo, payment methods, emergency contact), pet
  (species, breed, vaccinations, allergies, medications, behaviour, feeding, vet
  contact), caretaker (services, pricing, availability calendar, radius, home
  environment, certifications, background-check status, ratings).
- **Core workflow**: search → request → accept/decline → pay → service window →
  complete → bidirectional review, with an explicit cancellation policy.
- **Data model** centred on `Booking` as the hub object.
- **Compliance**: PCI-DSS (never touch raw cards), GDPR/CCPA, background checks,
  KYC, marketplace-facilitator liability, WCAG 2.1 AA.
- **Recommended stack**: Next.js + TS + Tailwind frontend, **NestJS backend as a
  separate service**, Postgres + PostGIS, Prisma, managed auth (Clerk/Auth0),
  Stripe Connect, Vercel + Neon.
- **Build phases**: (1) MVP booking end-to-end, (2) trust & retention, (3) scale
  — geo search, mobile app, admin console.

### 1.2 What the build actually decided (and where it diverged)

These divergences are deliberate and documented in the code. They matter because
they are the things a new developer will be surprised by.

| Spec said | Build did | Why |
|---|---|---|
| Separate NestJS API service | **Next.js Route Handlers in the same app** | Velocity. The spec called this out as an explicit team decision with "future refactor risk" — the risk was taken. A mobile client would still work: the API is plain REST/JSON, not tRPC, so it is not TypeScript-coupled. |
| Managed auth (Clerk/Auth0) | **Self-hosted Auth.js v5** | Cost/control. Sessions are JWT with **no database adapter**, which forced a hand-built revocation mechanism (`User.sessionsValidFrom`). |
| PostGIS for geo | **Plain lat/lng + in-memory distance filtering** (`lib/geo.ts`) | Simpler. The cost: caretaker and vet search have **no text search and no pagination**. |
| Stripe Connect (marketplace splits) | **Stripe Payments only** | Payouts are not built at all (§10.4). Money comes in; nothing goes out. |
| Escrow / auth-then-capture | **Immediate capture on the store only** | Bookings and appointments record a price and charge nobody. |
| Real-time chat (Socket.io/Pusher) | **8-second polling** in `MessageThread` | No realtime infrastructure. |
| BullMQ + Redis background jobs | **One Vercel cron** (`vercel.json` → `/api/cron/advance-orders`, daily 03:00) | Enough for simulated fulfilment. |
| Owner + Caretaker roles | **Owner, Caretaker, Vet, Shelter** + 4 staff roles | Scope grew well beyond the brief. |

### 1.3 What the product became

The product is materially larger than the original brief. The organising idea —
stated in the README and visible throughout the schema — is **one shared pet
health record** that all four domains read and write:

1. **Caretakers** (the original brief) — search, book, message, review.
2. **Vets** — a mirrored marketplace. Vets hold licences, availability and
   consult modes; appointments mirror bookings; the durable output is a
   **medical record** written into the pet's file.
3. **Store** — pet food and supplies. **Prescription-only products are unlocked
   by the prescriptions a vet wrote into that pet's record.** This is the
   cross-module seam that justifies the whole architecture.
4. **Shelter adoption** — shelters list animals, owners apply, a fee is paid,
   and on completion **the entire health record transfers with the animal**.

Plus three cross-cutting systems:

5. **Leash Plus membership** — a Stripe subscription granting server-enforced
   entitlements: `free_shipping`, `vet_consult_discount`, `priority_booking`.
6. **Admin/ops console** at `/dashboard/admin` — users, professional
   verification, payments ledger, refunds, subscriptions, system settings,
   audit log.
7. **An LLM support assistant** — a floating chat on every page that answers
   questions, reads the signed-in customer's own records, and cancels things.

---

## 2. Technology stack

### 2.1 Frontend

| Thing | Version | Notes |
|---|---|---|
| **Next.js** | `16.2.10` | **App Router.** ⚠️ Next 16 renames `middleware.ts` → **`proxy.ts`**. |
| **React** | `19.2.4` | |
| **TypeScript** | `^5` | `strict: true`, path alias `@/*` → repo root. |
| **Tailwind CSS** | `v4` | **No `tailwind.config.js`.** Design tokens live in `app/globals.css` under `@theme`. |
| **Framer Motion** | `^12` | Shared easing curves in `lib/motion.ts`, mirrored in CSS. |
| **Zustand** | `^5` | Three stores: `session`, `cart` (localStorage-persisted), `booking-draft`. |
| **React Hook Form** + `@hookform/resolvers` | `^7` / `^5` | Forms, with Zod resolvers. |
| **sonner** | `^2` | Toasts. |
| **`@stripe/react-stripe-js`** | `^6` | Card element on checkout. |
| **`@ai-sdk/react`** | `3.0.269` | `useChat` for the assistant panel. |

**Design system** — palette (`ink` `#1b3b36`, `marigold` `#f2a93b`, `leash`
`#e85c41`, `fog`, `charcoal`, `mist`), fonts Space Grotesk / Inter / IBM Plex
Mono via `next/font`, `--radius-card: 12px`.

### 2.2 Backend

| Thing | Version | Notes |
|---|---|---|
| **Next.js Route Handlers** | — | The entire HTTP API. Node runtime. |
| **Prisma** | `^6.19.3` | **Pinned to 6.x** — Prisma 7 requires Node ≥ 20.19 and this project runs 20.18. |
| **PostgreSQL** | — | Hosted on **Neon**. Two URLs: `POSTGRES_PRISMA_URL` (pooled, queries) and `POSTGRES_URL_NON_POOLING` (migrations). |
| **pgvector** | — | `CREATE EXTENSION vector`, HNSW cosine index on `knowledge_chunks.embedding vector(1536)`. |
| **Auth.js (NextAuth)** | `^5.0.0-beta.32` | JWT strategy, no DB adapter. |
| **bcryptjs** | `^3` | Password hashing. |
| **Zod** | `^4.4.3` | Validation at **every** write boundary. Schemas in `lib/validation/`. |
| **Stripe** | `^22.6.1` | Server SDK. |
| **Vercel AI SDK** | `ai@6.0.266` | **Pinned to v6** — v7 requires Node ≥ 22. |

### 2.3 Tooling

`ESLint 9` (`eslint-config-next`) · `Vitest 4` · `playwright-core` (custom e2e
runner in `scripts/e2e/`) · `tsx` · `dotenv-cli`.

### 2.4 Runtime constraint worth knowing

**Node 20.18** is the ceiling that pins both Prisma (6.x) and the AI SDK (v6).
Upgrading Node is the unlock for both. *(docs)*

---

## 3. Where everything lives

There is **one repository and one deployable**. Frontend and backend are the
same Next.js app.

```
petcare-app/
├── app/                          ── FRONTEND pages + BACKEND API, same tree
│   ├── layout.tsx, globals.css, page.tsx
│   ├── (public)     search/ caretaker/[id]/ vets/ store/ adopt/ shelters/
│   │                support/ plus/ pet-health/ login/ signup/ ...
│   ├── dashboard/   owner·caretaker·vet·shelter dashboards, pets/, orders/,
│   │                and admin/ (users, payments, subscriptions, professionals,
│   │                settings, audit)
│   └── api/         ◀── THE BACKEND. 81 route.ts files.
│
├── components/                   ── 75 React components
│   ├── ui/          primitives: Button, Field, Panel, StatusBadge,
│   │                ProgressLeash, ToggleChips, ProfileHero, Skeleton…
│   ├── vet/ store/ dashboard/ adoption/ admin/ assistant/ booking/
│   │                reviews/ search/ shelter/ notifications/
│   └── SiteHeader, SiteFooter, PetForm, RoleToggle, SessionSync…
│
├── lib/
│   ├── api/         ── CLIENT fetch layer, one file per domain (20 files).
│   │                   Pages and components call ONLY these. Never fetch().
│   ├── server/      ── BACKEND DOMAIN LOGIC (66 files). All business rules.
│   │   ├── admin/ adoptions/ assistant/ payments/ webhooks/
│   │   └── access.ts session.ts http.ts orders.ts bookings.ts vets.ts …
│   ├── store/       ── Zustand: session.ts, cart.ts, booking-draft.ts
│   ├── validation/  ── Zod schemas (schemas.ts, admin-schemas.ts)
│   ├── db/prisma.ts ── the singleton PrismaClient
│   ├── seed-data/   ── deterministic fixtures (only the seeder imports these)
│   ├── content/     ── support policy + pet-health copy, read by /support
│   ├── pricing.ts   ── shipping/tax, shared by server and cart (one definition)
│   ├── pricing-vet.ts, booking-priority.ts, delivery.ts, geo.ts, media/, motion.ts
│
├── prisma/
│   ├── schema.prisma  ── 32 models, 951 lines
│   ├── migrations/    ── 15 additive migrations, 00000000000000 … 14
│   └── seed.ts        ── entry; the work is in lib/server/seed.ts
│
├── types/index.ts     ── 964 lines. The shapes the API returns. Single source
│                         of truth shared by client and server.
├── auth.ts            ── Node-only Auth.js config (Credentials + Google)
├── auth.config.ts     ── Edge-safe base config (no DB/bcrypt imports)
├── proxy.ts           ── Next 16's middleware. Optimistic route protection.
├── tests/             ── 28 Vitest suites against a real Postgres `test` schema
├── scripts/e2e/       ── Playwright-core browser suite + sweep
├── docs/              ── original brief, frontend brief, going-live guide
├── application documentation/  ── 19-doc technical handover set
├── API_CONTRACTS.md · README.md · ROADMAP.md
└── vercel.json        ── the daily cron
```

### 3.1 The layer contract — this is the rule that matters

```
  Page / component (client)
        │   calls only ↓
  lib/api/<domain>.ts          fetch wrapper, throws ApiError
        │   HTTP ↓
  app/api/<...>/route.ts       auth guard → Zod parse → domain call → ok()
        │   calls ↓
  lib/server/<domain>.ts       ALL business logic. Takes an injectable
        │                      PrismaClient so tests can pass their own.
        │   ↓
  Prisma → Postgres
```

**Three things that follow from this and are easy to break:**

1. **Every page that fetches data is a client component.** There are no server
   actions and no server-side data loading. The few server components
   (`app/layout.tsx`, `SiteFooter`, `app/store/page.tsx`) render static shells.
   Fetching on the server would be a genuine architectural departure. *(docs)*
2. **Route handlers are thin.** If you are writing an `if` in a route handler
   that is not an auth check or an error mapping, it belongs in `lib/server/`.
3. **Authorization lives in route handlers, never in the client.** The Zustand
   session store is a cache; every write re-checks the real session.

---

## 4. The database

**PostgreSQL on Neon, via Prisma 6. 32 models.** Schema: `prisma/schema.prisma`.

### 4.1 Two conventions that are load-bearing

1. **All timestamps are ISO-8601 `String`, not `DateTime`.** ISO-8601 sorts
   lexicographically = chronologically, so ordering and range filters work on
   strings with no timezone drift. Do not "fix" this.
2. **There are no Prisma enums.** Enum-ish values are `String` / `String[]`,
   validated by Zod at the API boundary and typed in `types/index.ts`. This is
   what makes the migrations purely additive.

A third: **money is split by domain.** The store is **integer cents**
(`priceCents`, `totalCents`). Bookings and vet appointments are **Float USD**
(`Booking.priceTotal`, `VetAppointment.fee`). Any future payouts feature spans
both — this is called out in `ROADMAP.md` as a hazard.

### 4.2 The models, by domain

| Domain | Models |
|---|---|
| **Identity** | `User` (roles[], staffRoles[], status, sessionsValidFrom, googleId, stripeCustomerId), `VerificationToken` |
| **Pets** | `Pet` (incl. `ownedSince` — an *authorization input*, see §6.4) |
| **Caretakers** | `CaretakerProfile`, `PricingEntry`, `AvailabilityDay`, `Booking`, `Message`, `Review` |
| **Vets** | `VetProfile`, `VetAvailabilityDay`, `VetAppointment`, `MedicalRecord` |
| **Store** | `Product`, `Order`, `OrderItem`, `OrderEvent` |
| **Money** | `Payment`, `Refund`, `Plan`, `Subscription`, `WebhookEvent` |
| **Adoption** | `ShelterProfile`, `AdoptionListing`, `AdoptionApplication` |
| **Assistant** | `AssistantConversation`, `AssistantMessage`, `KnowledgeChunk` (pgvector) |
| **Platform** | `Notification`, `AdminAuditLog`, `SystemSetting`, `RateLimitHit` |

### 4.3 The status machines

Illegal transitions return **409**, not a corrupted record. One transitions
table per domain.

| Entity | States |
|---|---|
| `Booking` | `requested → accepted → in_progress → completed`; `declined`, `cancelled` terminal |
| `VetAppointment` | `requested → confirmed → in_progress → completed`; `declined`, `cancelled` terminal |
| `Order` | `pending_payment → paid → processing → packed → shipped → out_for_delivery → delivered`; `cancelled`, `refunded` terminal |
| `Order.paymentStatus` | `unpaid`, `pending`, `requires_action`, `processing`, `authorized`, `paid`, `partially_refunded`, `refunded`, `failed`, `disputed` |
| `AdoptionListing` | `draft` → published → … → `closed` |
| `AdoptionApplication` | `submitted` → decision → `completed` |

### 4.4 Migrations and seeding

15 additive migrations (`00000000000000_init` … `00000000000014_adoption_fee_payments`).
Deploy with `npm run db:migrate`; iterate with `db:migrate:dev`.

Seed data is deterministic, in `lib/seed-data/` (~2,800 lines), applied by
`lib/server/seed.ts`. It is wired so the cross-module behaviour is visible
immediately: Luna holds a current prescription unlocking an Rx-only cat food,
Biscuit's rabies booster is nearly due, four orders sit at different delivery
stages.

⚠️ **Seed freshness is a known issue.** Orders, memberships and payments are
timed relative to seed time; bookings, appointments and medical records are
pinned to a fixed `TODAY`, so seeded "upcoming" items drift into the past.

---

## 5. The API

**81 route files under `app/api/`.** REST + JSON. Full request/response shapes
in **`API_CONTRACTS.md`**; per-endpoint guards in
`application documentation/06-api-reference.md`.

Every handler follows the same four lines:

```ts
const auth = await requireUser();          // or requireStaff("finance")
if ("response" in auth) return auth.response;
const parsed = await parseBody(request, someZodSchema);
if ("response" in parsed) return parsed.response;
return ok(await domainFunction(auth.uid, parsed.data));
```

Helpers: `lib/server/http.ts` (`ok`, `error`, `notFound`, `unauthorized`,
`forbidden`, `badRequest`, `parseBody`, `parseQuery`) and
`lib/server/session.ts` (`requireUser`, `requireStaff`, plus the re-exported
access predicates).

### 5.1 Endpoint map

| Group | Endpoints |
|---|---|
| **Auth** | `/api/auth/[...nextauth]`, `/api/signup`, `/api/verify-email`, `/api/resend-verification`, `/api/forgot-password`, `/api/reset-password`, `/api/me`, `/api/config` |
| **Users & profiles** | `/api/users` `GET`, `/api/users/[id]` `GET,PATCH`, `.../caretaker-profile` `GET,PATCH`, `.../vet-profile` `GET,PATCH`, `.../shelter-profile` `GET,PATCH`, `.../reviews` `GET` |
| **Pets & records** | `/api/pets` `GET`, `/api/pets/[id]` `GET,PATCH`, `.../appointments` `GET`, `.../medical-records` `GET,POST`, `.../recommendations` `GET`, `/api/medical-records/[id]` `DELETE`, `/api/owners/[ownerId]/pets` `GET,POST` |
| **Caretakers & bookings** | `/api/caretakers/search`, `/api/caretakers/[id]`, `.../bookings`, `/api/bookings` `POST`, `/api/bookings/[id]` `GET`, `.../status` `PATCH`, `.../messages` `GET,POST`, `.../reviews` `GET,POST`, `/api/owners/[ownerId]/bookings` |
| **Vets & appointments** | `/api/vets/search`, `/api/vets/[id]`, `.../appointments`, `/api/appointments` `POST`, `/api/appointments/[id]` `GET`, `.../status` `PATCH`, `.../reviews` `GET,POST`, `/api/owners/[ownerId]/appointments` |
| **Store** | `/api/products` `GET`, `/api/products/[slug]` `GET`, `/api/brands` `GET`, `/api/orders/quote` `POST`, `/api/orders` `GET,POST`, `/api/orders/[id]` `GET`, `.../status` `PATCH`, `.../cancel` `POST`, `.../payment/sync` `POST`, `/api/ops/orders` `GET` |
| **Membership** | `/api/membership` `GET`, `.../checkout` `POST`, `.../cancel` `POST`, `.../resume` `POST`, `.../portal` `POST`, `.../sync` `POST` |
| **Adoption** | `/api/adoptions/listings` `GET,POST`, `.../[id]` `GET,PATCH`, `.../[id]/status` `PATCH`, `/api/adoptions/applications` `GET,POST`, `.../[id]` `GET`, `.../status` `PATCH`, `.../payment` `POST`, `.../complete` `POST`, `/api/shelters/search`, `/api/shelters/[id]` |
| **Admin** (all `requireStaff`) | `/api/admin/stats`, `/users` `GET`, `/users/[id]` `GET,PATCH,DELETE`, `/professionals` `GET`, `/professionals/[id]` `PATCH`, `/payments` `GET`, `/payments/[id]/refund` `POST`, `/subscriptions` `GET`, `/subscriptions/[id]` `PATCH`, `/settings` `GET,PATCH`, `/audit` `GET`, `/adoptions/[id]/reverse` `POST` |
| **Assistant** | `/api/assistant/chat` `POST` (streaming), `/api/assistant/conversations/[id]` `GET,DELETE` |
| **Platform** | `/api/notifications` `GET,POST`, `/api/webhooks/stripe` `POST`, `/api/cron/advance-orders` `GET` |

### 5.2 Three API rules the code holds to

1. **The server owns the truth about money.** `POST /api/orders` has *no price
   field in its request body at all*. It re-reads every product, recomputes the
   total and charges its own figure. The cart's totals are display-only,
   reconciled through the shared `lib/pricing.ts` (free shipping ≥ $49, flat
   $5.99, 8.25% blended tax).
2. **`/api` is deliberately excluded from `proxy.ts`.** Route handlers resolve
   the session themselves; the assistant answers signed-out callers on purpose;
   the Stripe webhook must arrive unauthenticated so its signature check is the
   gate.
3. **Status changes go through a transitions table**, so an illegal move is a
   409.

---

## 6. Authentication & authorization

### 6.1 The split config

- **`auth.config.ts`** — edge-safe. **No DB, no bcrypt imports.** This is what
  `proxy.ts` loads. Holds `session: { strategy: "jwt" }`, the `jwt`/`session`
  callbacks that carry `uid` and the JWT's `iat`, and `pages.signIn: "/login"`.
- **`auth.ts`** — Node runtime. Credentials provider (bcrypt against
  `users.passwordHash`) + Google, *conditionally added only when
  `AUTH_GOOGLE_ID`/`SECRET` exist*, so the app is healthy before the OAuth app
  does.
- **`proxy.ts`** — Next 16's middleware. Matcher: `/dashboard/*`,
  `/onboarding/*`, `/booking/*`, `/account/*`. **Optimistic only** — the real
  enforcement is in the handlers.

### 6.2 Session revocation without a session table

JWT sessions with no DB adapter means a cookie stays valid for its full lifetime
no matter what happens to the account. So `requireUser()` does two extra checks
on every authenticated request:

- the account row still exists and `status === "active"` (a suspension bites on
  the next request, not on token expiry);
- the token's `iat` is **not** older than `User.sessionsValidFrom`, which is
  bumped on password reset, on suspension, and by an admin forcing sign-out.

Cost: one indexed PK lookup per request.

### 6.3 The role model

- **Marketplace roles** (`User.roles[]`): `owner` · `caretaker` · `vet` ·
  `shelter`. One account can hold several — the `RoleToggle` picks which hat.
- **Staff roles** (`User.staffRoles[]`), orthogonal, never self-editable, never
  in the role toggle: `ops` · `support` · `finance` · `admin` (admin satisfies
  every check). `User.isOps` is a superseded legacy column read only through
  `staffRoles`.

### 6.4 The access predicates — `lib/server/access.ts`

Deliberately imports nothing from Auth.js, which is what lets the unit suite
exercise them directly (`tests/access.test.ts`). Re-exported through
`session.ts` so handlers use one import site.

`isBookingParticipant` · `ownsPet` · `canViewPet` · `ownsCaretakerProfile` ·
`ownsVetProfile` · `ownsShelterProfile` · `isAppointmentParticipant` ·
`canAccessPetRecords` · `hasStaffRole` · `isOps`

**`Pet.ownedSince` is an authorization input, not a display field.** It is what
makes a caretaker's or vet's record access *end* when a pet changes hands: both
predicates require the engagement granting access to have been created at or
after that instant. It was chosen over comparing `ownerId`s because `ownerId` is
mutable and `createdAt` is written once.

Known gap, from `ROADMAP.md`: `ownedSince` ends access that outlives
*ownership*, not access that outlives *time*. Under a single owner, a vet who
saw a pet once in 2019 still has record access — and record access includes
writing prescriptions, which unlock Rx products in the store. The fix is a
trailing window on `canAccessPetRecords`.

### 6.5 Other defences

Rate limiting (`lib/server/rate-limit.ts`, `RateLimitHit` table) on sign-in per
email address and per client, plus the assistant. Google sign-in **refuses** to
merge into an existing password account at the same address (account
pre-hijacking); `allowDangerousEmailAccountLinking` is explicitly off.
`APP_ORIGIN` is read from env, never from the `Host` header, because
`trustHost: true` would otherwise let a spoofed Host put an attacker's domain
into a genuine password-reset email.

---

## 7. Payments & membership

### 7.1 The provider seam

`lib/server/payments.ts` picks a provider from **`LEASH_PAYMENTS`** and **fails
closed**: `stripe` with no secret key *throws* rather than quietly taking
pretend money for real orders.

The **demo provider settles inline through the same reconciler the Stripe
webhook uses** — one code path, not two. That is why the seeded data and most of
the test suite run with no credential at all.

### 7.2 The pieces

- `lib/server/payments/ledger.ts` — the `Payment`/`Refund` ledger.
- `lib/server/payments/stripe-provider.ts`, `stripe-client.ts`,
  `subscription-provider.ts`.
- `lib/server/webhooks/stripe.ts` + `store.ts` — the `WebhookEvent` table with a
  claim protocol (`status`, `attempts`, `lockedAt`) so events are processed once.
  Signature verified; `/api/webhooks/stripe` **refuses every request** when
  `STRIPE_WEBHOOK_SECRET` is unset.
- `lib/server/subscriptions.ts` + `entitlements.ts` — Leash Plus. Statuses are
  **Stripe's own vocabulary** (`incomplete`, `trialing`, `active`, `past_due`,
  `unpaid`, `canceled`) rather than a parallel one, so nothing can drift.
- Entitlements are **enforced server-side**, never a badge: `free_shipping`
  (applied in `quoteCart`), `vet_consult_discount`
  (`VetAppointment.discountPct`), `priority_booking`
  (`lib/booking-priority.ts`).

### 7.3 Current state

`LEASH_PAYMENTS=demo`. Membership checkout returns **503** rather than
pretending. Everything around it — ledger, refunds, webhook, entitlements, admin
consoles — is built and tested. Activation is **keys only, no code change**.

---

## 8. The support assistant

`lib/server/assistant/` (19 files) + `components/assistant/` +
`POST /api/assistant/chat`.

### 8.1 Model routing — `lib/server/assistant/model.ts`

One seam, three routes, explicit-to-implicit precedence:

1. `OPENROUTER_API_KEY` — chat **and** embeddings, free-tier default.
2. `ANTHROPIC_API_KEY` — chat only (Anthropic publishes no embedding model).
3. **Vercel AI Gateway** (`AI_GATEWAY_API_KEY`, or Vercel's OIDC token on a
   deployment) — the production route.

Defaults: `anthropic/claude-sonnet-5` (gateway) / `claude-sonnet-5` (direct).
With no credential at all the endpoint returns **503** and says so.
`ASSISTANT_ENABLED=false` kills the whole feature without a deploy.
**Nothing else in the assistant imports a provider.**

### 8.2 The security argument

The tool factory (`tools/index.ts`) is built per-request from `AssistantContext`:

1. **No tool accepts a user id.** Not one `inputSchema` has `userId`/`ownerId`/
   `uid`. `uid` comes from the session and is captured in a closure, so asking
   about somebody else is *unrepresentable* rather than refused. A test asserts
   this.
2. **Anonymous callers get a smaller tool list, not a wall of refusals** — write
   tools are absent entirely when `ctx.uid` is null.
3. **Every id the model passes is re-checked server-side** in `guards.ts`,
   against the database, never the conversation.
4. **Money is formatted at the tool boundary** — the model receives `"$59.98"`,
   never `5998`, so it has no number to divide by 100 incorrectly.

### 8.3 Read / write / link

- **Reads** — `getMyOrders`, `getMyBookings`, `getMyAppointments`, `getMyPets`,
  `getMyNotifications`, `getOrder`, `getBooking`, `getAppointment`,
  `getPetHealthRecord`, `getActivePrescriptions`, `getProduct`,
  `searchProducts`, `searchCaretakers`, `searchVets`, `searchKnowledge`,
  `getStoreFacts`, `recommendProductsForPet`.
- **Writes** (signed-in only) — `cancelOrder`, `cancelBooking`,
  `cancelAppointment`, `markNotificationsRead`. **That is the whole list.**
- **Links** — `startCheckout`, `startCaretakerBooking`, `startVetAppointment`,
  `openPage`, `offerSignIn`.

**The design decision:** placing an order, creating a booking, writing a health
record and every ops action have **no tool at all**. The assistant produces a
pre-filled deep link and the human presses the button — so a hallucinated tool
call yields a dead link rather than a commitment nobody asked for.

### 8.4 Retrieval

**Hybrid**: pgvector cosine similarity + Postgres full-text ranking, fused by
reciprocal rank fusion, over `KnowledgeChunk` (HNSW index + a GIN index on
`to_tsvector`). On a corpus this size the lexical half does most of the work.
Ingest: `npm run kb:ingest`.

**Emergency guidance is inlined into the system prompt, not retrieved** —
an answer about a cat that cannot urinate must not depend on a similarity search
returning the right row.

---

## 9. Testing & operations

### 9.1 Tests

- **28 Vitest suites** in `tests/`, run against a **real Postgres `test`
  schema** (not mocks). `globalSetup: tests/helpers/global-setup.ts`.
- **`fileParallelism: false`** — the suites share one database. ⚠️ **Run
  `npm test` one instance at a time**; two concurrent runs corrupt each other's
  global setup.
- Domain functions take an **injectable `PrismaClient`** precisely so tests can
  pass their own.
- Runtime is **~40 minutes**, almost entirely network round trips to Neon.
- **Browser e2e**: `scripts/e2e/suite.mjs` + `sweep.mjs` on `playwright-core`.
- **Not covered**: no React component tests, no route-handler HTTP tests (the
  guards are tested at the predicate level instead). *(docs)*

### 9.2 Commands

| Command | Does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Vitest against the `test` schema |
| `npm run db:migrate` / `db:migrate:dev` / `db:seed` / `db:studio` | Prisma (all via `dotenv -e .env.local`) |
| `npm run art:generate` | Regenerate `/public/products` artwork |
| `npm run kb:ingest` | Embed support content into the assistant corpus |
| `npm run e2e` / `e2e:sweep` | Browser tests |

`postinstall` runs `prisma generate`.

### 9.3 Local setup

```bash
npm install
cp .env.local.example .env.local   # POSTGRES_PRISMA_URL + AUTH_SECRET at minimum
npm run db:migrate
npm run db:seed
npm run dev                        # http://localhost:3000
```

⚠️ **README inconsistency**: the README says `DATABASE_URL`, but
`schema.prisma` and `.env.local.example` use **`POSTGRES_PRISMA_URL`** and
**`POSTGRES_URL_NON_POOLING`**. Trust the schema.

### 9.4 Environment variables

| Var | Required? | Purpose |
|---|---|---|
| `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` | **yes** | Neon pooled / direct |
| `AUTH_SECRET` | **yes** | Auth.js signing key |
| `STAFF_PASSWORD` | **yes before seeding anything public** | staff accounts; the seeder warns loudly if unset |
| `AUTH_GOOGLE_ID` / `_SECRET` | no | Google button stays hidden until both set |
| `RESEND_API_KEY`, `EMAIL_FROM` | no | mailer logs instead of sending |
| `EMAIL_DEV_MODE` | no | returns reset links in the API response; **forced off in production** |
| `LEASH_PAYMENTS` | no (`demo`) | `demo` \| `stripe`; fails closed |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | for real money | |
| `APP_ORIGIN` | recommended | email links; never derived from `Host` |
| `CRON_SECRET` | production | `/api/cron/advance-orders` refuses everything when unset |
| `AI_GATEWAY_API_KEY` \| `ANTHROPIC_API_KEY` \| `OPENROUTER_API_KEY` | for the assistant | exactly one; 503 without |
| `ASSISTANT_ENABLED`, `ASSISTANT_MODEL`, `ASSISTANT_EMBED_MODEL`, `ASSISTANT_CLIENT_SALT` | no | overrides |

### 9.5 Demo accounts

All seeded marketplace accounts share `leashdemo123`. **Staff do not** — they
use `STAFF_PASSWORD`.

| Account | Role |
|---|---|
| Maya Chen | owner — two pets, bookings, appointments, orders in flight |
| Elena Petrova | caretaker with incoming requests |
| Dr. Naomi Ruiz | vet with a schedule and patients |
| Austin Pets Alive | shelter with listings and applications |
| Priya Raman | `admin` — every console |
| Tom Okafor | `support` + `finance` — not settings or staff roles |
| Rosa Delgado | `ops` — the fulfilment queue only |

The three-way staff split is deliberate: one admin proves nothing about whether
the boundaries are real.

In development a **dev account switcher** (bottom-left) jumps between accounts.
Both it and its endpoint are disabled in production, as are the one-tap demo
logins on `/login` (an admin can re-enable those from
`/dashboard/admin/settings`).

### 9.6 What is simulated

- **Fulfilment.** No warehouse. Orders advance from the ops console at
  `/dashboard/orders` or from the daily cron, both writing the same
  customer-visible tracking events a carrier integration would.
- **Payments, until configured** (§7).

**Not simulated:** accounts, sessions, bookings, appointments, health records,
prescriptions, the catalog, stock, orders, the payments ledger, refunds,
memberships and their entitlements.

---

## 10. Status — what is done, what is not, what is broken

### 10.1 Complete and tested *(docs, with test files as evidence)*

Caretaker search/booking/status machine/messaging · vet search, appointments,
visit summaries, prescriptions · the health record and the prescription → store
gate · store catalog, cart, quote, checkout, tracking, cancellation · the
payment ledger, refunds and the webhook claim protocol · Leash Plus entitlements
· reviews both directions · reputation · notifications + email mirroring · the
full admin console · shelter adoption incl. transfer and reversal · the
assistant · auth incl. revocation and staff roles.

### 10.2 Built, dormant — credentials only, no code change

Stripe payments · Google sign-in · real email · the AI Gateway route.

### 10.3 ⚠️ Looks finished, is not

| | |
|---|---|
| **Refills are never decremented** | `refillsLeft` is written at record creation and updated by nothing. A prescription with `refillsLeft: 3` authorises **unlimited** purchases until `expiresAt`. The product page prints "3 refills left" and the number never moves. |
| **Read receipts are dead by construction** | `Message.readAt` is read by no component. Worse, `GET /api/bookings/:id/messages` calls `markMessagesRead` *before* serializing, so the response can never contain an unread inbound message — and `MessageThread` polls it every 8s. Any future unread feature must unpick this first. |
| **Assistant rehydration never renders** | `AssistantPanel` passes `initial ?? []` to `useChat`, but `initial` arrives async and the chat is only recreated when `id` changes — which it never does. A reloaded thread loses its visible *and* model-visible history. |
| **Assistant token accounting** | `inputTokens`/`outputTokens` are always 0; `onFinish` never passes usage. Dead columns. |
| **Deep-link pre-fill is partial** | The link tools carry service, dates and pet; `/booking/new` reads only `caretakerId` and `/vets/book` only `vetId` and `date`. |
| **The assistant corpus is stale** | The ingested corpus describes a store with **no membership**, and predates refunds and the lead-time rules. Re-run `npm run kb:ingest`. |

### 10.4 Not built at all

- **Payouts.** Money comes in; **nothing goes out**. Caretakers, vets and
  shelters are paid nothing and Leash takes no commission. This is the next
  substantial phase and it is bigger than it looks: Stripe Connect onboarding
  and identity verification, making bookings and appointments *payable at all*
  (today they record a price and charge nobody), payout scheduling, reversals on
  late cancellation, 1099 reporting — and it spans the cents-vs-Float split.
- Notification preferences (`notify()` is the single gate; nothing exists).
- A `/notifications` page (the bell caps at 30, no "see all").
- Review edit/delete/moderation — deliberately: ratings fold into a **running
  average** and there is no arithmetic that un-folds one review.
- Text search and pagination for caretakers and vets (the store's
  `searchProducts` does it properly in Postgres; copy that pattern).
- Email change (`updateUserSchema` no longer accepts `email`; the token type
  exists but the re-verification flow does not).
- Background checks / ID verification beyond the admin-writable status field.
- Shelter reviews, foster placements, meet-and-greet scheduling.

### 10.5 Known defects, ranked *(docs; B-1 verified directly)*

| # | Bug | Where | Severity |
|---|---|---|---|
| **B-1** | **`POST /api/orders` performs no `ownsPet` check.** A stranger's `petId` buys Rx-only products, and the 201-vs-409 difference reveals which prescriptions that pet holds. `POST /api/orders/quote` *does* check, with a comment saying why it must. **I confirmed this asymmetry in the source.** | `app/api/orders/route.ts` | **High** |
| B-2 | Notification email interpolates `title`, `body`, `user.name` into HTML unescaped; `appointment.reason` and `application.petName` are user-controlled. | `notifications.ts` | Medium |
| B-3 | Assistant rehydration never renders (§10.3). | `AssistantPanel.tsx` | Medium |
| B-4 | The assistant passes the client-supplied `messages` array to the model, defeating the stated reason for persisting only the newest turn. No data leak. | `assistant/chat/route.ts` | Medium |
| B-5 | `void emailIfPossible(...)` is not awaited; serverless can tear down the invocation before the mail sends, silently. | `notifications.ts` | Medium |
| B-6 | Sends `kind: "membership_started"` for "profile has been verified" — wrong kind; survives because the icon happens to fit. | `admin/professionals.ts` | Low |
| B-7 | Opening the bell clears **all** unread rows, but the list caps at 30. | `NotificationBell.tsx` | Low |
| B-8 | The bell does not poll (inconsistent with `MessageThread`). | `NotificationBell.tsx` | Low |
| B-9 | Booking reviews render with no `author` → every one shows "Verified customer". | `app/booking/[id]/page.tsx` | Low |
| B-10 | `VisitSummaryForm` writes `Number("")` → `0` refills if the vet clears the field; its type list also omits `allergy`, which the server permits. | `VisitSummaryForm.tsx` | Low |
| B-11 | `sweep.mjs` never calls `process.exit`, so it exits 0 even on failure. | `scripts/e2e/sweep.mjs` | Low |
| B-12 | `ProgressLeash` divides by `steps.length - 1`; a one-step array yields `NaN`. | `ProgressLeash.tsx` | Low |
| B-13 | Review lookups filter on `bookingId` only, not `kind`. | `reviews.ts` | Low |
| B-14 | `createRecord` does not validate `appointmentId` against the pet or vet. | `medical-records.ts` | Low |
| B-15 | `createOrder`'s transaction observed at 5261 ms against Prisma's 5 s default. | `orders.ts` | Low |

**Unconfirmed:** `activePrescriptions` filters `NOT: { refillsLeft: 0 }` on a
**nullable** column. No seeded prescription has `refillsLeft: null`, so whether
Prisma's `NOT` includes NULL rows here has never been exercised. If it excludes
them, a vet who leaves refills blank creates a prescription that silently
unlocks nothing.

### 10.6 Duplication worth removing

Allergen matching exists **three times** (`StoreCatalog.tsx`, an inline copy in
`app/store/[slug]/page.tsx`, and a server twin). "Is this prescription active?"
exists **four times** — and **only the SQL one gates money**; the other three
agree by coincidence. Both review `POST` routes are byte-identical but for two
string literals. `MAX_PER_LINE` is duplicated as a bare `20`.

*Deliberate and documented — leave alone:* the bezier curves in `lib/motion.ts`
vs `globals.css`, and the palette hexes in `ToastProvider`/`StatusBadge`/
`ProgressLeash`/the Stripe appearance object (Framer, SVG and Stripe cannot read
Tailwind theme variables).

### 10.7 One thing that is *not* marked anywhere

`grep -rn "TODO\|FIXME\|HACK\|XXX"` returns **zero** matches across the
codebase. **Do not read that as "nothing is unfinished."** It means unfinished
work is not marked in the code, and this document plus `ROADMAP.md` and
`application documentation/13-status-and-debt.md` are the entire inventory.

---

## 11. Development history

27 commits, built in visible phases:

```
083bf70  Initial Create Next App
b8c4b5a  Frontend MVP (the original caretaker marketplace)
f16cd77  Phase 1 backend: Postgres + Prisma + Route Handlers
8854b29  Phase 2: real auth (Auth.js), email/password + Google
5082181  Phase 3: messaging, email verification, password reset
4cf3769  Phase 1 data layer for vet care + store
35b102e  Phases 2-3: vet care module
19b4d49  Phases 4-6: store, checkout, order tracking
3fd7940  Phase 7: wire the three modules into one product
88d9673  Phase 8: quality pass
04be0a7  Vet reviews, real review rules
f127364  Derived reputation, notifications, cron fulfilment
6020046  Split authorization predicates out of session.ts
4ff6f04  Fulfilment schedule + cancellation window
cea4cf1  /support — the policies written down
a80bfbf  The support assistant
443e00e  Admin console, real payments, the security pass
33d6550  Shelter adoption, on the shared health record
fc9537f  The handover documentation (19 docs; no application code touched)
```

---

## 12. Where to go next

### If you are picking this up to work on it

1. **Read `application documentation/README.md`** — a 19-document technical
   handover set, far deeper than this file on any single topic. Docs 1–4 and
   7–17 are narrative; **5 (database), 6 (all 81 endpoints) and 18 (all 75
   components)** are lookup reference.
2. **Read `API_CONTRACTS.md`** before touching any endpoint.
3. **Read `ROADMAP.md`** for what is planned and what is deliberately not.
4. **Read the relevant guide in `node_modules/next/dist/docs/` before writing
   code** — per this repo's `AGENTS.md`, this Next.js version has breaking
   changes from what most references assume.

### If you want the highest-value work first

1. **Fix B-1** — add the `ownsPet` guard to `POST /api/orders`. It is one line,
   it is the only High-severity finding, and the correct check already exists
   three files away in `quote/route.ts`.
2. **Escape the notification email HTML** (B-2).
3. **Decide what `refillsLeft` means** — decrement it on purchase, or stop
   displaying it. Today the UI states a fact the system does not enforce.
4. **Set the Stripe, Google and Resend credentials** — three dormant,
   fully-built features activate with no code change. See `docs/going-live.md`.
5. **Re-run `npm run kb:ingest`** so the assistant stops describing a store with
   no membership.

### Two operational warnings from the README, worth repeating

- **Vercel's Hobby plan is not licensed for commercial use.** Upgrade to Pro
  *before* the first real charge, not after.
- **Register the Stripe webhook against the production URL.** Deployment
  protection puts a login page in front of previews, so events bounce off it and
  orders sit unpaid with the money taken.

---

*Analysis written 2026-09-20 against commit `fc9537f`.*
