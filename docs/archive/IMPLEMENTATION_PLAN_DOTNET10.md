# Implementation plan — .NET 10 backend, Next.js frontend, local Postgres

The execution plan. Decisions are settled; this is what to build and in what
order.

Supersedes the decision sections of `MIGRATION_PLAN_DOTNET.md` (which remains
useful for the reasoning behind each choice). Effort figures come from
`EFFORT_ESTIMATE_FULL_REWRITE.md`.

---

## 0. Decisions, locked

| | Decision |
|---|---|
| **Backend** | ASP.NET Core on **`net10.0`**, Minimal APIs, feature folders |
| **Data access** | **Dapper** + Npgsql. No EF Core. |
| **Database** | **Local PostgreSQL 17**, one instance per developer |
| **Migrations** | **DbUp**, embedded in the binary, forward-only — §2 |
| **Frontend** | **Next.js stays.** Minimal change: 4 auth files + a rewrite proxy — §4 |
| **Assistant** | **Stays in Node** as the one surviving Next.js route handler — §4.4 |
| **Redis** | **Not now.** Revisit only when you run a second API instance. |
| **Docker** | Not used |

**Total effort: ≈ 80–125 working days** for one experienced developer —
roughly 4–6 months solo, 3–4.5 months with two once §3 Phase 2 lands.

That is meaningfully less than the Vite variant (105–155 days), because the
frontend rewrite disappears and the assistant's streaming endpoint never has to
be reimplemented in C#.

It is **not** zero for the assistant, though. Its 26 tools currently `import`
the TypeScript domain functions directly — `getOrdersByUser`, `getBookingById`
and so on. Deleting those files as each domain is ported breaks the assistant,
so its tools have to be re-pointed at the .NET API over HTTP: **4–8 days**,
scheduled per §4.4.

---

## 1. Target architecture

```
┌──────────────────────────────────────────────────────────┐
│  Next.js  (port 3000)                                    │
│   • 44 pages, 75 components — UNCHANGED                  │
│   • lib/api/*.ts — UNCHANGED (relative /api paths)       │
│   • /api/assistant/* — the only surviving route handler  │
│   • rewrites: /api/* → localhost:5001  (beforeFiles)     │
└───────────────────────────┬──────────────────────────────┘
                            │  same-origin, cookie forwarded
┌───────────────────────────▼──────────────────────────────┐
│  Leash.Api  (net10.0, port 5001)                         │
│   Features/{Orders,Bookings,Vets,Pets,Store,...}         │
│   Auth/ — cookie auth + AccessPredicates                 │
│   Infrastructure/{Db,Http,Json}                          │
└───────────────────────────┬──────────────────────────────┘
                            │  Npgsql + Dapper
┌───────────────────────────▼──────────────────────────────┐
│  PostgreSQL 17 (local :5432)                             │
│   leash_dev · leash_test                                 │
│   schema managed by Leash.Database (DbUp)                │
└──────────────────────────────────────────────────────────┘
```

### Solution layout

```
Leash.sln
├── src/
│   ├── Leash.Api/                    ASP.NET Core host
│   │   ├── Program.cs
│   │   ├── Features/
│   │   │   └── Orders/
│   │   │       ├── OrderEndpoints.cs    ← app/api/orders/*
│   │   │       ├── OrderService.cs      ← lib/server/orders.ts
│   │   │       ├── OrderQueries.cs      the SQL
│   │   │       ├── OrderDtos.cs         ← types/index.ts
│   │   │       └── OrderValidators.cs   ← the Zod schemas
│   │   ├── Auth/
│   │   │   ├── CookieAuthSetup.cs
│   │   │   └── AccessPredicates.cs      ★ lib/server/access.ts
│   │   └── Infrastructure/
│   │       ├── Db/ConnectionFactory.cs
│   │       ├── Http/Results.cs          ★ lib/server/http.ts
│   │       └── Json/IsoDateTimeConverter.cs
│   ├── Leash.Database/               ← migrations live here  §2
│   └── Leash.Migrator/               ← console entry point   §2.4
└── tests/Leash.Api.Tests/
```

