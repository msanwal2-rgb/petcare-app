# 1. Overview and Architecture

## 1.1 What the application is

Leash is a **two-sided pet-care marketplace**. Pet owners are on one side;
caretakers, veterinarians and adoption shelters are on the other. A store sits
alongside all three.

What makes it one application rather than four is the **shared pet health
record**. A `Pet` row is written by vets, read by caretakers, consulted by the
store, and transferred by adoption. Every domain touches the same row:

- A **vet** writes a `prescription` record after a visit.
- The **store** reads that record and unlocks the prescription-only food it
  names — for that pet only, and only while it is unexpired.
- A **caretaker** with a live booking reads the animal's feeding instructions,
  allergies and behaviour notes.
- A **shelter** hands the whole record over when the animal is adopted.

If you understand nothing else about this application, understand that. Most of
its interesting design — and most of its sharp edges — lives at those seams.

## 1.2 Why it exists

**Confirmed from the repository:** `docs/claude-code-frontend-brief.md` and
`docs/pet-care-marketplace-foundation.md` describe the original product brief.
The application was built in phases, visible in the migration sequence: the
marketplace core, then real authentication, then vet care and the store, then
the assistant, then admin/payments, then adoption.

**Inferred:** it reads as a portfolio-grade demonstration application — the seed
data is rich and deliberately curated, and the README leads with demo accounts.
That does not make it a toy: authentication, payments, authorisation and the
domain rules are genuinely implemented and tested.

## 1.3 Technology stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Framework | Next.js (App Router) | `16.2.10` | **Middleware is renamed `proxy.ts`** in Next 16 |
| UI | React | `19.2.4` | React 19 hook rules are enforced by ESLint |
| Language | TypeScript | `^5` | `strict` — see `tsconfig.json` |
| Styling | Tailwind CSS | `^4` | v4: tokens in `app/globals.css` `@theme`; **no `tailwind.config.js`** |
| Database | PostgreSQL (Neon, serverless) | — | Provisioned via the Vercel–Neon marketplace integration |
| ORM | Prisma | `^6.19.3` | **Pinned to 6.x** — Prisma 7 needs Node ≥ 20.19; this machine runs 20.18 |
| Auth | Auth.js (NextAuth) | `^5.0.0-beta.32` | JWT sessions, **no database adapter** |
| Payments | Stripe | `^22.6.1` | Behind a provider seam; demo provider is the default |
| Payments (browser) | `@stripe/stripe-js`, `@stripe/react-stripe-js` | `^9.15.0`, `^6.9.0` | Payment Element |
| Validation | Zod | `^4.4.3` | At every write boundary |
| Client state | Zustand | `^5.0.14` | Session cache and cart |
| Forms | React Hook Form + `@hookform/resolvers` | `^7.81.0`, `^5.4.0` | Used on some forms, not all |
| Motion | Framer Motion | `^12.42.2` | One vocabulary in `lib/motion.ts` |
| Toasts | Sonner | `^2.0.7` | |
| Passwords | bcryptjs | `^3.0.3` | 10 rounds |
| LLM | Vercel AI SDK | `ai@6.0.266`, `@ai-sdk/react@3.0.269` | **Pinned exactly** — `ai` v7 needs Node ≥ 22 |
| LLM providers | `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic` | `2.0.72`, `3.0.113` | OpenRouter via the openai-compatible provider |
| Tests | Vitest | `^4.1.10` | Against a real Postgres `test` schema |
| Browser tests | `playwright-core` | `^1.49.1` | Drives system Chrome; hand-rolled runner |
| Hosting | Vercel | — | Auto-deploys from `main` |

**Two pins are load-bearing and linked.** Node 20.18 on the development machine
forces Prisma to 6.x *and* `ai` to v6. Upgrading Node lifts both at once. This
is documented in `README.md` and is the reason several dependency versions look
conservative.

## 1.4 System architecture

