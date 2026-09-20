# Migration plan — .NET backend, React frontend, local Postgres, Dapper

Target: replace the Next.js backend with an ASP.NET Core API using **Dapper**
(no EF Core), keep the React frontend, run **local PostgreSQL** with real
migrations, **no Docker**.

Written against commit `fc9537f`. Companion to `PROJECT_ANALYSIS.md`.

---

## 0. Verdict up front

**This migration is unusually tractable, and the reason is architectural luck.**

The current app already has the exact seam you need:

- Every page is a **client component**. There is no server-side data fetching,
  no server actions, no RSC data flow. The frontend already talks to the backend
  over plain HTTP/JSON.
- Every fetch goes through **`lib/api/_client.ts`**, and in the browser it uses
  **relative paths** (`base()` returns `""`). Nothing hardcodes an origin.
- The backend is already layered: route handlers are thin, and **all** business
  logic sits in `lib/server/*.ts` behind function boundaries.

So the frontend does not care that Node is answering `/api/orders`. Point that
path somewhere else and it keeps working.

**The one genuine coupling is auth — and it is four files.** I grepped for real
`next-auth` package imports across the whole frontend:

| File | Coupling |
|---|---|
| `lib/auth/session-client.ts` | `signIn`, `signOut` — the whole bridge |
| `app/login/page.tsx` | `getProviders()`, only to ask "is Google configured?" |
| `app/signup/page.tsx` | same |
| `types/next-auth.d.ts` | a type augmentation |

That is it. 44 pages and 75 components touch none of it — they read the Zustand
store, which is hydrated from `GET /api/me`. Rewrite one file, add one boolean
to `PublicConfig`, and the frontend is auth-agnostic.

**What is actually expensive** is not the plumbing. It is re-implementing ~66
domain files and ~28 test suites in C#, and getting the authorization predicates
exactly right. Budget accordingly (§11).

---

## 1. Decisions I'd make, with reasons

### 1.1 ⚠️ Target .NET 10, not .NET 8

You said .NET 8. One thing you should know before committing: **.NET 8's LTS
support window ends 10 November 2026** — roughly two months from now. .NET 10 is
the current LTS (supported to November 2028).

Everything in this plan is identical on either version; nothing here uses a
.NET 9/10-only API. But starting a multi-month rewrite on a runtime that leaves
support before you finish it means an unplanned upgrade lands in the middle of
the project.

**Recommendation: `net10.0`.** If you have a hard constraint pinning you to 8
(hosting, org policy), say so and the plan stands unchanged — just expect the
bump as a scheduled task.

### 1.2 Keep Next.js as the frontend shell — do not rewrite to Vite

| Option | Cost | What you get |
|---|---|---|
| **A. Keep Next.js, delete `app/api/` + `lib/server/`** ✅ | ~2–3 days | Zero page rewrites. Routing, layouts, `next/font`, `next/image`, Tailwind setup all survive untouched. |
| B. Vite + React Router SPA, served as static files by ASP.NET | ~3–5 weeks | One runtime in production, one deployable, no Node in prod. |

**Recommendation: A**, for the port. It is the smallest possible diff and it
keeps every option open.

Two honest caveats so you're choosing with open eyes:

- **A leaves two runtimes in production** (Node for Next, .NET for the API).
  That is the real cost, and it is the whole case for B.
- **The SEO argument for keeping Next.js is weaker than it looks.** Every data
  page is already a client component, so the HTML you ship today is a shell —
  you are not currently getting the SSR/SEO benefit the original spec asked for.
  Getting it would be separate work under either option.

So pick A because it is cheap, not because it is buying you SSR you already
don't have. If you later decide you want a single deployable, B becomes a
contained, well-understood project rather than a prerequisite.

### 1.3 Redis: not yet — and I'd say no for at least a year

You asked whether to use it. Short answer: **no, and here's the honest reasoning
rather than a reflex.**

Redis would earn its place for three things. Check each against what you have:

