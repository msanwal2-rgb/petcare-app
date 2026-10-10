# Leash — Build Plan

How and when to build. **What** to build is in `REQUIREMENTS.md`.

**Target:** a fresh .NET 10 API + React (Vite) SPA + PostgreSQL, reaching full
parity with the existing application minus the AI assistant.

**Timeline:** 2 months (~40–44 working days).

---

## 0. Where the plan stands — revised 2026-10-10

The calendar in §6 is the original. This section records what actually
happened against it, and the revisions the owner made. **`STATUS.md` is the
detailed source; this is the plan-level view.**

| Plan days | Work | State |
|---|---|---|
| 1–5 | M0 Foundation · M1 Auth | ✅ Done |
| 6–10 | M2 Authorization · M3 Pets & records | ✅ Done |
| 11–15 | M4 Caretakers & bookings | ✅ Done |
| 16–18 | M5 Vets & appointments | ✅ Done |
| 19–20 | Week-4 checkpoint + first deploy | ⏭ **Skipped** — owner's decision, 2026-10-09 |
| — | Landing page (`app/page.tsx`) | ✅ Done — **was never scheduled**; added 2026-10-09 |
| 21–30 | M6 Store & orders | ✅ Done |
| **31–34** | **UI parity pass** — see below | ⬜ **Next.** Added 2026-10-10 |
| 35–36 | M8 Notifications | ⬜ |
| 37–39 | M7 Payments & membership | ⬜ |
| 40–42 | M9 Admin console | ⬜ |
| 43–44 | Release hardening + **first deploy** | ⬜ |
| stretch | M10 Adoption | ⬜ |

**28 plan-days of scope done; 2 skipped; 14 remain, plus the stretch.** The
parity pass moves the end of the plan from day 40 to day 44 — the top of the
original "~40–44 working days".
531 xUnit tests passing; 15 of the reference's 28 Vitest suites ported (one in
half — `orders.test.ts` lines 434–868 belong to M7).

### The revisions, and what they cost

1. **The week-4 checkpoint and first deploy were skipped.** The owner's call,
   recorded in `STATUS.md` §5, and it stands. The consequence is the one §7
   warns about: **the first deploy now happens in days 43–44, and every
   deployment problem lands there.** Six are already known (STATUS §4, ⚠ rows):
   nothing builds the SPA into `wwwroot`; no CI; `verify.sh` cannot run in CI
   because its baseline is gitignored; vulnerable transitive packages in the
   test project; the fulfilment job must run on one instance; host
   configuration never exercised. None is hard; all are cheaper before week 8.
   The week-6 deploy in §7 did not happen either, for the same reason.
2. **The landing page was added.** No day in §6 owned it — it was not a module,
   so the original plan had none. It took about half a day and is done.
3. **A UI parity pass was added before M8/M7** (owner's decision, 2026-10-10).
   §4 says the 44 reference pages are *ported mechanically*. In practice most
   M1–M6 screens were written fresh against the new API instead, so the app
   works but looks like a different product — the dashboard most of all. See
   the next section.

### The UI parity pass — days 31–34

**Goal: every screen built so far looks and is structured like the reference
app.** The reference's screens are the design; `web/` currently has its own.

**Measured 2026-10-10:** 27 of the reference's 69 components exist in `web/`.
34 of the 42 missing belong to modules already marked done. The other 8 —
`PaymentForm` (M7), `NotificationBell` (M8), `AdminShell` (M9), the adoption and
shelter screens (M10) — arrive with their modules and are **out of scope** here.

#### The rules

1. **Port, don't redesign.** Copy the reference component and apply the
   ARCHITECTURE.md §6 table (`next/link` → `Link to`, `next/image` → `<img>` with
   the `BLUR_DATA_URL` background, `useRouter` → `useNavigate`, delete
   `"use client"`). If it looks different afterwards, the port is not finished.
2. **Change only the data access.** Reference components call `lib/api/*` with
   the old shapes. Swap each call for the `web/src/api/*` one, which differs in
   known ways: list endpoints are cursor pages (`{ items, nextCursor }`) instead
   of arrays; `CaretakerWithUser` and `VetWithUser` are nested
   (`{ profile, user, … }`) not flat; self-only lists read the session rather
   than taking a user id (`listMyBookings()`, not `getBookingsByOwner(id)`).
   `web/src/hooks/useAsync.ts` and `getUsersByIds` already exist.
3. **Keep the deliberate fixes.** These differ from the reference on purpose:
   the hero search bar's city picker (the reference's location box filtered
   nothing); the visit summary offering `allergy` (V9); no "complete" button on
   an appointment (the summary completes it); the server-side quote with
   allergen warnings in the cart; per-unit refills. Where a reference component
   reproduces a defect from REQUIREMENTS.md §12, the fix wins.
4. **No API changes.** Everything the reference screens need already exists. If
   that turns out to be wrong, stop and say so rather than widening an endpoint.

#### The inventory, in order

