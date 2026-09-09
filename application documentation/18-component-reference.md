# 18. Component reference

All **75 components**, with their props. Generic components show their type
parameter. `?` = optional; `=` shows the default.

Everything is `"use client"` except `SiteFooter` and `app/layout.tsx`.

## 18.1 Shell and chrome — `components/`

| Component | Props | Notes |
|---|---|---|
| `SiteHeader` | — | Reads `useSession()` + `useScrolled(8)`. Chrome tightens on scroll (64→56px). Sliding `layoutId="nav-pill"`. ⚠️ `prefetch={guarded ? Boolean(currentUser) : undefined}`. Renders a fixed spacer while `!hasHydrated`. |
| `SiteFooter` | — | **The only static server component.** |
| `SessionSync` | — | Renders `null`. One effect: `refreshSessionUser()`. **Mounted first.** |
| `PageTransition` | `{ children }` | `MotionConfig reducedMotion="user"` + `motion.div key={pathname}`. **No exit animation** — exit adds latency to every click. |
| `ToastProvider` | — | Sonner at `bottom-right`, **offset 88px** to clear the assistant launcher. Palette hardcoded (Sonner cannot read Tailwind vars). |
| `RoleToggle` | — | Switches `activeRole`. Never shows staff roles. |
| `MaintenanceBanner` | — | Reads a `SystemSetting`. |
| `VerifyEmailBanner` | — | Shown while `!user.verified`. |
| `AuthRequired` | `{ message?, callbackPath }` | Client-side page gate. ⚠️ Renders the literal string **"not logged in"**, which `e2e:sweep` block [B] greps for. **Never put this in a global widget** — it would make [B] pass vacuously everywhere. |
| `DevAccountSwitcher` | — | One-tap demo logins. Rendered as a sibling of the header. |

## 18.2 Shared presentational — `components/`

| Component | Props |
|---|---|
| `EmptyState` | `{ icon, title, description, actionLabel?, actionHref?, className? }` |
| `RatingStars` | `{ rating, reviewCount?, size?="md", className? }` — **does the `toFixed(1)`**; the stored accumulator keeps full precision |
| `ReviewCard` | `{ review, author? }` — ⚠️ falls back to "Verified customer" with no author; the booking page passes none (B-9) |
| `ServiceTypeChip` | `{ service, size?="md" }` |
| `SearchBar` | `{ variant?="hero", initial? }` |
| `HeroSection` · `FeaturedCaretakers` | — |
| `PetCard` | `{ pet, href?, selected?, onSelect?, className? }` |
| `PetCardSkeleton` · `CaretakerCardSkeleton` | — |
| `CaretakerCard` | `{ caretaker }` |
| `BookingStatusBadge` | `{ status, className? }` — maps to a `StatusBadge` tone |
| `AvailabilityCalendar` | `{ availability, selectedDate, onSelectDate, onSelectSlot, selectedSlot?, emptyLabel?, className? }` |

## 18.3 Forms — `components/`

| Component | Props | Notes |
|---|---|---|
| `PetForm` | `{ ownerId, pet? }` | ⚠️ **Does not send `ownerId` in the payload** — it feeds `createPet(ownerId, payload)`. It used to spread it into every edit, which was the ownership backdoor. |
| `CaretakerProfileForm` | `{ userId, profile? }` | |
| `VetProfileForm` | `{ userId, profile? }` | **The template to copy** — derives option lists from the label maps in `lib/utils.ts`, so adding a specialty updates the dropdown by itself. |
| `ShelterProfileForm` | `{ userId, profile? }` | Modelled on the vet form. |
| `LeaveReview` | `{ toName, onSubmit, prompt? }` | Deliberately **presentational** — takes `onSubmit` so both review types reuse it. Blocks `rating === 0`. Surfaces the server's own message via `ApiError`. |

## 18.4 UI primitives — `components/ui/` (13 files, all used)