| Use | Do you need it? |
|---|---|
| **Session storage** | No. Cookie auth carries the principal; there is no server-side session to store. |
| **Rate limiting** | Not yet. You are running **one** API instance. In-memory or Postgres both work. |
| **Caching** | No. Premature — you have no measured hot path, and the catalog is small. |

What I'd actually do:

- **Keep the existing `rate_limit_hits` Postgres table** for sign-in throttling.
  It is already designed, it needs no new infrastructure, and it is **durable
  across restarts** — which an in-memory limiter is not. For throttling failed
  logins, losing the counter on every deploy is a real (if small) weakness.
- **Add .NET's built-in `Microsoft.AspNetCore.RateLimiting`** for coarse
  per-IP protection on the whole API. In-memory is fine for that.
- **Put both behind one `IRateLimiter` interface**, so swapping in Redis later
  is a single class.

**Adopt Redis when — and only when — you run more than one API instance.** At
that moment in-memory limiting silently becomes per-instance and you have a real
problem. Until then it is an extra service to install, monitor and back up, for
nothing. Given you also said no Docker, that is a service you'd be installing on
Windows by hand. Not worth it.

**Background jobs do not need Redis either.** The daily order-advance cron
becomes a `BackgroundService` (~30 lines). If you later want retries and a
dashboard, **Hangfire has a Postgres storage provider** — still no Redis.

### 1.4 Dapper: what you're giving up, and the two things you must replace

Dapper is a good fit here — the domain logic is already query-shaped, and you
get exact control over SQL and transactions. But EF Core was doing two jobs you
now own:

1. **Migrations.** Dapper has none. → §3.
2. **Object graph materialisation.** Prisma's `include` built nested objects for
   you. → use Postgres `json_agg` (§4.3), not Dapper multi-mapping.

You also lose change tracking and LINQ. Neither is a loss here — the current
code writes explicit updates anyway.

### 1.5 Recommended package set

| Concern | Package | Why |
|---|---|---|
| Driver | `Npgsql` | Register `NpgsqlDataSource` as a singleton (the Npgsql 8+ way). |
| Micro-ORM | `Dapper` | |
| Migrations | **`DbUp`** + `DbUp.Postgresql` | Plain ordered `.sql` as embedded resources. §3. |
| Validation | **`FluentValidation`** | Replaces Zod. Must emit the same error envelope — §6.3. |
| Passwords | **`BCrypt.Net-Next`** | Verifies your existing `$2a$`/`$2b$` hashes. §5.2. |
| Google OAuth | `Microsoft.AspNetCore.Authentication.Google` | |
| Stripe | `Stripe.net` | |
| Tests | `xUnit` + **`Respawn`** | §9. |
| API docs | `Swashbuckle` / built-in OpenAPI | Feeds TS type generation. §10. |
| pgvector *(only if porting the assistant)* | `Pgvector` + `Pgvector.Npgsql` | §8. |

**Deliberately not recommended:** Dapper.Contrib (hand-write the SQL),
AutoMapper (the DTO mapping here is trivial and explicit is clearer), MediatR
(you have no cross-cutting pipeline that needs it), Clean Architecture's 5-project
layout (§1.6).

### 1.6 Project layout — feature folders, one project, not Clean Architecture

The current `lib/server/<domain>.ts` one-file-per-domain layout worked. Mirror
it. A 5-project onion for a single-team CRUD-plus-rules API is ceremony that
makes every change touch four folders.

