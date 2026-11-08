# Leash — Status

Where the build is, and what to pick up next.

Last updated: **2026-11-08**, the client's dashboard round (§3-D). **Every module in the plan is built**; what remains is deploying it — see §4 and `NEXT_PROMPT.md`.

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
| **M7** | Payments & membership | ✅ Done — 7 endpoints, the ledger, Stripe + demo providers, the webhook; 148 tests. See §3-M7 |
| **M9** | Admin console | ✅ Done — 14 endpoints, 8 screens, the audit log; 108 tests. See §3-M9 |
| — | Release hardening | ✅ Done — CI, a vulnerability gate, M5/M6 endpoint suites, code splitting, the two-site publish script. **The redeploy itself needs an elevated shell** — see §3-H |
| **M10** | Adoption | ✅ Done — 16 endpoints, 5 screens and the shelter dashboard; 81 tests, including the full port of `adoption-transfer`. See §3-M10 |
| — | **Dashboards** (client, 2026-11-08) | ✅ Vet, caretaker and owner done — stats cards, an interactive calendar, the upcoming list, vet rescheduling; 4 endpoints, 66 tests. **Shelter not started.** See §3-D |
| — | **Publishing availability** (2026-11-08) | ✅ An editor on the vet and caretaker profile pages; the booking calendar is a real month calendar; vet booking times fixed to the owner’s zone; 14 tests. See §3-AV |

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
cd API && dotnet test        # 889 passing, ~5m
cd web && npm run build && npx oxlint src
./db/verify.sh               # ✓ IDENTICAL
```

Demo logins: any seeded marketplace account with `leashdemo123` —
`maya.chen@example.com` (owner), `liam.novak@example.com` (caretaker),
`naomi.ruiz@example.com` (vet). In development the "Dev" switcher, bottom left,
changes account in one click. Staff accounts use `STAFF_PASSWORD`, not the
demo password.

### Database

32 tables (five change scripts since the bootstrap). 29 from the original schema (32 minus the three assistant tables),
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
| `db/changes/005_audit_log_seq.sql` | `admin_audit_log.seq`, an identity tie-break for the newest-first log, plus an index on `("createdAt" DESC, seq DESC)`. Applied to `petapp_dev` and `leash_review` |
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
PATCH  /appointments/{id}/status POST /appointments/{id}/reschedule   → the vet only (§3-D)
POST   /appointments/{id}/visit-summary
GET    /appointments/{id}/reviews   POST /appointments/{id}/reviews

GET    /products                 GET  /products/{slug}
POST   /orders/quote
GET    /orders                   POST /orders             GET /orders/{id}
POST   /orders/{id}/cancel       POST /orders/{id}/payment/sync
PATCH  /orders/{id}/status                                 → ops
GET    /ops/orders                                         → ops

GET    /notifications             POST /notifications      { ids } — marks exactly those

GET    /vets/{id}/stats          GET /caretakers/{id}/stats   GET /me/stats   → the dashboards' cards (§3-D)
       the four schedule lists also take ?from=&to=&status= — a calendar window, soonest first

GET    /membership               POST /membership/checkout
POST   /membership/cancel        POST /membership/resume
POST   /membership/portal        POST /membership/sync
POST   /webhooks/stripe                                    → unauthenticated; the signature is the gate

GET    /admin/stats                                        → any staff
GET    /admin/users   /admin/users/{id}    PATCH /admin/users/{id}    DELETE /admin/users/{id}   → support (staff roles, delete: admin)
GET    /admin/professionals      PATCH /admin/professionals/{id}        → support
GET    /admin/payments           POST  /admin/payments/{id}/refund     → finance
GET    /admin/subscriptions      PATCH /admin/subscriptions/{id}        → finance
GET    /admin/audit              GET /admin/settings   PATCH /admin/settings   → admin
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
| `IMessageService`, `IReviewService`, `IReputationService` | `IMessageRepository`, `IReviewRepository` |
| `INotifier` (status machines only), `INotificationService`, `INotificationOutbox` | `INotificationRepository` |
| `INotificationChannel` — `EmailChannel`, `PushChannel` (disabled) | |
| `IPaymentLedger`, `IEntitlementService`, `ISubscriptionReconciler`, `IMembershipService` | `IPaymentRepository` (payments + refunds), `ISubscriptionRepository` |
| `IWebhookEventStore`, `IStripeWebhookHandler`, `IStripeWebhookIntake` | `IWebhookEventRepository` |
| `IPaymentProvider`, `ISubscriptionProvider` — demo or Stripe, chosen by `Payments:Provider` | |
| `IAdminUserService`, `IAdminProfessionalService`, `IAdminFinanceService`, `IAdminConsoleService`, `IAuditLog`, `StaffGate` | `IAdminRepository`, `IAuditRepository` |
| `IDashboardService` (the cards, §3-D) | `IDashboardRepository` (read-only aggregates) |

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
/dashboard           one role-aware page: owner · caretaker · vet · shelter ("Viewing as")  [guarded]
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
/adopt               the adoption directory, longest-waiting first
/adopt/:id           an animal, and the application form
/adoptions/:id       an application: progress, the fee, withdraw
/shelters/:id        a shelter's public page
/dashboard/shelter-profile     the shelter's own profile  [guarded]
/plus  /account/membership     Leash Plus (M7)
/dashboard/admin/*  the staff console (M9)               [guarded; roles in the API]
```

Retired URLs redirect, carrying their query string: `/dashboard/pets`,
`/dashboard/bookings`, `/dashboard/appointments` → `/dashboard`; `/vet/:id` →
`/vets/:id`; `/appointment/new` → `/vets/book`; `/appointment/:id` →
`/appointments/:id` (`components/Moved.tsx`).

Shell, design system (`components/ui/`), session store, API client layer and the
route guard are all in place. `web/src/types/index.ts` is the reference
project's file, copied, with `PublicConfig.googleEnabled` added.

### Tests — 1050 passing