```
                         ┌────────────────────────────────┐
                         │  Browser (React 19 client)     │
                         │  every page is a client comp.  │
                         └───────────────┬────────────────┘
                                         │  fetch, same-origin
                                         │  (lib/api/_client.ts)
        ┌────────────────────────────────▼────────────────────────────────┐
        │                    Next.js 16 on Vercel                         │
        │                                                                 │
        │  proxy.ts ──► optimistic session gate on page routes only       │
        │               (/dashboard, /onboarding, /booking, /account)     │
        │                                                                 │
        │  app/api/**/route.ts  ── 81 handlers                            │
        │     │  requireUser() / requireStaff(role)   ← the real boundary │
        │     │  parseBody(schema) / parseQuery(schema)                   │
        │     ▼                                                           │
        │  lib/server/<domain>.ts  ── business logic, db-injectable       │
        │     │                                                           │
        │     ▼                                                           │
        │  Prisma Client ──────────────────────────────────────────────┐  │
        └──────────────────────────────────────────────────────────────┼──┘
                                                                       │
   ┌───────────────┬───────────────┬──────────────┬────────────────┐   │
   │  Stripe       │  Google OAuth │  Resend      │  OpenRouter /  │   │
   │  payments +   │  sign-in      │  email       │  Anthropic /   │   │
   │  billing      │               │              │  AI Gateway    │   │
   │       ▲       │               │              │                │   │
   │       │ webhook                                               │   │
   │  /api/webhooks/stripe                                         │   │
   └───────────────┴───────────────┴──────────────┴────────────────┘   │
                                                                       ▼
                                                        ┌──────────────────────┐
                                                        │  Neon PostgreSQL     │
                                                        │  32 tables + pgvector│
                                                        └──────────────────────┘

   Vercel Cron ──► GET /api/cron/advance-orders (daily, Bearer CRON_SECRET)
```

### What each boundary is for

