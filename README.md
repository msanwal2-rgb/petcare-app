# Leash — pet care, vet care, and the food in between

A marketplace where an owner books **caretakers** (walking, sitting, boarding,
daycare), books **licensed vets**, and buys **food and supplies** — with one
health record shared across all three. The vet writes into it, the caretaker
reads it, and the store honours the prescriptions in it.

Full stack: Next.js App Router, Postgres, real authentication, and a tested
domain layer.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript**. Note that Next 16 renames
  middleware to **`proxy.ts`**.
- **Postgres (Neon) + Prisma 6** — pinned to 6.x; Prisma 7 needs Node ≥ 20.19.
- **Auth.js v5** (`next-auth@5 beta`) — JWT sessions, email/password via a
  Credentials provider, Google when configured. Split config: `auth.config.ts`
  is edge-safe for `proxy.ts`; `auth.ts` holds the Node-only providers.
- **Zod** at every write boundary. **Tailwind v4** — tokens live in
  `app/globals.css` under `@theme`; there is no `tailwind.config.js`.
- **Framer Motion**, **sonner**, **React Hook Form**, **Zustand**, **Vitest**.

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

## Trying it out

Every seeded account shares the password `leashdemo123`, and `/login` has
one-tap buttons for one account per role:

- **Maya Chen** — owner: two pets, bookings, vet appointments, orders in flight
- **Elena Petrova** — caretaker with incoming requests
- **Dr. Naomi Ruiz** — vet with a schedule and patients to write records for

In development a **dev account switcher** (bottom-left) jumps to any seeded
account, including **Rosa Delgado**, the store-operations account that can
advance orders at `/dashboard/orders`. Both the switcher and the endpoint behind
it are disabled in production.

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

## What's simulated

- **Payments.** `lib/server/payments.ts` defines a `PaymentProvider` interface
  with a demo implementation that authorises and captures instantly. No card is
  collected and no money moves. The `paymentStatus` state machine, the refund
  path, and the order totals are real — swapping in a provider is a new
  implementation of that interface plus a webhook.
- **Fulfilment.** There is no warehouse. `/dashboard/orders` is where an ops
  account advances an order, and each advance writes the customer-visible
  tracking event. Everything downstream of that is real.

Not simulated: accounts, sessions, bookings, appointments, health records,
prescriptions, the catalog, stock, and order records.

## Docs

- **`API_CONTRACTS.md`** — every endpoint, its auth rule, and its shapes.
- **`docs/`** — the original product foundation and frontend brief.