```
Leash.sln
├── src/Leash.Api/
│   ├── Program.cs                  endpoint groups, DI, auth, CORS
│   ├── Features/
│   │   ├── Orders/
│   │   │   ├── OrderEndpoints.cs   maps routes  → 1:1 with app/api/orders/*
│   │   │   ├── OrderService.cs     ← port of lib/server/orders.ts
│   │   │   ├── OrderQueries.cs     the SQL
│   │   │   ├── OrderDtos.cs        ← mirrors types/index.ts
│   │   │   └── OrderValidators.cs  ← port of the Zod schemas
│   │   ├── Bookings/ Vets/ Pets/ Store/ Adoptions/ Admin/ Membership/ …
│   ├── Auth/                       cookie handler, ValidatePrincipal, predicates
│   │   └── AccessPredicates.cs     ← port of lib/server/access.ts  ★ security core
│   ├── Infrastructure/
│   │   ├── Db/ConnectionFactory.cs
│   │   ├── Http/Results.cs         ← port of lib/server/http.ts
│   │   └── Json/IsoDateTimeConverter.cs
│   └── Migrations/*.sql            embedded resources, DbUp
├── src/Leash.MigrationRunner/      tiny console app; also runnable at startup
└── tests/Leash.Api.Tests/          ← port of tests/*.test.ts
```

**Use Minimal APIs with endpoint groups**, not MVC controllers. They map almost
line-for-line onto the current thin route handlers.

---

## 2. Local Postgres on Windows, no Docker

1. Install **PostgreSQL 17** via the EDB Windows installer. Add `bin/` to PATH.
2. Create role and databases:

```sql
CREATE ROLE leash WITH LOGIN PASSWORD 'devonly';
CREATE DATABASE leash_dev  OWNER leash;
CREATE DATABASE leash_test OWNER leash;
```

3. Connection string → **User Secrets**, never `appsettings.json`:

```bash
dotnet user-secrets set "ConnectionStrings:Default" \
  "Host=localhost;Port=5432;Database=leash_dev;Username=leash;Password=devonly"
```

**One snag to know about now:** `pgvector` is **not** in the EDB installer. On
Windows it means building from source with MSVC or finding a prebuilt binary —
genuinely annoying. This only matters if you port the assistant, which is why
§8 says don't, yet.

---

## 3. Migrations — DbUp, and how to get your baseline for free

You asked for proper migrations. With Dapper that means a script runner.

**Recommendation: DbUp.** Plain `.sql` files, ordered by filename, tracked in a
`schemaversions` table, embedded in the assembly. It suits you specifically
because **your schema is already designed** — you are not iterating on a model,
you are transcribing one. Plain SQL is the honest representation of that.

*(FluentMigrator is the alternative if you want C# migrations with `Down()`
methods. It is more machinery than a transcription job needs. DbUp has no
rollback — for a forward-only app database that is a feature, not a gap.)*

### 3.1 Generate the baseline from Prisma — do not hand-write it

```bash
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > src/Leash.Api/Migrations/0001_baseline.sql
```

That emits the complete 32-table schema, every index and FK, in one file.
Review it, strip the pgvector bits if you are deferring the assistant, and
that is migration one. **Do not transcribe 951 lines of Prisma schema by hand** —
you will introduce errors that the type system can no longer catch for you.

### 3.2 Convention

```
Migrations/
  0001_baseline.sql
  0002_money_to_cents.sql
  0003_timestamps_to_timestamptz.sql
  9000_dev_seed.sql          ← dev/test only, gated by environment
```

Mark each as `<EmbeddedResource>`. Run on startup in Development; run the
`MigrationRunner` console app explicitly in anything else — you do not want a
web app racing itself to migrate on multi-instance startup.

### 3.3 Two schema changes to make *during* the port

Both are called out as hazards in your own `ROADMAP.md`. This is the moment.

**`0002_money_to_cents.sql` — unify money representation.**

Today the store is integer cents and bookings/appointments are `double
precision` USD. Floats and money do not belong together, and `ROADMAP.md`
flags the split as the thing that will hurt when you build payouts.

```sql
ALTER TABLE bookings
  ADD COLUMN "priceTotalCents" integer;
UPDATE bookings SET "priceTotalCents" = round("priceTotal" * 100)::int;
ALTER TABLE bookings ALTER COLUMN "priceTotalCents" SET NOT NULL;
ALTER TABLE bookings DROP COLUMN "priceTotal";
-- same for vet_appointments: fee, baseFee
```

Keep the **API contract unchanged** — emit `priceTotal` as USD from the DTO
(`cents / 100m`). The frontend does not change; the storage is fixed. Never use
`double` for money in C#; use `int` cents and `decimal` only at the boundary.