| # | Area | Reference → port | What changes in `web/` |
|---|---|---|---|
| 1 | **Dashboard** — the biggest gap | `app/dashboard/page.tsx` + `components/dashboard/{OwnerDashboard,CaretakerDashboard,VetDashboard,BookingListRow}.tsx`, `AuthRequired.tsx` | One page that switches by role ("Owner dashboard / Welcome back, Maya", "Viewing as" toggle, a "finish setting up" empty state when there are no roles). **Owner:** pet cards → vet appointments and "on its way" orders side by side → recommended products for the first pet → upcoming bookings → past bookings. **Caretaker:** incoming requests with inline Accept/Decline → active bookings → availability calendar → history. **Vet:** requests → schedule → "your clinic" → past appointments. `ShelterDashboard` waits for M10 |
| 2 | **Routes and URLs** | the reference route list | `/vet/:id` → **`/vets/:id`**; `/appointment/new` → **`/vets/book`**; `/appointment/:id` → **`/appointments/:id`**. The standalone `/dashboard/pets`, `/dashboard/bookings` and `/dashboard/appointments` pages **do not exist in the reference** — their content is the owner dashboard. Remove them and redirect the old URLs to `/dashboard` (and the renamed ones to their new paths) so no bookmark 404s |
| 3 | **Shared UI kit** | `components/ui/{Panel,ProfileHero,ResultsGrid,SelectFilter,ToggleChips}.tsx`, `PetCard` + `PetCardSkeleton`, `ReviewCard`, `BookingStatusBadge`, `vet/AppointmentStatusBadge` | Port first; most screens below depend on them |
| 4 | **Find care** | `search/SearchResults.tsx`, `AvailabilityCalendar.tsx`, `booking/BookingNewClient.tsx`, `booking/MessageThread.tsx`, `reviews/LeaveReview.tsx`, `CaretakerProfileForm.tsx` | Search results, caretaker profile (`ProfileHero`), booking request, booking detail's thread and review, the caretaker's own profile editor |
| 5 | **Find a vet** | `vet/{VetSearchResults,VetCard,VetProfileForm,AppointmentBookingClient,VisitSummaryForm}.tsx` | Vet search, vet profile, booking a visit, the visit summary form (keeping `allergy`), the vet's profile editor |
| 6 | **Health record** | `vet/{HealthRecordSection,MedicalRecordCard}.tsx` | The pet detail page's timeline |
| 7 | **Store** | `store/{StoreCatalog,PetShoppingBar,RecommendedForPet,FeedingGuide}.tsx` | The shop grid and filters, the "shopping for <pet>" bar, recommendations, the feeding guide on a product page. Keep the server quote and allergen warnings |
| 8 | **Login / signup** | `app/login/page.tsx`, `app/signup/page.tsx` | Mostly ported already; the reference has a photo panel (`Image` + `BLUR_DATA_URL`) the web version lacks. Line-by-line visual diff |
| 9 | **Content pages** | `app/pet-health/page.tsx`, `app/support/page.tsx`, `lib/content/{pet-health,support-policies}.ts` | Missing entirely. `lib/content` is "copy as-is" per §4 |
| 10 | **Dev account switcher** | `DevAccountSwitcher.tsx` | One-click switching between demo accounts in Development. Must stay off outside Development, as `demoLoginVisible` already is |

#### Done means

- Every screen in rows 1–10 compared side by side with the reference, and the
  differences that remain are only the deliberate ones in rule 3.
- `npm run build` + `npx oxlint src` clean; `dotnet test` still green (no API
  changes expected, so it should be untouched).
- **From M8 on, every module ports the reference screens first and adapts them
  to the API second.** That is the rule that stops this recurring.

### Debt carried into weeks 7–8

| | Item | Why it matters |
|---|---|---|
| ⚠ | **Endpoint suites for M5 and M6** (`VetEndpointTests`, `StoreEndpointTests`) | Every other module has one. S9 and price-tampering are HTTP-shaped and currently checked only by hand-run curl walks |
| ⚠ | **Port `orders.test.ts` 434–868, `webhooks.test.ts`, `stripe-signature.test.ts` before writing M7** | §7 and §11 already require this; M7 is the highest-risk week |
| ❓ | **Owner to confirm "one refill per unit"** | M6 implemented P9 that way; one constant if the intent was per line |
| | Refills are not restored when an order is cancelled | Needs `order_items."prescriptionId"` — a schema change |
| | Route-level code splitting | Bundle is 749 kB in one chunk, growing ~70 kB a module |

---

## 1. Decisions

| | |
|---|---|
| Backend | ASP.NET Core **`net10.0`**, **MVC controllers**, layered: API + class library |
| Data access | **Dapper** + Npgsql, inside repositories behind interfaces. No EF Core. |
| Database | **PostgreSQL 18.6**, local ✅ installed. Plain `.sql` run in pgAdmin — no migration tool. |
| Frontend | **React + Vite** SPA, React Router, TypeScript, Tailwind v4 |
| Deployment | Vite builds to static files **served by ASP.NET** — one process, no Node in production |
| UI | **Port** the existing 75 components and design system |
| Out of scope | AI assistant, pgvector, Redis, Docker |

`net10.0` over `net8.0`: .NET 8 leaves LTS support 10 Nov 2026.

### Packages

| Concern | Package |
|---|---|
| Driver | `Npgsql` — one `NpgsqlDataSource` singleton |
| Micro-ORM | `Dapper` |
| Validation | `FluentValidation` |
| Passwords | `BCrypt.Net-Next` — verifies the existing `$2a$`/`$2b$` hashes unchanged |
| OAuth | `Microsoft.AspNetCore.Authentication.Google` |
| Payments | `Stripe.net` |
| Tests | `xUnit` + `Respawn` |
| API docs | Swashbuckle → OpenAPI → TypeScript client |

