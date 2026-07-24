# Build Brief: Pet Care Marketplace — Frontend (MVP)

Give this whole file to Claude Code as the project brief. It covers scope, stack, data shapes, pages, design direction, motion, and imagery. Read it fully before writing code.

Approach this as a senior frontend engineer handing off to a backend engineer: the UI itself should feel modern, interactive, and polished — real photography, smooth transitions, responsive feedback on every action — and the code, especially the data layer in §7, should make it obvious exactly what the backend needs to build, with no guesswork required on their end.

---

## 1. What we're building

A two-sided marketplace web app connecting **Pet Owners** with **Caretakers** for pet care services (walking, sitting, boarding, daycare), billed hourly or daily.

**This build is frontend-only.** There is no backend yet. Build against realistic mock data, but structure the data-fetching layer so a real API can be swapped in later without touching page/component code (details in §7).

---

## 2. Tech stack — use exactly this

- **Next.js 14+ (App Router)** + **TypeScript**
- **Tailwind CSS** for styling
- **Framer Motion** for page transitions, scroll-triggered reveals, and micro-interactions (§3)
- **sonner** for toast notifications (booking requested, accepted, profile saved, etc.)
- **React Hook Form** + **Zod** for form handling/validation
- **Zustand** for lightweight client state (current user session, booking-in-progress state) — don't reach for Redux
- **next/image** for every photo — never a raw `<img>` tag — for automatic optimization, lazy loading, and blur placeholders
- No backend framework, no database, no real auth provider — mock all of it (§8)
- Package manager: npm

Initialize with:
```
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir
npm install framer-motion sonner react-hook-form zod zustand
```

---

## 3. Design direction

Do **not** default to generic AI-website styling (cream background + terracotta accent + serif display; or near-black + neon accent; or newspaper/broadsheet layout). This product should feel warm, trustworthy, and a little playful — like handing your dog's leash to someone competent — without being cutesy or cliché (no literal paw-print wallpaper, no Comic Sans energy).

The bar is **modern and interactive, not static.** Every screen should feel alive: real photography, smooth motion on load and on interaction, and immediate visual feedback for every action. Nothing should snap into place with a hard cut, and nothing should sit on the page inert.

**Use this token system:**

**Color**
| Token | Hex | Use |
|---|---|---|
| `ink` | `#1B3B36` | Primary — headers, primary buttons, nav |
| `marigold` | `#F2A93B` | Secondary accent — badges, highlights |
| `leash` | `#E85C41` | CTA accent — primary action buttons only, used sparingly |
| `fog` | `#F1F3F0` | Page background (pale sage-grey, NOT warm cream) |
| `charcoal` | `#22282A` | Body text |
| `mist` | `#C8D6C6` | Borders, dividers, secondary/disabled states |

**Type**
- Display/headings: **Space Grotesk** — confident, geometric, a little unusual, not a serif
- Body: **Inter**
- Utility/data (prices, times, availability slots): **IBM Plex Mono** — gives scheduling/pricing info a "chart" feel that fits a service-booking product

**Layout concept**
- Caretaker search results: card grid (like Airbnb listings), each card styled like an ID-tag/appointment-card — rounded corners (12px), a small colored service-type chip, mini availability strip
- Generous whitespace, max content width ~1200px, mobile-first responsive down to 375px

**Signature element**
- A single recurring visual motif: a gently curved **dashed "leash line"** connector used as the progress indicator in the booking flow (Search → Request → Confirm). Animate it (see Motion below) — it should draw itself in as the user progresses, not sit there statically. This is the one memorable/distinctive element — don't scatter paw prints or leash icons elsewhere in the UI.