**`0003_timestamps_to_timestamptz.sql` — but do this *after* the port is green.**

Every timestamp is currently `text` holding ISO-8601. It works (ISO-8601 sorts
lexicographically) but it costs you real indexes and type safety.

**Sequence this deliberately:**

1. Port with columns as **`text`**. Exact parity, lowest risk, fastest path to a
   passing test suite.
2. *Then* convert to `timestamptz` as its own migration, with the tests already
   green to catch regressions.

Doing both at once means every failure is ambiguous — port bug or timestamp bug?

When you do convert, two things matter:

- **Classify each column first.** Some are genuine timestamps
  (`Booking.startDateTime`) → `timestamptz`. Some are calendar dates
  (`Pet.dob`, `AvailabilityDay.date`) → `date`. Getting this wrong introduces
  timezone bugs in availability, which is the worst place to have them.
- **Match JS `toISOString()` byte-for-byte on the way out.** `DateTimeOffset`'s
  round-trip format (`"O"`) emits 7 fractional digits and `+00:00`. JavaScript
  emits 3 and `Z`. The frontend does string comparisons on these. One converter
  prevents a long tail of subtle bugs:

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

### 3.4 Seed data — dump it, don't port it

`lib/seed-data/` is ~2,800 lines of TypeScript fixtures. Porting them to C# is
days of tedious, error-prone work for zero architectural gain.

**Instead:** seed the current app once with `npm run db:seed`, then

```bash
pg_dump --data-only --inserts --no-owner leash_dev > Migrations/9000_dev_seed.sql
```

Ship that as an environment-gated migration. You get identical demo data in
minutes. Regenerate it whenever the fixtures change.

---

## 4. Porting the data layer

### 4.1 Connection management

Register **one** `NpgsqlDataSource` singleton (it pools internally). Do not
`new NpgsqlConnection` per call.

```csharp
builder.Services.AddNpgsqlDataSource(cs, b => b.EnableDynamicJson());
// then inject NpgsqlDataSource; `await using var conn = await ds.OpenConnectionAsync();`
```

### 4.2 Type mappings

| Postgres | C# | Note |
|---|---|---|
| `text[]` (roles, species, allergens…) | `string[]` | Npgsql handles natively; Dapper passes through. |
| `jsonb` (`slots`, `parts`, `value`, `payload`) | `string` → `JsonSerializer`, or POCO with `EnableDynamicJson()` | |
| `text` timestamps (phase 1) | `string` | Exact parity. |
| `timestamptz` (phase 2) | `DateTimeOffset` | With the converter above. |
| integer cents | `int` | |
| `vector(1536)` | `Pgvector.Vector` | Only if porting the assistant. |

**Keep the string-ish enums as strings.** Do not create Postgres `ENUM` types
and do not map to C# `enum` — it makes every future value a migration. Use
`static class OrderStatus { public const string Paid = "paid"; }` plus
validation, mirroring how `types/index.ts` does it today.

### 4.3 Nested shapes: use `json_agg`, not multi-mapping

`lib/server/serialize.ts` rebuilds nested objects (order + items + events,
address, vetContact, priceRange). Dapper's multi-mapping gets awkward past two
levels and duplicates parent rows.

Let Postgres do it — one round trip, one deserialize:

```sql
SELECT o.*,
       (SELECT json_agg(i) FROM order_items i WHERE i."orderId" = o.id) AS items,
       (SELECT json_agg(e ORDER BY e."occurredAt")
          FROM order_events e WHERE e."orderId" = o.id)                 AS events
FROM orders o WHERE o.id = @id;
```

Map `items`/`events` as `string` and deserialize, or enable dynamic JSON and map
straight to `List<OrderItemDto>`.

### 4.4 Transactions — an upgrade, not a downgrade

`createOrder` currently runs inside a Prisma interactive transaction and has
been observed at **5261 ms against Prisma's 5 s default timeout** (bug B-15).

