# Leash — Status

Where the build is, and what to pick up next.

Last updated: **2026-10-17**, end of M8 (notifications).

- `REQUIREMENTS.md` — what to build
- `BUILD_PLAN.md` — when, and the decisions
- `ARCHITECTURE.md` — **how. Read this before writing code.**
- this file — what is done, what is next

---

## 1. Milestones

| | Module | State |
|---|---|---|
| **M0** | Foundation | ✅ Done |
| **M1** | Identity & authentication | ✅ Done |
| **M2** | Authorization core ★ | ✅ Done — all nine predicates, 35 tests |
| **M3** | Pets & health records | ✅ Done — 8 endpoints, 94 tests |
| **M4** | Caretakers & bookings | ✅ Done — 13 endpoints, 114 tests |
| **M5** | Vets & appointments | ✅ Done — 12 endpoints, 103 tests |
| — | Week-4 checkpoint & first deploy | ⏭ **Skipped** by the owner, 2026-10-09. See §5 and §4 |
| — | Landing page | ✅ Done — the reference's `app/page.tsx`, ported |
| **M6** | Store & orders | ✅ Done — 10 endpoints, 116 tests, a fulfilment job |
| — | **UI parity pass** | ✅ Done — every M1–M6 screen ported from the reference; 34 components added. See §3-0 |
| **M8** | Notifications | ✅ Done — 2 endpoints, an outbox and its drain, the bell; 45 tests. See §3-M8 |
| M7 | Payments | ⬜ **Next** |
| M9 | Admin console | ⬜ |
| M10 | Adoption | ⬜ Stretch |

**M0 → M1 → M2 are strictly sequential, and M2 comes before anything that
touches data.**

---

## 2. What exists

### Environment (verified on this machine)

| | |
|---|---|
| .NET SDK | 10.0.401 |
| PostgreSQL | 18.6, service running on 5432 |
| Node | installed; `web/` builds |
| Databases | `petapp_dev` (seeded), `petapp_test` (rebuilt by the suite) |
| psql / pg_dump | `C:\Program Files\PostgreSQL\18\bin` — **not on PATH by default** |

```bash
# run it
cd API/src/Leash.Api && dotnet run --launch-profile http   # :5001 + Swagger
cd web && npm run dev                                      # :5173, calls the API on :5001 (public/config.js)

# check it
cd API && dotnet test        # 584 passing, ~3m
cd web && npm run build && npx oxlint src
./db/verify.sh               # ✓ IDENTICAL
```

Demo logins: any seeded marketplace account with `leashdemo123` —
`maya.chen@example.com` (owner), `liam.novak@example.com` (caretaker),
`naomi.ruiz@example.com` (vet). In development the "Dev" switcher, bottom left,
changes account in one click. Staff accounts use `STAFF_PASSWORD`, not the
demo password.

### Database

32 tables (four change scripts since the bootstrap). 29 from the original schema (32 minus the three assistant tables),
plus `schema_version`, `refresh_tokens` and `notification_outbox`.

| Script | What |
|---|---|
| `db/petapp.sql` | **The master.** pg_dump-generated, hand-headed. Running it on an empty database gives a complete current schema |
| `db/_bootstrap/001_from_prisma.sql` | Historical: the schema as Prisma emitted it |
| `db/_bootstrap/002_cents_and_timestamps.sql` | Historical: money → integer cents, ISO text → `timestamptz` |
| `db/changes/001_sessions_valid_from_timestamptz.sql` | `users."sessionsValidFrom"` text → `timestamptz`. The bootstrap regex missed it (ends in "From", not "At") |
| `db/changes/002_refresh_tokens.sql` | The `refresh_tokens` table for mobile auth |
| `db/changes/003_vet_clinic_phone.sql` | `vet_profiles."clinicPhone"` — the practice's public line. Empty by default, deliberately not backfilled from `users.phone` |
| `db/changes/004_notification_outbox.sql` | `notification_outbox` (one row per out-of-band channel per notification, claimed under a lease) and `notifications.seq`, an identity tie-break for "newest first". Applied to `petapp_dev` and `leash_review` |
| `db/reference/R001_*.sql` | Plans, settings, catalogue — every environment |
| `db/devseed/D001_*.sql` | 25 users, 12 pets, bookings, orders — **dev/test only** |

### API — `Leash.Api` + `Leash.Core`

Endpoints live (all under `/api/v1`):

```
POST   /auth/signup              POST /auth/login          POST /auth/logout
POST   /auth/verify-email        POST /auth/resend-verification
POST   /auth/forgot-password     POST /auth/reset-password
POST   /auth/refresh             GET  /auth/google         GET /auth/google/complete
GET    /me                       GET  /config
GET    /users   /users/{id}      PATCH /users/{id}
GET    /brands

GET    /pets                     GET  /pets?ids=a,b,c      POST /pets
GET    /pets/{id}                PATCH /pets/{id}          DELETE /pets/{id}
GET    /pets/{id}/appointments   GET  /pets/{id}/recommendations
GET    /pets/{id}/medical-records
POST   /pets/{id}/medical-records
DELETE /medical-records/{id}

GET    /caretakers/search        GET  /caretakers/{id}
GET    /caretakers/{id}/bookings
GET    /users/{id}/caretaker-profile    PATCH /users/{id}/caretaker-profile
GET    /users/{id}/reviews
GET    /bookings                 POST /bookings           GET /bookings/{id}
PATCH  /bookings/{id}/status
GET    /bookings/{id}/messages   POST /bookings/{id}/messages
POST   /bookings/{id}/messages/read
GET    /bookings/{id}/reviews    POST /bookings/{id}/reviews

GET    /vets/search              GET  /vets/{id}
GET    /vets/{id}/appointments
GET    /users/{id}/vet-profile          PATCH /users/{id}/vet-profile
GET    /appointments             POST /appointments       GET /appointments/{id}
PATCH  /appointments/{id}/status
POST   /appointments/{id}/visit-summary
GET    /appointments/{id}/reviews   POST /appointments/{id}/reviews

GET    /products                 GET  /products/{slug}
POST   /orders/quote
GET    /orders                   POST /orders             GET /orders/{id}
POST   /orders/{id}/cancel       POST /orders/{id}/payment/sync
PATCH  /orders/{id}/status                                 → ops
GET    /ops/orders                                         → ops

GET    /notifications             POST /notifications      { ids } — marks exactly those
```

Plus two background jobs in `Leash.Api/Jobs/`: `FulfilmentWorker` — hourly by
default, `Fulfilment:Enabled` / `Fulfilment:IntervalMinutes`, one instance only —
and `NotificationOutboxWorker` — every 15 s, `Notifications:Outbox:Enabled` /
`Notifications:Outbox:IntervalSeconds`, safe on every instance.

Services and repositories in `Leash.Core`, all behind interfaces, all registered
in `AddLeashCore`:

| Service | Repository |
|---|---|
| `IAuthService` | `IUserRepository` |
| `IUserService` | `IVerificationTokenRepository` |
| `IEmailFlowService` | `IRefreshTokenRepository` |
| `ITokenService` | `IRateLimitRepository` |
| `ISessionValidator` | `ISettingsRepository` |
| `IAccessService` ★ | `ICatalogRepository` |
| `IRateLimitService`, `ISettingsService`, `ICatalogService` | `IAccessRepository` ★ |
| `IPetService` | `IPetRepository` |
| `IMedicalRecordService` | `IMedicalRecordRepository`, `IAppointmentRepository` |
| `ICaretakerService` | `ICaretakerRepository` |
| `IBookingService` | `IBookingRepository` |
| `IVetService` | `IVetRepository` |
| `IAppointmentService` | |
| `IOrderService`, `IOrderLifecycle`, `IFulfilmentService` | `IOrderRepository`, `IPaymentRepository` |
| `IPaymentProvider` (`DemoPaymentProvider` until M7) | |
| `IMessageService`, `IReviewService`, `IReputationService` | `IMessageRepository`, `IReviewRepository` |
| `INotifier` (status machines only), `INotificationService`, `INotificationOutbox` | `INotificationRepository` |
| `INotificationChannel` — `EmailChannel`, `PushChannel` (disabled) | |

Cross-cutting, settled and inherited by every later module:

- **Error envelope** — `Http/ApiResults.cs`
- **Timestamp format** — `Json/IsoDateTimeConverter.cs`
- **Validation** — global `Filters/ValidationActionFilter.cs`
- **Transactions** — `Persistence/UnitOfWork.cs`
- **Dapper type mapping** — `Persistence/DapperSetup.cs`
- **Rate limiting** — DB-backed sliding window
- **Dual auth** — cookie + rotating JWT pair, chosen per request

### web

The route tree is the reference project's `app/` directory, path for path
(`web/src/routes.tsx`). Every screen below is a port of the reference screen.

```
/                    the landing page — hero search (city picker), pillars, featured caretakers
/login  /signup  /forgot-password  /reset-password  /verify-email
/onboarding          role selection                       [guarded]
/dashboard           one role-aware page: owner · caretaker · vet ("Viewing as")  [guarded]
/dashboard/pets/new  add a pet                            [guarded]
/dashboard/pets/:id  Details / Health record tabs          [guarded]
/dashboard/caretaker-profile   the caretaker's listing    [guarded]
/dashboard/vet-profile         the clinic's listing       [guarded]
/dashboard/orders    the ops fulfilment queue             [guarded; ops in the API]
/search              caretaker search, filter rail, cursor "Show more"
/caretaker/:id       profile hero, rates, availability, reviews
/booking/new         three-step request                   [guarded]
/booking/:id         status, parties, thread, reviews     [guarded]
/vets                vet search
/vets/:id            clinic profile
/vets/book           three-step visit request             [guarded]
/appointments/:id    status, patient, visit summary, review  [guarded]
/store  /store/:slug  /store/cart
/store/checkout  /store/orders  /store/orders/:id         [guarded]
/pet-health  /support                                     content pages
/adopt  /plus  /dashboard/admin/*                         named placeholders (M10, M7, M9)
```

Retired URLs redirect, carrying their query string: `/dashboard/pets`,
`/dashboard/bookings`, `/dashboard/appointments` → `/dashboard`; `/vet/:id` →
`/vets/:id`; `/appointment/new` → `/vets/book`; `/appointment/:id` →
`/appointments/:id` (`components/Moved.tsx`).

Shell, design system (`components/ui/`), session store, API client layer and the
route guard are all in place. `web/src/types/index.ts` is the reference
project's file, copied, with `PublicConfig.googleEnabled` added.

### Tests — 584 passing

| File | Covers |
|---|---|
| `AccessServiceTests` | Port of `tests/access.test.ts` — the nine predicates, and what a transfer of ownership ends |
| `PetServiceTests` | Port of `tests/pets.test.ts` — CRUD, the closed transfer backdoor, delete, recommendations, life stage and allergen matching |
| `MedicalRecordServiceTests` | Port of `tests/medical-records.test.ts` — the timeline, who may author what, and the one active-prescription rule |
| `PetEndpointTests` | Every pet route over HTTP: `[Authorize]` on each action, the envelope, the wire shape, the fee omission |
| `BookingServiceTests` | Port of `tests/bookings.test.ts` plus the response-rate half of `reputation.test.ts` — the two tables, pagination, integer pricing |
| `CaretakerServiceTests` | Port of `tests/caretakers.test.ts`, rewritten around SQL search: filters, distance, cursor paging |
| `MessageReviewServiceTests` | Ports of `tests/messages.test.ts` and `tests/reviews.test.ts`, plus the ratings half of `reputation.test.ts` |
| `AppointmentServiceTests` | Port of `tests/appointments.test.ts` plus the vet half of `reputation.test.ts` — the §11.2 tables, the visit summary, V8 on both write paths, the one-directional review, consultation pricing |
| `VetServiceTests` | Port of `tests/vets.test.ts`, rewritten around SQL search: filters, distance to the clinic, cursor paging, and what a vet may not set about themselves |
| `CatalogServiceTests` | The catalogue half of `tests/products.test.ts`, rewritten around keyset paging: every sort walked one row at a time, filters, wildcard escaping |
| `OrderServiceTests` | The M6 half of `tests/orders.test.ts` (lines 1–433) and all of `tests/fulfillment.test.ts`, including the M8 notification case — quoting, S9, oversell, abandoned holds, the status machine, the cancel window, the job. Plus the S9 cases the reference has no counterpart for |
| `NotificationServiceTests` | Port of `tests/notifications.test.ts` — the gate, what each machine announces, href deep links — plus the outbox (claim, lease, backoff, give-up, racing drains), N5 escaping and N7 marking. One reference case inverted: "clears everything when given no id" was the N7 defect |
| `NotificationEndpointTests` | The bell over HTTP: guarded, scoped to the caller, `{ ids }` required (400 on `{}`), and the M8 acceptance walk — a caretaker accepts and the owner's bell says so |
| `BookingEndpointTests` | What is guarded and what is deliberately public, 409-vs-403, and the §6.4 acceptance walk |
| `AuthServiceTests` | Port of `tests/auth.test.ts` — hashing, credentials, registration, OAuth linking |
| `EmailFlowTests` | Port of `tests/email-flows.test.ts` — tokens, verification, reset, watermark |
| `AuthEndpointTests` | REQUIREMENTS §3.4 acceptance over HTTP, rate limits, revocation |
| `UserEndpointTests` | The two projections, self-only patching, the privilege boundary |
| `MobileTokenTests` | Dual auth, rotation, replay detection |

---

## 3-M8. M8 — notifications (2026-10-17)

REQUIREMENTS §10.1, end to end: `GET`/`POST /notifications`, the
reference's `NotificationBell` mounted in both header bars, the email half
through an outbox, and `tests/notifications.test.ts` ported (45 tests across
`NotificationServiceTests`, `NotificationEndpointTests` and the fulfilment
case in `OrderServiceTests`). The support page's promise of shipping
notifications is now true.

