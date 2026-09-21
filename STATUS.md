# Leash — Status

Where the build is, and what to pick up next.

Last updated: **2026-09-21**, end of M2.

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
| **M3** | Pets & health records | ⬜ **Next** |
| M4 | Caretakers & bookings | ⬜ |
| M5 | Vets & appointments | ⬜ |
| M6 | Store & orders | ⬜ |
| M7 | Payments | ⬜ |
| M8 | Notifications | ⬜ |
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
cd web && npm run dev                                      # :5173, proxies /api

# check it
cd API && dotnet test        # 104 passing, ~32s
cd web && npm run build && npx oxlint src
./db/verify.sh               # ✓ IDENTICAL
```

Demo logins: any seeded marketplace account with `leashdemo123` —
`maya.chen@example.com` (owner), `elena.petrova@example.com` (caretaker),
`naomi.ruiz@example.com` (vet). Staff accounts use `STAFF_PASSWORD`, not the
demo password.

### Database

31 tables. 29 from the original schema (32 minus the three assistant tables),
plus `schema_version` and `refresh_tokens`.

| Script | What |
|---|---|
| `db/petapp.sql` | **The master.** pg_dump-generated, hand-headed. Running it on an empty database gives a complete current schema |
| `db/_bootstrap/001_from_prisma.sql` | Historical: the schema as Prisma emitted it |
| `db/_bootstrap/002_cents_and_timestamps.sql` | Historical: money → integer cents, ISO text → `timestamptz` |
| `db/changes/001_sessions_valid_from_timestamptz.sql` | `users."sessionsValidFrom"` text → `timestamptz`. The bootstrap regex missed it (ends in "From", not "At") |
| `db/changes/002_refresh_tokens.sql` | The `refresh_tokens` table for mobile auth |
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
```

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

Cross-cutting, settled and inherited by every later module:

- **Error envelope** — `Http/ApiResults.cs`
- **Timestamp format** — `Json/IsoDateTimeConverter.cs`
- **Validation** — global `Filters/ValidationActionFilter.cs`
- **Transactions** — `Persistence/UnitOfWork.cs`
- **Dapper type mapping** — `Persistence/DapperSetup.cs`
- **Rate limiting** — DB-backed sliding window
- **Dual auth** — cookie + rotating JWT pair, chosen per request

### web

```
/                    home (M1 form; the real landing page needs M4/M6)
/login  /signup  /forgot-password  /reset-password  /verify-email
/onboarding          role selection            [guarded]
/dashboard           the M1 landing place      [guarded]
/search /vets /store /adopt                    named placeholders
```

Shell, design system (`components/ui/`), session store, API client layer and the
route guard are all in place. `web/src/types/index.ts` is the reference
project's file, copied, with `PublicConfig.googleEnabled` added.

### Tests — 104 passing

| File | Covers |
|---|---|
| `AccessServiceTests` | Port of `tests/access.test.ts` — the nine predicates, and what a transfer of ownership ends |
| `AuthServiceTests` | Port of `tests/auth.test.ts` — hashing, credentials, registration, OAuth linking |
| `EmailFlowTests` | Port of `tests/email-flows.test.ts` — tokens, verification, reset, watermark |
| `AuthEndpointTests` | REQUIREMENTS §3.4 acceptance over HTTP, rate limits, revocation |
| `UserEndpointTests` | The two projections, self-only patching, the privilege boundary |
| `MobileTokenTests` | Dual auth, rotation, replay detection |

---

## 3. M2 — what landed, and what M3 inherits

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
| | `tests/` in the reference project has 28 Vitest suites. 3 are ported. They are the specification — port each module's as you build it |
| | `AccessServiceTests` inlines the reference's `activePrescriptions` rule as SQL, because `lib/server/medical-records.ts` is M3. When M3 ports that module, replace the helper with a call to it — the assertions should not need to change |
| | Google OAuth is implemented but unconfigured, so untested against the real provider. Set `Auth:Google:ClientId`/`:ClientSecret` and add `http://localhost:5173/api/v1/auth/google/callback` as an authorised redirect URI |
| | `db/petapp_at_last_release.sql` is gitignored and local-only. Recreate it from `petapp.sql` before adding the next change script |
| | No CI yet. `BUILD_PLAN.md` §9 wants: throwaway database from `petapp.sql`, run the suite, run `verify.sh` |
| | The web bundle is 606 kB (186 kB gzipped) in one chunk. Fine for now; route-level code splitting when it matters |
| | `web/src/assets/{hero.png,react.svg,vite.svg}` are leftovers from the Vite template — `hero.png` may be wanted by the real landing page in M4 |

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
| Cursor pagination on every list endpoint | From M4. No endpoint loads an unbounded set |
| Dual auth from M1 | Cheap now, a rewrite later |
| AI assistant, pgvector, Redis, Docker | Out of scope |