Explicit `NpgsqlTransaction` has no such implicit ceiling, and you control the
isolation level. **B-15 disappears in the port** — just make sure the stock
decrement keeps its `WHERE stockQty >= @qty` guard so the sold-out race
(`stock_race`, a 409) still works.

---

## 5. Authentication — the hard part, and it maps cleanly

### 5.1 Architecture

.NET becomes the **sole** auth authority. Delete `auth.ts`, `auth.config.ts`,
`proxy.ts` and `app/api/auth/`.

Use **ASP.NET Core cookie authentication** with an HttpOnly, Secure,
SameSite=Lax cookie. Not a bearer token in `localStorage` — you would be
downgrading from the HttpOnly cookie you have today, and handing any XSS a
permanent credential.

### 5.2 Your existing password hashes keep working

`bcryptjs` writes standard `$2a$`/`$2b$` hashes. **`BCrypt.Net-Next` verifies
them unchanged.** No forced password reset, no dual-hash migration window — the
seeded and real accounts just work.

```csharp
BCrypt.Net.BCrypt.Verify(password, user.PasswordHash)
```

### 5.3 Session revocation has a native home

Your `sessionsValidFrom` mechanism exists because Auth.js JWT sessions have no
session table. ASP.NET cookie auth gives you the exact hook —
`CookieAuthenticationEvents.OnValidatePrincipal` — which runs on every
authenticated request and can reject the principal:

```csharp
options.Events.OnValidatePrincipal = async ctx =>
{
    var uid = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
    var acct = await users.GetAuthStateAsync(uid);          // status, sessionsValidFrom
    var issuedAt = ctx.Properties.IssuedUtc;
    if (acct is null || acct.Status != "active" || issuedAt < acct.SessionsValidFrom)
    {
        ctx.RejectPrincipal();
        await ctx.HttpContext.SignOutAsync();
    }
};
```

That is a **cleaner** expression of the rule than the hand-rolled check in
`requireUser()`, and it is enforced by the framework rather than by each handler
remembering to call it. Keep the same semantics: suspension bites on the next
request; a password reset invalidates older cookies.

### 5.4 Frontend changes — genuinely small

**Rewrite `lib/auth/session-client.ts`** (the only file that imports
`signIn`/`signOut`):

| Function | Was | Becomes |
|---|---|---|
| `loginWithPassword` | `signIn("credentials", …)` | `POST /api/auth/login` |
| `logout` | `signOut()` | `POST /api/auth/logout` |
| `loginWithGoogle` | `signIn("google", …)` | `window.location = "/api/auth/google?returnUrl=…"` |
| `refreshSessionUser` | `GET /api/me` | **unchanged** |
| `navigateAfterAuth` | — | **unchanged** (keep it — the hard-navigation reasoning in its docstring still applies) |

**Kill `getProviders()`** in `app/login/page.tsx` and `app/signup/page.tsx` by
adding one field to the config endpoint you already have:

```ts
export interface PublicConfig {
  signupsOpen: boolean;
  maintenanceBanner: string;
  demoLoginVisible: boolean;
  googleEnabled: boolean;   // ← new
}
```

Both pages already fetch `/api/config`. This removes the last `next-auth` import
from any page.

**Delete `proxy.ts`.** Its own docstring calls it "an optimistic check only" —
the real enforcement is already in the handlers. Replace with the client-side
`AuthRequired` guard you already have. No security is lost, because none was
being provided there.

**Keep the open-redirect check.** `safeInternalPath()` in `session-client.ts`
guards `callbackUrl`. Port the same validation to the .NET `returnUrl` handling
— it is an open redirect if you forget.

---

## 6. The cutover mechanism — strangler, not big bang

This is the part that makes the whole project safe. **Do not rewrite 81
endpoints and flip a switch.**

### 6.1 Next.js rewrites route individual paths to .NET

In `next.config.ts`:

```ts
async rewrites() {
  return {
    beforeFiles: [                                    // ← beforeFiles is required
      { source: "/api/products/:path*", destination: "http://localhost:5001/api/products/:path*" },
      { source: "/api/brands",          destination: "http://localhost:5001/api/brands" },
      // add paths here as each one is ported; everything else still hits app/api/
    ],
  };
}
```