| Component | Props |
|---|---|
| `Button` / `ButtonLink` | `{ variant?="primary" \| "cta" \| "outline" \| "ghost", size?="md" \| "sm" \| "lg", ...motionProps }` — **`cta` is the leash red, one per screen** |
| `Field` | `{ label, hint?, error?, htmlFor?, children, className? }` — the error row is `role="alert"` |
| `Input`, `Textarea`, `Select` | native elements + the shared `control` class |
| `Panel` | `{ title?, action?, children, className? }` |
| `Stat` | `{ label, value }` |
| `ProfileHero` | `{ imageUrl, name, verified, subtitle?, city, state, rating, reviewCount, children? }` |
| `ProfilePageSkeleton` | — |
| **`ProgressLeash`** | `{ steps: string[], activeIndex, label?="Step", className? }` — ⚠️ divides by `steps.length - 1`; one step ⇒ `NaN` (B-12). `role="img"` + an `aria-live` read-out |
| `ResultsGrid<T extends {id}>` | `{ items, loading, renderItem, skeleton, skeletonCount?=6, emptyTitle, emptyDescription, emptyActionLabel?, emptyActionHref?, className? }` — the loading/empty/grid triad for **all three searches** |
| `Reveal` | `{ children, delay?=0, className?, y?=16 }` |
| `RevealGroup` | `{ children, className?, stagger?=0.06 }` — ⚠️ uses `useInView` + a **persistent** `animate`; `whileInView`+`once` leaves late-mounting children invisible |
| `RevealItem` | `{ children }` |
| `SegmentedControl<T>` | `{ segments, value, onChange, size?="sm", label?, className? }` — **returns `null` below 2 segments** |
| `SelectFilter<T>` | `{ id, label, anyLabel, options, optionLabel, value, onChange }` |
| `Skeleton` | `{ className? }` → `.shimmer` |
| `StatusBadge` | `{ tone: pending\|active\|progress\|done\|failed\|muted, label, className? }` — **one badge for bookings, appointments and orders**; callers map their status to a *tone*, never a colour |
| `ToggleChips<T>` | `{ options, selected, onToggle, label, size?="sm", className? }` + `toggleValue<T>` |
| `icons.tsx` | 25 stroke icons, `currentColor`, 24×24 viewBox, 20×20 default |

## 18.5 Search results

| Component | Props | Notes |
|---|---|---|
| `search/SearchResults` | — | Caretakers. Reads filters from the query string. ⚠️ Filters in memory. |
| `vet/VetSearchResults` | — | Vets. |
| `adoption/AdoptionResults` | — | Listings. |
| `vet/VetCard` | `{ vet }` | |
| `adoption/AdoptionCard` | `{ listing }` | |

All three results components use `ResultsGrid` + `SelectFilter` + `ToggleChips`
and a sticky filter rail. They are near-identical by design; copy whichever is
closest.

## 18.6 Booking and messaging

| Component | Props | Notes |
|---|---|---|
| `booking/BookingNewClient` | — | The **only** consumer of `useBookingDraft`. Steps: details → review → confirm. |
| `booking/MessageThread` | `{ bookingId, currentUserId, people }` | `people` is a client-built `{userId: {name, avatarUrl}}` map. ⚠️ Polls every **8 s** with no `document.hidden` check, no backoff, no pagination. Send → `reload()`, no optimistic insert. |

## 18.7 Vet and health record

| Component | Props | Notes |
|---|---|---|
| `vet/HealthRecordSection` | `{ pet }` | Owner-facing. Three sections — "Coming due" (`nextDueAt` within **60 days**), "Active prescriptions", "Upcoming appointments" — then the timeline. Passes `allowedTypes={["weight","allergy"]}`, mirroring `OWNER_AUTHORABLE`. Offers delete only when `r.authorUserId === currentUser?.id`. |
| `vet/MedicalRecordCard` | `{ record, onDelete?, className? }` | Per-type icon and accent. Renders the prescription `<dl>` and links `productSlugs` to `/store/<slug>`. Contains its own `prescriptionActive` — one of **four** copies of that rule (§13.6). |
| `vet/VisitSummaryForm` | `{ petId, appointmentId?, onCreated, allowedTypes?=AUTHORABLE_TYPES, className? }` | The vet write surface. Fields appear per type. Converts dates to ISO (`occurredAt` at `T12:00:00Z`). ⚠️ Splits `productSlugs` on commas with no validation; `Number("")` → `0` writes a dead prescription; **its default type list excludes `allergy`** (B-10). |
| `vet/AppointmentBookingClient` | — | Reads `vetId` and `date` from the query string. ⚠️ Ignores the other deep-link params (§13.4.5). |
| `vet/AppointmentStatusBadge` | `{ status, className? }` | |

## 18.8 Store

