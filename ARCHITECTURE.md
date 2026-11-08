# Leash — Architecture

How this codebase is put together, and how to add a feature to it.

`REQUIREMENTS.md` says **what** to build. `BUILD_PLAN.md` says **when**.
`STATUS.md` says what is **done**. This file says **how**, and it is the one to
read before writing code.

---

## 1. The three projects

```
API/
├── Leash.slnx
├── src/Leash.Api/          HTTP. Controllers, auth schemes, error envelope, JSON.
├── src/Leash.Core/         Models, repositories, services — and their interfaces.
└── tests/Leash.Api.Tests/  xUnit against both.

web/                        React + Vite SPA (TypeScript, Tailwind v4, React Router)
db/                         petapp.sql (master) + changes/ + reference/ + devseed/
```

**`Leash.Core` must never reference ASP.NET Core.** It takes the
`Microsoft.Extensions.*` *abstractions* only. This is not a style preference —
it is what makes the dependency arrow enforceable by the compiler rather than by
review. If you find yourself wanting an `HttpRequest`, an `IActionResult` or
`HttpContext` inside `Leash.Core`, the thing you are writing belongs in
`Leash.Api`, or it needs its input passed in as a plain value.

The reverse is fine and expected: `Leash.Api` references `Leash.Core`.

### The layers, and what each is allowed to know

| Layer | Knows about | Must not |
|---|---|---|
| **Controller** | HTTP: status codes, headers, cookies, the current `ClaimsPrincipal` | Contain a rule, touch SQL, or open a transaction |
| **Service** | Business rules, transactions, other services | Know it is being called over HTTP |
| **Repository** | SQL, Dapper, the table shape | Contain a rule, or decide what an error means |
| **Entity** | One table's columns | Have behaviour beyond mapping to a DTO |
| **DTO** | The wire contract (mirrors `web/src/types`) | Carry a column no client should see |

---

## 2. Adding a feature — the recipe

Every module from M2 onward follows the same seven steps. M1 (`Auth`, `Users`)
is the worked example; read `AuthController` → `AuthService` → `UserRepository`
once before starting, and the shape will be obvious.

### Step 1 — Schema, if the feature needs one

Write `db/changes/NNN_description.sql`. Every change script is self-guarding and
wrapped in a transaction:

```sql
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM schema_version WHERE script = 'NNN_description')
  THEN RAISE EXCEPTION 'Already applied on this database'; END IF;
END $$;

ALTER TABLE ...;

INSERT INTO schema_version (script) VALUES ('NNN_description');
COMMIT;
```

Then, **in the same commit**:

```bash
# apply to both local databases
psql -U leash -d petapp_dev  -v ON_ERROR_STOP=1 -f db/changes/NNN_description.sql
psql -U leash -d petapp_test -v ON_ERROR_STOP=1 -f db/changes/NNN_description.sql

# regenerate the master from the converted database, re-attach the header
pg_dump -U leash --schema-only --no-owner --no-privileges petapp_dev > /tmp/dump.sql
#   ...prepend db/petapp.sql's 28-line header, append the schema_version INSERT

./db/verify.sh          # must print: ✓ IDENTICAL
```

`verify.sh` builds one database from the master and one from
`petapp_at_last_release.sql` + `changes/`, and diffs the schema dumps. It
catches the failure that matters: the two paths producing *different* schemas
while both look correct.

> `db/petapp_at_last_release.sql` is **committed** (since release hardening,
> 2026-10-17) so CI can run `verify.sh`. It is the schema the scripts in
> `changes/` start from. Replace it only when retiring scripts every environment
> has run: copy `petapp.sql` over it and remove those scripts, in one commit.
> Never edit it by hand.

### Step 2 — Entity and DTOs

`Leash.Core/Models/Entities/<Name>Entity.cs` — a **mutable class with a
parameterless constructor**, one property per column, plus `ToDto()`.

```csharp
public class PetEntity
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public DateTimeOffset OwnedSince { get; set; }
    public string[] Allergies { get; set; } = [];

    public PetDto ToDto() => new(Id, OwnerId, /* … */);
}
```

**Not a positional record.** Dapper matches a constructor by comparing the
reader's reported field types, and it fails on the two types this schema leans
on: `text[]` is reported as `System.Array` (not `string[]`) and `timestamptz` as
`DateTime` (not `DateTimeOffset`). The failure is a runtime
`InvalidOperationException` naming the signature it wanted. Mutable properties
sidestep it entirely — see `Persistence/DapperSetup.cs`.