**`proxy.ts`** (Next 16's renamed middleware) is an *optimistic* check only. Its
own header says so. It matches page routes — `/dashboard/:path*`,
`/onboarding/:path*`, `/booking/:path*`, `/account/:path*` — and redirects a
signed-out visitor to `/login`. It deliberately **does not match `/api`**:

- route handlers resolve the session themselves,
- the assistant endpoint answers signed-out callers on purpose,
- the Stripe webhook must arrive unauthenticated so its signature check can be
  the gate.

*Confirmed:* `proxy.ts:24-29`, and the comment above the matcher.

**`requireUser()` / `requireStaff(role)`** in `lib/server/session.ts` are the
real boundary. Every mutating endpoint opens with one of them. `requireUser()`
also performs session revocation — see [document 3](./03-auth.md).

**`lib/server/<domain>.ts`** holds the business logic. Every function takes an
injectable `db: PrismaClient = defaultPrisma` as its trailing argument, which is
what makes the domain testable against a real schema without a running Next
server. This is the single most important convention in the codebase.

## 1.5 Request flow, traced

A representative mutating request — a caretaker accepting a booking:

```
1. User clicks "Accept request"
   components/dashboard/CaretakerDashboard.tsx

2. Client wrapper
   lib/api/bookings.ts → updateBookingStatus(id, "accepted")
   → lib/api/_client.ts patchJson() → fetch PATCH /api/bookings/:id/status
                                       cache: "no-store"

3. proxy.ts does NOT run (no /api match)

4. app/api/bookings/[id]/status/route.ts
   a. requireUser()            → 401 if signed out, suspended, or the token
                                 predates sessionsValidFrom
   b. getBookingById(id)       → 404 if absent
   c. isBookingParticipant / ownsCaretakerProfile
                               → 403 if neither party
   d. parseBody(updateBookingStatusSchema)
                               → 400 with Zod issues
   e. derives the actor from the session, never the body

5. lib/server/bookings.ts → updateBookingStatus(id, status, db, actor)
   a. TRANSITIONS[from].includes(to)   → invalid_transition
   b. ACTOR_ALLOWED[to].includes(actor)→ wrong_actor
   c. prisma.booking.update
   d. refreshResponseRate("caretaker", …)  ← derived reputation
   e. notify(ownerId, …)                   ← the only notification writer

6. Route maps the result union to HTTP:
   ok → 200 | not_found → 404 | wrong_actor → 403 | invalid_transition → 409

7. Client: toast.success(), reload() re-runs the useAsync fetch, UI re-renders
```

Two properties of that flow are worth internalising:

- **Fallible domain functions return a discriminated union**
  (`{ ok: true, … } | { ok: false, code: "…" }`), and the *route* decides the
  HTTP status. The domain never imports `Response`. This is what lets the same
  function be called from a route, from the seeder, and from the assistant's
  tool layer.
- **The actor is derived from the session in the route**, never accepted from
  the body. Where an older endpoint broke this rule it has been changed —
  `createAppointment(ownerId, …)` and `createOrder(userId, …)` both take
  identity as an argument.

## 1.6 Project structure

```
app/                      Next.js App Router
  api/**/route.ts         81 route handlers — thin: guard, validate, delegate, map
  <page>/page.tsx         44 pages — all client components
  layout.tsx              root shell: SessionSync, header, banner, transitions, toaster, assistant
  globals.css             Tailwind v4 @theme tokens, .lift, keyframes, reduced-motion

components/               75 components
  ui/                     design primitives (Panel, Stat, StatusBadge, Button, Field, …)
  admin/                  the admin console shell
  dashboard/              one dashboard per role
  store/  vet/  booking/  adoption/  shelter/  assistant/  notifications/
                          domain component groups

lib/
  api/                    20 thin fetch wrappers — one file per domain. Pages call ONLY these.
  server/                 the domain layer. 66 files. Injectable db, no Next imports where avoidable.
    access.ts             authorization predicates — the security-critical file
    session.ts            requireUser / requireStaff
    adoptions/            listings, applications, transfer, payment
    payments/             ledger, stripe provider, subscription provider
    webhooks/             stripe event handling and idempotency
    assistant/            the LLM subsystem
    admin/                admin domain (users, finance, professionals, stats)
  validation/             Zod schemas — schemas.ts (public) + admin-schemas.ts (internal)
  store/                  Zustand stores (session cache, cart)
  hooks/                  useAsync, useScrolled
  content/                editorial content (support policies, pet-health guides)
  seed-data/              fixtures — only the seeder imports these
  media/                  photo helpers
  motion.ts pricing.ts delivery.ts geo.ts utils.ts booking-priority.ts pricing-vet.ts

prisma/
  schema.prisma           32 models
  migrations/             15 hand-named sequential migrations
  seed.ts                 entry point → lib/server/seed.ts

tests/                    28 Vitest files, 542 tests, against a real `test` schema
  helpers/                global setup, snapshot/restore harness

scripts/
  e2e/                    hand-rolled Playwright suites (journeys + route sweep)
  ingest-knowledge.ts     embeds the assistant corpus
  generate-product-art.ts regenerates /public/products SVGs

docs/                     product brief, foundation doc, going-live guide
"application documentation"/  this documentation
```

### Where new code goes

| You are adding | Put it in |
|---|---|
| A new page | `app/<route>/page.tsx`, `"use client"`, data via `lib/api/*` |
| A new endpoint | `app/api/<path>/route.ts` — guard, validate, delegate, map |
| Business logic | `lib/server/<domain>.ts` — injectable `db` last, return a result union |
| A client fetch wrapper | `lib/api/<domain>.ts` — one function per endpoint |
| Validation | `lib/validation/schemas.ts`, or `admin-schemas.ts` if staff-only |
| A reusable visual | `components/ui/` |
| A domain component | `components/<domain>/` |
| A label or option list | `lib/utils.ts` — derive `*_OPTIONS` from the label map |
| Fixtures | `lib/seed-data/` — and add the table to `SEED_TABLES` |

**Never** put business logic in a route handler, and never let a page call
`fetch` or Prisma directly. Both rules are currently unbroken.
