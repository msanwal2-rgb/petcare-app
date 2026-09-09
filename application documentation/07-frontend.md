# 7. The frontend

**44 pages, 75 components.** Next.js 16 App Router — but note the shape:

> ⚠️ **No page in this application fetches data on the server.** There are no
> server actions and no `use server`. Pages render, then fetch from `/api/*`
> through `useAsync`. The only server components are `app/layout.tsx`,
> `SiteFooter`, and `app/store/page.tsx` — and that last one exists solely to
> wrap its client child in `<Suspense>`, which `useSearchParams()` requires.

That is a deliberate uniformity, not an oversight: one data path, one auth
story, and an API that the assistant and any future client can use too. But it
means **no page is fast on first paint** and every screen has a loading state.

## 7.1 Data fetching — `useAsync` is the whole layer

`lib/hooks/useAsync.ts`, **imported by 44 files**:

```ts
useAsync<T>(fn: () => Promise<T>, deps: unknown[]):
  { data: T | null; loading: boolean; error: Error | null; reload: () => void }
```

`fn` is **deliberately excluded from deps** (with the lint rule disabled at the
top of the file), so re-runs are driven only by `deps` and by `reload()`'s
internal nonce.

⚠️ **This is the highest-blast-radius pattern in the frontend.** If a caller's
closure captures something not listed in `deps`, it reads a stale value with no
warning and no lint error.

There is **no cache, no request dedupe and no abort**. Every mount refetches.
`MessageThread` layers an 8-second `setInterval` on top; `NotificationBell`
layers nothing (see §13).

Chain: page → `useAsync` → `lib/api/*.ts` → `lib/api/_client.ts` → route handler.

## 7.2 State — three Zustand stores

| Store | File | Persisted? |
|---|---|---|
| `useSession` | `lib/store/session.ts` | **No — deliberately** |
| `useCart` | `lib/store/cart.ts` | Yes, `localStorage` key `leash-cart` |
| `useBookingDraft` | `lib/store/booking-draft.ts` | No |

**The session store is not the source of truth.** It is a render convenience.
The file's header states the reason: a stale or spoofed `localStorage` value
would grant nothing, because every write endpoint re-checks the real Auth.js
session server-side. `SessionSync` (renders `null`, mounted first in the layout)
calls `refreshSessionUser()` → `GET /api/me` → `setUser`.

⚠️ **Name collision:** `lib/store/session.ts` exports `useSession`, and so does
`next-auth/react`. `session-client.ts` has to import the store as `useStore` to
disambiguate. An autocomplete accident imports the wrong one and silently reads
an empty session.

The cart persists `{ lines, petId }` only, via `partialize`. Each `CartLine`
carries a display snapshot (name, image, `unitPriceCents`) that is **never
trusted for money** — checkout re-prices every line server-side.

⚠️ `onRehydrateStorage` in `cart.ts` assigns `state.hasHydrated = true` directly
rather than calling `set`, so subscribers are not notified of that flip. It
works only because rehydration triggers its own render, and the `CartButton`
badge depends on it.

## 7.3 The layout, and why the order matters

`app/layout.tsx` (server component):

```
<SessionSync />            ← first: start /api/me before session-dependent chrome
<SiteHeader />             ← OUTSIDE <main>: PageTransition remounts on pathname
<MaintenanceBanner />
<main>
  <PageTransition>{children}</PageTransition>   ← key={pathname}
</main>
<SiteFooter />
<ToastProvider />          ← offset 88px to clear the assistant launcher
<AssistantLauncher />      ← OUTSIDE <main>: survives remount; e2e:sweep scans main
```

`PageTransition` wraps everything in `<MotionConfig reducedMotion="user">` —
**that single line is what makes every Framer animation in the app respect
reduced motion**; individual components never check. There is no exit animation,
because exit adds latency to every click.

While `!hasHydrated`, `SiteHeader` renders a fixed `h-9 w-40` spacer instead of
auth controls, so there is no flash of the wrong state.

## 7.4 Two traps that cost days

**⚠️ Never client-side navigate across an auth change.** Visiting a guarded
route while signed out — by clicking it *or by Next prefetching it* — makes
`proxy.ts` answer 307 → `/login`, and **the App Router caches that redirect
against the route**. A later `router.push()` replays it: the user signs in and
bounces straight back to `/login` with nothing to explain it. `router.refresh()`
does **not** evict the entry.

Everything auth-related therefore goes through **`navigateAfterAuth()`** in
`lib/auth/session-client.ts`, which is a full `window.location.assign`. It
honours a same-origin `?callbackUrl` (guarded by a private `safeInternalPath`);
sign-out passes `honorCallback: false`.

The same reasoning produces this in `SiteHeader`:

```tsx
prefetch={item.guarded ? Boolean(currentUser) : undefined}
```

Guarded links only prefetch once there is a session.

**Reproduce with `npm run build && npm start` — `next dev` hides it.**

**⚠️ A stagger container can ship invisible content.** `RevealGroup` originally
used `whileInView` + `once`, which fires then stops — a child that mounted later
(a section still awaiting its fetch) inherited `hidden` and stayed at opacity 0
forever. It now drives a persistent `animate` from `useInView`. Any new stagger
container needs the same, and `e2e:sweep` section [C] checks every page for text
stuck below `opacity 0.05`.

## 7.5 UI primitives — `components/ui/` (13 files, all used)