★ = security-critical. Human review required, not just passing tests.

---

## 2. The database system

This is the part you asked to get right, so it gets the most detail.

### 2.1 The problem you described

> *"a proper system for db maintenance … easily update the db on different
> places when we deploy … so we don't have to maintain a lot of scripts
> manually to run on different servers"*

The failure mode you want to avoid is a `sql/` folder somewhere, a wiki page
listing what to run, and nobody sure which server is at which version.

**Four properties fix that permanently:**

| Property | How |
|---|---|
| **Scripts travel with the app** | Embedded resources in a DLL. There is no folder to copy, no script to forget, and the binary physically cannot disagree with its own migrations. |
| **The database knows its own version** | DbUp's `schemaversions` journal table records every script and when it ran. Query the server, get the truth. |
| **Running it twice is safe** | Applying is idempotent — already-run scripts are skipped. Re-running on a current database is a no-op that prints "nothing to do". |
| **One command, every environment** | `Leash.Migrator --connection "..."`. Dev laptop, staging, production: same command, same binary. |

Deploying to a new server becomes: copy the app, run the migrator, start the
app. No manual SQL. Ever.

### 2.2 Project setup

`src/Leash.Database/Leash.Database.csproj` — a class library:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="dbup-postgresql" Version="6.*" />
    <PackageReference Include="Npgsql" Version="9.*" />
  </ItemGroup>
  <ItemGroup>
    <!-- every .sql under Scripts/ ships inside the DLL -->
    <EmbeddedResource Include="Scripts\**\*.sql" />
  </ItemGroup>
</Project>
```

### 2.3 Script organisation — three tiers, and the distinction matters

```
src/Leash.Database/Scripts/
├── Migrations/          ← schema. ALWAYS runs, EVERY environment.
│   ├── 202601010000_baseline.sql
│   ├── 202601150900_money_to_cents.sql
│   └── 202602031400_add_notification_channel.sql
├── Reference/           ← data the app needs to FUNCTION. Always runs.
│   ├── R001_plans.sql             (Leash Plus)
│   └── R002_system_settings.sql
└── DevSeed/             ← demo data. Development and test ONLY.
    └── D001_demo_accounts.sql
```

**Splitting Reference from DevSeed is important and your current seeder does not
do it.** `lib/server/seed.ts` creates the `Plan` row, the `SystemSetting` rows,
the product catalog *and* Maya Chen's pets in one pass. Production needs the
first two and must never receive the last one.

Reference scripts are written as **idempotent upserts** so they can be re-run
safely as values evolve:

```sql
INSERT INTO plans (id, key, name, "priceCents", entitlements, "consultDiscountPct", active, "createdAt")
VALUES ('plan_plus', 'plus', 'Leash Plus', 999,
        ARRAY['free_shipping','vet_consult_discount','priority_booking'], 15, true, now()::text)
ON CONFLICT (key) DO UPDATE
   SET name = EXCLUDED.name,
       "priceCents" = EXCLUDED."priceCents",
       entitlements = EXCLUDED.entitlements;
```

DbUp runs these with `RunAlways` (they carry no journal entry), so they
re-apply on every deploy and reference data stays correct.

### 2.4 Naming convention

**`YYYYMMDDHHMM_short_description.sql`** — timestamp-prefixed.

DbUp orders by filename, and timestamps sort correctly. The reason to prefer
them over `0001`, `0002` is merge conflicts: two developers on two branches both
write `0015_...` and one silently ends up out of order. Timestamps cannot
collide in practice.

**Rules, and the first one is not negotiable:**

1. **Never edit an applied migration.** Not to fix a typo. Once a script has run
   anywhere — including a teammate's laptop — it is immutable. Corrections are
   new migrations. This single rule prevents most migration disasters.
2. One logical change per file.
3. Descriptive names: `add_notification_channel`, not `update3`.
4. Prefer `IF NOT EXISTS` / `IF EXISTS` as belt-and-braces.
5. No `DROP` of a column still referenced by deployed code — see §2.8.

### 2.5 The runner

Two things make this production-safe: a **Postgres advisory lock** so concurrent
instances cannot both migrate, and **transaction-per-script**.

```csharp
// src/Leash.Database/Migrator.cs
using DbUp;
using DbUp.Engine;
using Npgsql;

