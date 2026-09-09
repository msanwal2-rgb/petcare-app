# Leash — pet care, vet care, and the food in between

A marketplace where an owner books **caretakers** (walking, sitting, boarding,
daycare), books **licensed vets**, buys **food and supplies**, and **adopts
from shelters** — with one health record shared across all four. The vet writes
into it, the caretaker reads it, the store honours the prescriptions in it, and
when an animal is adopted the whole record goes with them.

Full stack: Next.js App Router, Postgres, real authentication, and a tested
domain layer.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript**. Note that Next 16 renames
  middleware to **`proxy.ts`**.
- **Postgres (Neon) + Prisma 6** — pinned to 6.x; Prisma 7 needs Node ≥ 20.19.
- **Auth.js v5** (`next-auth@5 beta`) — JWT sessions, email/password via a
  Credentials provider, Google when configured. Split config: `auth.config.ts`
  is edge-safe for `proxy.ts`; `auth.ts` holds the Node-only providers.
- **Stripe** for payments and the Leash Plus membership, behind the
  `PaymentProvider` seam in `lib/server/payments.ts`. Chosen by
  `LEASH_PAYMENTS`, and it fails closed rather than falling back to the demo.
- **Zod** at every write boundary. **Tailwind v4** — tokens live in
  `app/globals.css` under `@theme`; there is no `tailwind.config.js`.
- **Framer Motion**, **sonner**, **React Hook Form**, **Zustand**, **Vitest**.
- **Vercel AI SDK** (`ai` v6) for the support assistant, reaching a model
  through the **AI Gateway** — or a direct Anthropic key when one is set. Both
  pinned to the v6 line: `ai` v7 needs Node ≥ 22 and this project runs 20.18,
  the same constraint that pins Prisma to 6.x.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # DATABASE_URL + AUTH_SECRET at minimum
npm run db:migrate
npm run db:seed
npm run dev                        # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Vitest against an isolated `test` schema |
| `npm run db:migrate` / `db:seed` / `db:studio` | Prisma |
| `npm run art:generate` | Regenerate `/public/products` artwork from the catalog |
| `npm run kb:ingest` | Embed the support content into the assistant's search corpus |
| `npm run e2e` / `e2e:sweep` | Browser tests (see `scripts/e2e/`) |

## Trying it out

Every seeded account shares the password `leashdemo123`, and `/login` has
one-tap buttons for one account per role:

- **Maya Chen** — owner: two pets, bookings, vet appointments, orders in flight
- **Elena Petrova** — caretaker with incoming requests
- **Dr. Naomi Ruiz** — vet with a schedule and patients to write records for
- **Austin Pets Alive** (`hello@austinpetsalive.example.com`) — a shelter with
  animals listed and applications waiting, including one approved and ready to
  complete

There are three staff accounts, and they hold different roles on purpose — one
admin proves nothing about whether the boundaries are real:

- **Priya Raman** — `admin`: every console
- **Tom Okafor** — `support` + `finance`: accounts, payments and memberships,
  but not settings or staff roles
- **Rosa Delgado** — `ops`: the fulfilment queue, and nothing else

**Staff do not share the demo password.** Set `STAFF_PASSWORD` before seeding
any database the public can reach; the seeder warns loudly if you haven't.
Publishing the password to an account that can refund payments, next to the
address of the console it unlocks, would make the site administrable by anyone
who reads this file.

The console lives at **`/dashboard/admin`**, and the "Admin" link appears in the
header for staff only. Hiding it is courtesy: every endpoint behind it re-checks
with `requireStaff`, so typing the URL gets an explanation rather than a console.

In development a **dev account switcher** (bottom-left) jumps to any seeded
account. Both it and the endpoint behind it are disabled in production, and the
one-tap demo logins on `/login` are off by default in production too — a
published password against a seeded database is a working login for anyone who
reads the page. An admin can turn them back on from `/dashboard/admin/settings`.