`Button`/`ButtonLink` (`variant: cta|primary|outline|ghost` — **`cta` is the
leash red and is reserved for one primary action per screen**) · `Field`,
`Input`, `Textarea`, `Select` · `Panel`, `Stat` · `ProfileHero`,
`ProfilePageSkeleton` · **`ProgressLeash`** · `ResultsGrid` (the
loading/empty/grid triad shared by all three searches) · `Reveal`,
`RevealGroup`, `RevealItem` · `SegmentedControl` (returns `null` below 2
segments) · `SelectFilter` · `Skeleton` · `StatusBadge` (one badge for bookings,
appointments and orders — callers map their status union to a **tone**, not a
colour) · `ToggleChips` · `icons.tsx` (25 stroke icons).

**`ProgressLeash` is the signature motif** — a dashed leash drawn along an SVG
path by an animated `clipPath`, used by checkout, booking, the appointment
lifecycle and order tracking. ⚠️ It divides by `steps.length - 1`; a one-step
array yields `NaN` coordinates and an unrenderable SVG, with no guard.

## 7.6 Styling

Tailwind **v4** — `@import "tailwindcss"` in `app/globals.css` and **no
`tailwind.config.js` anywhere.** All theming is the `@theme` block:

| Token | Value | Use |
|---|---|---|
| `--color-ink` | `#1b3b36` | headings, nav |
| `--color-marigold` | `#f2a93b` | secondary accent |
| `--color-leash` | `#e85c41` | **CTA only** |
| `--color-fog` | `#f1f3f0` | page background |
| `--color-charcoal` | `#22282a` | body text |
| `--color-mist` | `#c8d6c6` | borders |

Fonts come from `next/font/google` in the layout and are bound to
`--font-display` (Space Grotesk), `--font-body` (Inter), `--font-mono` (IBM Plex
Mono).

Two extracted utilities exist because six utilities had drifted across four card
components: **`.lift`** (hover raise) and **`.lift-media`** (image scale on
parent hover).

Motion constants live in `lib/motion.ts`: `EASE_OUT` for entering, `EASE_GLIDE`
for travelling elements, `DURATION = {fast: .25, base: .4, slow: .6}`,
`layoutGlide`. The bezier values are **duplicated** into `--ease-out-soft` /
`--ease-glide` in CSS, with a comment saying the duplication is deliberate
(Framer cannot read CSS custom properties as easing arrays).

A global `@media (prefers-reduced-motion: reduce)` block collapses every
duration to `0.001ms` and hides the shimmer.

## 7.7 The store screens, end to end

**Catalog** — `app/store/page.tsx` is a server component wrapping
`<StoreCatalog>` in `<Suspense>`, required because the catalog calls
`useSearchParams()`. Filters live in the query string; `PAGE_SIZE = 12`.

**Cart** — gates on `useCart().hasHydrated` before rendering, so a persisted
cart never flashes empty. Shows local display prices, but swaps to server
figures the moment the quote arrives: `quote?.subtotalCents ?? displaySubtotal`;
shipping and tax show `"—"` until then.

**Checkout** — `ProgressLeash` over `["Address","Review","Pay"]`. Re-quotes on
**every** quantity change (`[lines, petId, currentUser?.id]`). `problems.length
> 0` blocks the button on both the cart and checkout screens, so a blocked line
surfaces early rather than at payment. The address form keeps only *touched*
fields in `edits` and falls through to `currentUser` **computed at render**, so
it self-fills as the session hydrates without clobbering typing.

Nice domain touch: with an active boarding booking, checkout offers "ship to
your caretaker instead".

**Payment** — `components/store/PaymentForm.tsx`. With no
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` the review step says "Demo payment" and the
order settles inline. With a key, checkout stores `pending`, **calls `clear()`
immediately** (the order already holds the stock, so leaving the cart full would
allow a duplicate), and moves to the Stripe step. `stripePromise` is
module-level and memoised — `loadStripe` injects a script tag, so a per-render
call would add one each time. Cards never touch a Leash server.

**Tracking** — `app/store/orders/[id]/page.tsx` reads `?paid=1` once into a lazy
`useState` and, if set, calls `syncOrderPayment(id)` before falling back to a
normal read. The reason is in the comment: *the browser knowing the card cleared
is not the server knowing*, which arrives on a webhook.

## 7.8 Shared browser/server modules

These four are **dependency-free on purpose** so both the browser and the server
can import them without dragging Prisma into the client bundle. **Preserve
that.**

| Module | Holds |
|---|---|
| `lib/pricing.ts` | `FREE_SHIPPING_THRESHOLD_CENTS = 4900`, `FLAT_SHIPPING_CENTS = 599`, tax 8.25%, `shippingFor`, `taxFor` |
| `lib/delivery.ts` | `FULFILMENT_SCHEDULE`, `earnedStatus`, `CUSTOMER_CANCELLABLE`, `canCustomerCancel` |
| `lib/pricing-vet.ts` | `consultFeeFor` — **Float USD**, and the file documents why |
| `lib/booking-priority.ts` | `LEAD_TIME_HOURS = { member: 2, standard: 24 }` |

Also `lib/utils.ts` — `cn`, the formatters, and every label map
(`SERVICE_LABELS`, `STATUS_LABELS`, `ROLE_LABELS`, …) with the option lists
derived from them by `Object.keys`. **Add a status to the label map and the
dropdown updates itself.**

`lib/geo.ts` ⚠️ knows exactly three cities (austin, denver, portland) by
substring match; anything else returns `undefined`, which silently degrades
radius filtering and distance sort. The file says a geocoding API belongs here.