public static class Migrator
{
    // Arbitrary but stable. Any process migrating this database uses the same id.
    private const long LockId = 0x1EA5_1DB1;

    public static MigrationResult Run(string connectionString, MigrationOptions opts)
    {
        EnsureDatabase.For.PostgresqlDatabase(connectionString);

        // Session-level advisory lock, held on its own connection for the whole
        // upgrade. A second instance starting at the same moment blocks here
        // rather than racing. Released when this connection closes.
        using var gate = new NpgsqlConnection(connectionString);
        gate.Open();
        using (var cmd = new NpgsqlCommand("SELECT pg_advisory_lock(@id)", gate))
        {
            cmd.Parameters.AddWithValue("id", LockId);
            cmd.ExecuteNonQuery();
        }

        try
        {
            var asm = typeof(Migrator).Assembly;

            var builder = DeployChanges.To
                .PostgresqlDatabase(connectionString)
                .JournalToPostgresqlTable("public", "schemaversions")
                // Postgres has TRANSACTIONAL DDL: a failed script rolls back
                // completely, leaving no half-applied schema.
                .WithTransactionPerScript()
                .LogToConsole();

            // 1. Schema — always.
            builder.WithScriptsEmbeddedInAssembly(asm,
                n => n.Contains(".Scripts.Migrations."));

            // 2. Reference data — always, re-runs every deploy.
            builder.WithScriptsEmbeddedInAssembly(asm,
                n => n.Contains(".Scripts.Reference."),
                new SqlScriptOptions { ScriptType = ScriptType.RunAlways });

            // 3. Demo data — development and test only.
            if (opts.IncludeDevSeed)
                builder.WithScriptsEmbeddedInAssembly(asm,
                    n => n.Contains(".Scripts.DevSeed."));

            var upgrader = builder.Build();

            if (opts.WhatIf)   // dry run: list what WOULD apply, change nothing
                return MigrationResult.Pending(upgrader.GetScriptsToExecute());

            var result = upgrader.PerformUpgrade();
            if (!result.Successful) throw new MigrationFailedException(result.Error);
            return MigrationResult.Applied(result.Scripts);
        }
        finally
        {
            using var unlock = new NpgsqlCommand("SELECT pg_advisory_unlock(@id)", gate);
            unlock.Parameters.AddWithValue("id", LockId);
            unlock.ExecuteNonQuery();
        }
    }
}
```

**One caveat on `WithTransactionPerScript()`:** `CREATE INDEX CONCURRENTLY`
cannot run inside a transaction. For those rare scripts, put them in their own
file and mark it `ScriptType.RunOnceNonTransactional`. You will want
`CONCURRENTLY` for any index added to a large table in production.

### 2.6 Two entry points, one migration set

**Development — automatic.** Nobody should ever be on a stale local schema:

```csharp
// Program.cs
if (app.Environment.IsDevelopment())
    Migrator.Run(connectionString, new MigrationOptions { IncludeDevSeed = true });
```

**Everywhere else — explicit, as a deploy step.** `src/Leash.Migrator/`:

```bash
Leash.Migrator --connection "$LEASH_DB" --what-if   # preview
Leash.Migrator --connection "$LEASH_DB"             # apply
```

Why not auto-migrate in production too? Three reasons:

- The API would need **DDL permissions at runtime**. It should have `SELECT`,
  `INSERT`, `UPDATE`, `DELETE` and nothing more.
- A failing migration takes the app down on startup instead of failing a deploy
  step you can read the output of.
- `--what-if` gives you a reviewable preview before anything touches production.

Publish the migrator as a self-contained single file so a server needs no .NET
installed:

```bash
dotnet publish src/Leash.Migrator -c Release -r win-x64 \
  --self-contained -p:PublishSingleFile=true