| File | Covers |
|---|---|
| `AvailabilityEndpointTests` | Publishing availability (§3-AV): a vet's save replaces the calendar and owners read the new days, saving the rest of the profile leaves it alone, an empty list closes everything, caretakers the same way, nobody publishes someone else's; refused: non-clock times, backwards hours, overlaps, 13 sets in a day, 401 days, a date twice |
| `DashboardServiceTests` | The dashboards (§3-D): what each card counts (declined/cancelled are not work, "upcoming" is live and not yet over, earnings are completed work at the recorded price, spending is the ledger net of refunds), the viewer's "today" and its clamp, the window reads (overlap, soonest first, status filter, keyset paging across shared start times), and rescheduling — vet only, requested/confirmed only, legality before authority, future only, the owner told in-app and by email, the conditional write |
| `DashboardEndpointTests` | The same over HTTP: every new route 401 anonymous, somebody else's figures and calendar 404, the wire shapes, the window's query string validated into the envelope (each list's own status vocabulary), the unchanged newest-first list, reschedule 200/403/404/409/400 and the owner's notification |
| `AdoptionTransferTests` | **Port of `tests/adoption-transfer.test.ts`, every case** — the specification for R6: preconditions, live engagements and the forced handover, the one-statement transfer (owner and `ownedSince` together), the record staying with the animal, severed grants both ways, rivals closed, one of two concurrent completions winning, reversal, the post-approval refund. Plus: reversal is audited, never refunds, needs support staff |
| `AdoptionServiceTests` | The rules in the reference's `listings.ts`, `applications.ts`, `payment.ts` and `shelters.ts`, which it had no suite for: the directory (available only, definite-yes filters, radius in the total, cursor), drafts, listing an animal and its machine, applying and its refusals, who decides what, one approval per animal, the fee through the ledger, the response rate |
| `AdoptionEndpointTests` | Adoption over HTTP: what is public, every private route 401, the nested wire shapes, 400/403/404/409 per refusal, the `live_engagements` payload, reversal needs support staff, and one adoption walked end to end — apply, review, approve, pay, complete, reverse |
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
| `PaymentLedgerTests` | Port of `tests/orders.test.ts` lines 434–868 — the provider seam with an asynchronous fake, idempotent and out-of-order intent states, the amount check, refund accounting, the payment state machine. Plus: the refund row exists before the provider is called, an unconfirmed refund stays pending and is retried under the same key, two refunds at once make one, a payment that settles after its order was cancelled is refunded |
| `StripeSignatureTests` | Port of `tests/stripe-signature.test.ts` against Stripe.net's verifier, signatures built by hand: tampering, wrong secret, replay, malformed header, re-serialised body, empty secret |
| `WebhookTests` | Port of `tests/webhooks.test.ts` — the claim protocol (new, duplicate, in-flight, dead worker, failed, exhausted, simultaneous), every handled event type, dashboard refunds, disputes won and lost, subscription ordering and grace, retention |
| `EntitlementTests` | Port of `tests/entitlements.test.ts` — who is a member, dunning grace, free shipping in the quote and at checkout, the consult discount snapshotted, priority booking on appointments **and** bookings |
| `MembershipServiceTests` | The membership routes the reference had no suite for: demo checkout through the reconciler, cancel/resume, portal, M2 and M14 failing closed, M15 customer reuse with a fake Stripe |
| `PaymentEndpointTests` | §9.4 over HTTP: buy Plus → free shipping and the 20% consult discount; the webhook refuses everything without a secret, rejects bad signatures, and processes one event delivered twice exactly once; the lead-time 409 carries the member window |
| `AdminServiceTests` | Port of `tests/admin.test.ts` — staff roles, search (every sort walked one row at a time, wildcards escaped), detail, every account action, staff-role changes and the last admin (including two admins demoting each other at once), soft delete, the audit log, settings, stats — plus professionals and finance, which the reference had no suite for |
| `AdminEndpointTests` | The console over HTTP: anonymous 401, customer 403 with an explanation (D2), the role matrix, Journey 7 (suspend → next request 401) and Journey 8 (refund → ledger and customer view), malformed actions, the audit row's actor and IP, settings reaching `/config`, V11 from the vet's side |
| `VetEndpointTests` | M5 over HTTP: every private route 401, the public three 200, no contact details in search, 403 vs 409, somebody else's appointment 404, the visit summary stamped with this appointment and the access check's vet whatever the body says, the one-way review, V11 |
| `StoreEndpointTests` | M6 over HTTP: S9 on quote and order, refused identically whatever the pet holds; the Rx 409 with its quote; **a tampered body charged the server's total**; duplicate lines 400; somebody else's order 404; customers cannot move orders; the ops queue; cancel window and refund |
| `BookingEndpointTests` | What is guarded and what is deliberately public, 409-vs-403, and the §6.4 acceptance walk |
| `AuthServiceTests` | Port of `tests/auth.test.ts` — hashing, credentials, registration, OAuth linking |
| `EmailFlowTests` | Port of `tests/email-flows.test.ts` — tokens, verification, reset, watermark |
| `AuthEndpointTests` | REQUIREMENTS §3.4 acceptance over HTTP, rate limits, revocation |
| `UserEndpointTests` | The two projections, self-only patching, the privilege boundary |
| `MobileTokenTests` | Dual auth, rotation, replay detection |

---

## 3-AV. Publishing availability (2026-11-08)

Owners can book a vet or caretaker only on a day the provider has published,
at the hours published. **Nothing let a provider publish** — the API took
`availability` on the profile PATCH (replace-whole), but no screen sent it, in
this build or the reference. So every published day was still the seed's July
2026, and the booking calendar, which only laid out those days with no months
to move between, showed a stale July.

| | |
|---|---|
| **The editor** | `components/AvailabilityEditor.tsx`, an "Availability" section on `/dashboard/vet-profile` and `/dashboard/caretaker-profile` (the dashboard strip links to `#availability`). Pick days on a month (several at once, or "Select weekdays"), set one or more sets of hours, open or close them; or **repeat a weekly pattern** for 4–52 weeks. Picking one open day loads its hours to edit. Nothing is sent until **Save availability**, which replaces the whole calendar with every day from today on — past days are dropped, so a calendar never outgrows the bound. Unsaved changes warn on leaving. Up to 12 months ahead. Shown once the profile exists; the profile form itself still never sends availability, so saving it leaves the calendar alone (tested) |
| **The rules** | `lib/availability.ts` mirrors the API: real clock times (`24:00` and `09:75` are not), each set ends after it starts, no two overlap (end-to-start is fine), at most 12 a day. The API's `AvailabilityDayValidator` now enforces the same — before, `25:00` and overlapping hours were accepted — and a save is bounded at 400 days, for vets and caretakers alike |
| **The booking calendar** | `AvailabilityCalendar` is a month grid with previous/next, starting at the selected day's month or the first month with something open, never before this month or beyond the 12-month horizon. Published days with hours are pickable; past days are not; a published day with no hours reads "Booked". With nothing open from today on, it says so. The same component is on the vet and caretaker profile pages |
| **Vet booking times** | The booking flow built each instant as `${date}T${time}:00.000Z` — the reference's — so a "09:00" slot was booked for **09:00 UTC** and the appointment page then showed it in the owner's zone (2:00 PM at UTC+5). It now reads the slot in the owner's zone (`fromDateTimeInputs`). Assumes owner and clinic share a zone, which a local marketplace does; the clinic's zone is not stored anywhere |

**Walked** (headless Chrome, `petapp_dev`): Dr Ruiz from the dashboard strip
landed on the editor; "Repeat every week" filled Mon–Fri for 8 weeks (40 days),
a Saturday clinic 10:00–13:00 on December 5, an overlap showed its message and
disabled opening; saved → 41 open days. Maya's `/vets/book?vetId=v1` opened on
November with those days open and their hours as slots; December showed the
Saturday; `/vets/v1` showed the same. A 09:00 booking on November 10 was stored
as 09:00 local (04:00 UTC). **The test appointment was deleted and v1's
response rate recomputed; Dr Ruiz's new published days were kept**, so
`petapp_dev` has a bookable vet.

---

## 3-D. The dashboards — client round (2026-11-08)

The client reviewed the dashboards and asked for the vet's and caretaker's to
be one layout, with the owner's sharing its top half. Vet, caretaker and owner
are done; **the shelter dashboard is untouched**, waiting on the client's
brief. The defaults below were the owner's choices on 2026-11-08.

| | |
|---|---|
| **Layout (vet and caretaker)** | Three cards → requests → schedule → **Upcoming**, a row of cards (four across, "Next up" marked; one slim line when there is nothing) → **Calendar** at full width, the selected day's panel floating under it → past → the listing, small, at the foot (`ProfileStrip`, replacing the "Your clinic" panel). The weekly availability grid is gone; published days are shaded on the calendar instead, and the day panel lists their hours |
| **Layout (owner)** | Three cards → the same Upcoming and Calendar with bookings and vet visits together → everything the owner had before (pets, visits and deliveries in flight, store picks, bookings) |
| **Why stacked** | The first cut put the list beside the calendar; empty, it was a tall blank box next to a full month, and the dashboards looked different depending on how busy each person was (the client's feedback, 2026-11-08). Stacked, the shape is the same busy or quiet, and the calendar has the width to label each day — "9:00a Biscuit", "+2 more" — from `sm` up; phones keep a dot per engagement. Only the weeks the month spans are drawn |
| **The day panel** | Opens under the calendar and scrolls itself into view when it opens off-screen — by no more than it takes, and again once its content has loaded, since a panel that opened as a skeleton can grow past the bottom. A panel already in view does not move the page. Pressing an Upcoming card jumps the calendar to that day and opens it the same way |
| **The cards** | Counted by the API over every row (`GET /vets/{id}/stats`, `/caretakers/{id}/stats`, `/me/stats`), gated like the list beside them. **Total** = requested, confirmed/accepted, in progress, completed (declined and cancelled were never work). **Upcoming** = live and not over before the viewer's today — the client sends `from` (local midnight), clamped server-side to within 26 h so it cannot count history. **Earned** = the recorded price of *completed* work; bookings and visits are **not charged through Leash**, so the card says "settled with the owner, not through Leash". **Spent** (owner) = what the ledger captured less refunds — store, Leash Plus, adoption fees — never the quoted price of care |
| **The calendar's reads** | The four list routes take `from`/`to`/`status`: with `from` they return the rows that *overlap* the window, soonest first, still keyset cursor pages (`ScheduleWindowSql`). Without `from` they are unchanged. `to` without `from`, `to ≤ from`, a status from the other vocabulary (`accepted` on appointments) or `status` without `from` is a 400 in the envelope. The calendar reads the visible six weeks, active statuses only (declined/cancelled are left off); the upcoming list merges sources across cursor pages without breaking order |
| **Reschedule** | `POST /appointments/{id}/reschedule { startDateTime, endDateTime }`. **The vet only** (owner 403, anyone else 404); **requested or confirmed only** (409, checked before the actor); the new start must be in the future (400); no lead time (the clinic is choosing). The status does not change, so the owner can still cancel. Written conditionally on the status (a racing cancellation wins), and the owner's notice — new kind `appointment_rescheduled`, in-app and by email through the outbox — commits with it. The notice carries no time: the server does not know the owner's zone, and the appointment page shows it in theirs. Same time again is a no-op that tells nobody. A **Reschedule** button on the vet's rows, the day panel and the appointment page |
| **No schema change** | `notifications.kind` is text. `db/changes` still ends at 005 |

**Walked** (headless Chrome, `petapp_dev`): Dr Ruiz's cards, July 12 on the
calendar showing a3 with Maya, Biscuit, the fee, the notes and her open hours;
rescheduled a3 from the day panel to the 20th of next month → it appeared in
her upcoming list and Maya's, and Maya's bell had "Your vet appointment has a
new time". Elena's July 20 showed Tom's boarding that began on the 18th. Phone
width: list above calendar. No console errors; the only failed calls were the
expected signed-out `401 /me`. **a3 and the notice were restored afterwards.**

---

## 3-M10. M10 — adoption (2026-10-18)

Shelters list animals; people apply; the shelter approves one; the applicant
pays the fee through the ledger; the shelter completes the adoption and the
animal moves to its new owner **with its whole health record**. Staff can put
it back.

| | |
|---|---|
| **Endpoints** | `GET /shelters/search`, `GET /shelters/{id}`, `GET`/`PATCH /users/{id}/shelter-profile`; `GET`/`POST /adoptions/listings`, `GET`/`PATCH /adoptions/listings/{id}`, `PATCH …/{id}/status`; `GET`/`POST /adoptions/applications` (`?as=shelter` for the queue), `GET …/{id}`, `PATCH …/{id}/status`, `POST …/{id}/payment`, `POST …/{id}/complete`; `POST /admin/adoptions/{id}/reverse` |
| **Screens** | `/adopt`, `/adopt/:id` (with the application form), `/adoptions/:id`, `/shelters/:id`, `/dashboard/shelter-profile`, and the shelter view of `/dashboard` — each a port of the reference screen. The `/adopt` placeholder and `ComingSoonPage` are gone |
| **R6 — the transfer** | `IAdoptionRepository.TransferPetAsync` is **the only code that moves `pets."ownerId"`**, and it moves `ownedSince` in the same statement, conditional on the old owner still owning the animal. That one write severs every caretaker and vet the previous household engaged (M2's predicates read `ownedSince`), and the records never move — they are keyed on the pet. Two concurrent completions: exactly one wins (tested). Reversal uses the same statement the other way |
| **R5 — the fee** | `POST …/payment` creates an intent keyed by the application id and a `payments` row (`kind = adoption_fee`, `adoptionApplicationId`); the demo provider settles inline through `ApplyIntentStateAsync`, Stripe through the webhook — **no new branch in the ledger or the webhook**. Applicant only, approved only; a $0 fee has no payment at all; a second call reuses the intent; a double click loses to the unique column and gets the same intent back |
| **Refunds** | Rejecting or withdrawing an *approved* application relists the animal and refunds a paid fee through `IPaymentLedger` (after the commit — the ledger calls the provider). **Reversal never refunds** — as the reference: whether the fee comes back is between a shelter and a person |
| **R7 — live engagements** | Completing is refused (409, `code: "live_engagements"`, with `bookingIds` and `appointmentIds`) while any booking or vet appointment for the animal is requested, accepted/confirmed or in progress. The dashboard names that, asks, and retries with `force: true`, which cancels each one **through its own status machine** as the shelter (the owner of record), so the other party is told. See the interpretation below |
| **R8 — reversal** | Support staff (admin passes), throttled like every admin write, **audited as `adoption.reverse` in the same transaction**, the adopter notified. The application becomes `rejected` with the reason as its note; the listing goes back to `available` |
| **R9** | Shelters have `responseRatePct` only, written by `ReputationService.RefreshShelterResponseRateAsync`: an application is answered once it is under review, approved, rejected or completed; a withdrawal counts as neither |
| **The machines** | Listings: draft → available → pending → adopted, with withdrawn, and adopted/withdrawn → available to relist. Applications: submitted → under review → approved → completed, with rejected and withdrawn. The shelter decides; the applicant may only withdraw; `completed` is reachable **only** by completing — a status write of `completed` is a 400. One approval per listing. Approving takes the animal off the market (`pending`) |
| **Notices** | The reference's six adoption kinds, word for word, written **inside** each move's transaction (N1) |
| **No schema change** | The tables were in the master from the start. `PaymentEntity` and its repository gained `adoptionApplicationId` |

### R7 — how "an explicit staff override" was read

REQUIREMENTS R7 says completion is refused while an open boarding booking
exists, "with an explicit staff override". The build does what the reference
does: **the shelter is the one who overrides**, explicitly, after being shown
what is in the way — and the refusal covers any live booking *or* vet
appointment, not only boarding. A support-staff-only override would block most
real adoptions, because a fostered animal in this data model *is* a pet under a
long boarding booking. **Confirm or change** — see §4.

### Differences from the reference

| | |
|---|---|
| **Wire shapes nest** | `{ listing, pet, shelterName, distanceMiles }`, `{ profile, user, availableCount, distanceMiles }`, `{ application, applicant, paymentStatus }` — the shape vets and caretakers already have. The flat reference types were removed from `types/index.ts`; the nested ones live in `api/adoptions.ts` and `api/shelters.ts` |
| **Every list is a cursor page** (§2.5) | The directory is `{ items, nextCursor, total }` (was offset paging) and the screens use "Show more"; shelter search and both application lists are cursor pages too (the reference returned bare arrays) |
| **The radius filters in SQL** | So `total` counts what the filters describe. The reference filtered after fetching a page, which shrank pages and over-counted. The directory stays longest-waiting first with a location too — the reference re-sorted *each page* by distance, which is no order at all across pages |
| **Draft listings are the shelter's** | `GET /adoptions/listings/{id}` serves a draft only to its own shelter, and a draft cannot be applied for. The reference served any listing by id |
| **Approving needs an available listing** | The reference set `pending` unconditionally, even over a withdrawn listing. Here approval moves `available → pending` conditionally and is a 409 otherwise |
| **Notices commit with the move** | The reference notified after its commit (N1). The application notices link to `/adoptions/{id}`; the reference's `/adoptions/applications/{id}` had no page behind it (N9) |
| **Race guards** | Applying locks the listing row, so one person cannot open two applications at once; listing an animal twice at once loses to the unique index with the same 409 |
| **`GET /users/{id}/shelter-profile` is a 404 when there is none** | Was `200 null`. Matches `/users/{id}/vet-profile`; the client reads both with `getJsonOrNull` |
| **Creating a listing** | `city`/`state`/`lat`/`lng` are optional and default to the shelter's address. The reference's schema required them while its service defaulted them |
| **Shelter search** | Active accounts only, as vets and caretakers. Sorted by available count, then response rate, then id |
| **The dashboard** | Recognises the live-engagement refusal by its `code`, not by matching words in the message |
| **The fee on a real card** | The reference's button assumed the demo provider. With Stripe configured, `/adoptions/:id` shows the checkout card form for the returned client secret |
| **Near** | The city picker of the vet and caretaker searches, filters in the URL |

### Kept as the reference has them — for you to decide

Each would change what a screen does, so none was touched (the brief allows
only §12 fixes). All are in §4.

1. **No screen creates or publishes a listing**, or reverses an adoption. The
   API does both (tested); the reference had no UI for either. A shelter's
   animals reach the directory only through the seed or the API.
2. **The applicant cannot see that their fee is paid.** The application has no
   payment field for the applicant, so the "Pay" panel stays after paying, and a
   second press says "already paid". The shelter's queue does show "Fee paid".
3. **"Approve" shows on a new application**, where only "Start review" is legal;
   pressing it is a 409. And "Decline" is hidden once approved, so a shelter
   cannot let an approved applicant go from the dashboard (the API allows it,
   with the refund).
4. **"Not yet listed"** on the shelter dashboard lists an animal whose listing is
   pending, because the directory search it reads returns available animals only.

---

## 3-H. Release hardening (2026-10-17)

| | |
|---|---|
| **CI** | `.github/workflows/ci.yml` — two jobs. *Schema + API*: a PostgreSQL 18 service, PGDG's 18 client tools, `bash db/verify.sh`, `dotnet list … --vulnerable` as a gate, `dotnet test`. *SPA*: `npm ci`, `npm run build`, `oxlint --deny-warnings`, `npm audit --audit-level=high`. Each command was run locally and passes; the workflow has not yet run on GitHub |
| **verify.sh in CI** | By committing `db/petapp_at_last_release.sql` (un-ignored). A delta-skipping mode was the alternative and would have checked nothing |
| **Vulnerabilities** | None in either package manager. Respawn 6.2.1 → 7.0.0 removed SqlClient and with it Azure.Identity 1.3.0; one dev-only npm finding fixed |
| **Endpoint suites** | `VetEndpointTests` (24) and `StoreEndpointTests` (25) — 889 tests |
| **Bundle** | Route-level splitting; entry 404 kB / 120 kB gzipped, from 847 kB in one chunk |
| **Deploy** | `deploy/publish-iis.ps1` rewritten for the two sites; it keeps the server's `config.js` and `appsettings.Production.json`. `-StageOnly` verified here. `deploy/README.md` §3–§5: publishing, payments settings, multiple instances |

**Not done: the redeploy.** Writing to `C:\inetpub\wwwroot\leash` and
`\leashfrontend` needs an elevated shell, which this session did not have. The
build is staged and verified; run `.\deploy\publish-iis.ps1` from an elevated
PowerShell. `leash_review` already has every change script (001–005).

---

## 3-M9. M9 — the admin console (2026-10-17)

REQUIREMENTS §10.2: fourteen endpoints under `/api/v1/admin`, the reference's
`AdminShell` and its eight screens, the audit log, and `tests/admin.test.ts`
ported (108 tests across `AdminServiceTests` and `AdminEndpointTests`).
`users.test.ts` was already covered by `UserEndpointTests`. One schema change:
`db/changes/005` (`admin_audit_log.seq`).

| | |
|---|---|
| **D1 — every call re-checks the role** | In the **service**, not the controller: each `IAdmin*Service` method starts with `StaffGate.RequireAsync(caller, role)`. The controller has `[Authorize]` (signed in) and decides nothing, so a route added later cannot forget a check that isn't there. Users/professionals: `support`; staff roles and deletion: `admin`; payments/subscriptions: `finance`; audit/settings: `admin`; overview: **any** staff role |
| **D2 — 403 that explains** | "This needs the "finance" staff role, which your account does not have." Never a 404 |
| **D3 — audit** | `IAuditLog.RecordAsync` is the only writer, and every mutation passes its own transaction, so the entry commits **with** the action (the reference wrote it best-effort afterwards). Actor, target, summary, metadata, IP (`X-Forwarded-For` first, else the connection — recorded, never trusted). Listed newest first, keyset on `(createdAt, seq)` |
| **D4 — not your own** | Nobody edits their own staff roles, suspends themselves or deletes themselves (403) |
| **The last admin** | Demoting, suspending or deleting an admin runs under a row lock on the active admins, re-reading the caller's own authority under it. Two admins demoting each other at once: one succeeds, the other is refused — tested. The reference counted without a lock, and its "last admin" refusal was only reachable through an actor its route would have refused anyway |
| **D5 — sessions** | Suspend and force sign-out bump `sessionsValidFrom` **and** revoke every refresh token in the same transaction. Journey 7 over HTTP: the suspended user's next request is a 401 |
| **Soft delete** | The row stays; name, email (a unique `deleted+{id}@removed.invalid`), phone, avatar, password hash, Google id, address, roles, staff roles and the Stripe customer id are scrubbed; sessions revoked |
| **V11** | Staff — and only staff — set a caretaker's background check or a vet's or shelter's verification. Verifying notifies the professional with a new kind, `profile_verified` (the reference reused `membership_started`) |
| **Finance** | The ledger with captured/refunded totals over the filter, refunds through `IPaymentLedger` (partial or full; a provider timeout is "queued", not "failed"); memberships with active count and MRR; cancel at period end or now (now: the provider is told to end it, not merely to stop renewing — the reference only set cancel-at-period-end at Stripe while marking the row ended), **resume** (spec; the reference had none), extend grace |
| **Settings** | `signupsOpen`, `maintenanceBanner`, `demoLoginVisible`, `freeShippingThresholdCents`. Only keys that actually change are stored and audited |
| **Throttle** | 120 admin writes an hour per member of staff, as the reference |
| **Lists** | Keyset everywhere with `total`; the screens keep "Previous · n / N · Next" through `useCursorPager` |

### Found on the way: an M1 session bug

**Signing back in straight after a forced sign-out was refused.** ASP.NET
serialises a cookie's `IssuedUtc` to whole seconds (RFC 1123) and a JWT's `iat`
is whole seconds, while `sessionsValidFrom` is written to the millisecond — so
a session issued in the same second as a revocation read as older than it. The
same hit "reset password, then sign in" inside one second. Both credentials now
carry the exact issue time as an `iat_ms` claim (`AuthClaims.IssuedAt`), and
the validator reads that, falling back to the coarse value for credentials
minted before the change.

**Walked** (headless Chrome, `petapp_dev`): Tom (support + finance) saw
Overview / Users / Professionals / Payments / Memberships; suspended Daniel with
a reason → Daniel's open session went from 200 to 401 → reactivated; verified a
professional; refunded $5.00 of Maya's o1 → her order read `partially_refunded`;
was shown "Staff only" on the audit page. Priya (admin) read the audit log
(every action above, with actor) and set a maintenance banner that Maya then
saw on the home page. Rosa (ops) saw Overview and Fulfilment only. Maya saw
"Staff only". No console errors; the only failed calls were those expected 403s.

---

## 3-M7. M7 — payments and membership (2026-10-17)

REQUIREMENTS §9, end to end, with the four reference suites ported **before**
the implementation (148 tests across six suites, §2). Seven endpoints, the
ledger, two providers behind each of two seams, the webhook, and three
screens: `/plus`, `/account/membership`, and checkout's Pay step. No schema
change — the M0 schema already had every table and column.

| | |
|---|---|
| **M1, M2 — the provider** | `Payments:Provider` = `demo` (default) or `stripe`, chosen once in `Payments/PaymentsSetup.cs`. `stripe` without `Payments:Stripe:SecretKey` throws at startup; an unknown value throws. Stripe goes through Stripe.net 53 (`Payments/StripeProviders.cs`); its failures become `PaymentProviderException`, **definitive** (a 4xx Stripe refused) or **transient** (timeouts, 5xx, 429) |
| **M3 — one reconciler** | `IPaymentLedger.ApplyIntentStateAsync` is the only writer of a payment's status from provider state. Its three callers: the webhook, the order page's sync, and the demo provider settling inline at checkout. Then `OrderLifecycle.SettleAsync`, which now acts only on what the ledger already says |
| **M4, M9 — the ledger** | The reference's transition table (`Payments/PaymentTransitions.cs`) is enforced on every write. Out-of-order events are refused by `lastEventAt` (event time, not arrival); a different amount than recorded marks the payment failed, not paid. The order's `paymentStatus` is mirrored in the same transaction |
| **M5 — the client secret** | Returned by `POST /orders` (and the 502 retry that creates the intent) only; never a column, stripped from webhook payloads before use, never returned by sync |
| **M6, M7 — the webhook** | `POST /webhooks/stripe`: 403 for everything while `Payments:Stripe:WebhookSecret` is unset; the raw body verified by Stripe.net (5-minute tolerance, API version not enforced); then the claim protocol — new / duplicate / in-flight / retry after a dead worker (5-minute lease) / exhausted after 5. A business "no" is a 200 skip; a thrown error is a 500 so Stripe redelivers. **Delivered twice → processed once**, shown over HTTP in the test suite and against the running API |
| **M8 — refunds** | Full or partial, recorded with who issued them. The row is written `pending` under a lock on the payment **before** the provider is called. A transient failure leaves it pending and the hourly housekeeping re-sends it under the same idempotency key; a definitive one marks it failed. A refund confirmed but not yet folded into the totals still blocks a second (found by the ported suite — see below). Refunds issued from Stripe's dashboard flow back in through `charge.refunded` |
| **Disputes** | `charge.dispute.created` → `disputed`; closed won → `paid`, lost → refunded in full |
| **M10–M12 — membership** | Stripe's own status vocabulary. `ISubscriptionReconciler.ApplyAsync` is the only writer of `subscriptions`, last-writer-wins by event time; `past_due` opens a 7-day grace window during which benefits continue. Membership notices (`membership_started`, `_payment_failed`, `_cancelled`, `_ended`) go out in the reconciler's transaction |
| **M11 — entitlements at the point of use** | `IEntitlementService` reads the database in the request: free shipping in `OrderService.PriceAsync` (quote and checkout, recorded in `benefitsApplied`), the 20% consult discount snapshotted in `AppointmentService.CreateAsync`, the 2-hour lead time in both `BookingService` and `AppointmentService`. A too-soon request's 409 carries `earliestAt`, `memberEarliestAt` and `isMember` |
| **M13–M15 — membership operations** | Checkout, cancel at period end, resume, portal, sync. M14: a plan the provider cannot sell is `purchasable: false` and checkout is a 503. M15: the provider customer id is stored on the user and reused |
| **Late payment on a dead order** | New. If a payment settles after its order was cancelled (the hold expired during a card challenge), it is refunded rather than left against an order whose stock was released. Leaving an unpaid order also cancels its intent at an asynchronous provider |
| **Throttles** | Membership checkout 10/hour; membership and order sync 60/hour, per user — as the reference had them |

### The demo provider sells Leash Plus — the deliberate departure

The reference had no demo subscription provider: without Stripe, membership
checkout was always a 503, so nothing about Leash Plus could be seen working
without keys. Here `DemoSubscriptionProvider` sells it: a one-month subscription,
settled inline **through `ISubscriptionReconciler`** plus an invoice row in the
ledger — the same two writes `customer.subscription.created` and `invoice.paid`
make. No money moves, exactly as with the demo store provider. It has no billing
portal (503) and no renewal loop: the period simply runs out.

### One bug the ported suite found

**Two refunds at once could both succeed.** Between the provider confirming a
refund and the ledger folding it into the payment's totals, the refund row says
`succeeded` while the payment still says `paid` with nothing refunded — and the
"already refunding?" check looked only for `pending`. A second refund in that
window passed every check. The in-flight check now counts a succeeded refund
whose `settledAt` is still empty. The reference had the same window.

### The seeded memberships are now relative to seeding time

The dev seed dated the three subscriptions absolutely; the active one lapsed on
2026-10-16, which would have made every "member" fixture a non-member. D001 now
dates them from `now()`, as the reference's seeder did. `petapp_dev` was rebased
the same way.

**Walked** (headless Chrome, `petapp_dev`, API on :5001 with a local webhook
secret): Maya's quote charged $5.99 shipping → `/plus` → "Join Leash Plus" →
landed on `/account/membership` showing Leash Plus, Active, renews in a month,
20% → the quote and cart then showed free shipping, "saving you $5.99" → a vet
appointment recorded **$68 against the clinic's $85** → a caretaker booking 3
hours out was accepted (members' lead time) → "Cancel booking" showed the C14
warning; dismissing kept it, confirming cancelled it → cancel and resume the
membership → the bell read "Your membership will end", "Welcome to Leash Plus".
A signed `invoice.paid` posted twice: `200 {effect}` then `200 {claim:
duplicate}`, one ledger row, `processed, attempts 1`; unsigned and wrong-secret
posts were 400. No console errors, no failed API calls.

**Not walkable:** the Stripe path itself — no keys on this machine. The
`StripePaymentProvider`/`StripeSubscriptionProvider` request shapes follow the
reference and Stripe.net's typed options, but have never been sent to Stripe.
The signature check and every webhook branch are covered by the ported suites.

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
| Checkout | The Pay step (`PaymentForm`) appears when `config.js` has a Stripe publishable key; a 502 after the order exists turns the button into "Retry payment" | The key is runtime config (`config.js`), not a build-time env var, so a deployed site can be switched without a rebuild. "Retry payment" is the API's documented failure mode (S17) |
| Ops queue | No refund button | As in the reference — refunds are the M9 admin console |
| Vet profile | The emergency panel's number is the clinic's own line (`clinic.phone`), not the vet's personal phone; the vet's profile form has a "Clinic phone" field the reference lacked | Owner's decision (§4) — the reference leaked the whole user record |
| Caretaker and vet profiles | Signed out, review bylines show the author's name | `GET /users?ids=` is now public (§4); in the reference it needed a session too |
| Pet page | The owner's "Remove" link stays | Owner's decision, 2026-10-10 |
| Notification bell | Opening the panel marks read **only the unread items it shows** (`POST /notifications { ids }`), not everything | REQUIREMENTS N7 — the reference cleared notifications that arrived after the panel was fetched, and every one beyond the thirty it showed |
| Shelter dashboard | A placeholder | M10 |
| Admin lists | "Previous · 2 / 5 · Next" kept, over cursor pages (`useCursorPager`) | §2.5; the reference paged by offset. The total still drives the page count |
| Admin overview | No "Support assistant" panel; visible to **any** staff role | The assistant is out of scope (§14); the spec says any staff, the reference gated it on `support` so ops-only staff had no landing tab |
| Admin memberships | A "Resume" button on a membership set to end | REQUIREMENTS §10.2 lists resume; the reference had cancel and extend-grace only |
| `/plus`, `/account/membership` | Joining works on the demo provider: the membership starts at once and the page lands on `/account/membership?checkout=success` | The reference had no demo subscription provider and answered 503, so Leash Plus could not be seen working without Stripe keys. The demo settles through the same reconciler as the webhook (M3). M14's 503 is kept for Stripe without a price |
| `/account/membership` | "Manage billing" on the demo provider is a 503 toast | There is no billing portal to open; not pretended |
| Booking and appointment detail | "Cancel" inside the last 12 hours asks to confirm | C14, owner's decisions 2026-10-10 (bookings) and 2026-10-17 (appointments too). UI only; the server rule is unchanged |
| Booking and appointment requests | A too-soon request's 409 carries `earliestAt`, `memberEarliestAt`, `isMember` | As the reference's appointments route did; now on bookings as well. The screens still show only the message |

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
| | `tests/` in the reference project has 28 Vitest suites. 21 are ported in full (M8 added `notifications`; M7 `webhooks`, `stripe-signature`, `entitlements` and the second half of `orders`; M9 `admin`; M10 `adoption-transfer`), and `users` is covered by `UserEndpointTests`. Not ported: the five `assistant-*` suites (out of scope), and `validation` — eight Zod-schema cases; the equivalent FluentValidation rules exist but not every one is pinned by a test. They are the specification — port each module's as you build it |
| | ~~M5 and M6 have no endpoint suites.~~ **Done in release hardening**: `VetEndpointTests` and `StoreEndpointTests`, including S9 and the price-tampering refusal over HTTP |
| ⚠ | **Refills spent on a cancelled order are not given back.** Checkout spends them per unit; cancellation restocks the goods but cannot return the refills, because nothing records *which* prescription a line drew on — that wants an `order_items."prescriptionId"` column (a schema change). The direction is safe — it under-authorises, never over — but an owner who cancels has to ask their vet to renew. Decide before real customers do it |
| ❓ | **Confirm "one refill per unit".** The owner's decision says "decrement when an Rx line is bought" without saying whether a line of three bags spends one refill or three. Implemented as three, because one-per-line lets a single refill cover a 99-bag line. One constant to change in `PrescriptionCover` if the intent was the other |
| | ~~REQUIREMENTS C14 — the booking cancellation window.~~ **Settled 2026-09-22: §11.1 as written, no cutoff.** Revisit alongside cancellation *penalties* when M7 brings payments and refunds — a cutoff with no money behind it is a rule with no consequence. See §5 |
| | ~~C13 is half-wired.~~ **Done in M7**: `priority_booking` shortens the lead time to 2 hours on bookings and appointments, read by `IEntitlementService` in the request |
| | ~~V5 is unwired.~~ **Done in M7**: a member's appointment records `discountPct` 20 and the discounted `feeCents`, snapshotted |
| | ~~M6 must decrement `refillsLeft` when an Rx line is bought.~~ **Done in M6**, in the order's transaction alongside the stock — see §3. REQUIREMENTS P9 is closed on both sides |
| | ~~M7 owns three things M6 left at the safe default, plus retryable refunds.~~ **Done in M7** — free shipping in the quote, the consult discount, priority booking; refunds write a pending row before the provider is called and are retried |
| | ~~Notifications for order milestones are M8's.~~ **Done in M8** — `OrderLifecycle.MoveAsync` raises them inside the move's transaction; the fulfilment suite's "notifies the customer" case is ported |
| | **Run the fulfilment job on one instance** — documented in `deploy/README.md` §5 (`Fulfilment__Enabled=false` on the others). The notification drain and the webhook are safe on every instance |
| | Catalogue text search is `ILIKE` — a sequential scan, fine at 25 products. At catalogue scale it wants a `pg_trgm` index (a schema change) |
| ⚠ | **A pet that has died cannot be removed.** Deleting is blocked once the animal has vet visits or health records, because all three FKs onto `pets` cascade and an owner must not delete records their vet authored. Needs a soft delete (`deletedAt`) and a decision about what a bereaved owner still sees — `STATUS.md` §3 has the reasoning |
| | `AccessServiceTests` still inlines the active-prescription rule as SQL. `IMedicalRecordRepository.ListAuthorizedProductSlugsAsync` now exists — swap the helper for a call to it so there is one definition in the tests too |
| | Google OAuth is implemented but unconfigured, so untested against the real provider. Set `Auth:Google:ClientId`/`:ClientSecret` and add `http://localhost:5173/api/v1/auth/google/callback` as an authorised redirect URI |
| | ~~`db/petapp_at_last_release.sql` is gitignored.~~ **Committed** so CI can run `verify.sh`; ARCHITECTURE §2 step 1 says when to replace it |
| | ~~No CI.~~ **`.github/workflows/ci.yml`**: PostgreSQL 18 service, `verify.sh`, a NuGet vulnerability gate, `dotnet test`; and for the SPA `npm ci`, build, `oxlint --deny-warnings`, `npm audit --audit-level=high`. Every step was run locally; **the workflow itself has not run on GitHub yet** — it will on the next push |
| | ~~Nothing builds the SPA into `wwwroot`.~~ Moot: the deployment is two sites (the SPA is its own). `deploy/publish-iis.ps1` now publishes both and keeps the server's `config.js` and `appsettings.Production.json` |
| | ~~Vulnerable transitive packages.~~ **Gone**: Respawn 6.2.1 pulled Microsoft.Data.SqlClient 4.0.5 → Azure.Identity 1.3.0; Respawn 7.0.0 needs neither. `System.Drawing.Common` was no longer in the graph. `npm audit` fixed one dev-only finding (`source-map-js`) |
| | ~~`verify.sh` cannot run in CI.~~ It can: the baseline is committed (the option chosen over a mode that skips the delta half, which would test nothing) |
| | ~~One 847 kB bundle.~~ **Route-level splitting** (`web/src/lazyPages.ts`): the entry chunk is 404 kB (120 kB gzipped), every page but home/login/signup/404 loads on first visit, plus a 234 kB shared chunk (framer-motion) |
| | **The parity pass's three API questions — decided 2026-10-10.** (1) **Clinic phone: yes.** `vet_profiles."clinicPhone"` (db/changes/003), on the wire as `clinic.phone`, set by the vet on their profile form, shown as a `tel:` link in the emergency panel. Not backfilled from `users.phone`, so a live database never publishes a vet's personal number; the dev seed carries clinic numbers. (2) **Allergen flags on store cards: no.** The product page and cart show the server's finding; the catalogue search takes no pet. (3) **Reviewer names for signed-out visitors: yes.** `GET /users?ids=` is public, like `GET /users/{id}` — the public projection only, capped at 50. The unfiltered listing still needs a session and a Development host. Both pinned by tests (`VetServiceTests`, `UserEndpointTests`) |
| | **Dashboards read the first 100** bookings, appointments and orders (the API's page maximum), newest first, and split them client-side as the reference did with unpaginated arrays. Fine at demo scale; a user with more than 100 bookings would not see the oldest in "Past". **Since §3-D the cards, the calendar and the upcoming list no longer depend on this** — they are counted and windowed by the API; only the request/schedule/past lists still read the hundred |
| | **The dev seed's bookings and appointments are all in June–July 2026**, so on `petapp_dev` today every "Upcoming" card reads 0 and the current month is empty; page back to July to see the calendar populated. Not changed, because the suites pin the seed's dates. **The seed's published availability is July 2026 too** — every other vet and caretaker has nothing bookable until they publish days in the editor (§3-AV). On `petapp_dev`, Dr Ruiz now has Mon–Fri published to early January |
| | **The header flickers if a page comes to rest at about 8px of scroll.** Found during the §3-D walk, there before it: `useScrolled(8)` shrinks the header past 8px, which shortens the page, which can pull the scroll back under the threshold — a 1px loop. Only at that exact resting point; a hysteresis (e.g. on at 16px, off at 4px) would end it |
| | `web/src/assets/{hero.png,react.svg,vite.svg}` are Vite template leftovers. The landing page uses the reference's Unsplash hero (`HERO_PHOTO`), not `hero.png`, so all three can go |

| ❓ | **R7 — who may override the live-engagement refusal.** Built as the reference: the shelter, explicitly, after the dashboard names what is in the way; and any live booking or vet appointment refuses, not only boarding. If R7's "staff override" meant support staff only, it is a check in `AdoptionTransferService.CompleteAsync` and a button in the console. §3-M10 has the reasoning |
| ❓ | **Four reference-screen gaps in adoption, left as the reference has them** (§3-M10; confirmed 2026-10-18 that the reference has every one — routes with no screen calling them, no paid-fee field, the same buttons, the same available-only search): no screen to create, publish or edit a listing, or to reverse an adoption (the API does all of it); the applicant's page cannot show that the fee is paid (would need `paymentStatus` on the applicant's view of an application — an API change); "Approve" offered on a brand-new application (always a 409) and "Decline" hidden once approved; "Not yet listed" includes animals whose listing is pending. The client chooses in `NEXT_PROMPT.md` §1 (D2) |
| ⚠ | **No payment has ever gone through Stripe — in this build or in the reference.** Checked 2026-10-18: the reference had real Stripe code but ran `LEASH_PAYMENTS=demo` with no keys; this build is the same (`Payments:Provider` unset → demo, no keys, the publishable key empty in `config.js`). Orders, Leash Plus, the adoption fee, refunds and the webhook are tested with fakes and Stripe.net's signature check only. Going live is configuration (`deploy/README.md` §4) plus a test-mode purchase of each kind — `NEXT_PROMPT.md` §3 A |
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
| **C14 decided: no penalty, a warning inside 12 hours.** Cancelling stays free and always allowed (§11.1). When the booking starts within 12 hours, the person cancelling is warned before it goes through — a confirmation, not a refusal and not a fee | Owner's call, 2026-10-10; **vet appointments get the same warning** (owner, 2026-10-17). Built in M7 (`web/src/lib/cancellation.ts`). The server rule does not change |
| Cursor pagination on every list endpoint | From M4. No endpoint loads an unbounded set. One shared implementation in `Persistence/Cursor.cs` from M5 |
| **A vet review is one-directional**: the owner reviews the vet, never the reverse | REQUIREMENTS V10. Not a missing feature and not a symmetry to restore later — a clinician's rating of the client, attached to the animal's record and read by whoever treats it next, is a different product. `ReviewKinds` exists for this |
| **Completing a visit requires a summary.** There is no status button for `completed` | M5. The summary endpoint is the only way in, and it writes the records in the same transaction. A consultation marked done with no clinical record is a hole in the patient's history nothing would notice |
| **The week-4 checkpoint and first deploy were skipped** | Owner's call, 2026-10-09: build the landing page and carry on to M6. The risk `BUILD_PLAN.md` §7 names — deployment problems found late — is accepted and moves with the work; the known deploy blockers are the ⚠ items in §4 |
| **The one-refill-per-unit reading of P9** | Implemented 2026-10-10, **pending the owner's confirmation** (§4) |
| **`verificationStatus` is set by staff, never by the vet** | REQUIREMENTS V11. Enforced by absence — not on the patch DTO, not in the `UPDATE`. M9 gives staff the control |
| Dual auth from M1 | Cheap now, a rewrite later |
| AI assistant, pgvector, Redis, Docker | Out of scope |