DTOs in `Leash.Core/Models/Dtos/` **are** positional records — nothing
materialises them from a reader.

Where the same table needs two projections (a public one and a privileged one),
write two types and let the narrower one be the default. `UserEntity` /
`UserCredentialEntity` is the pattern: the password hash exists only on the
subclass, and only two queries ask for it.

### Step 3 — Repository interface, then implementation

`Leash.Core/Repositories/Interfaces/I<Name>Repository.cs`. One interface per
aggregate, exposing only the operations actually needed. **No generic
`IRepository<T>`** — with Dapper there is no change tracker to abstract over,
and a uniform CRUD surface flattens projections that are deliberately different.

Every method takes an optional transaction scope, last-but-one:

```csharp
Task<PetEntity?> GetByIdAsync(
    string id, ITransactionScope? scope = null, CancellationToken ct = default);
```

The implementation opens a `DbSession`, which borrows the caller's connection
when a scope is passed and takes one from the pool when it is not:

```csharp
public async Task<PetEntity?> GetByIdAsync(
    string id, ITransactionScope? scope = null, CancellationToken ct = default)
{
    await using var session = await DbSession.OpenAsync(db, scope, ct);
    return await session.Connection.QuerySingleOrDefaultAsync<PetEntity>(
        new CommandDefinition(
            $"SELECT {Columns} FROM pets WHERE id = @id",
            new { id }, session.Transaction, cancellationToken: ct));
}
```

Two rules for the SQL:

- **Spell out the columns.** A `const string Columns` with explicit
  `AS "PascalCase"` aliases, never `SELECT *`. The tables hold password hashes,
  provider ids and session watermarks; a `SELECT *` into an entity that happens
  not to bind them today is one added property away from serialising a secret.
- **Quote camelCase identifiers.** The schema came from Prisma, so columns are
  `"ownerId"`, `"createdAt"`, `"stockQty"`. Unquoted, PostgreSQL folds them to
  lowercase and the query fails to find them.

### Step 4 — Service interface, then implementation

`Leash.Core/Services/Interfaces/I<Name>Service.cs`. This is where the rules go,
and where the reasoning goes in a docstring — a future reader needs to know *why*
a branch exists, not just that it does.

Return shapes the controller can map without knowing the domain:

- `null` for "not found" / "refused, no detail needed"
- an `enum` failure alongside the value for "refused, and the reason changes the
  status code"
- a tuple `(T? Value, TFailure? Failure)` when both are needed

Never return an `IActionResult` from a service.

### Step 5 — Transactions

**Rule: a write touching more than one row or more than one table runs in a
transaction.** The service owns it:

```csharp
await using var scope = await unitOfWork.BeginAsync(ct);

var pet = await pets.GetByIdAsync(petId, scope, ct);
if (pet is null) return null;                    // disposes → rolls back

await pets.UpdateOwnerAsync(petId, newOwnerId, scope, ct);
await records.ReparentAsync(petId, newOwnerId, scope, ct);

await scope.CommitAsync(ct);
```

Disposing without committing rolls back, so an early `return` or a thrown
exception leaves nothing behind. Keep expensive CPU work (bcrypt, image
processing) **outside** the scope so it does not hold a row lock.

When another service's write must land in your transaction — a guest booking
writes the user and the pet, then the booking — do not copy that service's
rules. Give it a `…InAsync(…, ITransactionScope scope)` method that runs every
rule inside the caller's scope without committing, and make its ordinary method
a wrapper that begins, calls it, and commits on success
(`IBookingService.CreateInAsync`, `IAppointmentService.CreateInAsync`).

Use `SELECT … FOR UPDATE` when a decision is read and then written, and two
callers racing must not both succeed — stock decrements, token rotation, claiming
a unique value.

### Step 6 — Controller

```csharp
[ApiController]
[Route("api/v1")]
public sealed class PetsController(IPetService pets) : ControllerBase
{
    [HttpGet("pets/{id}")]
    [Authorize]
    public async Task<IActionResult> Get(string id, CancellationToken ct)
    {
        var pet = await pets.GetForCallerAsync(User.RequireUserId(), id, ct);
        return pet is null ? ApiResults.NotFound($"Pet {id} not found") : Ok(pet);
    }
}
```

- `[Route("api/v1")]` on the class, the resource path on the method. Versioned
  from the first endpoint — an app-store binary cannot be force-updated.
