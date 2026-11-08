# Leash — prompt for improvements and new features

**How to use — two ways:**

1. **Short (recommended).** Paste this into a new chat, then describe the
   feature in your next message:

   > This repo is Leash, a pet-care app. Before I give you a task, get oriented:
   > read AGENTS.md, HANDOFF.md (start with §0, the latest session), STATUS.md,
   > ARCHITECTURE.md and FEATURE_PROMPT.md. The app is API/ (.NET 10), web/
   > (React + Vite) and db/ (PostgreSQL 18); the root folders (app/, lib/,
   > components/, prisma/, tests/) are the old reference app — read them if
   > useful, never edit or run them. Don't change anything yet: reply with a
   > short summary of where things stand and wait for my feature. When you do
   > make changes, follow FEATURE_PROMPT.md §3–§4: tests first, `dotnet test`,
   > `npm run build`, `npx oxlint src --deny-warnings` and `./db/verify.sh`
   > must pass, then commit as rehman427 with no Co-Authored-By line. Don't
   > push. I may already have the API and Vite running — check the ports and
   > use mine; never stop my servers, and clean up any you start.

2. **Long.** Fill in §1 below and paste this whole file.

For the client's pending decisions from the original build (Stripe, the
adoption screen gaps, R7, refills), use `NEXT_PROMPT.md` instead — it already
says what to build for each answer.

---

## 1. What I want — fill this in

**Type:** [ ] improvement to something that exists   [ ] new feature   [ ] bug fix

**What it is, in a few sentences:**
> _e.g. "Shelters can upload more than one photo per animal, and the listing page shows a gallery."_

**Who uses it** (owner · caretaker · vet · shelter · staff · visitor):
> _..._

**Where it shows up** (which screens, new or existing):
> _..._

**Rules that matter** (who may do it, money, limits, what must never happen):
> _..._

**Out of scope / not now:**
> _..._

**Client's exact words, if any:**
> _paste here_

---

## 2. What this codebase is

Two codebases live in this repository. **Only change the build.**

| | |
|---|---|
| `API/` + `web/` + `db/` | **The build** — .NET 10 API, React 19 + Vite SPA, PostgreSQL 18. Every module M0–M10 is done: auth, pets and health records, caretakers and bookings, vets and appointments, store and orders, notifications, payments and Leash Plus, the admin console, adoption. Since then (client round, 2026-11-08): reworked vet, caretaker and owner dashboards with stats cards, an interactive calendar and vet rescheduling, and an availability editor for vets and caretakers — HANDOFF §0, STATUS §3-D and §3-AV. **The shelter dashboard is the one not yet reworked.** 1050 xUnit tests. |
| Root `app/`, `components/`, `lib/`, `prisma/`, `tests/` | **The reference implementation** (Next.js) the build was ported from. Read it to see how something already behaves; never run or edit it. `ROADMAP.md` and `PROJECT_ANALYSIS.md` describe the reference, not the build. |

Read before writing code, in this order: `HANDOFF.md` (current state and
traps) → `STATUS.md` (what exists, what is decided, open items) →
`ARCHITECTURE.md` (**§2 is the step-by-step recipe for adding a feature**;
§9 is the traps) → `REQUIREMENTS.md` for the spec of anything that touches
existing behaviour.

### API (`API/src`)

- `Leash.Api` — controllers (`Controllers/*`), auth, the error envelope
  (`Http/ApiResults.cs`), the validation filter, background jobs (`Jobs/`).
  Controllers decide nothing: they call one service and map its failure enum
  to a status code in one place.