| Component | Props | Notes |
|---|---|---|
| `store/StoreCatalog` | — | Filter state from the query string. `PAGE_SIZE = 12`. `onFilter` resets `page`. Selecting a pet implies their species (`\|\|` not `??`, because "no selection" is `""`). Holds one of **three** copies of `allergenClash` (§13.6). |
| `store/ProductCard` | `{ product, allergenWarning? }` | `Vet Rx` pill, `Sold out` bar, `Sale` pill. Uses `.lift` / `.lift-media`. |
| `store/PetShoppingBar` | `{ pets, selectedId, onSelect, className? }` | The seam between the health record and the store. |
| `store/FeedingGuide` | `{ product, pet? }` | Renders only for `dry_food \| wet_food \| prescription_diet`. Banded rations; "this bag lasts ~N days, about $X/day" (assumes 4 cups/lb). |
| `store/RecommendedForPet` | `{ pet, limit?=4, className? }` | Species + life stage + **allergen** filtered. |
| `store/CartButton` | `{ className? }` | Gates on `hasHydrated` so the badge never flashes empty. |
| `store/PaymentForm` | `{ clientSecret, publishableKey, amountCents, returnUrl, onPaid, onBack }` | ⚠️ `stripePromise` is **module-level and memoised** — `loadStripe` injects a script tag, so a per-render call adds one each time. `confirmPayment({ redirect: "if_required" })`. Only `card_error` / `validation_error` messages are shown verbatim. |
| `store/OrderTracking` | `{ order }` | `ProgressLeash` over the six-status journey + a timestamped event timeline. Off-journey statuses (`cancelled`, `refunded`) render prose instead. |
| `store/OrderStatusBadge` | `{ status, className? }` | |

## 18.9 Dashboards

| Component | Props |
|---|---|
| `dashboard/OwnerDashboard` | `{ user }` |
| `dashboard/CaretakerDashboard` | `{ user }` |
| `dashboard/VetDashboard` | `{ user }` |
| `dashboard/ShelterDashboard` | — |
| `dashboard/BookingListRow` | `{ booking, counterpartName, counterpartAvatar }` |
| `admin/AdminShell` | `{ title, lede, action?, denied?, loading?, children }` — `denied` is set by a page that got a 403 from its own endpoint, so the console degrades per-page rather than failing whole |

`app/dashboard/page.tsx` switches on `activeRole`.

## 18.10 Notifications and assistant

| Component | Props | Notes |
|---|---|---|
| `notifications/NotificationBell` | `{ className? }` | Mounted **twice** (desktop + mobile) in `SiteHeader`. `ICON` maps all 19 kinds. ⚠️ Does not poll (B-8); opening it marks **everything** read (B-7); `openPanel` relies on `open` being the pre-`setOpen` render value, so a refactor to `setOpen(!open)` breaks the mark-read (B-6 adjacent). |
| `assistant/AssistantLauncher` | `{ enabled?=true }` | ⚠️ **Mounted outside `<main>`** — it must survive `PageTransition`'s remount, and `e2e:sweep` [C] scans `main *` for `opacity < 0.05`. Keyed on `currentUser?.id ?? "anonymous"`. |
| `assistant/AssistantPanel` | `{ onClose }` | `useChat` + `DefaultChatTransport`. Thread id in `sessionStorage`. ⚠️ **B-3 lives here** — `messages: initial ?? []` never reaches the chat because `id` is fixed for the component's lifetime. |
| `assistant/AssistantMessage` | `{ message }` | |
| `assistant/DeepLinkCard` | `{ link }` | Renders `{ kind: "deep_link", href, label, summary }`. |
| `assistant/ProductSuggestions` | `{ products }` | |
| `assistant/ToolActivity` | `{ toolName, done, failed }` | |
| `assistant/useFocusTrap` | hook | Not in `lib/hooks/`, but hook-shaped. |

## 18.11 Hooks — `lib/hooks/`

| Hook | Signature | Consumers |
|---|---|---|
| `useAsync<T>` | `(fn, deps) => { data, loading, error, reload }` | **44 files — the entire data layer.** ⚠️ `fn` excluded from deps; no cache, dedupe or abort |
| `useScrolled` | `(threshold = 8) => boolean` | one: `SiteHeader` |

## 18.12 Components with exactly one consumer

Close to inlineable, but live: `useBookingDraft` (`BookingNewClient`),
`useScrolled` (`SiteHeader`), `FeedingGuide`, `DevAccountSwitcher`.

**No dead components were found.** Every file in `components/` has at least one
live consumer.