- **`ApiResults`, never `BadRequest(...)` / `NotFound()`.** The framework helpers
  emit `ProblemDetails` (`title`, `status`, `traceId`), which is a different
  shape from the error envelope the frontend parses.
  `SuppressModelStateInvalidFilter` is on for the same reason.
- `[Authorize]` per action. There is **no fallback policy**, so a new action is
  public until it says otherwise — deliberate, because a fallback policy hides a
  missing authorization check behind a 401 that looks correct.
- `User.RequireUserId()` throws rather than returning null. Only use it behind
  `[Authorize]`, where a missing id means the pipeline is misconfigured.

### Step 7 — Validator

`Leash.Core/Validation/<Name>Validators.cs`, a `FluentValidation`
`AbstractValidator<TRequest>`. Registered automatically by
`AddValidatorsFromAssemblyContaining` and run by the global
`ValidationActionFilter` before the action body — so an action never re-checks
its own arguments.

Messages are written for the person filling in the form. Paths are translated to
the JSON contract (`roles[0]`, not `Roles[0]`) by the filter.

---

## 3. The error envelope

One shape, everywhere. `Leash.Api/Http/ApiResults.cs`.

```jsonc
{ "error": "Validation failed",
  "issues": [{ "path": "items.0.quantity", "message": "Expected number" }] }
```

| Status | Helper | Meaning |
|---|---|---|
| 400 | `BadRequest` / `ValidationFailed` | Understood, not valid |
| 401 | `Unauthorized` | Not signed in, or session no longer valid |
| 403 | `Forbidden` | Signed in, not permitted |
| 404 | `NotFound` | — |
| 409 | `Conflict(msg, extra)` | Illegal transition, or no longer satisfiable |
| 429 | `TooManyRequests(msg, limit)` | Rate limited |
| 502 | `BadGateway(msg, extra)` | Payment provider failed |
| 503 | `Unavailable` | Feature not configured / switched off |

`Conflict` and `BadGateway` merge `extra` in **beside** `error` rather than
nesting it, because that is what the client reads (`quote`, `productId`,
`orderId`).

Drift here presents as unrelated UI bugs across every form in the app. Do not
add a second error shape.

---

## 4. Authentication

Two credentials, one set of endpoints, selected per request by
`AuthSetup`'s policy scheme on the presence of an `Authorization: Bearer`
header.

| | Web | Native |
|---|---|---|
| Credential | HttpOnly cookie, 30 days | JWT access 15 min + rotating refresh 30 days |
| Asked for by | (default) | `X-Leash-Client: mobile` on login |
| Revocation | `sessionsValidFrom` watermark | watermark + `refresh_tokens.revokedAt` |

**Exactly one is issued per sign-in.** Never both — an access token in a response
the browser can read is what the HttpOnly cookie exists to prevent.

### Session revocation — the load-bearing part

Both credentials are self-contained, so there is no session row to delete.
`ISessionValidator` runs on **every** authenticated request (cookie:
`OnValidatePrincipal`; bearer: `OnTokenValidated`) and checks two things:

1. `status == 'active'` — a suspended or deleted account is refused with **401,
   not 403**, because the right client response is to sign out, not retry.
2. the credential's issue time is **at or after** `sessionsValidFrom`.

The watermark is bumped on password reset, on suspension, and by an admin forcing
sign-out — and **deliberately not on ordinary logout**, which would sign every
other device out too. Consequence, pinned by a test: a cookie copied before
sign-out keeps working. See `BUILD_PLAN.md` §11.

When you add an admin action that suspends or force-signs-out a user, bump
`sessionsValidFrom` **and** revoke refresh tokens, in one transaction.

---

## 5. Data conventions

| PostgreSQL | C# | Note |
|---|---|---|
| `text` | `string` | Enum-like values are `text`, validated at the boundary — no PG `ENUM` |
| `text[]` | `string[]` | Native in Npgsql |
| `jsonb` | POCO or `string` | `EnableDynamicJson()` is on |
| integer cents | `int` | **All money.** Never `double`/`decimal` in storage |
| `timestamptz` | `DateTimeOffset` | Via the Dapper type handler |
| `date` | `DateOnly`/`DateTimeOffset` | Calendar-only: `pets.dob`, availability days |