**`beforeFiles` matters.** The default (`afterFiles`) only applies when no file
route matched — so `app/api/products/route.ts` would win and your .NET endpoint
would never be reached. `beforeFiles` runs first, letting the rewrite shadow the
existing handler.

Three things fall out of this, and together they are why this approach is worth
the setup:

1. **Zero frontend changes.** `lib/api/_client.ts` keeps calling relative
   `/api/...`. It never learns that .NET exists.
2. **Zero CORS.** Same origin from the browser's point of view. No preflight, no
   `AllowCredentials`, no `SameSite=None`.
3. **Cookies stay first-party.** The auth cookie is set on the Next origin and
   forwarded by the proxy. Nothing cross-site.

Mirror the same arrangement in production with a reverse proxy (IIS ARR, nginx,
YARP) so the API lives under the site's own origin.

### 6.2 Cut over one domain at a time

For each domain: implement in .NET → add the rewrite → run the e2e suite →
delete the Node route handler and its `lib/server/` file. Revert = remove one
line from the rewrite list.

Run both processes in dev. Add to `package.json`:

```json
"dev:api": "dotnet watch run --project ../Leash.Api",
"dev:all": "concurrently \"npm run dev\" \"npm run dev:api\""
```

### 6.3 ★ Keep the error envelope byte-identical

`lib/api/_client.ts` parses `{ error: string }` and throws `ApiError(message,
status)`. Several routes add structured extras that the UI reads — `issues[]`
for validation, `{ quote }` on a 409 unsatisfiable cart, `{ productId }` on a
stock race, `{ orderId }` on a payment-setup failure.

**Reproduce this exactly**, or you will chase phantom UI bugs across every form:

```jsonc
// 400 validation
{ "error": "Validation failed",
  "issues": [{ "path": "items.0.quantity", "message": "Expected number" }] }
```

Write a FluentValidation → this-shape filter **once**, in `Infrastructure/Http/
Results.cs`, as a direct port of `lib/server/http.ts` (`Ok`, `Error`, `NotFound`,
`Unauthorized`, `Forbidden`, `BadRequest`). Do it in phase 1 and every later
phase inherits it.

---

## 7. Phased plan

Sizes assume one experienced full-time developer. They are estimates, not
commitments — §11 lists what could move them.

| # | Phase | Scope | Size |
|---|---|---|---|
| **0** | **Foundation** | Local Postgres, DbUp + baseline from `prisma migrate diff`, seed dump, solution skeleton, `Results.cs`, FluentValidation filter, JSON converter, the rewrite proxy, CI. | **3–5 d** |
| **1** | **Auth** ★ | Cookie auth, bcrypt verify, `OnValidatePrincipal`, signup/login/logout, verify-email, forgot/reset password, Google, `/api/me`, `/api/config` + `googleEnabled`. Rewrite `session-client.ts`. Delete `proxy.ts` + Auth.js. **Prove login works end to end against the unchanged React login page.** | **8–12 d** |
| **2** | **Access predicates** ★ | Port `lib/server/access.ts` and `tests/access.test.ts` **first and completely**, before any endpoint depends on it. This is the security core of the whole app. | **3–4 d** |
| **3** | **Read-only catalog** | products, brands, caretakers/search + detail, vets/search + detail, shelters, adoption listings (read). No writes. Establishes the DTO, `json_agg` and pagination patterns. | **6–9 d** |
| **4** | **Pets + health records** | pets CRUD, medical records, the **prescription → store gate** (`authorizedProductSlugs`), recommendations. Depends on phase 2. | **6–9 d** |
| **5** | **Bookings + appointments** | Both status machines, messages, reviews, reputation. Port the transition tables literally — an illegal move must still be a 409. | **8–12 d** |
| **6** | **Store + payments** | quote → order → payment, the server-owns-money rule, stock race, cancellation, Stripe provider seam, webhook + claim protocol, ledger, refunds, membership/entitlements. **Largest and highest-risk phase.** | **12–18 d** |
| **7** | **Notifications + jobs** | `notify()`, email (fix B-2 and B-5 here), cron → `BackgroundService`. | **4–6 d** |
| **8** | **Admin console** | users, professionals, payments, subscriptions, settings, audit. 12 endpoints, all `requireStaff`. | **6–8 d** |
| **9** | **Adoption** | listings, applications, fee, transfer, reversal. | **5–7 d** |
| **10** | **Timestamp migration** | `0003_timestamps_to_timestamptz.sql` + DTO converter, with the suite green. | **3–5 d** |
| **11** | **Assistant** — *decide, don't default* | See §8. | **0 / 15–25 d** |