The seed data is wired so the cross-module behaviour is visible immediately:
Luna holds a current prescription for an Rx-only cat food (so it's buyable),
Biscuit's rabies booster is nearly due, and four orders sit at different points
along the delivery timeline.

## How it fits together

```
app/
  api/                  Route handlers. Thin: auth guard → Zod parse → domain call
  (routes)              search · vets · store · dashboard · appointments · orders
components/
  ui/                   Primitives: Button, Field, Panel, StatusBadge,
                        ProgressLeash, ToggleChips, ProfileHero
  vet/ store/ dashboard/  Feature components
lib/
  api/                  Client fetch layer — one file per domain.
                        Pages and components call ONLY these.
  server/assistant/     The support assistant: tools, guards, retrieval,
                        instructions, and the one file that picks a model.
  server/               Domain logic, one file per domain. Every function takes
                        an injectable PrismaClient so tests can pass their own.
  seed-data/            Deterministic fixtures. Only the seeder imports these.
  media/                Photo URL builder + blur placeholder (production code)
  store/                Zustand: session, booking draft, cart
  pricing.ts            Shipping/tax rules, shared by server and cart
types/                  Domain models — the shape the API returns
prisma/                 Schema + additive migrations
```

Three rules the code holds to:

1. **The server owns the truth about money.** The cart's totals are display
   only; `POST /api/orders` re-reads every product, recomputes the total, and
   charges its own figure. The create-order request has no price field at all.
2. **Authorization lives in the route handlers**, never in the client. The
   Zustand session store is a cache; every write re-checks the real session.
3. **Status changes go through a transitions table**, one per domain
   (bookings, appointments, orders), so an illegal move is a 409 rather than a
   corrupted record.

## The support assistant

A floating chat on every page. It answers questions about orders, bookings, vet
appointments and how the platform works, looks up the signed-in customer's own
records, and cancels things. It does not buy or book anything.

That last part is a design decision rather than a limitation. Placing an order,
creating a booking, writing a health record and every operations action have
**no tool at all** — the assistant produces a link into the form the customer
would have used, pre-filled, and they press the button. A hallucinated tool call
therefore produces a dead link rather than a commitment nobody asked for.

Three things hold the rest together:

1. **No tool accepts a user id.** `uid` comes from the session and is captured
   in a closure, so asking about somebody else is unrepresentable rather than
   refused. Anonymous visitors get a *smaller tool list*, not a wall of
   refusals. A test asserts both, so they stay true.
2. **Money is formatted at the tool boundary.** The model receives `"$59.98"`,
   never `5998`, so it has no number to divide by 100 incorrectly.
3. **Retrieval is hybrid.** pgvector cosine similarity and Postgres full-text
   ranking, fused by reciprocal rank fusion. On a corpus this size the lexical
   half does most of the work — dense vectors alone put "cancel my booking" and
   "cancel my order" within a hundredth of each other.

Emergency guidance is inlined into the system prompt rather than retrieved,
because an answer about a cat that cannot urinate must not depend on a
similarity search returning the right row.

Needs one model credential — `AI_GATEWAY_API_KEY` for production, or
`ANTHROPIC_API_KEY`, which takes precedence and is the easy path for local
testing. With neither, the endpoint returns 503 and says so rather than failing
obscurely. `ASSISTANT_ENABLED=false` switches the whole thing off without a
deploy. See `.env.local.example`.

## Going live

**→ `docs/going-live.md` is the step-by-step, with the links to apply at.**

Three integrations are written, tested and dormant. Each activates by setting
environment variables; none needs a code change.

| | Apply at | Set | Until then |
|---|---|---|---|
| **Google sign-in** | [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | the button stays hidden |
| **Payments + membership** | `vercel integration add stripe` | `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `LEASH_PAYMENTS=stripe` | the demo provider settles inline; membership checkout answers 503 |
| **Email** | [resend.com](https://resend.com/signup) | `RESEND_API_KEY`, `EMAIL_FROM` | the mailer logs instead of sending |

Two things are easy to get wrong and expensive to notice late:

- **Vercel's Hobby plan is not licensed for commercial use.** Upgrade to Pro
  *before* the first real charge, not after.
- **Register the Stripe webhook against the production URL.** Deployment
  protection puts a login page in front of previews, so events bounce off it and
  orders sit unpaid with the money taken.

Moving to a different host later is a short list — `docs/going-live.md` ends
with exactly what is Vercel-specific (four env reads, all with fallbacks, plus
the cron schedule). Neon is already independent of it.

## What's simulated

- **Fulfilment.** There is no warehouse. Orders move either from the ops
  console at `/dashboard/orders` or from a daily cron that advances each one to
  the stage its age has earned. Both write the same customer-visible tracking
  events and notifications a carrier integration would.
- **Payments, until configured.** `lib/server/payments.ts` picks a provider from
  `LEASH_PAYMENTS` and **fails closed** — `stripe` with no secret key throws
  rather than quietly taking pretend money for real orders. The demo provider
  settles inline through the *same* reconciler the webhook uses, so the seeded
  data and most of the test suite run with no credential. One code path, not two.

Not simulated: accounts, sessions, bookings, appointments, health records,
prescriptions, the catalog, stock, order records, the payments ledger, refunds,
memberships and the entitlements they grant.

## Docs

- **`API_CONTRACTS.md`** — every endpoint, its auth rule, and its shapes.
- **`ROADMAP.md`** — what is still missing and what it would take.
- **`docs/going-live.md`** — activating Google, Stripe and email, with the
  links to apply at; and what would have to change to move off Vercel.
- **`/support`** — the policies the app enforces, written down. Every figure on
  that page is read from the module that enforces it, so it cannot drift.
- **`docs/`** — the original product foundation and frontend brief.