- **Timestamps serialise as `yyyy-MM-ddTHH:mm:ss.fffZ`** — exactly JavaScript's
  `toISOString()`. The frontend does string comparisons on these. `IsoDateTimeConverter`
  handles it; do not add another converter.
- **`Ids.Now()` is the only clock read.** It truncates to milliseconds so the
  value that goes out over HTTP, the value stored in `timestamptz` and the value
  read back all agree.
- **`Ids.New("prefix")`** for new ids. Prefixes match the seed data (`u`, `p`,
  `b`, `o`). PostgreSQL 18 has `uuidv7()` but the fixtures carry string ids, so
  it is not adopted.
- **Money at the DTO boundary:** the API emits USD decimals where the existing
  contract does (`Booking.priceTotal`, `VetAppointment.fee`) and integer cents
  everywhere else. Divide by 100 in exactly one place.

---

## 6. The web app

```
web/src/
├── api/          one file per domain. NOTHING else calls fetch.
├── auth/         session.ts (login/logout/refresh), demo.ts
├── store/        Zustand. session.ts is a *cache*, not the source of truth.
├── components/   ui/ = design system; the rest are app components
├── pages/        one default-export component per route
├── routes.tsx    the route tree
├── App.tsx       the shell (header, banners, footer, toaster, SessionSync)
├── lib/          utils, motion, photos — framework-agnostic
└── types/        copied verbatim from the reference project
```

- **The API is a separate origin** (since 2026-10-17, `deploy/README.md`).
  `web/public/config.js` sets `apiBaseUrl` — `:5001` in development, the IIS
  backend site when deployed — and `api/_client.ts` prefixes every call with
  it and sends `credentials: "include"`. The API allows the SPA in
  `Cors:Origins`. There is no Vite proxy. A new endpoint needs nothing extra
  to work cross-origin; a new *header* the client sends would need to be
  allowed (the policy allows any header today).
- **`@/` resolves to `src/`** — declared in *both* `vite.config.ts` and
  `tsconfig.app.json`. Both are needed (`tsc -b` runs first in `npm run build`).
- **Pages call `src/api/*`, never `fetch`.** That rule is what kept the reference
  frontend portable enough to move here.
- **Guards are UX, not security.** `RequireAuth` waits for `hasHydrated` before
  deciding, so a signed-in user reloading a guarded page sees a skeleton rather
  than a redirect. Every endpoint re-checks server-side.

### Porting a screen from the reference project

| From | To |
|---|---|
| `next/link` `<Link href>` | `react-router` `<Link to>` |
| `next/navigation` `useRouter()` | `useNavigate()` |
| `useSearchParams()` | `useSearchParams()` (react-router) |
| `usePathname()` | `useLocation().pathname` |
| `useParams()` | `useParams()` (react-router) |
| `next/image` | `components/Avatar.tsx`, or a plain `<img>` with width/height |
| `"use client"` | delete it |
| `app/x/page.tsx` | `pages/XPage.tsx` + an entry in `routes.tsx` |
| `next/image fill` in a sized box | an `absolute inset-0 h-full w-full object-cover` `<img>`, with `BLUR_DATA_URL` as the box's CSS background |
| a file under the reference's `public/` | the same path under `web/public/` |
| `lib/api/*` | `web/src/api/*` — cursor pages (`{ items, nextCursor }`), nested `{ profile, user }`, self-only lists with no user id |
| a client copy of a server rule (Rx active, allergen match) | ask the server — the quote answers both |
| a renamed or removed route | a `<Moved to=…>` entry in `routes.tsx`, so old links redirect |

**Port the reference screen first, adapt it to the API second.** A screen that
looks different from the reference is an unfinished port unless the difference
is a REQUIREMENTS.md §12 fix — and then it is listed in `STATUS.md`.

---

## 7. Testing

```bash
cd API && dotnet test          # 1150 tests, ~7m
cd web && npm run build        # tsc -b && vite build
cd web && npx oxlint src
./db/verify.sh                 # must print ✓ IDENTICAL
```

Two levels, and both matter:

- **Service tests** resolve from a real DI container (`CoreHost`) and exercise
  `Leash.Core` directly. This is the level the reference project's 28 Vitest
  suites work at, and **those suites are the specification** — port them as you
  go, not at the end. They encode the transition tables, the actor rules and the
  money rules.
- **Endpoint tests** boot the app (`LeashApp`) and speak HTTP. They cover what
  service tests structurally cannot: that the cookie is issued, that
  `[Authorize]` is actually on the action, that a 401 carries the envelope. An
  authorization hole lives in exactly that gap.