```

### 2.7 Deploying to a new environment

```
1. Provision an empty Postgres database
2. Leash.Migrator --connection "..." --what-if      # review
3. Leash.Migrator --connection "..."                # baseline + everything since
4. Deploy and start the API
```

That is the whole runbook, and it is identical for a laptop, a staging box and
production. **No manual SQL, no script folders, no version spreadsheet.**

For an **existing** database already at a known schema — your current Neon
instance, if you keep its data — mark the baseline as applied without executing
it, then let subsequent migrations run normally:

```bash
Leash.Migrator --connection "..." --mark-applied-through 202601010000_baseline
```

(Implement as an insert into `schemaversions`. DbUp then treats the script as
done and skips it.)

### 2.8 Zero-downtime changes — expand / contract

Once you have more than one server, or any deploy where old and new code run
briefly together, a rename or a drop in one migration breaks the running app.

Spread destructive changes across **three deploys**:

| Deploy | Migration | Code |
|---|---|---|
| **1 — Expand** | Add the new column, nullable. Backfill. | Writes both, reads old. |
| **2 — Migrate** | — | Reads new, writes both. |
| **3 — Contract** | Drop the old column. | Reads and writes new only. |

The `money_to_cents` migration in §3 Phase 0 is safe to do in one step *only*
because it happens before anything is deployed. Later ones will not be.

### 2.9 Safety net

| Practice | Why |
|---|---|
| **Backup immediately before migrating** | A `pg_dump` in the deploy pipeline, before the migrator step. This is your rollback. |
| **Forward-only — no `Down()` scripts** | Down-migrations are rarely tested and often lossy. Roll forward with a corrective migration, or restore the backup. DbUp deliberately has no rollback. |
| **CI applies every migration to an empty DB** | Catches a broken migration before it reaches a person. §5. |
| **Expose the schema version** | `GET /health/schema` → last applied script + timestamp. Answers "what version is that server on?" without a DB login. |
| **Separate DB roles** | `leash_app` (DML only) for the API; `leash_migrator` (DDL) used only by the migrator. |

### 2.10 Getting off Neon onto local Postgres

```bash
# 1. Install PostgreSQL 17 (EDB Windows installer). Add bin/ to PATH.

# 2. Roles and databases
psql -U postgres -c "CREATE ROLE leash WITH LOGIN PASSWORD 'devonly';"
psql -U postgres -c "CREATE DATABASE leash_dev  OWNER leash;"
psql -U postgres -c "CREATE DATABASE leash_test OWNER leash;"

# 3. Generate the baseline from the Prisma schema — do NOT hand-write it
npx prisma migrate diff --from-empty \
  --to-schema-datamodel prisma/schema.prisma --script \
  > src/Leash.Database/Scripts/Migrations/202601010000_baseline.sql

# 4. Capture demo data from the current seeded database
npm run db:seed
pg_dump --data-only --inserts --no-owner "$NEON_URL" \
  > src/Leash.Database/Scripts/DevSeed/D001_demo_accounts.sql

# 5. Prove it
Leash.Migrator --connection "Host=localhost;Database=leash_dev;Username=leash;Password=devonly"
```

**Split step 4's output** into `Reference/` (plans, system settings, products)
and `DevSeed/` (users, pets, bookings, orders) per §2.3. It is a one-off edit
and it is what stops demo accounts reaching production.

Connection strings go in **User Secrets** locally and **environment variables**
in deployed environments. Never `appsettings.json`.

```bash
dotnet user-secrets set "ConnectionStrings:Default" \
  "Host=localhost;Port=5432;Database=leash_dev;Username=leash;Password=devonly"