**Imagery & photography**
Real, warm photography is doing a lot of the "attractive" work here — this is not an icon-and-illustration product.
- Every `Pet` and every `CaretakerProfile` needs a real photo. Curate a fixed list of ~20 high-quality pet photos and ~15 diverse caretaker headshots from Unsplash (pick specific photo URLs — don't use the randomized Unsplash Source endpoint, since random results are inconsistent and sometimes off-brand) and reference them as constants in `/lib/mock-data`.
- Landing page hero: one strong, real photo (a person with a dog, mid-walk or mid-cuddle — not a posed stock-photo grin) filling most of the viewport, with a slow, subtle zoom on load (Ken Burns effect: `scale(1)` → `scale(1.08)` over ~20s ease). This is the single largest visual commitment on the site — pick the image carefully.
- Every image uses `next/image` with a fixed aspect ratio (prevents layout shift), rounded corners matching the card radius, and a blur placeholder while loading — never a blank box or a bare spinner.
- Caretaker card images zoom in subtly on hover (`scale(1.05)`, clipped by `overflow-hidden`), paired with the card-lift interaction below.

**Motion & interaction**
- **Page transitions**: wrap route changes in Framer Motion's `AnimatePresence` — a quick fade + 8px slide (200–250ms, ease-out), never a jarring hard cut
- **Scroll reveals**: sections and grid cards fade + slide up into view as the user scrolls (`whileInView`), staggered ~50ms per item — not all at once
- **Hover states**: caretaker/pet cards lift slightly (`translateY(-4px)` + deeper shadow) with the image zoom above; buttons shift color and scale down slightly (`scale(0.97)`) on press for tactile feedback
- **Loading states**: while mock data "loads" (simulate a realistic ~400–800ms delay in the data layer, §7), show skeleton loaders shaped like the real content with a shimmer sweep — never a bare spinner or blank screen
- **Toast feedback**: every meaningful action (booking requested, accepted/declined, profile saved, pet added) triggers a `sonner` toast styled with the token palette, confirming what just happened in plain language
- **Booking flow progress**: the signature leash-line animates its dash offset forward as each step completes, with a small spring bounce on completion

**Standards regardless of style choices:**
- Fully responsive, visible keyboard focus states on all interactive elements
- Respect `prefers-reduced-motion` — every animation above needs a reduced/no-motion fallback that still communicates the state change (e.g. an instant swap instead of an animated transition)
- Write UI copy in active voice, from the user's point of view (e.g. "Request booking," not "Submit"); empty states should read as an invitation to act, not a blank void; errors should say what happened and what to do next

---

## 4. Data models (TypeScript — put in `/types`)

```typescript
type UserRole = 'owner' | 'caretaker';

interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl: string;
  roles: UserRole[]; // a user can be both
  address: { city: string; state: string; lat: number; lng: number };
  verified: boolean;
  createdAt: string;
}

interface Pet {
  id: string;
  ownerId: string;
  name: string;
  species: 'dog' | 'cat' | 'other';
  breed: string;
  sex: 'male' | 'female';
  dob: string;
  weightLbs: number;
  photoUrl: string;
  vaccinated: boolean;
  allergies: string[];
  medications: string[];
  behaviorNotes: string;
  feedingInstructions: string;
  vetContact: { name: string; phone: string };
}

type ServiceType = 'walking' | 'sitting' | 'boarding' | 'daycare';

interface CaretakerProfile {
  id: string;
  userId: string;
  bio: string;
  servicesOffered: ServiceType[];
  pricing: { serviceType: ServiceType; unit: 'hour' | 'day'; rate: number }[];
  serviceRadiusMiles: number;
  acceptedSpecies: ('dog' | 'cat' | 'other')[];
  homeEnvironment: { fencedYard: boolean; hasOtherPets: boolean; smokeFree: boolean };
  certifications: string[];
  backgroundCheckStatus: 'verified' | 'pending' | 'none';
  rating: number; // 0-5
  reviewCount: number;
  responseRatePct: number;
  availability: { date: string; slots: { start: string; end: string }[] }[];
}

type BookingStatus = 'requested' | 'accepted' | 'declined' | 'in_progress' | 'completed' | 'cancelled';

interface Booking {
  id: string;
  ownerId: string;
  caretakerId: string;
  petIds: string[];
  serviceType: ServiceType;
  startDateTime: string;
  endDateTime: string;
  notes: string;
  status: BookingStatus;
  priceTotal: number;
  createdAt: string;
}

interface Review {
  id: string;
  bookingId: string;
  fromUserId: string;
  toUserId: string;
  rating: number;
  comment: string;
  createdAt: string;
}
```

---

## 5. Pages & routes

| Route | Purpose |
|---|---|
| `/` | Landing page — value prop, search bar (location + dates), how-it-works |
| `/search` | Caretaker search results — filters: location, dates, service type, price range, species; card grid |
| `/caretaker/[id]` | Caretaker profile detail — bio, services/pricing, availability calendar, reviews, "Request booking" CTA |
| `/booking/new?caretakerId=` | Booking request flow — select pet(s), service type, date/time range, notes → review → submit |
| `/booking/[id]` | Booking status/detail page — shows status, both parties' summary info, cancel option if applicable |
| `/dashboard` | Role-aware dashboard: if owner, shows their pets + upcoming/past bookings; if caretaker, shows incoming requests + calendar |
| `/dashboard/pets/new` and `/dashboard/pets/[id]` | Create/edit pet profile |
| `/dashboard/caretaker-profile` | Create/edit caretaker profile (services, pricing, availability) — only shown if user has `caretaker` role |
| `/onboarding` | Post-signup: choose role(s) (owner / caretaker / both) |
| `/login`, `/signup` | Mock auth — just needs to set a mock session in Zustand store, no real auth logic |

---

## 6. Key components (build these as reusable, in `/components`)

- `HeroSection` — landing page hero with the Ken Burns image treatment (§3)
- `CaretakerCard` — search result card (photo, name, rating, price range, service chips, distance), with hover lift + image zoom
- `CaretakerCardSkeleton` — shimmer placeholder matching `CaretakerCard`'s exact layout, shown while search results load
- `PetCard` — compact pet summary card
- `PetCardSkeleton`
- `BookingProgressLeash` — the signature animated dashed-line progress indicator (§3)
- `AvailabilityCalendar` — visual calendar showing open/booked slots, used on caretaker profile and booking flow
- `ServiceTypeChip` — colored badge per service type
- `RatingStars`
- `BookingStatusBadge` — color-coded by `BookingStatus`
- `EmptyState` — reusable, with title/description/action button, used across dashboard when no pets/bookings yet
- `ReviewCard`
- `PageTransition` — thin wrapper using Framer Motion's `AnimatePresence`, used once in the root layout to animate every route change

---

## 7. Data layer — build this so a real backend can be swapped in later

Create `/lib/api/` with one file per domain (`users.ts`, `pets.ts`, `caretakers.ts`, `bookings.ts`, `reviews.ts`). Each exports async functions with the signature a real API client would have, e.g.:

```typescript
// lib/api/caretakers.ts
export async function searchCaretakers(params: SearchParams): Promise<CaretakerProfile[]> {
  // for now: filter/return from mock data in /lib/mock-data with a simulated delay
}
export async function getCaretakerById(id: string): Promise<CaretakerProfile | null> { ... }
```

Pages/components should only ever call these functions — never import mock data directly. This means swapping mock implementations for real `fetch` calls to a backend later is a one-file change per domain, not a rewrite.

### 7.1 Document the contract for the backend team

This is the most important handoff artifact in the whole project — a backend developer should be able to build the real API from this alone, without needing to ask questions or read frontend component code.

Every function in `/lib/api/` gets a JSDoc block stating the real endpoint it stands in for:

```typescript
/**
 * GET /api/caretakers/search
 * Query: { lat: number; lng: number; radiusMiles: number; serviceType?: ServiceType;
 *          startDate?: string; endDate?: string; minPrice?: number; maxPrice?: number }
 * 200 -> CaretakerProfile[]
 * Used on: /search
 */
export async function searchCaretakers(params: SearchParams): Promise<CaretakerProfile[]> { ... }
```

Additionally, generate a single **`API_CONTRACTS.md`** at the project root listing every endpoint implied by `/lib/api/` in one table: method, path, request shape, response shape, and which page(s) call it. This is the literal checklist the backend developer works from to build matching endpoints — it should require zero reverse-engineering of frontend code.

---

## 8. Mock data (`/lib/mock-data`)

Generate realistic seed data:
- 15–20 `User` records (mix of owner-only, caretaker-only, and both-role users)
- 10–15 `Pet` records distributed across owners, varied species/breeds, a couple with allergies/medications filled in to show those UI states
- 8–10 `CaretakerProfile` records with varied services, pricing, ratings, and availability patterns (some fully booked, some wide open — need both states for UI testing)
- 15–20 `Booking` records across all `BookingStatus` values (need at least a few of each status so every UI state is visible without manual testing)
- Reviews for completed bookings

Mock auth: a simple Zustand store holding "current user" — provide a way to switch between a sample owner account and a sample caretaker account for testing (e.g., a dev-only account switcher in the UI, clearly marked as temporary).

---

## 9. Explicitly out of scope for this build

- Real authentication/authorization
- Real payments (show a mock "Confirm & Pay" step in the booking flow, but it just transitions booking status — no Stripe integration)
- Real-time messaging/chat
- Background check / ID verification integration
- Backend, database, or API server of any kind

---

## 10. Definition of done

- `npm run dev` runs cleanly with no console errors
- Every route in §5 exists and is reachable via navigation (no dead links)
- Every `BookingStatus` and every empty-data state has a visible, deliberately designed UI (not a blank page)
- Page transitions, scroll reveals, hover states, and loading skeletons are all implemented per §3 — no instant hard-cut navigation, no bare spinners
- `prefers-reduced-motion` fallback verified
- Every `Pet` and `CaretakerProfile` in mock data has a real curated photo, rendered via `next/image` with no layout shift
- `API_CONTRACTS.md` exists at the project root and covers every function in `/lib/api/`
- Fully responsive from 375px to desktop
- Keyboard navigable, visible focus states
- Design tokens from §3 are actually used (check no default Tailwind gray/blue slipped in)
