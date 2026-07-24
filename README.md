# Leash — Pet Care Marketplace (Frontend MVP)

A two-sided marketplace connecting **pet owners** with **caretakers** for
walking, sitting, boarding, and daycare. This is a **frontend-only** build on
realistic mock data, structured so a real backend can be swapped in without
touching page or component code.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript** — the brief specified
  "Next.js 14+"; npm's `latest` now ships 16, which uses the same App Router
  APIs.
- **Tailwind CSS v4** — design tokens live in `app/globals.css` under `@theme`
  (v4 is CSS-first; there is no `tailwind.config.js`).
- **Framer Motion** — page transitions, scroll reveals, the animated leash line,
  micro-interactions (all honor `prefers-reduced-motion`).
- **sonner** — toast notifications. **React Hook Form + Zod** — forms.
  **Zustand** — mock session + booking-in-progress state.
- **next/image** for every photo, with blur placeholders and fixed aspect
  ratios (no layout shift).

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint
```

No environment variables or backend required.

## Trying it out

There's no real auth. Use the **Dev account switcher** (bottom-left, marked
`DEV`) to jump between sample accounts, or use the demo buttons on `/login`:

- **Maya Chen** — owner with pets and active bookings
- **Elena Petrova** — 5.0★ caretaker with incoming requests
- Several dual-role accounts exist too (owner + caretaker toggle in the header)

Every `BookingStatus` and empty-data state is represented in the seed data, so
all UI states are visible without manual setup.

## Project structure

```
app/                     Routes (landing, search, caretaker, booking, dashboard, auth…)
components/              Reusable UI (cards, skeletons, leash progress, calendar…)
  ui/                    Primitives (Button, Field, Skeleton, Reveal, icons)
lib/
  api/                   Data layer — one file per domain. Pages call ONLY these.
  mock-data/             Seed records + curated Unsplash photo constants
  store/                 Zustand: session + booking draft
  hooks/                 useAsync (loading→data→error)
  utils.ts               Formatting, distance, labels
types/                   Domain models (User, Pet, CaretakerProfile, Booking, Review)
API_CONTRACTS.md         ← the backend handoff: every endpoint the API layer implies
```

## For the backend team

Start with **`API_CONTRACTS.md`**. It lists every endpoint implied by
`/lib/api/*` — method, path, request/response shapes, and which pages call each.
Each function in `/lib/api` also carries a JSDoc block naming the real endpoint
it stands in for. Replacing a mock implementation with real `fetch` calls is a
one-file change per domain; the function signatures and return types stay
identical.

## Out of scope (mocked or omitted)

Real auth, real payments (a mock "Confirm & Pay" step only), in-app messaging,
background-check / ID-verification integrations, and any backend/database. See
`docs/` for the original product foundation and build brief.