- `Leash.Core` — everything else, and it **never references ASP.NET Core**:
  `Models/Entities` (Dapper row classes with `ToDto()`), `Models/Dtos`
  (records), `Models/Enums` (string constants, not C# enums),
  `Repositories/` (hand-written SQL with Dapper, one interface per aggregate),
  `Services/` (the rules; authorization via `IAccessService`; staff roles via
  `StaffGate`), `Validation/` (FluentValidation, one validator per request
  type), `Payments/` (provider seam, ledger, webhook), `DependencyInjection.cs`
  (register every new repository and service there).
- Tests in `API/tests/Leash.Api.Tests`: service tests through `CoreHost`
  (real DI, real database) and endpoint tests through `LeashApp` (real HTTP).
  The database is rebuilt from `db/petapp.sql` and re-seeded before each test.

### Web (`web/src`)

- `api/*.ts` — one client per domain; **nothing else calls fetch**. Nested
  wire shapes and their TypeScript types live here.
- `pages/*` — one page per route, lazy-loaded through `lazyPages.ts`, wired
  in `routes.tsx` (guard with `RequireAuth` where a session is needed).
- `components/ui/*` — the design system (Button, Field, Panel, StatusBadge,
  ResultsGrid, ProgressLeash, ToggleChips, Skeleton…). Reuse these; match the
  look of neighbouring screens. Toasts are `sonner`. Data loading is
  `hooks/useAsync`; cursor lists use "Show more" or `hooks/useCursorPager`.
- `types/index.ts` — shared domain types. `store/session.ts` — the signed-in
  user (a cache; the API is the truth).
- `components/dashboard/schedule/*` — the dashboards' shared pieces:
  `ScheduleOverview` (Upcoming cards + month calendar + day panel),
  `StatCards`, `ProfileStrip`, `RescheduleDialog`, and `sources.ts` /
  `engagement.ts`, which turn appointments and bookings into one shape. A new
  dashboard reuses these. `components/AvailabilityEditor.tsx` and
  `AvailabilityCalendar.tsx` publish and show bookable days. Dates and local
  time: `lib/calendar.ts`; availability rules: `lib/availability.ts`.
- Motion follows `lib/motion.ts` (glide, never bounce); reduced motion is
  honoured globally by `MotionConfig` in `PageTransition`.

### Database (`db/`)

`db/petapp.sql` is the master schema; `db/changes/NNN_*.sql` are the change
scripts (005 is the latest, **006 is next**); `db/devseed/` is the demo data;
`./db/verify.sh` checks the master and the scripts agree.

---

## 3. Non-negotiables (from AGENTS.md — they apply to every change)

- **Authorization is checked in the API on every request**, re-checked on
  every write, never inferred from an earlier request. The client is never
  trusted; UI guards are courtesy.
- **The server owns money.** Never trust a client price; recompute from the
  database. **Integer cents** in storage; never `double`/`float` for money.
- **A write touching more than one row or table runs in one transaction**
  (`IUnitOfWork`). Notifications (`INotifier`) and audit rows (`IAuditLog`)
  go inside that same transaction.
- **One error envelope** (`ApiResults`). Never `BadRequest()`/`NotFound()`
  from ASP.NET in a controller.
- **Every list endpoint is cursor-paginated** (`Persistence/Cursor.cs`, keyset
  with an id tie-break). No unbounded result sets, no filtering in memory.
- **All routes under `/api/v1/`.** Timestamps serialise as
  `yyyy-MM-ddTHH:mm:ss.fffZ`.
- **Schema change:** the next `db/changes/006_*.sql` (self-guarding, in a
  transaction), mirrored into `db/petapp.sql` in the same commit;
  `./db/verify.sh` must print IDENTICAL; apply it to `petapp_dev` and
  `leash_review`; a new column on a seeded table gets its value appended to
  every positional `INSERT` in `db/devseed/`.
- **Keep the two-site deployment** (API and SPA as separate IIS sites,
  `web/public/config.js` + `Cors:Origins`, `credentials: "include"`). In
  development Vite :5173 calls the API :5001 directly. Do not add a proxy or
  serve the SPA from the API.
- **Do not re-open** anything in STATUS §5 or HANDOFF §4 (for example: only
  `TransferPetAsync` changes a pet's owner; deleting a pet with history is a
  409; a vet review is one-directional; the demo payment provider sells Leash
  Plus).

---

## 4. How to do the work

1. **Understand first.** Read the code the change touches and, if the feature
   already exists in the reference, `lib/server/<domain>.ts` there. Then write
   a short plan: endpoints (method, route, request, response, status codes),
   any schema change, the rules, the screens. **For anything larger than a
   small change, show me the plan and wait for my OK.** If my request is
   ambiguous, ask — don't guess.
2. **Tests first** for every behaviour: service tests for the rules (who may,
   what is refused, money, concurrency), endpoint tests for the HTTP surface
   (401 anonymous, 403 wrong person, 404 not yours, 409 illegal state, 400
   validation, the JSON shape the SPA reads).
3. **API, by ARCHITECTURE §2:** schema → entity and DTOs → repository →
   service (with a failure enum) → validator → controller → register in
   `DependencyInjection.cs`.
4. **Web:** add the client in `api/`, then the page or component reusing
   `components/ui/`, then the route. No new UI library without asking.
5. **Verify — all must pass before calling it done:**
   ```bash
   cd API && dotnet test                                  # all green (1050 before this change)
   cd web && npm run build && npx oxlint src --deny-warnings
   ./db/verify.sh                                         # ✓ IDENTICAL
   ```
   Stop the running API before building (`Stop-Process` on `Leash.Api`) —
   it locks `Leash.Core.dll`.
6. **Walk it in the running app** as each role it affects. **First check
   whether I already have servers up** (I run the API from Visual Studio on
   :5001 and Vite from VS Code on :5173 or :5174) — if so, use them and never
   stop them. Otherwise start your own: API with
   `dotnet run --project API/src/Leash.Api --launch-profile http` (:5001),
   SPA with `cd web && npm run dev` (:5173) — and stop them when done by
   process tree (stopping the background shell leaves the node/dotnet child
   running; HANDOFF §0). Headless Chrome via
   `playwright-core` from the root `node_modules` and
   `C:/Program Files/Google/Chrome/Application/chrome.exe` works for scripted
   walks; put scripts in the scratchpad, not the repo. Check: no console
   errors, no unexpected failed API calls. Put any demo data you change back.
7. **Update the docs:** a section in `STATUS.md` for the change (what it does,
   the rules, any new endpoint) and its rows in the tests table; `HANDOFF.md`
   (state, new traps); `ARCHITECTURE.md` only if a convention changed.
8. **Commit** with the repo's configured identity (`rehman427`), one commit per
   change, with **no `Co-Authored-By` or other Claude trailer** (the history
   was deliberately rewritten without them). **Do not push** — I push.
9. **Report back:** what changed (API, web, database), how to see it in the
   app, anything that needs a redeploy or a database script on the server, and
   anything you were unsure about.

### Accounts and tools

- Demo accounts, password `leashdemo123`: `maya.chen@example.com` (owner),
  `liam.novak@example.com` (caretaker), `elena.petrova@example.com`
  (caretaker c4), `naomi.ruiz@example.com` (vet — the only provider with
  future published days in `petapp_dev`), `hello@austinpetsalive.example.com`
  (shelter).
- Staff: `priya.raman@example.com` (admin), `tom.okafor@example.com`
  (support + finance), `rosa.delgado@example.com` (ops). Their password is
  `STAFF_PASSWORD` in the root `.env.local` — read it for a walk, never print it.
- `psql` and `pg_dump` are at `C:\Program Files\PostgreSQL\18\bin`, not on
  PATH. Dev database `petapp_dev`, user `leash`, password `devonly`.

### Shipping it

After the change is committed, the owner redeploys from an elevated
PowerShell with `.\deploy\publish-iis.ps1` (it keeps the server's settings and
`config.js`) and runs any new `db/changes/NNN_*.sql` once on the server's
database (`deploy/README.md`).