| | |
|---|---|
| **N1 — one gate** | `INotifier.NotifyAsync`. Handed to `BookingService`, `AppointmentService` and `OrderLifecycle` and to **no controller** — the same split as `IOrderLifecycle`/`IOrderService`. Controllers get `INotificationService` (list, mark read) |
| **Inside the move's transaction** | Each status machine passes its own scope, so the notice commits if and only if the move does. A refused move (an owner accepting their own booking) leaves no bell and owes no email. The reference notified after commit; a crash between the two lost the notice. A ghost recipient is zero rows (`INSERT … WHERE EXISTS`), not an error that would abort the caller's transaction |
| **What is announced** | The reference's three tables word for word, in `Services/Notices.cs`: booking accepted/declined; appointment confirmed/declined/completed; order shipped/out for delivery/delivered — to the owner/customer, never to whoever moved it. Cancellations, picking, packing and "in progress" stay silent |
| **One place per service** | `BookingService.UpdateStatusAsync`; `AppointmentService.AnnounceAsync`, which both the status path and the visit-summary path end in (the summary is the only way to `completed`); `OrderLifecycle.MoveAsync`, which the ops console, the fulfilment job and settlement all go through |
| **N9 — href** | `/booking/{id}`, `/appointments/{id}`, `/store/orders/{id}` — the SPA's own routes |
| **N6 — the outbox** | `db/changes/004`. One `notification_outbox` row per enabled out-of-band channel, written with the notification. `NotificationOutboxWorker` drains it every 15 s: claim with `FOR UPDATE SKIP LOCKED` under a 5-minute lease, deliver, record conditionally on the lease. Failures back off 1 m → 5 m → 30 m → 2 h → 6 h, then `failed` with `lastError`. Suspended/deleted recipients are `skipped`. At-least-once; the outbox id goes to Resend as `Idempotency-Key` so a retried send lands once. **Safe on every instance**, unlike the fulfilment job |
| **N3 — channels** | `INotificationChannel` (`Notifications/NotificationChannels.cs`). In-app is the row itself; `EmailChannel` via `IMailer`; `PushChannel` registered and **disabled** — no outbox rows are written for it, and delivering one would throw rather than report a push that never happened |
| **N5 — escaping** | `NotificationEmail.Render` HTML-encodes every interpolated value: first name, title, body (which quotes the owner's `appointment.reason`), and the link. Pinned with a `<a href="https://evil…">` reason and a `<b>` name. The plain-text part is text and is not escaped |
| **N7 — read only what was seen** | `POST /notifications { ids }` marks exactly those of the caller's ids that are unread; `{}`, `{ids: []}` and the reference's `{id}` are a 400, never "everything". The bell sends the unread ids it rendered. Somebody else's id matches nothing |
| **Ordering** | `notifications.seq` (identity) breaks `createdAt` ties — a catch-up fulfilment run writes three notices in one millisecond, and ids are random (ARCHITECTURE §9.11). The list is keyset-paged on `(createdAt, seq)` with `nextCursor`, 30 a page, like every other list |

**Walked** (headless Chrome, `petapp_dev`): Liam accepted b1 from the booking
page → Maya's bell read "1 unread" → opening it showed "Your booking was
accepted" and cleared the count → clicking it landed on `/booking/b1`. Maya
bought dental chews; Rosa (ops) walked the order from "Start picking" to "Mark
delivered" in the console → Maya's bell read "3 unread", newest first
(delivered, out for delivery, on its way). The API log shows the outbox
sending all four emails. Phone width: one bell, in the mobile bar. No console
errors, no failed API calls.

**Contract departures** — `GET /notifications` adds `nextCursor`; `POST` takes
`{ ids: string[] }` (required, 1–100) instead of `{ id? }`. `web/src/api/notifications.ts`
matches. The bell itself is the reference's file with §6 applied and the N7
change in `openPanel`.

**Not done, deliberately:** the bell fetches once per sign-in, as the
reference did — a notification that arrives while the app is open shows after
a reload (the header does not remount on navigation). No polling was added
(no API change to make a screen fit).

---

## 3-0. The UI parity pass — what landed

Every screen M1–M6 built is now a port of the reference screen rather than a
fresh design: 34 reference components added to `web/` (`components/dashboard/*`,
the `ui/` kit — `Panel`, `ProfileHero`, `ResultsGrid`, `SelectFilter`,
`ToggleChips` — `PetCard`, `ReviewCard`, the three status badges,
`AvailabilityCalendar`, `AuthRequired`, `search/`, `booking/`, `reviews/`, eight
`vet/` components, five `store/` components, `DevAccountSwitcher`) and every page
rewritten from its `app/**/page.tsx`. **No API change in the pass itself; its follow-up (the owner's three decisions, §4) added a column and opened one endpoint — 539 tests.**
Walked headlessly as owner, caretaker, vet and signed out: no console errors and
no failed API calls beyond the expected signed-out `401 /me`.

### Differences from the reference that remain — all deliberate

| Screen | Difference | Why |
|---|---|---|
| Hero, caretaker and vet search | Location is a city picker; no "end date" box | The reference's free-text location and end date filtered nothing (rule 3) |
| Search, vets, store, orders | "Show more" instead of page numbers or full lists; counts read "12+" | Every list is a cursor page and the API never counts the set |
| Search, vets, store | Filters live in the URL | So `/pet-health` → `/vets?emergencyOnly=true` and "Shop everything for Bruno" land correctly |
| Appointment | No "Complete visit" button; the visit-summary form completes the visit | STATUS §5 |
| Visit summary form | Offers `allergy` | V9 |
| Product page | Rx gate and allergen warning come from `POST /orders/quote` for that pet and quantity | P8/S18 — the reference duplicated both rules in the browser. A side effect: a quantity beyond the refills is refused there too |
| Store grid | No per-card allergen flag | Only a client matcher could produce it (S18). The product page and cart show the server's finding |
| Cart | The quote's allergen warning under each line | Rule 3 |
| Booking and appointment detail | Either party can cancel through `in_progress` | §11.1/§11.2 as settled; the reference stopped earlier and contradicted its own support page |
| Booking thread | Explicit mark-as-read after the thread renders | C10 |
| Pet page | Non-owners see only the health record; the owner has "Remove {name}" under the form | The reference showed vets an edit form the server refuses; delete is the only UI for the 409 rule |
| Checkout, order detail | No Stripe step; a 502 after the order exists turns the button into "Retry payment" | M7; the API's documented failure mode |
| Ops queue | No refund button | As in the reference — refunds are the M9 admin console |
| Vet profile | The emergency panel's number is the clinic's own line (`clinic.phone`), not the vet's personal phone; the vet's profile form has a "Clinic phone" field the reference lacked | Owner's decision (§4) — the reference leaked the whole user record |
| Caretaker and vet profiles | Signed out, review bylines show the author's name | `GET /users?ids=` is now public (§4); in the reference it needed a session too |
| Pet page | The owner's "Remove" link stays | Owner's decision, 2026-10-10 |
| Notification bell | Opening the panel marks read **only the unread items it shows** (`POST /notifications { ids }`), not everything | REQUIREMENTS N7 — the reference cleared notifications that arrived after the panel was fetched, and every one beyond the thirty it showed |
| Shelter dashboard | A placeholder | M10 |

### Fixed on the way

- **Product images were broken throughout the store** since M6: the reference
  serves them from `public/products/`, which was never copied. Now in
  `web/public/products/` (25 SVGs).
- **The page never scrolled to the top on navigation**, and `#hash` links did
  nothing. `ScrollRestoration` in the shell.
- **The selected segment of `SegmentedControl` was invisible** (white on white):
  a `-z-10` pill inside a non-stacking button. Also in the reference. `isolate`
  on the container — this fixes the "Viewing as" toggle too.

---

## 3. M6 — what landed, and what M7 inherits

The store end to end: catalogue search, the server-side quote, checkout with
reserved stock, order history, the status machine, a customer cancellation
window, an ops console, and a background job that walks paid orders to the
door. Ten endpoints, seven screens, 116 tests.

Journey 4 of REQUIREMENTS §13 — *a prescription unlocks an Rx-only product →
cart → quote → pay → track to delivered* — is walkable now, with the demo
payment provider standing in for M7's. That is the seam `BUILD_PLAN.md` says
justifies the architecture: the prescription a vet writes in M5's visit summary
is what `ListAuthorizedProductSlugsAsync` reads at the quote.

### The rules M6 settled

| | |
|---|---|
| **S9 — the one High-severity defect** | The reference's `POST /orders` never checked that the named pet was the caller's, while `quote` did. So a stranger's `petId` bought that animal's Rx diet, and the 201-vs-409 difference read its prescriptions. **Closed inside `OrderService`**, on both quote and create, before the pet is used for anything — a future route that forgets cannot reopen it. Pinned by four tests, including "the refusal is identical whatever the pet holds" |
| **The client's prices are display-only** (S3, S10) | No request type has a price field. Quote and create both re-read the catalogue. Verified over HTTP: a body claiming `unitPriceCents: 1, totalCents: 1` was charged 2005 |
| **Oversell** (S12) | One statement: `UPDATE … SET stock = stock - q WHERE stock >= q`. PostgreSQL re-evaluates the `WHERE` after the row lock, so two racing checkouts cannot both take the last unit. Concurrency test run eight times, stable |
| **The order exists before money moves** | `[tx: reclaim → re-quote → take stock → order @ pending_payment] → intent → ledger row → settle`. A failure after the commit leaves an unpaid order holding stock — retryable, nothing to compensate. The reference had the inverse once and lost charges in the gap |
| **Abandoned holds are reclaimable, not reclaimed** | 15-minute hold. Checkout reclaims expired holds on the products it is buying, in its own transaction; the job sweeps the rest. One `UPDATE … RETURNING` claims an order, so a race between the two returns stock exactly once (tested) |
| **Restock only if it never shipped** | `delivered → refunded` is legal. Refunding a delivered order returns money, not inventory — unless staff pass `Restock` for goods that physically came back |
| **Cancelling a paid order refunds it** | The reference's original bug left `paymentStatus: paid` on a cancelled order |
| **Moves are conditional on the status read** | Three writers — ops, the job, settlement. `WHERE status = @from` means a concurrent move loses cleanly instead of both applying |
| **Ops moves check authority first** | Unlike bookings and appointments, where legality comes first. A customer is not a party to the order's fulfilment and learns nothing about its state from that route |
| **`refillsLeft` is spent at checkout** (P9) | The owner's 2026-09-22 decision, now implemented. Inside the order's transaction, after the stock, the pet's active prescriptions are locked `FOR UPDATE`, re-counted, and decremented conditionally. **One refill per unit**, unlimited (`null`) cover used first, then soonest-to-expire. A quote refuses a quantity the refills cannot cover. `Services/PrescriptionCover.cs` is the whole rule; eight tests, including two checkouts racing for the last refills |
| **Allergen warnings, one matcher** (S8, S18) | Computed in the quote by `CatalogService.MatchingAllergens` — the same matcher as the recommendations shelf. The reference had three. A warning, not a refusal |
| **An order that is not yours** | 404, as everywhere. Ops (and admin) can read any order |

### The two-service split, and why

`IOrderService` is what controllers get, and **every method on it authorizes**.
`IOrderLifecycle` is the bare state machine — no caller, no authorization — and
**no controller is ever handed it**. The fulfilment job and payment settlement
need to move an order without pretending to be somebody; giving them a
caller-less method on the same service a controller holds would have been one
injected dependency away from an unauthenticated status endpoint. Same
principle as a repository: the thing that writes does not decide who may.

### Two real bugs found by the ported suite

1. **A catch-up fulfilment run scrambled the customer's timeline.** Four stages
   in one run share one timestamp; the only remaining tie-break was the event
   id, a random UUID. A customer read *shipped, delivered, out for delivery*.
   The reference never hit it because its cuids were time-ordered. Fixed by
   ordering on lifecycle position as the tie-break — correct rather than merely
   plausible, because an order's statuses only move forward and each appears
   once. Checkout could hit it too: placed and paid can land in one millisecond.
2. **My own concurrency test asserted the wrong invariant** — that the second
   of two identical moves fails. It may instead read the already-moved status
   and take the documented no-op. What must hold is "applied exactly once", and
   that is what is tested now, alongside a genuine two-destination race.

### Departures from the reference contract

| | |
|---|---|
| **`ProductPage` is `{ items, nextCursor }`** | Was `{ items, total, limit, offset }`. Keyset like every other list. `types/index.ts` updated; nothing used the old shape |
| **`CartQuote` gained `allergenWarnings` and `amountToFreeShippingCents`** | The first because S18 wants one matcher and it must be the server's; the second because the threshold lives in settings, which the client cannot see |
| **`POST /orders` responds `{ ...order, payment }`** | Matches `PlacedOrder extends Order` in the web contract |
| **Duplicate product ids in one basket are a 400** | Two lines for one product each pass the stock check alone and could together oversell it |

### What is deliberately waiting for M7 and M8

- **The payment provider is the demo one.** `IPaymentProvider` is the seam —
  `CreateIntentAsync` / `GetIntentAsync` / `RefundAsync`, `Asynchronous` — and
  M7 registers Stripe in its place. The order code already creates the order
  before the intent, which is the ordering a real card needs.
- **Refunds are not yet retryable.** The refund runs after the status commits,
  because it is a third-party call. The demo cannot fail; Stripe can, and M7's
  ledger must write a pending refund row *before* calling the provider. Until
  then a failed real refund would leave a `cancelled` order with `paid` money.
- **Nobody is a member.** The quote hard-codes `freeShipping = false`; `discountPct`
  on appointments is 0; lead time is the standard 24 h. Three call sites, all
  marked, all the safe direction.
- **Notifications** for shipped / out for delivery / delivered are M8's.
  `OrderLifecycle.MoveAsync` is the one place to raise them.
- **The second half of `tests/orders.test.ts`** (lines 434–868: intents,
  webhook idempotency, refund accounting, the payment state machine). Port it
  *before* writing M7, as `BUILD_PLAN.md` says.

### The landing page

Ported from `app/page.tsx` with one change worth knowing. The reference's
search bar collected a free-text location and a `service`; no endpoint read
either — the location filtered nothing and `service` was the wrong key. The
hero now offers a **city picker** mapped to coordinates (`lib/cities.ts`), so
the distance search M4 built in SQL is reachable from the UI for the first time,
and it emits `serviceType` and `startDate`, which the search page now honours.
The caretaker card is shared between the search grid and the landing strip
(`components/CaretakerCard.tsx`).

---

## 3a. M5 — vets and appointments (reference)

Vets and appointments, end to end: 12 endpoints, six screens, and
`appointments` and `vets` ported from the reference suite (103 tests). The
scaffolding M2–M4 left was grown rather than duplicated — `IAppointmentRepository`
went from one read method to seven, `AppointmentTimelineDto` now serves both the
pet timeline and the appointment resource, and `IReputationService` grew its vet
arm beside the caretaker one.

`IsAppointmentParticipantAsync` has been waiting since M2 with no caller. It has
one now.

### The rules M5 settled

| | |
|---|---|
| **The status machine is §11.2** | `confirmed`, not `accepted`. Its own `AppointmentStatuses` type rather than a shared one with bookings, so a copy-pasted `"accepted"` fails to compile rather than failing at the transition table. Pinned by a test |
| **Legality vs authority** | Unchanged from M4 and checked in the same order. Illegal move → **409**; legal move by the wrong party → **403**. An owner cannot confirm their own appointment (V6) |
| **Who drives what** | `confirmed`/`declined`/`in_progress` → vet only. `cancelled` → either. `completed` is not a button at all — see below |
| **The fee** | Computed server-side from the clinic's `consultFee`. **Three numbers are recorded**, not one: `baseFeeCents`, `discountPct`, `feeCents` (V4). A membership that lapses next month must not rewrite what somebody was told last week. All integer cents, rounded once |
| **The pet** | Checked against the caller, which the reference never did. An appointment is *how* a vet earns `CanAccessPetRecords`, so an unchecked `petId` would hand any animal's clinical file — and the right to write prescriptions against it — to any clinic named in a request |
| **A vet review is one-directional** | The owner reviews the vet. A clinician who tries gets a 403 named `OneDirectionOnly`, not a missing feature. This is what `ReviewKinds` is for |
| **`verificationStatus` is staff's** | V11. Absent from `VetPatchRequest` and absent from the `UPDATE` statement — a licence badge its holder can grant themselves tells an owner nothing |
| **An appointment that is not yours** | 404, not 403. Same reasoning as bookings |

### Completing a visit is not a status change

`POST /appointments/{id}/visit-summary` is what moves an appointment to
`completed`, and there is no button that does it without a summary. That is
deliberate: a consultation that could be marked done with no clinical record of
having happened is a gap in the patient's history that nothing would ever
notice.

**This is the seam `BUILD_PLAN.md` calls the thing that justifies the whole
architecture**, so it is worth stating exactly what it does:

- the access decision, every record and the status move commit in **one
  transaction**;
- each record is stamped with the vet profile id `CanAccessPetRecordsAsync`
  **returned when it granted access** — never one looked up separately, never
  one from the request body;
- each record's `petId` comes from the appointment row and its `appointmentId`
  is the route's. **Any `appointmentId` in the body is overwritten**, which is
  what makes REQUIREMENTS V8 structurally impossible here rather than merely
  checked. There is no combination of inputs that files a finding under another
  animal's visit.

`MedicalRecordService.CreateAsync` reaches the same guarantee the other way, by
checking: a cited `appointmentId` must be for this pet, and must be the author's
own — the vet's clinic for a vet, the booker for an owner. That closes V8 on the
ordinary record route too, which is the one the reference got wrong.

### Two defects from §12 closed on the way

1. **V9 — the visit-summary form omitted `allergy`.** It now offers every type
   the server accepts, generated from `RECORD_TYPE_OPTIONS` rather than typed
   out, so a seventh type would appear without anyone remembering. A vet who
   found a food allergy during a consultation previously had nowhere to record
   it, and the allergy list is exactly what the store's recommendations read.
2. **Review lookups filtered on `bookingId` without `kind`.**
   `ListForSubjectAsync` and `FindByAuthorAsync` both take `kind` now, and it is
   required rather than optional. Booking ids and appointment ids happen to come
   from disjoint prefixes today, which is the kind of accident that stops being
   true when somebody changes an id scheme.

### Three pieces of refactoring, deliberately small

- **`Persistence/Cursor.cs`** — the keyset cursor encode/decode that
  `BookingRepository` and `CaretakerRepository` each had a private copy of.
  Appointments would have been a third. All three now share it.
- **`Services/LeadTime.cs`** — C13's 24/2 hours, which a booking and an
  appointment both enforce. **This replaces `BookingService.LeadTimeHoursFor` as
  the one place M7 wires entitlements**; STATUS §4 is updated to match.
- **`VetAppointmentEntity` moved out of `ProductEntity.cs`** and
  `AppointmentTimelineDto` out of `CatalogDtos.cs`, into `VetEntities.cs` and
  `VetDtos.cs`. Both were parked there by M3 because vet care had no file yet.

### Where the checkpoint picks up

**M5 is done; days 19–20 are not a formality.** Journey 3 of REQUIREMENTS §13 —
*book a vet → vet completes a visit summary → a prescription appears in the
pet's record* — is now walkable end to end, and is asserted at the service level
by `AppointmentServiceTests`. Journeys 1–3 are the checkpoint's pass criteria.

Nothing has ever been deployed and there is no CI. See §4 for the specific
things found while building M5 that will make the first deploy harder.

---

## 3b. M4 — caretakers and bookings (reference)

Caretakers and bookings, end to end: 13 endpoints, six screens, and
`bookings`, `caretakers`, `messages`, `reviews` and `reputation` ported from the
reference suite.

`IsBookingParticipantAsync` has been waiting since M2 and now has its callers —
every booking read, every status move, every message and every review goes
through it.

### The rules M4 settled

| | |
|---|---|
| **Legality vs authority** | Two separate tables. An illegal move is **409** (a rule about the booking); a legal move by the wrong party is **403** (a rule about the person). Legality is checked first — more useful to say, and it does not leak the status to someone probing with the wrong verb |
| **Who drives what** | `accepted`/`declined`/`in_progress`/`completed` → caretaker only. `cancelled` → either. **An owner cannot accept their own booking** (C8) |
| **The price** | Computed server-side from the caretaker's rate card. The request has no price field, so there is nothing to tamper with. All integer cents — hours to the nearest, days rounded up, both floored at one unit |
| **The pets** | Every id on a request is checked against the caller. A booking is *how* a caretaker earns `CanViewPet`, so an unchecked `petIds` would hand any animal's file to any caretaker |
| **Reading messages** | An explicit `POST …/messages/read` (C10). The `GET` marks nothing |
| **Reputation** | `rating`, `reviewCount` and `responseRatePct` are derived, and `ReputationService` is their only writer. The patch type has no such fields, so a caretaker cannot award themselves one |
| **A booking that is not yours** | 404, not 403. Ids are sequential, so the distinction would let a caller count the marketplace's volume |

### Search runs in PostgreSQL now

REQUIREMENTS C4 and the standing rule in §5. The reference read every caretaker
with their pricing and availability and filtered the array in Node — a table
scan plus a full materialisation, and unpaginable, because the page boundary is
decided after the work is done.

`CaretakerRepository.SearchAsync` does the filtering, the haversine distance,
the price range and the ordering in one statement, and returns a page plus a
cursor. The cursor is **keyset, not offset**: it compares against the last row's
sort key, so it neither repeats nor skips when reputations move between pages.
`OFFSET 200` does both. Two tests walk the whole result set one page at a time
and assert it equals the unpaginated list, in both sort orders.

### Two requirements are deliberately part-done

1. **C13 — priority booking.** The lead-time rule is enforced: a booking needs
   24 hours' notice. The Leash Plus arm that shortens it to 2 is not wired,
   because entitlements are M7. `BookingService.LeadTimeHoursFor` is the one
   place M7 changes, and it currently answers "non-member" for everyone — which
   is the safe direction, refusing bookings a member should be allowed rather
   than allowing ones nobody should.
2. **C14 — the cancellation window. Settled: there isn't one, for now.**
   §11.1 (the normative table) lets either party cancel from any non-terminal
   state with no time bound, and that is what ships. C14's "published window"
   is **deferred to M7 by the owner's decision**, to be designed together with
   cancellation *penalties* and refunds — a cutoff with no money behind it is a
   rule with no consequence, and picking the hour before knowing the penalty
   would be guessing twice. Do not add one before then.

### Where M5 picks up

`IAppointmentRepository` still has the one read method M3 added — grow it rather
than starting a second interface. `AppointmentTimelineDto` is one record whose
`Fee` is written conditionally, replacing the reference's two TypeScript types;
extend it rather than adding a parallel DTO.

`ReputationService` is built to take the vet arm: the answered-status list is the
only thing that differs (`confirmed` where a booking says `accepted`), and the
shelter arm in M10 needs `responseRatePct` only — shelters have no rating or
review count until `Review.kind` grows an adoption arm.

`ReviewService` already writes `kind`, and `ReviewKinds.VetAppointment` exists
and is exercised by the read tests against seeded rows. M5 adds the write path:
**one direction only** — the owner reviews the vet. A clinician rating the client
is a different and much worse product.

---

## 3c. M3 — pets and the health record (reference)

Pets and the health record, end to end: 8 endpoints, the three owner screens,
and `tests/pets.test.ts` + `tests/medical-records.test.ts` ported in full.

`IAccessService` is now called from every action that touches a pet — which is
the half of M2 that nothing could verify until this milestone existed.
`PetEndpointTests` walks each route anonymously to prove `[Authorize]` is on it,
because that gap is where an authorization hole lives.

### The rules M3 settled

| | |
|---|---|
| **Who sees a pet** | Owner, a sitter with a qualifying booking, a treating vet. A stranger gets 404, never 403 |
| **Who sees the health record** | Owner and treating vet only. **A booking is not clinical access** — the sitter's panel says so rather than rendering empty |
| **Who writes a record** | A treating vet writes any type, stamped with the vet profile the access check returned. An owner writes `allergy` and `weight` only |
| **Who deletes a record** | The author. An owner reads their animal's whole history and cannot remove what a vet wrote |
| **Who sees recommendations** | The owner only — the shelf is a readout of the animal's allergy list |
| **The fee on a visit** | Present for the booker, **absent from the JSON** for everyone else. Not null — absent |

### `refillsLeft` — REQUIREMENTS P9, decided

The spec required a decision and forbade shipping the inconsistency. **Zero
means exhausted and stops authorising products; null means the vet set no
limit and it never runs out.** That is expressed once, in
`MedicalRecordRepository.ActivePrescription`, and it is the only definition of
"is this prescription active?" in the codebase — P8 exists because the old
system had four and only the SQL one gated money.

**What this hands M4/M6:** nothing decrements it yet. **M6 must decrement
`refillsLeft` when an Rx line is bought**, in the same transaction as the stock
decrement, or the column goes back to being decorative and a single
prescription authorises unlimited purchases until it expires. That is the
inconsistency P9 named; M3 closed the read side of it and M6 owns the write
side.

> **Since done.** M6 spends refills at checkout, one per unit, in the order's
> transaction — see §3 and `Services/PrescriptionCover.cs`.

### Two things that need a human decision

1. **Deleting a pet is blocked once it has any clinical history** (409). All
   three foreign keys onto `pets` are `ON DELETE CASCADE`, so a raw delete
   takes the animal's records, its appointments and any adoption listing with
   it — an owner deleting forty records they did not author by deleting the
   patient, which is the wholesale version of what "only the author may delete
   a record" exists to prevent. **The gap: there is now no way to retire a pet
   that has died.** That wants a soft delete (`deletedAt`, filtered from lists,
   records kept hanging from it) — a schema change plus a decision about what a
   bereaved owner should still be able to see. Not guessed at here.
2. **`Species` is three values** (`dog`, `cat`, `other`), because
   `web/src/types/index.ts` says so and the same three constrain a product's
   `species` and a professional's `acceptedSpecies`. Widening it is a contract
   change: `PetEnums.cs`, `types/index.ts`, and every label map keyed on it, in
   one commit.

### Where M4 picks up

`IsBookingParticipantAsync` has been waiting since M2 and finally gets its
caller. `IAppointmentRepository` exists with one read method — M5 grows it
rather than starting a second interface. `ICatalogRepository` has products for
the recommendation query only; M6 adds search, filtering, sorting and cursor
pagination.

`AppointmentTimelineDto` is one record whose `Fee` is written conditionally,
replacing the reference's two TypeScript types. M5 should extend it rather than
add a parallel appointment DTO.

---

## 3d. M2 — the authorization core (reference)

**No endpoints. Pure predicates, used by every other module.** All nine are in
`IAccessService` / `AccessService`, backed by a dedicated `IAccessRepository`,
with `tests/access.test.ts` ported in full (`AccessServiceTests`, 35 cases).

| Predicate | Rule |
|---|---|
| `OwnsPetAsync` | The pet's `ownerId` is the caller |
| `CanViewPetAsync` | Owner, **or** a caretaker/vet with a qualifying engagement |
| `CanAccessPetRecordsAsync` | Owner, **or** a vet with a qualifying appointment. Returns `RecordAccess(Allowed, AsVetId)` |
| `IsBookingParticipantAsync` | The booking's owner, or the user behind its caretaker profile |
| `IsAppointmentParticipantAsync` | The appointment's owner, or the user behind its vet profile |
| `OwnsCaretakerProfileAsync` / `OwnsVetProfileAsync` / `OwnsShelterProfileAsync` | The profile's `userId` is the caller |
| `HasStaffRoleAsync` | `staffRoles` contains it, or `admin`. Also requires `status = 'active'` |

Three things about the shape that M3 onward depends on:

- **Every predicate takes an optional `ITransactionScope`**, like a repository
  method. It is there for the re-check on a write: a service that opens a
  transaction, verifies the caller may act and then writes must run the
  verification *inside* that transaction, or it approves a row the write can no
  longer rely on. Pinned by a test.
- **`IAccessRepository` is its own repository**, deliberately not M3–M5's. Its
  projections are one or two columns each, and nothing a feature team does to
  `IPetRepository` can widen an authorization query. Do not consolidate them.
- **A refusal is indistinguishable from an absence.** Every predicate answers
  false for a row that does not exist. Ids are sequential (`p1`, `p2`, …), so a
  caller able to tell "no such pet" from "not your pet" can enumerate the table.
  Controllers turn both into 404.

### `Pet.ownedSince` — read this twice

It is an **authorization input, not a display field**. It is what makes a
caretaker's or vet's record access *end* when a pet changes hands.

Both engagement-based predicates require the engagement granting access to have
been **created at or after `ownedSince`**.

It was chosen over matching the engagement's `ownerId` to the pet's current
`ownerId` because that version depends on a *mutable* column somebody may
reasonably backfill one day — which would silently restore every grant this
exists to end. `createdAt` is written once and never touched.

**Known limitation — carry it forward, do not regress it:** this ends access
that outlives *ownership*, not access that outlives *time*. Under a single
owner, a vet who saw a pet once years ago retains record access, which includes
writing prescriptions that unlock Rx-only products. A trailing window on
`CanAccessPetRecords` is the fix if it is ever prioritised.

**M3 owns the other half of this.** The predicates read `ownedSince`; nothing
writes it yet. Whatever M3 (or M10's adoption transfer) does to move a pet must
set `ownerId` and `ownedSince` **in the same statement**. Setting the owner
without the timestamp leaves every derived grant from the old household alive,
and no test outside this suite would notice.

### Where predicates get called

M2 added no endpoints, so nothing changed visibly. From M3 onward, every
controller action touching a pet, booking, appointment or profile calls one
first. The `OwnsPet` check on anything touching a pet is on the
**never cut** list in `BUILD_PLAN.md` §7.

Two predicates have no caller until later milestones — `OwnsShelterProfile`
waits for M10, `IsBookingParticipant` for M4. They are here rather than there
because §4 requires the set ported in full, together, and reviewed once.

---

## 4. Open items

| | Item |
|---|---|
| | ~~`origin/main_newDev` still has the pre-rewrite commit hashes.~~ **Settled 2026-09-21.** The history rewrite is on the remote: `origin/main_newDev` and local `main_newDev` are both at `9ff75e2`, and all 8 commits are authored *and* committed by `rehman427 <abdulrehmanlatif65@gmail.com>` with no Claude trailers. No force push is outstanding. The pre-rewrite history is kept at `backup/main_newDev-pre-rewrite` (`90a6473`, old authorship + trailers) and `backup/main_newDev-pre-name-rewrite` (`e59b561`) — **local refs only, never pushed.** Delete them when you no longer want the old hashes recoverable |
| ⚠ | A cookie copied before sign-out keeps working — deliberate, pinned by a test, documented in `BUILD_PLAN.md` §11. **Do not "fix" it by bumping the watermark on logout** |
| | `tests/` in the reference project has 28 Vitest suites. 16 are ported (`notifications.test.ts` in M8), one of them in half: `orders.test.ts` lines 434–868 are M7's and should be ported **before** M7 is written. They are the specification — port each module's as you build it |
| | **M5 and M6 have no endpoint suites.** Every other module has one (`PetEndpointTests`, `BookingEndpointTests`, …) covering what a service test structurally cannot: that `[Authorize]` is on each action, that a 401 carries the envelope, that 409-vs-403 survives the controller. Both service layers are covered in full; their 22 routes are checked only by the hand-run curl walks recorded in `HANDOFF.md`. **`StoreEndpointTests` matters most** — S9 and the price-tampering refusal are the store's two security properties, and both are HTTP-shaped |
| ⚠ | **Refills spent on a cancelled order are not given back.** Checkout spends them per unit; cancellation restocks the goods but cannot return the refills, because nothing records *which* prescription a line drew on — that wants an `order_items."prescriptionId"` column (a schema change). The direction is safe — it under-authorises, never over — but an owner who cancels has to ask their vet to renew. Decide before real customers do it |
| ❓ | **Confirm "one refill per unit".** The owner's decision says "decrement when an Rx line is bought" without saying whether a line of three bags spends one refill or three. Implemented as three, because one-per-line lets a single refill cover a 99-bag line. One constant to change in `PrescriptionCover` if the intent was the other |
| | ~~REQUIREMENTS C14 — the booking cancellation window.~~ **Settled 2026-09-22: §11.1 as written, no cutoff.** Revisit alongside cancellation *penalties* when M7 brings payments and refunds — a cutoff with no money behind it is a rule with no consequence. See §5 |
| | **C13 is half-wired, and now on both marketplaces.** Bookings *and* appointments need 24 hours' notice; the Leash Plus arm that shortens it to 2 waits on M7's entitlements. **`Services/LeadTime.cs` is the single place to change** — it replaced `BookingService.LeadTimeHoursFor` in M5, when appointments needed the same numbers |
| | **V5 is unwired in the same way.** `AppointmentService.CreateAsync` passes a hard-coded `0` for the consultation discount, so `discountPct` is always 0 and `feeCents` always equals `baseFeeCents`. The three columns are written and the arithmetic is tested; M7 supplies the plan's `vet_consult_discount` at that one call site. Zero is the safe direction — it charges full price rather than discounting for non-members |
| | ~~M6 must decrement `refillsLeft` when an Rx line is bought.~~ **Done in M6**, in the order's transaction alongside the stock — see §3. REQUIREMENTS P9 is closed on both sides |
| ⚠ | **M7 owns three things M6 left at the safe default.** The quote's `freeShipping` is hard-coded false (S5, S6), appointment `discountPct` is 0 (V5), and lead time is the standard 24 h for everyone (C13). All three call sites are marked. Plus: refunds must become retryable — M6 refunds after the status commits, which is fine for the demo provider and not for one that can fail |
| | ~~Notifications for order milestones are M8's.~~ **Done in M8** — `OrderLifecycle.MoveAsync` raises them inside the move's transaction; the fulfilment suite's "notifies the customer" case is ported |
| ⚠ | **Run the fulfilment job on one instance.** Concurrent runs are *safe* — every move is conditional on the status read — but duplicate the work. On more than one machine set `Fulfilment__Enabled=false` on all but one, or make it a scheduled job. A deploy decision |
| | Catalogue text search is `ILIKE` — a sequential scan, fine at 25 products. At catalogue scale it wants a `pg_trgm` index (a schema change) |
| ⚠ | **A pet that has died cannot be removed.** Deleting is blocked once the animal has vet visits or health records, because all three FKs onto `pets` cascade and an owner must not delete records their vet authored. Needs a soft delete (`deletedAt`) and a decision about what a bereaved owner still sees — `STATUS.md` §3 has the reasoning |
| | `AccessServiceTests` still inlines the active-prescription rule as SQL. `IMedicalRecordRepository.ListAuthorizedProductSlugsAsync` now exists — swap the helper for a call to it so there is one definition in the tests too |
| | Google OAuth is implemented but unconfigured, so untested against the real provider. Set `Auth:Google:ClientId`/`:ClientSecret` and add `http://localhost:5173/api/v1/auth/google/callback` as an authorised redirect URI |
| | `db/petapp_at_last_release.sql` is gitignored and local-only. Recreate it from `petapp.sql` before adding the next change script |
| | No CI yet. `BUILD_PLAN.md` §9 wants: throwaway database from `petapp.sql`, run the suite, run `verify.sh`. **`.github/workflows/` exists and is empty** |
| ⚠ | **Nothing builds the SPA into `wwwroot`.** `Program.cs` calls `UseStaticFiles()` and `MapFallbackToFile("index.html")`, and `ARCHITECTURE.md` §6 says production serves the SPA from the API's `wwwroot` — but no `.csproj` target, script or pipeline step runs `npm run build` or copies `web/dist` there. A deploy done today ships an API that answers `/api/v1/*` and returns 404 for every page. Found while wiring M5's routes; see §6 of `HANDOFF.md` |
| ⚠ | **The test project pulls vulnerable transitive packages.** `Azure.Identity` 1.3.0 (one high, two moderate) and `System.Drawing.Common` 5.0.0 (one critical) — nine `NU19xx` warnings on every build. Test-only and not shipped, but any CI with a vulnerability gate fails on day one, which is a bad way to discover them |
| ⚠ | **`verify.sh` cannot run in CI as written.** It diffs `petapp.sql` against `petapp_at_last_release.sql` + `changes/`, and that baseline is **gitignored** — a fresh clone does not have it, so the script has nothing to compare against. CI needs either a committed baseline, a tagged-release checkout to generate one from, or a mode that skips the delta half |
| | The web bundle is **847 kB (246 kB gzipped)** in one chunk — 606 at M4, 687 at M5, 749 at M6; the parity pass added ~100 kB of ported screens. Route-level code splitting is now worth doing; the store and the vet screens are natural first splits, and nobody needs the ops console in their first load |
| | **The parity pass's three API questions — decided 2026-10-10.** (1) **Clinic phone: yes.** `vet_profiles."clinicPhone"` (db/changes/003), on the wire as `clinic.phone`, set by the vet on their profile form, shown as a `tel:` link in the emergency panel. Not backfilled from `users.phone`, so a live database never publishes a vet's personal number; the dev seed carries clinic numbers. (2) **Allergen flags on store cards: no.** The product page and cart show the server's finding; the catalogue search takes no pet. (3) **Reviewer names for signed-out visitors: yes.** `GET /users?ids=` is public, like `GET /users/{id}` — the public projection only, capped at 50. The unfiltered listing still needs a session and a Development host. Both pinned by tests (`VetServiceTests`, `UserEndpointTests`) |
| | **Dashboards read the first 100** bookings, appointments and orders (the API's page maximum), newest first, and split them client-side as the reference did with unpaginated arrays. Fine at demo scale; a user with more than 100 bookings would not see the oldest in "Past" |
| | `web/src/assets/{hero.png,react.svg,vite.svg}` are Vite template leftovers. The landing page uses the reference's Unsplash hero (`HERO_PHOTO`), not `hero.png`, so all three can go |

---

## 5. Decisions already made — don't re-litigate

| | |
|---|---|
| Three projects, controller/service/repository, DI | Revised from the plan's original single-project Minimal-API layout, at the owner's direction |
| Dapper inside repositories only. No EF Core, no Dapper.Contrib | Hand-written SQL |
| No generic `IRepository<T>` | One interface per aggregate |
| bcrypt cost 10 | Not Argon2id — the seeded `$2b$` hashes must keep verifying |
| Integer cents in storage | USD decimals only where the existing DTO contract already does |
| Enum-like values as `text`/`text[]` | No PostgreSQL `ENUM` types |
| Plain `.sql` change scripts, no migration tool | Master + `changes/`, reconciled by `verify.sh` |
| `refillsLeft`: 0 = exhausted, null = no limit. **M6 decrements it inside the checkout/order transaction, alongside stock** | Owner's call, 2026-09-22. REQUIREMENTS P9 settled; M3 closed the read side |
| Deleting a pet with clinical history stays a **409** | Owner's call, 2026-09-22. Soft delete / archival is a later pass, not a regression to fix |
| **No booking cancellation cutoff.** §11.1 as written: either party cancels from any non-terminal state | Owner's call, 2026-09-22. REQUIREMENTS C14 deferred to M7, where cutoffs and penalties get designed together |
| **C14 decided: no penalty, a warning inside 12 hours.** Cancelling stays free and always allowed (§11.1). When the booking starts within 12 hours, the person cancelling is warned before it goes through — a confirmation, not a refusal and not a fee | Owner's call, 2026-10-10. Not yet built — the M8/M7 session does it. The server rule does not change; it is a UI warning |
| Cursor pagination on every list endpoint | From M4. No endpoint loads an unbounded set. One shared implementation in `Persistence/Cursor.cs` from M5 |
| **A vet review is one-directional**: the owner reviews the vet, never the reverse | REQUIREMENTS V10. Not a missing feature and not a symmetry to restore later — a clinician's rating of the client, attached to the animal's record and read by whoever treats it next, is a different product. `ReviewKinds` exists for this |
| **Completing a visit requires a summary.** There is no status button for `completed` | M5. The summary endpoint is the only way in, and it writes the records in the same transaction. A consultation marked done with no clinical record is a hole in the patient's history nothing would notice |
| **The week-4 checkpoint and first deploy were skipped** | Owner's call, 2026-10-09: build the landing page and carry on to M6. The risk `BUILD_PLAN.md` §7 names — deployment problems found late — is accepted and moves with the work; the known deploy blockers are the ⚠ items in §4 |
| **The one-refill-per-unit reading of P9** | Implemented 2026-10-10, **pending the owner's confirmation** (§4) |
| **`verificationStatus` is set by staff, never by the vet** | REQUIREMENTS V11. Enforced by absence — not on the patch DTO, not in the `UPDATE`. M9 gives staff the control |
| Dual auth from M1 | Cheap now, a rewrite later |
| AI assistant, pgvector, Redis, Docker | Out of scope |