`DatabaseFixture` rebuilds `petapp_test` from `db/petapp.sql` on every run, then
Respawn-truncates and re-seeds before each test. Rebuilding is deliberate: the
suite is also the check that the master schema produces a working database.

> **Trap:** `WebApplicationFactory.ConfigureAppConfiguration` is applied *after*
> `Program`'s body has already read the connection string, so it cannot redirect
> the data source. `LeashApp` sets **environment variables** instead
> (`ConnectionStrings__Default`), which `WebApplicationBuilder` reads early
> enough. Getting this wrong makes the tests silently run against `petapp_dev`
> and pass anyway.

Put tests in one `[Collection(DatabaseCollection.Name)]` so xUnit serialises
them — they share one database and each resets it.

---

## 8. Configuration

Read from `appsettings.Development.json` locally, environment variables in
production (double underscore for nesting: `ConnectionStrings__Default`).

| Key | Purpose |
|---|---|
| `ConnectionStrings:Default` | PostgreSQL |
| `Auth:Secret` | Signs cookies and access tokens. Rotating it signs everyone out — the break-glass action |
| `Auth:Google:ClientId` / `:ClientSecret` | Both set ⇒ Google button appears; unset ⇒ 503 |
| `App:Origin` | Where emailed links point. **Configuration, never the `Host` header** — otherwise `Host: attacker.example` yields a valid reset link on an attacker's domain |
| `Email:ResendApiKey` | Unset ⇒ the mailer logs instead of sending |
| `Email:DevMode` | Returns action links in responses. **Forced off outside Development**, whatever it says |
| `Email:From` | Sender for Resend. Default `Leash <onboarding@resend.dev>` |
| `Cors:Origins` | The SPA's address(es) when it is a separate site. Unset ⇒ nothing cross-origin |
| `Fulfilment:Enabled` / `:IntervalMinutes` | The order fulfilment job. **One instance only** |
| `Notifications:Outbox:Enabled` / `:IntervalSeconds` | The notification email drain (default on, 15 s). Safe on every instance |
| `Payments:Provider` | `demo` (default) or `stripe`. **`stripe` without `Payments:Stripe:SecretKey` refuses to start**; an unknown value refuses to start |
| `Payments:Stripe:SecretKey` | Stripe secret key. Environment variable only |
| `Payments:Stripe:WebhookSecret` | The webhook endpoint's signing secret. **Unset ⇒ every webhook is a 403** |

Anything damaging if published goes in an environment variable, not in a file.

---

## 9. Things that will bite you

1. **Positional records + Dapper** → runtime materialisation error. Entities are
   mutable classes. (§2 step 2)
2. **`SELECT *`** → a secret in a response, eventually.
3. **Unquoted camelCase columns** → "column ownerid does not exist".
4. **`BadRequest(...)` in a controller** → `ProblemDetails` instead of the
   envelope, and a client that cannot parse the error.
5. **`WebApplicationFactory` config** → tests against the wrong database. (§7)
6. **Forgetting `./db/verify.sh`** → master and change scripts diverge silently.
7. **A read-then-write without a transaction** → a race that only shows up in
   production.
8. **Bumping `sessionsValidFrom` on logout** → signs every device out. Don't.
9. **A Dapper multi-map segment whose every column is NULL materialises as
   `null`**, not as an empty object — so the mapper lambda must construct its
   result rather than mutate the argument. `VetRepository.SearchAsync` splits on
   a `DistanceMiles` that is `NULL::float8` when no origin was given, and got
   thirteen `NullReferenceException`s before this was understood.
10. **Positional-record equality is memberwise and arrays compare by
    reference** → two structurally identical DTOs are never `Assert.Equal`.
    Compare serialised JSON in tests.
11. **Ids are random, so they are not an order.** `Ids.New` makes UUIDs. Rows
    written in one batch with one timestamp sort randomly by id — an order
    timeline read "shipped, delivered, out for delivery" before
    `OrderLifecycle.Timeline` added a lifecycle tie-break. The reference used
    time-ordered cuids and never saw it; anything ported that sorts by id as a
    stand-in for creation order has the same latent bug.
12. **FluentValidation runs every rule in a chain even after one fails.** A
    `.Must(x => x.Length …)` after `.NotNull()` gets the null. Use
    `.Cascade(CascadeMode.Stop)`.
