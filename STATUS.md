# Leash — Status

Where the build is, and what to pick up next.

Last updated: **2026-09-21**, end of M1.

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
| **M2** | Authorization core ★ | ⬜ **Next** — only `HasStaffRole` exists |
| M3 | Pets & health records | ⬜ |
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
cd API && dotnet test        # 69 passing, ~25s
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
| `IAccessService` ← *M2 fills this in* | `ICatalogRepository` |
| `IRateLimitService`, `ISettingsService`, `ICatalogService` | |

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

### Tests — 69 passing

| File | Covers |
|---|---|
| `AuthServiceTests` | Port of `tests/auth.test.ts` — hashing, credentials, registration, OAuth linking |
| `EmailFlowTests` | Port of `tests/email-flows.test.ts` — tokens, verification, reset, watermark |
| `AuthEndpointTests` | REQUIREMENTS §3.4 acceptance over HTTP, rate limits, revocation |
| `UserEndpointTests` | The two projections, self-only patching, the privilege boundary |
| `MobileTokenTests` | Dual auth, rotation, replay detection |

---

## 3. M2 — the next module

**No endpoints. Pure predicates, used by every other module.**
`REQUIREMENTS.md` §4 is the spec. It requires the predicates ported **in full,
with tests, and reviewed by a human — not just green tests** — before anything
depends on them.

### The work

1. Read `lib/server/access.ts` in the reference project **in full**, including
   the docstrings. They explain the non-obvious decisions.
2. Add to `IAccessService` / `AccessService` in `Leash.Core`:

   | Predicate | Rule |
   |---|---|
   | `OwnsPet(uid, petId)` | The pet's `ownerId` is the caller |
   | `CanViewPet(uid, petId)` | Owner, **or** a caretaker/vet with a qualifying engagement |
   | `CanAccessPetRecords(uid, petId)` | Owner, **or** a vet with a qualifying appointment |
   | `IsBookingParticipant(uid, bookingId)` | The booking's owner or its caretaker |
   | `IsAppointmentParticipant(uid, apptId)` | The appointment's owner or its vet |
   | `OwnsCaretakerProfile` / `OwnsVetProfile` / `OwnsShelterProfile` | The profile's `userId` is the caller |
   | `HasStaffRole(uid, role)` | ✅ already done — `staffRoles` contains it, or `admin` |

3. Port `tests/access.test.ts` to xUnit in full.
4. **Then** review by hand. This is an authorization hole if it is subtly wrong,
   and a subtly wrong predicate does not crash.

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

### Where predicates get called

M2 adds no endpoints, so nothing changes visibly. From M3 onward, every
controller action touching a pet, booking, appointment or profile calls one
first. The `OwnsPet` check on anything touching a pet is on the
**never cut** list in `BUILD_PLAN.md` §7.

---

## 4. Open items

| | Item |
|---|---|
| ⚠ | **`origin/main_newDev` still has the pre-rewrite commit hashes.** All 7 local commits were re-authored to `rehman427 <abdulrehmanlatif65@gmail.com>` with the Claude co-author trailers removed. Pushing needs `git push --force-with-lease`. Backup refs: `backup/main_newDev-pre-rewrite`, `backup/main_newDev-pre-name-rewrite` |
| ⚠ | A cookie copied before sign-out keeps working — deliberate, pinned by a test, documented in `BUILD_PLAN.md` §11. **Do not "fix" it by bumping the watermark on logout** |
| | `tests/` in the reference project has 28 Vitest suites. 2 are ported. They are the specification — port each module's as you build it |
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