**Total excluding the assistant: roughly 65–95 working days.** Call it 3–5
months for one developer at a realistic pace, less with two once phase 2 lands
and the domains parallelise.

**Phases 0–2 are strictly sequential and on the critical path.** From phase 3,
domains are largely independent.

---

## 8. The assistant — my recommendation is to *not* port it

It is 19 server files, 26 tools, hybrid pgvector + full-text retrieval, and a
streaming endpoint. Three specific problems:

1. **The wire protocol.** `useChat` from `@ai-sdk/react` expects the Vercel AI
   SDK's specific SSE stream format — tool-call parts, tool-result parts, text
   deltas. Reimplementing it in .NET means matching an undocumented-ish protocol
   exactly, or rewriting the entire chat UI too.
2. **pgvector on Windows without Docker** is a build-from-source job (§2).
3. **It is the least essential subsystem** — and its corpus is already stale
   (`PROJECT_ANALYSIS.md` §10.3).

**Recommendation: leave `/api/assistant/*` as the last surviving Next.js route
handler.** You are keeping Next.js anyway (§1.2), so this costs nothing. It
needs the user's identity, which it gets by calling .NET's `/api/me` with the
incoming cookie forwarded — about ten lines replacing its current
`auth()` call.

That leaves Node owning exactly one endpoint, with a clear, documented reason —
rather than a 15–25 day detour through an SSE protocol reimplementation on the
critical path.

If you later want it fully in .NET, `Microsoft.Extensions.AI` gives you the tool
loop; the streaming protocol remains the hard part, and by then you can change
the client too.

---

## 9. Testing — and a large, free win

The 28 Vitest suites are your specification. They encode the transition tables,
the access predicates and the money rules. **Port them; do not skip them.**
Realistically this is 25–35% of total effort and it is already inside the phase
estimates above.

Setup without Docker:

- **xUnit**, one collection per domain, `[Collection]` to serialise DB access.
- **Respawn** to truncate between tests against the local `leash_test` database
  — far faster than the current snapshot-restore approach.
- Test the **service layer** (`OrderService`), matching what the Vitest suites
  do today, plus `WebApplicationFactory` integration tests for the auth and
  authorization paths — which is coverage you **do not have now** (there are no
  route-handler HTTP tests today).

**The free win: your test suite should go from ~40 minutes to 1–2 minutes.**
`PROJECT_ANALYSIS.md` §9.1 notes the current runtime is "almost entirely network
round trips to Neon." Local Postgres removes that entirely. This changes how you
work — a suite you can run on every save is a different tool from one you run at
lunch. It is probably the single biggest day-to-day quality-of-life improvement
in this whole plan, and it comes free with "local Postgres."

Keep `scripts/e2e/` running throughout — it exercises the full stack through the
browser and is your best cutover regression signal.

---

## 10. Keeping the TypeScript contract in sync

`types/index.ts` is 964 lines and is the shared contract. Once C# DTOs are the
source of truth, hand-maintaining it invites drift.

Generate it: Swashbuckle → OpenAPI → `openapi-typescript` → `types/api.generated.ts`.
Add a CI check that fails if the committed file is stale.