```

### 2.11 Two schema changes to make during the port

**`money_to_cents`** — the store uses integer cents; bookings and appointments
use `double precision` USD. Floats and money do not mix, and `ROADMAP.md` flags
the split as what will hurt when you build payouts.

```sql
ALTER TABLE bookings ADD COLUMN "priceTotalCents" integer;
UPDATE bookings SET "priceTotalCents" = round("priceTotal" * 100)::int;
ALTER TABLE bookings ALTER COLUMN "priceTotalCents" SET NOT NULL;
ALTER TABLE bookings DROP COLUMN "priceTotal";
-- same for vet_appointments.fee and .baseFee
```

Keep the **API contract unchanged** — emit `priceTotal` as USD from the DTO
(`cents / 100m`). The frontend does not change; the storage is fixed.

**`timestamps_to_timestamptz`** — every timestamp is currently `text` holding
ISO-8601. **Do this last (Phase 10), not first.** Port with `text` for exact
parity and a fast path to green tests; convert once the suite can catch
regressions. Doing both at once makes every failure ambiguous.

When you do: classify each column first — `Booking.startDateTime` is a
`timestamptz`, but `Pet.dob` and `AvailabilityDay.date` are `date`. And match
JS `toISOString()` exactly on the way out, or frontend string comparisons break
quietly:

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
JavaScript emits 3 and `Z`.

---

## 3. Backend phases

| # | Phase | Scope | Days |
|---|---|---|---:|
| **0** | **Foundation** | Postgres install, `Leash.Database` + DbUp + baseline + seed split, solution skeleton, `Results.cs` (exact error envelope), FluentValidation filter, `NpgsqlDataSource`, the rewrite proxy, CI. | **4–6** |
| **1** | **Auth** ★ | Cookie auth, bcrypt verify, `OnValidatePrincipal` revocation, signup/login/logout, verify-email, forgot/reset, Google, `/api/me`, `/api/config`. Rewrite `session-client.ts`, delete `proxy.ts` + Auth.js. | **8–12** |
| **2** | **Access predicates** ★ | Port `lib/server/access.ts` and `tests/access.test.ts` **completely, before anything depends on them.** | **3–4** |
| **3** | **Read-only catalog** | products, brands, caretakers, vets, shelters, adoption listings (read). Establishes DTO, `json_agg` and pagination patterns. | **6–9** |
| **4** | **Pets + health records** | pets CRUD, medical records, the prescription → store gate, recommendations. | **6–9** |
| **5** | **Bookings + appointments** | Both status machines, messages, reviews, reputation. | **8–12** |
| **6** | **Store + payments** | quote → order → payment, server-owns-money, stock race, Stripe seam, webhook claim protocol, ledger, refunds, membership. **Highest risk.** | **12–18** |
| **7** | **Notifications + jobs** | `notify()` with a channel abstraction, email (fix B-2, B-5), cron → `BackgroundService`. | **4–6** |
| **8** | **Admin console** | users, professionals, payments, subscriptions, settings, audit. | **6–8** |
| **9** | **Adoption** | listings, applications, fee, transfer, reversal. | **5–7** |
| **10** | **Timestamps** | `timestamps_to_timestamptz` + converter, suite green. | **3–5** |

**Phases 0–2 are sequential and on the critical path.** From Phase 3 the domains
parallelise.

### Cut over one domain at a time

Implement in .NET → add the rewrite → run `npm run e2e` → delete the Node route
handler and its `lib/server/` file. Reverting is removing one line.

### Fix these during the port, not after

| Issue | Action |
|---|---|
| **B-1 (High)** — `POST /api/orders` has no `ownsPet` check | Add it. The correct check already exists in `quote/route.ts`. **Do not carry this across.** |
| **B-2** — unescaped HTML in notification email | `HtmlEncoder.Default.Encode`. Free in .NET. |
| **B-5** — fire-and-forget email | Outbox table + `BackgroundService`. |
| **B-15** — transaction exceeds Prisma's 5s default | Gone. Explicit `NpgsqlTransaction` has no implicit ceiling. |
| Prescription-active logic duplicated 4× | Exactly one server-side implementation. |
| Read receipts: a `GET` that mutates | Do not reproduce. Make marking-read an explicit `POST`. |

### Mobile-readiness — decide in Phase 1, not later (+6–10 days)

You mentioned a mobile app. These are cheap now and painful to retrofit:

- **Dual auth** — HttpOnly cookie for web, rotating JWT bearer pair for mobile,
  both from the same endpoints via a policy scheme selector. **+3–4 d now,
  multiples later.**
- **`/api/v1/` prefix** from the first endpoint. You cannot force-update an app
  store binary. **+0.5 d.**
- **Cursor pagination** on every list endpoint. Caretaker/vet search currently
  filters in memory with none — fine for a desktop grid, not for mobile infinite
  scroll. Copy `searchProducts`. **+2–3 d.**
- **Notification channels** (in-app / email / push) behind `notify()`, even with
  push unimplemented. **+1–2 d.**

Nothing else about mobile requires a decision now: `lib/api/`, `types/` and the
pricing logic are already plain portable TypeScript, sharable with React Native
as-is.

---

## 4. Frontend — the complete list of changes

This is genuinely all of it.

### 4.1 The rewrite proxy — `next.config.ts`

```ts
async rewrites() {
  return {
    beforeFiles: [                                  // beforeFiles is REQUIRED
      { source: "/api/products/:path*",
        destination: "http://localhost:5001/api/products/:path*" },
      // add each path as it is ported; everything else still hits app/api/
    ],
  };
}
```

`beforeFiles` matters: the default (`afterFiles`) only applies when no file
route matched, so `app/api/products/route.ts` would win and your .NET endpoint
would never be reached.

This gives you three things: **zero frontend changes** (relative `/api` paths
keep working), **zero CORS**, and **first-party cookies**. Mirror it in
production with a reverse proxy.

### 4.2 Auth — 4 files

**Rewrite `lib/auth/session-client.ts`** — the only file importing
`signIn`/`signOut`:

| Function | Becomes |
|---|---|
| `loginWithPassword` | `POST /api/auth/login` |
| `logout` | `POST /api/auth/logout` |
| `loginWithGoogle` | `window.location = "/api/auth/google?returnUrl=…"` |
| `refreshSessionUser` | **unchanged** (`GET /api/me`) |
| `navigateAfterAuth` | **unchanged** — keep it; the hard-navigation reasoning in its docstring still applies |

Port `safeInternalPath()`'s open-redirect check to the .NET `returnUrl` handling.

**Remove `getProviders()`** from `app/login/page.tsx` and `app/signup/page.tsx`
by adding one field to `PublicConfig` (both pages already fetch `/api/config`):

```ts
export interface PublicConfig {
  signupsOpen: boolean;
  maintenanceBanner: string;
  demoLoginVisible: boolean;
  googleEnabled: boolean;   // ← new
}
```

**Delete `proxy.ts`.** Its own docstring calls it "an optimistic check only";
real enforcement is in the handlers. The `AuthRequired` component already covers
the client side. No security is lost.

**Delete `types/next-auth.d.ts`** and the `next-auth` dependency.

### 4.3 Also delete, at the end

`app/api/**` (except `assistant/`), `lib/server/**` (except the assistant),
`auth.ts`, `auth.config.ts`, `prisma/`, and the `@prisma/client`, `prisma`,
`bcryptjs`, `stripe`, `zod` dependencies.

`lib/validation/` stays if the frontend uses the schemas for client-side form
validation; otherwise it goes too.

### 4.4 The assistant stays in Node — but it is not free (4–8 days)

`/api/assistant/*` remains the one Next.js route handler. Keeping it there
avoids the genuinely hard part: `agent.ts` builds the reply with
`createAgentUIStreamResponse` from the `ai` package, and `AssistantPanel.tsx`
reads it with `useChat` from `@ai-sdk/react`. Those are two halves of **one
proprietary SSE wire format** (the AI SDK "UI Message Stream" — typed
`text-delta`, `tool-input-*`, `tool-output-available`, `message-metadata`,
`finish` events). Reimplementing it in C# is the expensive, low-value part.

**But its tools import the TypeScript domain layer directly.**
`tools/reads.ts` pulls in `getOrdersByUser`, `getBookingById`, `getPetById`,
`activePrescriptions`, `searchProducts` and a dozen more from `lib/server/*`.
Those files are being deleted domain by domain, so the tools have to move to
HTTP calls against the .NET API.

The work, per tool:

```ts
// before — direct import
const orders = await getOrdersByUser(ctx.uid, ctx.db);
// after — the user's own request, forwarded
const orders = await apiGet<Order[]>("/api/v1/orders", ctx.cookie);
```

Three things make this smaller than it first looks:

- **`lib/api/*` already exists** as a fetch layer with the right shapes. It
  needs a server-side variant of `_client.ts` taking an absolute base URL and an
  explicit cookie header, since there is no ambient browser cookie.
- **`guards.ts` mostly disappears.** Calling the API *as the user* means .NET's
  own authorization answers — a 403 becomes `refuse("not_yours")`. The
  authorization stops being duplicated in two languages, which is a real
  improvement over what exists now.
- **`present.ts` stays untouched.** Money formatting at the tool boundary is
  pure display logic and has no reason to move.

**Schedule it to trail the backend phases** — re-point each domain's tools in
the same pass that deletes that domain's `lib/server/` file, rather than as one
lump at the end.

Also: the corpus is stale (`PROJECT_ANALYSIS.md` §10.3) — re-run
`npm run kb:ingest`. Retrieval needs pgvector, which **is not in the EDB Windows
installer** and means building from source. If that blocks, run the assistant
with tools only and no retrieval until it is sorted.

**Frontend total: 3–5 days, plus 4–8 for the assistant's tools.**

---

## 5. Testing

The 28 Vitest suites are your specification — they encode the transition tables,
the access predicates and the money rules. **Port them.** This is 25–35% of the
backend figure and is already inside the phase estimates.

- **xUnit**, one collection per domain, `[Collection]` to serialise DB access.
- **Respawn** to truncate between tests against `leash_test`.
- Test the service layer (matching what Vitest does today), plus
  `WebApplicationFactory` integration tests for auth and authorization —
  coverage you do **not** have now.
- Keep `scripts/e2e/` running throughout. It is your best cutover signal.

**CI pipeline:**

```yaml
- createdb leash_ci
- Leash.Migrator --connection "$CI_DB"     # every migration, empty DB
- dotnet test
- npm run e2e
```

Step 2 is what stops a broken migration ever reaching a person.

**Expect the suite to go from ~40 minutes to 1–2.** The current runtime is
almost entirely network round trips to Neon; local Postgres removes them. This
changes the inner loop for the whole project.

---

## 6. Week one

1. Install PostgreSQL 17; create `leash`, `leash_dev`, `leash_test` (§2.10).
2. Generate `202601010000_baseline.sql` via `prisma migrate diff`; dump demo
   data; split Reference from DevSeed.
3. Scaffold the solution; wire DbUp with the advisory lock, `NpgsqlDataSource`,
   `Results.cs`, the FluentValidation filter.
4. Port **`GET /api/brands`** — no auth, no nesting, trivial SQL — add the
   `beforeFiles` rewrite, and confirm the store page renders brand filters from
   .NET **with no frontend change at all**.
5. Only then start Phase 1.

Step 4 is the proof the plan rests on. If the React app cannot tell the
difference, everything after it is transcription with a safety net. Get that
signal before committing months.

---

## 7. Environment notes for this machine

Checked directly:

```
.NET SDKs:     8.0.x, 9.0.309, 10.0.401   ✅  ASP.NET Core 10.0.12 runtime present
Node / npm:    not installed              ← needed for the frontend and step 2 above
PostgreSQL:    not installed, nothing on :5432
node_modules:  never installed in this repo
```

Install **Node 20+** and **PostgreSQL 17** before starting. Node is needed both
to run the frontend and for the one `prisma migrate diff` command that generates
the baseline schema — hand-writing 951 lines of schema instead would be slow and
error-prone.