**Deliberately not used:** Dapper.Contrib (hand-write SQL), AutoMapper (mapping
is trivial; explicit is clearer), MediatR (no pipeline needs it), a generic
`IRepository<T>` (a CRUD surface buys nothing over Dapper — there is no change
tracker to abstract over — and it would flatten projections that are
deliberately different, like "the user row" versus "the user row plus its
password hash").

### Architecture — controller / service / repository

Three projects. **Revised from the original single-project, Minimal-API,
feature-folder plan**, which is what M0 was scaffolded as; M1 was restructured
into this and the layout below is what exists.

| Project | Holds | References |
|---|---|---|
| `Leash.Api` | MVC controllers, the error envelope, the JSON contract, the auth schemes | `Leash.Core` |
| `Leash.Core` | models (entities, DTOs, enums), repository interfaces + Dapper implementations, service interfaces + implementations, validators | — |
| `Leash.Api.Tests` | xUnit: services against `Leash.Core`, endpoints against a booted `Leash.Api` | both |

The dependency arrow points one way. `Leash.Core` references the
`Microsoft.Extensions.*` **abstractions** and never ASP.NET Core, so anything
needing an `HttpRequest` or an `IActionResult` cannot drift into it — that is
what the compiler enforces rather than a convention.

- **Controllers are thin:** guard → service call → map the result to a status.
  They read the request (a client IP for a rate-limit key, a header to choose a
  credential) because that needs the request; they decide nothing.
- **Services hold the rules** and own transactions.
- **Repositories hold the SQL**, one interface per aggregate, and nothing else
  in the codebase opens a connection.
- **DI everywhere:** `AddLeashCore(config)` in `Leash.Core/DependencyInjection.cs`
  is the composition root, so a second host (a worker, a test) gets the same
  graph without duplicating the wiring.

### Transactions — complex operations commit or roll back as one

**Rule: a write that touches more than one row or more than one table runs
inside a transaction.** PostgreSQL transactions are cheap and its DDL is
transactional, so this costs nothing and removes a class of "how did the data
get like that?".

Every repository method takes an optional `ITransactionScope`. Passed one it
enlists in the caller's transaction; passed nothing it runs on its own
connection — so a single-statement call site stays a single line, and a service
that needs several writes to be atomic opens one scope and passes it down
(`IUnitOfWork.BeginAsync()`). Disposing without committing rolls back, so an
exception on the way out of a `using` leaves nothing behind.

Where a partial write would be actively wrong, not merely untidy:

| Operation | Why both halves or neither |
|---|---|
| Password reset | New hash + session watermark + refresh-token revocation. Hash without watermark leaves the attacker's session valid — the reset accomplishes nothing it was for. |
| Refresh-token rotation | Issue replacement + revoke predecessor, under `SELECT … FOR UPDATE`. Either half alone breaks single-use: revoke-only locks the user out, issue-only leaves two live tokens. |
| Issuing a verification token | Delete the previous one, insert the new one. Otherwise a resend leaves two live links, or none. |
| Registration | Duplicate check + insert. Without it two simultaneous signups both read "no such user" and the second dies on the unique index — a 500 where a 409 was meant. |
| Rate-limit consume | Count + record. Otherwise a burst all reads the same low count and all passes, which is precisely the case the limit exists for. |
| Stock decrement (M6) | Guarded `WHERE "stockQty" >= @qty` inside the order transaction, so the sold-out race still returns 409. |

Expensive work stays **outside** the transaction — bcrypt at cost 10 is ~100ms
of CPU, and holding a row lock across it would serialise unrelated resets
behind each other.

---

## 2. Repository layout

```
petcare-app/
├── API/
│   ├── Leash.slnx
│   ├── src/Leash.Api/                    HTTP only — no SQL, no rules
│   │   ├── Program.cs
│   │   ├── Controllers/
│   │   │   └── <Domain>Controller.cs     [ApiController], "api/v1/…"
│   │   ├── Auth/
│   │   │   ├── AuthSetup.cs              cookie + JWT + Google, scheme selector
│   │   │   ├── SessionCookie.cs          issues the ticket, sets IssuedUtc
│   │   │   ├── CurrentUser.cs            RequireUserId(), the 401 envelope
│   │   │   └── AuthConstants.cs
│   │   ├── Filters/ValidationActionFilter.cs   global, FluentValidation
│   │   ├── Http/ApiResults.cs            ★ the error envelope
│   │   ├── Json/IsoDateTimeConverter.cs
│   │   └── wwwroot/                      Vite build output
│   │
│   ├── src/Leash.Core/                   models · repositories · services
│   │   ├── DependencyInjection.cs        AddLeashCore() — composition root
│   │   ├── Models/
│   │   │   ├── Entities/                 rows, mutable for Dapper
│   │   │   ├── Dtos/                     mirrors web/src/types
│   │   │   └── Enums/                    role/status string constants
│   │   ├── Repositories/
│   │   │   ├── Interfaces/I<Aggregate>Repository.cs
│   │   │   └── <Aggregate>Repository.cs  ★ the only place SQL lives
│   │   ├── Services/
│   │   │   ├── Interfaces/I<Domain>Service.cs
│   │   │   └── <Domain>Service.cs        business rules, owns transactions
│   │   ├── Persistence/
│   │   │   ├── UnitOfWork.cs             ★ ITransactionScope, DbSession
│   │   │   ├── DapperSetup.cs            timestamptz ↔ DateTimeOffset
│   │   │   └── Ids.cs                    id prefixes, the one clock read
│   │   ├── Security/                     Passwords (bcrypt), EmailAddress
│   │   ├── Email/                        IMailer + Resend / log
│   │   ├── Validation/                   FluentValidation
│   │   └── Configuration/AppOrigin.cs    ★ emailed links, never the Host header
│   │
│   └── tests/Leash.Api.Tests/
│       ├── Infrastructure/DatabaseFixture.cs   petapp.sql + Respawn
│       ├── Infrastructure/CoreHost.cs          Leash.Core via real DI
│       └── Infrastructure/LeashApp.cs          WebApplicationFactory
├── web/
│   ├── src/
│   │   ├── routes/      React Router config
│   │   ├── pages/       ← ported from app/**/page.tsx
│   │   ├── components/  ← ported from components/
│   │   ├── api/         ← copied from lib/api/
│   │   ├── store/       ← copied from lib/store/
│   │   ├── lib/         ← copied from lib/{pricing,delivery,geo,utils}.ts
│   │   ├── types/       ← copied from types/index.ts
│   │   └── content/     ← copied from lib/content/
│   ├── index.html
│   └── vite.config.ts
├── db/
│   ├── petapp.sql              MASTER
│   ├── changes/NNN_*.sql
│   ├── reference/R001_*.sql
│   ├── devseed/D001_*.sql
│   └── verify.sh
│
└── [existing Next.js project — REFERENCE ONLY, never deployed]
    app/  components/  lib/  prisma/  types/  tests/  docs/
```

`.gitignore` additions: `API/**/bin/`, `API/**/obj/`, `API/**/*.user`,
`web/dist/`, `web/node_modules/`, `API/**/appsettings.*.local.json`.

### Development

Vite on `:5173` proxies `/api` to `:5001` — no CORS, first-party cookies.

```ts
// web/vite.config.ts
server: { proxy: { "/api": "http://localhost:5001" } }
```

### Production — one process

```csharp
app.UseStaticFiles();                     // wwwroot ← web/dist
app.MapGroup("/api/v1").MapLeashEndpoints();
app.MapFallbackToFile("index.html");      // SPA fallback
```

`npm run build` in `web/`, copy `dist/` into `API/src/Leash.Api/wwwroot/`.

---

## 3. Database system

No migration tool. Plain `.sql`, run by hand in pgAdmin.

| Situation | Run |
|---|---|
| **New server / fresh DB** | `petapp.sql`, then `reference/`, then `devseed/` on dev boxes |
| **Existing server, new change** | just the new `changes/NNN_*.sql` |
| **After writing any change** | hand-edit `petapp.sql` to match, same commit |

### Every change script self-guards

Created once, inside `petapp.sql`:

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  script     text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

Every change script follows one shape:

```sql
-- db/changes/014_add_notification_channel.sql
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM schema_version WHERE script = '014_add_notification_channel')
  THEN RAISE EXCEPTION 'Already applied on this database'; END IF;
END $$;

ALTER TABLE notifications ADD COLUMN channel text NOT NULL DEFAULT 'in_app';

INSERT INTO schema_version (script) VALUES ('014_add_notification_channel');
COMMIT;
```

Two things this buys for six lines: running it twice is **refused** rather than
silently harmful (a repeated `ALTER TABLE ADD COLUMN` errors confusingly; a
repeated backfill `UPDATE` corrupts quietly), and `SELECT * FROM schema_version`
tells you exactly what any server holds — no spreadsheet, no memory.

**Wrap every script in `BEGIN`/`COMMIT`.** PostgreSQL has transactional DDL, so
a script that fails halfway rolls back completely instead of leaving a
half-migrated schema. Free, and it matters most when running by hand.

### Rules

1. **Never edit a change script that has already run anywhere** — including your
   own machine. Fixes are new scripts.
2. One logical change per script.
3. Update `db/petapp.sql` in the same commit as the change script.
4. Never `DROP` a column that deployed code still reads.
5. Keep reference data (plans, settings, catalog — every environment) separate
   from demo data (users, pets, bookings — dev/test only).

### `db/verify.sh` — run before any deployment

The master and the change scripts are two descriptions of one schema. The risk
is not forgetting to update the master — it is the two producing **different
results** while both look correct. Classic case: a change script that adds a
column, backfills it, then sets `NOT NULL`, versus a master declaring
`NOT NULL DEFAULT 'x'`. Both defensible; fresh and migrated databases now hold
different data.

```bash
createdb chk_master && psql -d chk_master -f db/petapp.sql
createdb chk_delta  && psql -d chk_delta  -f db/petapp_at_last_release.sql
for f in db/changes/*.sql; do psql -d chk_delta -f "$f"; done
pg_dump --schema-only --no-owner chk_master > /tmp/a.sql
pg_dump --schema-only --no-owner chk_delta  > /tmp/b.sql
diff /tmp/a.sql /tmp/b.sql          # must be empty
dropdb chk_master && dropdb chk_delta
```

### Squashing

When `changes/` reaches ~40 files, regenerate the master from a live database
and archive the old scripts. Existing servers are already current; new ones take
everything from the master.

### Bootstrap

**There is no `.env.local` in this repo, so there is no Neon connection string.**
Seed into the **local** database instead and dump from there — it removes the
external dependency entirely and is the better path anyway.

```bash
# 0. put the PostgreSQL 18 tools on PATH (they are not, by default)
#    C:\Program Files\PostgreSQL\18\bin

# 1. the master — generated, never hand-written.
#    This reads the schema FILE, not a database, so it needs no connection.
npx prisma migrate diff --from-empty \
  --to-schema-datamodel prisma/schema.prisma --script > db/petapp.sql

# 2. then edit it:
#   - drop assistant_conversations, assistant_messages, knowledge_chunks
#   - drop the pgvector extension and its indexes
#   - add schema_version
#   - money: bookings.priceTotal, vet_appointments.{fee,baseFee} → integer cents
#   - timestamps: text → timestamptz (or date for dob / availability days)

# 3. create the databases and apply it (pgAdmin, or psql)
createdb petapp_dev && createdb petapp_test
psql -d petapp_dev -f db/petapp.sql

# 4. seed INTO the local database
#    .env.local:  POSTGRES_PRISMA_URL=postgresql://leash:devonly@localhost:5432/petapp_dev
#                 POSTGRES_URL_NON_POOLING=<the same>
npm install && npm run db:seed

# 5. dump the seeded data back out, and split it
pg_dump --data-only --inserts --no-owner petapp_dev > /tmp/seed.sql
# split: db/reference/ (plans, system_settings, products)
#        db/devseed/   (users, pets, bookings, orders)
```

Step 4 is the only thing in the whole build that needs the old Prisma stack —
it runs once, to generate fixtures. After that the reference project is read,
never executed.

### PostgreSQL 18 notes

Nothing in this plan depends on a version below 18, and Npgsql 9 supports it.
Two things it adds that are worth knowing:

- **`uuidv7()` is built in** — time-ordered UUIDs. Not adopted here: the
  existing ids are application-generated strings and the seed dump carries them,
  so changing the scheme would mean rewriting the fixtures for no gain.
- **`WITHOUT OVERLAPS` on unique constraints** (with range types) can enforce
  "no two overlapping accepted bookings for one caretaker" **in the database**
  rather than in application code. Genuinely relevant to M4/M5. Treat it as an
  optional hardening step after the booking logic works — not a day-one change.

**Split reference from demo data.** The existing seeder creates plans, settings,
the catalog *and* demo accounts in one pass. Production needs the first three
and must never receive the fourth.

**29 tables** — the original 32 minus the three assistant tables.

---

## 4. What gets reused

The existing shared layer has **two lines** of Next.js coupling in total (two
`process.env` reads in `lib/api/_client.ts`). This is what keeps a fresh build
from being a twelve-month project.

### Copy almost as-is

| From | To | Change |
|---|---|---|
| `types/index.ts` (964 lines) | `web/src/types/` | none |
| `lib/api/*` (20 files) | `web/src/api/` | base URL becomes config |
| `lib/store/*` (Zustand) | `web/src/store/` | none |
| `lib/pricing.ts`, `pricing-vet.ts`, `delivery.ts`, `geo.ts`, `booking-priority.ts`, `utils.ts` | `web/src/lib/` | none |
| `lib/content/*` | `web/src/content/` | none |
| `app/globals.css` (`@theme`) | `web/src/index.css` | none — Tailwind v4 has a first-party Vite plugin |
| `components/ui/*` | `web/src/components/ui/` | none |

### Port mechanically

| What | Files | Edit |
|---|---:|---|
| `next/link` → `react-router` `Link` | 56 | `href` → `to` |
| `next/navigation` → React Router hooks | 29 | 20 `useRouter`, 20 `useParams`, 16 `useSearchParams`, 10 `usePathname` |
| `next/image` → `<img>` | 32 | plus rework `lib/media/photos.ts` |
| `next/font` → `@font-face` | 2 | Space Grotesk · Inter · IBM Plex Mono |
| `"use client"` | 88 | delete |
| `app/**/page.tsx` → route components | 44 | register in the router |

### Rewrite in C#

All 66 files in `lib/server/`, all 79 route handlers, `auth.ts` /
`auth.config.ts`, every Prisma query. **The 28 Vitest suites in `tests/` are the
specification** — port them to xUnit as you go.

### Drop

`lib/server/assistant/*` · `components/assistant/*` · `app/api/assistant/*` ·
`ai` and `@ai-sdk/*` · the three assistant tables · pgvector.

---

## 5. Build order

```
M0 Foundation ─► M1 Auth ─► M2 Authorization ─┬─► M3 Pets & Records
                                               │        │
                                               │        ├─► M4 Caretakers
                                               │        ├─► M5 Vets
                                               │        └─► M6 Store ─► M7 Payments
                                               ├─► M8 Notifications
                                               ├─► M9 Admin
                                               └─► M10 Adoption (needs M3 + M7)
```

**M0 → M1 → M2 are strictly sequential.** M2 before anything touching data.
M3 before M4/M5/M6 — the health record is shared by all three.

---

## 6. The two months

### Landing zone

| | Modules | Confidence |
|---|---|---|
| Weeks 1–4 | M0 · M1 · M2 · M3 · M4 · M5 | **Committed** |
| Weeks 5–7 | M6 · M7 · M8 | **Committed** |
| Week 8 | M9 · release hardening | **Likely** |
| Stretch | M10 Adoption | **Slips first** |

**M10 is deliberately last** — it depends on pets, records and payments, and is
the most self-contained feature, so slipping it costs least and it can ship as a
follow-on.

### Week 1 — Foundation & Auth (M0 + M1) ✅

| Day | Work |
|---|---|
| 1 | Node 20 installed (PostgreSQL 18.6 ✅ already in). `db/petapp.sql` generated and edited (assistant tables out, cents, `timestamptz`, `schema_version`). Databases created in pgAdmin. Seeded locally, dumped, split. |
| 1 | **Proof slice:** `GET /api/v1/brands` rendering in the Vite app. Validates DB, Dapper, error envelope, SPA fallback and dev proxy before any real feature. |
| 2 | `API/` scaffold: `Leash.Api` + `Leash.Core`, `Program.cs`, `AddLeashCore`, `ApiResults.cs`, the validation filter, `/api/v1/` routing, `IsoDateTimeConverter`. |
| 2 | `web/` scaffold: Vite + React + TS + Tailwind v4, router skeleton, `src/api`, Zustand, design tokens. |
| 3–5 | **M1:** cookie auth, `OnValidatePrincipal` revocation, bcrypt, signup, verify-email, login, logout, password reset, rate limiting, `/me`, `/config`. **Dual auth (JWT pair) for mobile.** |
| 3–5 | **web:** `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/onboarding`, auth guard, session store. |

### Week 2 — Authorization & Health Record (M2 + M3) ✅

| Day | Work |
|---|---|
| 6–7 | **M2:** all access predicates + the full xUnit port of `tests/access.test.ts`. **Human review, not just green tests.** |
| 8–10 | **M3:** pet CRUD, medical records, prescriptions, `ownedSince`, recommendations. Decide `refillsLeft` semantics. |
| 8–10 | **web:** `/dashboard`, `/dashboard/pets`, `/dashboard/pets/new`, `/dashboard/pets/[id]`, health record section. |

### Week 3 — Caretakers & Bookings (M4) ✅

| Day | Work |
|---|---|
| 11–12 | Caretaker profile, pricing, availability, search **with SQL cursor pagination**. |
| 13–15 | Booking + status machine + actor rules (409 on illegal), messages (explicit `POST` to mark read), bidirectional reviews, reputation. |
| 11–15 | **web:** `/search`, `/caretaker/[id]`, `/booking/new`, `/booking/[id]`, `/dashboard/caretaker-profile`, owner + caretaker dashboards. |

### Week 4 — Vets & halfway checkpoint (M5) ✅ — checkpoint skipped, see §0

| Day | Work |
|---|---|
| 16–18 | Vet profile, search, appointments + status machine, visit summary writing medical records, vet reviews. |
| 16–18 | **web:** `/vets`, `/vets/[id]`, `/vets/book`, `/appointments/[id]`, `/dashboard/vet-profile`, vet dashboard, visit summary form. |
| 19–20 | **Checkpoint:** journeys 1–3, demo seed data, **deploy once**. |

**Deploy in week 4 even though it is incomplete.** A deployment done once in
week 4 is routine by week 8 instead of a crisis.

### Weeks 5–6 — Store & Orders (M6) ✅ — see §0 for the deploy that did not happen

| Day | Work |
|---|---|
| 21–23 | Catalog: products, search/filter/sort with SQL pagination, brands. **web:** `/store`, `/store/[slug]`. |
| 24–25 | **Quote — the money boundary.** Server re-prices, shipping and tax from one module, stock check, **Rx gate**, allergen warnings. **web:** `/store/cart`. |
| 26–28 | Orders: create (⚠ **with the `OwnsPet` check**), line snapshots, status machine, event timeline, cancellation window, stock reservation + sold-out 409. **web:** `/store/checkout`, `/store/orders`, `/store/orders/[id]`. |
| 29–30 | Fulfilment: ops console, daily `BackgroundService`. **web:** `/dashboard/orders`. Deploy again. |

**End of week 6:** the prescription written in week 4 unlocks an Rx-only product
and a customer can buy it. That seam justifies the whole architecture.

### Week 7 — Notifications & Payments (M8 + M7) ⬜ — after the UI parity pass (§0)

| Day | Work |
|---|---|
| 35–36 | **M8 first** — orders generate notifications, so it slots in here. `Notify()` gate with the channel abstraction, in-app records, email (escaped HTML, outbox-backed). |
| 37–39 | **M7:** provider seam (fails closed), ledger, intents, webhook + claim protocol, refunds, Leash Plus, entitlements. **web:** `/plus`, `/account/membership`, Stripe element. |

**Highest-risk days of the project.** Port `tests/webhooks.test.ts` and
`tests/stripe-signature.test.ts` **before** writing the implementation — and,
since M6 (§0), the second half of `tests/orders.test.ts` too.

**M6 built the seams M7 plugs into** (detail in `HANDOFF.md` §3): register the
Stripe provider in place of `DemoPaymentProvider`; make refunds retryable by
writing the ledger row before the provider call; switch on the three
membership benefits M5 and M6 left at "not a member" — free shipping in the
quote, the vet consult discount, the priority-booking lead time. M8's one hook
into orders is `OrderLifecycle.MoveAsync`.

### Week 8 — Admin & release (M9)

| Day | Work |
|---|---|
| 40–42 | **M9:** stats, users, professionals, payments + refunds, subscriptions, settings, audit. 7 screens, all behind `RequireStaff`. |
| 43–44 | Journeys 1–8, accessibility pass, error states, search performance — **and the first production deploy ever** (§0). |

**Revised 2026-10-10:** with the week-4 and week-6 deploys skipped, days 43–44
carry the whole of deployment risk. Strongly prefer clearing the six known
blockers (§0) during weeks 7–8 as they are touched — the SPA build into
`wwwroot` and a minimal CI workflow are each well under a day — so that day 43
is a deploy rather than a debugging session.

### Stretch — M10 Adoption (5–7 days)

Shelter profiles, listings, applications, fee payment, and **the transfer**.
Fully specified in `REQUIREMENTS.md` §10.3.

---

## 7. How to work

- **Vertical slices, never horizontal layers.** Finish a module's SQL, service,
  endpoints, tests *and* screens before starting the next. **This is the rule
  the timeline depends on.** Nine complete modules is a product; eleven at 80%
  is not shippable and cannot be demonstrated.
- **Port the tests as you go**, not at the end. They encode the transition
  tables, the actor rules and the money rules.
- **Read the reference implementation constantly.** When behaviour is unclear,
  `lib/server/<domain>.ts` is the answer — do not guess.
- **Deploy in weeks 4 and 6.** Deployment problems found in week 8 are the
  classic way a two-month project becomes ten weeks. *(Revised: both were
  skipped by the owner's decision — see §0 for what that moves into week 8.)*

### If it slips, cut in this order

1. M10 Adoption — ship as a follow-on
2. M9 admin screens (keep the staff checks on the API)
3. M8 email mirroring (keep in-app notifications)
4. M4/M5 reviews and reputation

**Never cut:** M2 authorization · the `OwnsPet` check on any endpoint touching a
pet · the server-owns-money rule in M6 · the xUnit ports for M2, M3, M6, M7.

---

## 8. Patterns

### Controller shape

```csharp
[ApiController]
[Route("api/v1")]
public sealed class OrdersController(IOrderService orders) : ControllerBase
{
    [HttpPost("orders")]
    [Authorize]
    public async Task<IActionResult> Create(CreateOrderRequest request, CancellationToken ct)
    {
        var order = await orders.CreateAsync(User.RequireUserId(), request, ct);

        return order is null
            ? ApiResults.Conflict("That cart can no longer be fulfilled")
            : Created($"/api/v1/orders/{order.Id}", order);
    }
}
```

Controllers stay thin: `[Authorize]` → (validation already ran) → service call
→ map the result to a status. Anything that decides something belongs in the
service, where the test suite reaches it without going through HTTP.

Note what is *not* there: no `BadRequest(...)`, no `NotFound()`. The framework
helpers produce `ProblemDetails` — a different shape from the error envelope,
with `title`, `status` and `traceId` — and the frontend's fetch layer does not
parse it. Failures go through `ApiResults`. `SuppressModelStateInvalidFilter`
is on for the same reason.

### Service shape — the rules, and the transaction

```csharp
public async Task<bool> ResetPasswordAsync(string token, string password, CancellationToken ct)
{
    // Expensive work first, outside the lock: bcrypt is ~100ms of CPU.
    var hash = Passwords.Hash(password);
    var now = Ids.Now();

    await using var scope = await unitOfWork.BeginAsync(ct);   // rolls back on dispose

    var userId = await ConsumeTokenAsync(token, TokenTypes.ResetPassword, scope, ct);
    if (userId is null) return false;

    if (!await users.SetPasswordAndRevokeSessionsAsync(userId, hash, now, scope, ct))
        return false;

    await refreshTokens.RevokeAllForUserAsync(userId, now, scope, ct);

    await scope.CommitAsync(ct);
    return true;
}
```

### Nested shapes — `json_agg`, not multi-mapping

Dapper multi-mapping gets awkward past two levels and duplicates parent rows.
Let PostgreSQL build the graph in one round trip:

```sql
SELECT o.*,
  (SELECT json_agg(i) FROM order_items i WHERE i."orderId" = o.id)                    AS items,
  (SELECT json_agg(e ORDER BY e."occurredAt") FROM order_events e WHERE e."orderId" = o.id) AS events
FROM orders o WHERE o.id = @id;
```

### Transactions

Explicit `NpgsqlTransaction`. Keep the stock decrement guarded
(`WHERE "stockQty" >= @qty`) so the sold-out race still returns 409.

### Session revocation

`CookieAuthenticationEvents.OnValidatePrincipal` — checks account status and
`sessionsValidFrom` on every authenticated request, and rejects the principal
when either fails.

### Timestamps

```csharp
public sealed class IsoDateTimeConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(ref Utf8JsonReader r, Type t, JsonSerializerOptions o)
        => DateTimeOffset.Parse(r.GetString()!, CultureInfo.InvariantCulture,
                                DateTimeStyles.AdjustToUniversal);

    public override void Write(Utf8JsonWriter w, DateTimeOffset v, JsonSerializerOptions o)
        => w.WriteStringValue(
             v.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture));
}
```

`DateTimeOffset`'s round-trip format emits 7 fractional digits and `+00:00`;
JavaScript emits 3 and `Z`, and the ported frontend compares these as strings.

### Type mapping

| PostgreSQL | C# |
|---|---|
| `text[]` | `string[]` — native in Npgsql |
| `jsonb` | POCO via `EnableDynamicJson()`, or `string` + `JsonSerializer` |
| integer cents | `int` |
| `timestamptz` | `DateTimeOffset` |

Keep enum-like values as `string` constants, not C# `enum` — mapping to
PostgreSQL `ENUM` types would turn every new value into a schema change.

---

## 8a. Mobile readiness (React Native, later)

Four decisions that are cheap now and painful to retrofit:

| | What | Module | Days |
|---|---|---|---:|
| 1 | **Dual auth** — cookie for web, rotating JWT access+refresh for mobile, same endpoints, policy scheme selector | M1 | 3–4 |
| 2 | **`/api/v1/` prefix** from the first endpoint | M0 | 0.5 |
| 3 | **Cursor pagination** on every list endpoint | M4 | 2–3 |
| 4 | **Notification channels** incl. push behind `Notify()` | M8 | 1–2 |

`web/src/types`, `web/src/api` and `web/src/lib` are framework-agnostic by
construction — lift them into `shared/` when mobile starts. **Components share
nothing**; React Native uses `View`/`Text`.

---

## 9. Testing

- **xUnit**, one collection per domain, `[Collection]` to serialise DB access.
- **Respawn** truncates between tests against a local `petapp_test` built from
  `db/petapp.sql`.
- Test the **service layer** — matching what the Vitest suites do — plus
  `WebApplicationFactory` integration tests for auth and authorization, which
  the original does not have.
- CI: build a throwaway database from `petapp.sql`, run the suite, run
  `db/verify.sh`.

**Expect the suite to run in 1–2 minutes** rather than the original's ~40. That
was almost entirely network round trips to Neon; local PostgreSQL removes them,
and it changes the inner loop for the whole project.

---

## 10. Verification

**Per module:** `dotnet test` for that module's suite, plus a manual walk
through its screens.

**Contract:** generate OpenAPI from the API and the TypeScript client from it,
so `web/src/types` cannot drift from the server.

**Release:** the eight end-to-end journeys in `REQUIREMENTS.md` §13. Journeys
1–3 are the week-4 checkpoint; journey 4 is the week-6 marker; 5, 7 and 8 land
in weeks 7–8; journey 6 is M10.

*Revised 2026-10-10:* journeys 1–4 are **buildable** now (4 with the demo
payment provider) but have **never been walked end to end as a checkpoint** —
the week-4 one was skipped. The service suites assert each of their steps, and
the key HTTP steps were checked with curl (HANDOFF.md §7). They get their first
real walk in days 43–44 with the rest.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| **Access predicates subtly wrong** — an authorization hole, not a crash | M2 fully ported and tested first, with human review. `Pet.ownedSince` has non-obvious semantics — read the docstrings in `access.ts` and `schema.prisma`. |
| **Error-envelope drift** — breaks forms and the cart app-wide, presenting as unrelated bugs | Settled in `Http/ApiResults.cs`. Controllers never use `BadRequest(...)`/`NotFound()`, which emit `ProblemDetails` instead, and `SuppressModelStateInvalidFilter` is on for the same reason |
| **A cookie copied before sign-out keeps working** — sign-out is client-side; there is no session table to invalidate a stolen copy | Accepted, and pinned by a test that says so (`A_cookie_copied_before_logout_still_works_afterwards`). The cookie is HttpOnly and Secure, and the `sessionsValidFrom` watermark kills it instantly on password reset, suspension or an admin force-out (A14). Mobile has no equivalent gap — sign-out revokes the refresh token server-side. **Do not "fix" it by bumping the watermark on logout** — that signs every other device out too; the real fix is a server-side session table |
| **Timestamp format drift** — breaks string comparisons quietly | The converter above |
| **Stripe webhook concurrency** — double-processing real money | Port the webhook tests before the implementation |
| **Frontend long tail** — 44 pages of small breakages found late | Vertical slices; deploy in weeks 4 and 6 |
| **First deploy in week 8** — the interim deploys were skipped (§0) | Accepted by the owner. Six blockers already known and listed in §0; clear them during weeks 7–8 rather than on day 43 |
| **No HTTP-level tests for M5/M6** | `VetEndpointTests` and `StoreEndpointTests` before release; S9 and price tampering are the store's two security properties and both are HTTP-shaped |
| **Money rounding** on the cents conversion | `round(x * 100)` once in `petapp.sql`; reconcile totals before and after |
| **Test-porting cut to save time** | It is the specification. Do not cut it. |

---

## 12. Getting started

### Environment status (verified on this machine)

| | Status |
|---|---|
| **.NET SDK** | ✅ 10.0.401 (plus 8.x and 9.0.309) — ASP.NET Core 10.0.12 runtime present |
| **PostgreSQL** | ✅ **18.6**, service `postgresql-x64-18` running, listening on 5432 |
| **pgAdmin 4** | ✅ installed |
| **psql / pg_dump** | ⚠ present at `C:\Program Files\PostgreSQL\18\bin` but **not on PATH** |
| **Node / npm** | ❌ **not installed** — the one remaining blocker |

**Node is still required**, for two separate reasons:

1. The Vite frontend cannot be developed or built without it.
2. `npx prisma migrate diff` generates `db/petapp.sql`, and `npm run db:seed`
   generates the demo fixtures. Both run against the reference project.

Without it, the alternative is hand-writing 951 lines of schema and ~2,800
lines of fixtures — slow, and a real source of errors the type system can no
longer catch. Install Node 20+ first.

### Day 1

1. Install **Node 20+**. Add `C:\Program Files\PostgreSQL\18\bin` to PATH.
2. Create the `leash` role and the `petapp_dev` / `petapp_test` databases in
   pgAdmin.
3. Generate `db/petapp.sql` (§3); apply the edits; run it.
4. Seed into `petapp_dev`, dump, split into `reference/` and `devseed/`.
5. Scaffold `API/` and `web/`.
6. **Port `GET /api/v1/brands`** and render the store's brand filter in the Vite
   app.

Step 6 is the proof the plan rests on. It validates the database, Dapper, the
error envelope, the SPA fallback and the dev proxy in a few hours — before two
months of work is committed to them.