**Do it incrementally.** Keep `types/index.ts` as the curated public surface and
have it re-export from the generated file domain by domain, as each phase lands.
Regenerating all 964 lines on day one produces a diff nobody can review.

---

## 11. Risks, and things that will bite

| Risk | Why it matters | Mitigation |
|---|---|---|
| **The access predicates** | `lib/server/access.ts` is the security core. A subtle mistake is an authorization hole, not a crash. `Pet.ownedSince` in particular is an *authorization input* with non-obvious semantics. | Phase 2, ported and fully tested **before** anything depends on it. Read the docstrings in `access.ts` and `schema.prisma` — the reasoning is written down. |
| **Error-envelope drift** | Breaks forms and the cart across the whole app, and presents as unrelated UI bugs. | §6.3, in phase 0. |
| **Timestamp format drift** | `DateTimeOffset` "O" ≠ JS `toISOString()`. Breaks string comparisons quietly. | The converter in §3.3; defer the column change to phase 10. |
| **Money rounding** | Float USD → int cents on data you already hold. | `round(x * 100)` once, in the migration, and reconcile totals against `payments` before and after. |
| **Test-porting underestimated** | It is the largest single line item and the easiest to hand-wave. | It is already in the phase numbers. Do not let it be cut — the suites *are* the spec. |
| **Stripe webhook claim protocol** | Concurrency-sensitive; subtle bugs mean double-processing real money. | Port `webhooks/store.ts` literally, including `lockedAt`/`attempts`. Port `webhooks.test.ts` and `stripe-signature.test.ts` first. |
| **Seed drift** | Many tests assert on seeded ids. | Dump-and-replay (§3.4) preserves ids exactly. |
| **.NET 8 EOL in ~2 months** | An unplanned upgrade mid-project. | §1.1 — target `net10.0`. |
| **Two runtimes in production** | More to deploy and monitor. | Accepted cost of §1.2 option A. Revisit with option B later if it grates. |

---

## 12. Fix these *during* the port, not after

The port touches every one of these anyway. Fixing them later means touching
them twice.

| From `PROJECT_ANALYSIS.md` | What to do in .NET |
|---|---|
| **B-1 (High)** — `POST /api/orders` has no `ownsPet` check | Add it. The correct check already exists in `quote/route.ts`. **Do not carry this bug across.** |
| **B-2** — unescaped HTML in notification email | Use `HtmlEncoder.Default.Encode` or a Razor template. Free in .NET. |
| **B-5** — fire-and-forget email lost on teardown | A hosted-service queue or outbox table. Serverless teardown is not a concern once you control the process, but an outbox is still the right shape. |
| **B-15** — transaction exceeds Prisma's 5 s default | Gone. Explicit `NpgsqlTransaction` has no implicit ceiling. |
| **Money split (cents vs Float)** | Migration `0002` (§3.3). |
| **`refillsLeft` never decremented** | Decide the rule before writing the port — the current UI states a fact the system does not enforce. |
| **Prescription-active logic duplicated 4×** | Exactly one implementation, server-side, in `Features/Pets`. Only the SQL one gates money today; make it the only one. |
| **Read receipts: a `GET` that mutates** | Do not reproduce it. Make marking-read an explicit `POST`. |

---

## 13. What I'd do in week one

1. Install Postgres 17, create `leash_dev` + `leash_test` (§2).
2. `prisma migrate diff` → `0001_baseline.sql`; `pg_dump` → `9000_dev_seed.sql`;
   verify both apply to an empty database (§3.1, §3.4).
3. Scaffold the solution; wire DbUp, `NpgsqlDataSource`, `Results.cs`, the
   FluentValidation filter, the JSON converter.
4. Add the `beforeFiles` rewrite with **one** trivial endpoint ported —
   `GET /api/brands` is ideal: no auth, no nesting, trivial SQL. Confirm the
   React store page renders brand filters from .NET **with no frontend change
   at all**.
5. Only then start phase 1.

Step 4 is the proof the whole plan rests on. If the React app cannot tell the
difference, everything after it is transcription work with a safety net. Get
that signal in week one, before you have committed months.
