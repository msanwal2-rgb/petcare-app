# Leash — Status

Where the build is, and what to pick up next.

Last updated: **2026-09-22**, end of M4.

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
| **M5** | Vets & appointments | ⬜ **Next** |
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
cd API && dotnet test        # 312 passing, ~95s
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
| `IPetService` | `IPetRepository` |
| `IMedicalRecordService` | `IMedicalRecordRepository`, `IAppointmentRepository` |
| `ICaretakerService` | `ICaretakerRepository` |
| `IBookingService` | `IBookingRepository` |
| `IMessageService`, `IReviewService`, `IReputationService` | `IMessageRepository`, `IReviewRepository` |

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
/dashboard/pets      the owner's pets          [guarded]
/dashboard/pets/new  add a pet                 [guarded]
/dashboard/pets/:id  profile, health timeline, recommendations  [guarded]
/search              caretaker search, cursor-paginated
/caretaker/:id       profile, rates, availability, reviews
/booking/new         request a booking         [guarded]
/booking/:id         status, messages, reviews [guarded]
/dashboard/bookings  the owner's bookings      [guarded]
/dashboard/caretaker-profile   listing, rate card, request queue  [guarded]
/vets /store /adopt                            named placeholders
```

Shell, design system (`components/ui/`), session store, API client layer and the
route guard are all in place. `web/src/types/index.ts` is the reference
project's file, copied, with `PublicConfig.googleEnabled` added.

### Tests — 312 passing

| File | Covers |
|---|---|
| `AccessServiceTests` | Port of `tests/access.test.ts` — the nine predicates, and what a transfer of ownership ends |
| `PetServiceTests` | Port of `tests/pets.test.ts` — CRUD, the closed transfer backdoor, delete, recommendations, life stage and allergen matching |
| `MedicalRecordServiceTests` | Port of `tests/medical-records.test.ts` — the timeline, who may author what, and the one active-prescription rule |
| `PetEndpointTests` | Every pet route over HTTP: `[Authorize]` on each action, the envelope, the wire shape, the fee omission |
| `BookingServiceTests` | Port of `tests/bookings.test.ts` plus the response-rate half of `reputation.test.ts` — the two tables, pagination, integer pricing |
| `CaretakerServiceTests` | Port of `tests/caretakers.test.ts`, rewritten around SQL search: filters, distance, cursor paging |
| `MessageReviewServiceTests` | Ports of `tests/messages.test.ts` and `tests/reviews.test.ts`, plus the ratings half of `reputation.test.ts` |
| `BookingEndpointTests` | What is guarded and what is deliberately public, 409-vs-403, and the §6.4 acceptance walk |
| `AuthServiceTests` | Port of `tests/auth.test.ts` — hashing, credentials, registration, OAuth linking |
| `EmailFlowTests` | Port of `tests/email-flows.test.ts` — tokens, verification, reset, watermark |
| `AuthEndpointTests` | REQUIREMENTS §3.4 acceptance over HTTP, rate limits, revocation |
| `UserEndpointTests` | The two projections, self-only patching, the privilege boundary |
| `MobileTokenTests` | Dual auth, rotation, replay detection |

---

## 3. M4 — what landed, and what M5 inherits

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

## 3a. M3 — pets and the health record (reference)

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

## 3b. M2 — the authorization core (reference)

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
| | `tests/` in the reference project has 28 Vitest suites. 10 are ported. They are the specification — port each module's as you build it |
| | ~~REQUIREMENTS C14 — the booking cancellation window.~~ **Settled 2026-09-22: §11.1 as written, no cutoff.** Revisit alongside cancellation *penalties* when M7 brings payments and refunds — a cutoff with no money behind it is a rule with no consequence. See §5 |
| | **C13 is half-wired.** Bookings need 24 hours' notice; the Leash Plus arm that shortens it to 2 waits on M7's entitlements. `BookingService.LeadTimeHoursFor` is the single place to change |
| ⚠ | **M6 must decrement `refillsLeft` when an Rx line is bought**, in the same transaction as the stock decrement. M3 decided the read side (0 = exhausted, null = no limit) and closed it behind one SQL predicate; until M6 writes to it, one prescription still authorises unlimited purchases until it expires. That is REQUIREMENTS P9 half-done, deliberately |
| ⚠ | **A pet that has died cannot be removed.** Deleting is blocked once the animal has vet visits or health records, because all three FKs onto `pets` cascade and an owner must not delete records their vet authored. Needs a soft delete (`deletedAt`) and a decision about what a bereaved owner still sees — `STATUS.md` §3 has the reasoning |
| | `AccessServiceTests` still inlines the active-prescription rule as SQL. `IMedicalRecordRepository.ListAuthorizedProductSlugsAsync` now exists — swap the helper for a call to it so there is one definition in the tests too |
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
| `refillsLeft`: 0 = exhausted, null = no limit. **M6 decrements it inside the checkout/order transaction, alongside stock** | Owner's call, 2026-09-22. REQUIREMENTS P9 settled; M3 closed the read side |
| Deleting a pet with clinical history stays a **409** | Owner's call, 2026-09-22. Soft delete / archival is a later pass, not a regression to fix |
| **No booking cancellation cutoff.** §11.1 as written: either party cancels from any non-terminal state | Owner's call, 2026-09-22. REQUIREMENTS C14 deferred to M7, where cutoffs and penalties get designed together |
| Cursor pagination on every list endpoint | From M4. No endpoint loads an unbounded set |
| Dual auth from M1 | Cheap now, a rewrite later |
| AI assistant, pgvector, Redis, Docker | Out of scope |
