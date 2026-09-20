# Migration runbook — module by module

How to actually do it. Modules, the order, the exact cutover steps, how the old
backend gets removed, and where the React Native app fits.

Decisions are in `IMPLEMENTATION_PLAN_DOTNET10.md`. This is the operational doc.

---

## 1. The database — your idea, with one fix

### What you proposed

> One `petapp.sql` that creates everything. Changes go in scripts, and we also
> update `petapp.sql`, so a new server gets the latest DB from one file.

**The goal is right.** One command, fresh server, latest schema. That is exactly
what you should have.

**One part will bite you: hand-maintaining `petapp.sql` alongside the change
scripts.** Two copies of the truth always drift. The failure looks like this —
someone adds a column in `014_add_channel.sql`, forgets to edit `petapp.sql`,
and four months later a new server gets a database missing that column. Nobody
notices until something breaks in production, and by then nobody remembers
which file was right.

It is not a matter of discipline. It happens to every team that tries it.

### The fix — same result, one source of truth

**The numbered scripts are the truth. `petapp.sql` is generated from them, never
hand-edited.**

```
db/
├── scripts/
│   ├── 001_baseline.sql          ← the whole current schema
│   ├── 002_money_to_cents.sql
│   ├── 003_add_notification_channel.sql
│   └── ...
└── petapp.sql                    ← GENERATED. Reference only. Do not edit.
```

**Fresh server:**

```bash
Leash.Migrator --connection "Host=...;Database=petapp;..."
```

It runs `001`, `002`, `003`… in order on the empty database. You get the latest
schema from one command. **That is the thing you wanted** — it is just a command
instead of a file, and it cannot drift because there is only one copy.

**Existing server:** the exact same command. It checks the `schemaversions`
table, sees `001` and `002` already ran, applies only `003`. Running it twice is
safe — the second time prints "nothing to do."

**Regenerate `petapp.sql` whenever you want to read the current schema:**

```bash
pg_dump --schema-only --no-owner petapp > db/petapp.sql
```

Keep it committed so you can browse the schema in one file. Just never *run* it
as the install path, and never edit it by hand.

### The rules

1. **Never edit a script that has already run** — not even a typo. Once it has
   run anywhere, including a teammate's laptop, it is frozen. Fixes are new
   scripts. This one rule prevents most database disasters.
2. One change per script.
3. Name them `NNN_what_it_does.sql` — `014_add_notification_channel.sql`.
4. Never `DROP` a column that deployed code still reads (§4.4).

### Squashing — the legitimate version of your idea

When the script list gets long (say 40+), you can collapse them into a fresh
baseline:

```bash
pg_dump --schema-only --no-owner petapp > db/scripts/001_baseline_v2.sql
# delete 001–040, mark existing servers as already at v2
```

This is a real practice with a name — **baseline squashing**. The difference
from your original idea is that it is **occasional and generated**, not
**continuous and hand-written**. Do it at version milestones, not every change.

### Creating the first script

Don't hand-write 951 lines of schema:

```bash
npx prisma migrate diff --from-empty \
  --to-schema-datamodel prisma/schema.prisma --script \
  > db/scripts/001_baseline.sql
```

Then split the seed data:

```bash
npm run db:seed
pg_dump --data-only --inserts --no-owner "$NEON_URL" > /tmp/seed.sql
```

Split that dump into two files — this matters:

| File | Contains | Runs where |
|---|---|---|
| `db/reference/R001_plans_and_settings.sql` | `plans`, `system_settings`, `products` | **Every** environment, including production |
| `db/devseed/D001_demo_data.sql` | users, pets, bookings, orders | **Dev and test only** |

Your current seeder creates all of it in one pass. Production needs the plans
and settings; it must never get Maya Chen's pets.

---

## 2. The modules

81 endpoints, 12 modules. Migrate in this order — it is dependency order, not
preference.

| # | Module | Endpoints | Key files ported | Days |
|---|---|---:|---|---:|
| **M0** | **Foundation** | 0 | migrator, `Results.cs`, validation filter, DB connection, rewrite proxy, CI | 4–6 |
| **M1** | **Identity & Auth** ★ | 10 | `auth-logic.ts`, `users.ts`, `tokens.ts`, `session.ts` | 8–12 |
| **M2** | **Access predicates** ★ | 0 | `access.ts` — pure logic, no endpoints | 3–4 |
| **M3** | **Catalog (read-only)** | 11 | `products.ts`, `caretakers.ts`, `vets.ts`, `shelters.ts` | 6–9 |
| **M4** | **Pets & health records** | 7 | `pets.ts`, `medical-records.ts` | 6–9 |
| **M5** | **Bookings** | 7 | `bookings.ts`, `messages.ts`, `reviews.ts`, `reputation.ts` | 8–10 |
| **M6** | **Vet appointments** | 7 | `appointments.ts`, `pricing-vet.ts` | 5–7 |
| **M7** | **Store & orders** | 8 | `orders.ts`, `reservations.ts`, `fulfillment.ts`, `delivery.ts` | 10–14 |
| **M8** | **Payments & membership** | 8 | `payments/*`, `webhooks/*`, `subscriptions.ts`, `entitlements.ts` | 8–12 |
| **M9** | **Notifications & jobs** | 1 | `notifications.ts`, `mailer.ts`, `email-flows.ts`, cron | 4–6 |
| **M10** | **Admin** | 12 | `admin/*`, `audit.ts`, `settings.ts` | 6–8 |
| **M11** | **Adoption** | 10 | `adoptions/*` | 5–7 |
| **M12** | **Assistant re-point** | 0 | tools → HTTP calls | 4–8 |
| | **Total** | **81** | | **78–112** |

### Why this order

- **M0 → M1 → M2 are locked and sequential.** Everything depends on them.
- **M2 before any data module.** `access.ts` is the security core — get it ported
  and fully tested before a single endpoint relies on it.
- **M3 first among the domains** because it is read-only. Low risk, high volume.
  It is where you settle the DTO shapes, the SQL style and pagination, so the
  harder modules inherit working patterns.
- **M7/M8 late** — money, transactions, webhook concurrency. Highest risk, and
  they benefit most from patterns already proven.
- **M12 last** — it depends on every other module's endpoints existing.

### What's in each module

<details>
<summary><b>M1 — Identity & Auth</b></summary>

`/api/auth/*` · `/api/signup` · `/api/verify-email` · `/api/resend-verification`
· `/api/forgot-password` · `/api/reset-password` · `/api/me` · `/api/config`
· `/api/users` · `/api/users/[id]`

**Also in this module:** the frontend auth rewrite — `session-client.ts`,
`googleEnabled` on `PublicConfig`, delete `proxy.ts`. And **dual auth** (§5).
</details>

<details>
<summary><b>M3 — Catalog</b></summary>

`/api/products` · `/api/products/[slug]` · `/api/brands` · `/api/caretakers/search`
· `/api/caretakers/[id]` · `/api/vets/search` · `/api/vets/[id]`
· `/api/shelters/search` · `/api/shelters/[id]`
· `/api/users/[id]/{caretaker,vet,shelter}-profile`

**Add cursor pagination here** — caretaker and vet search currently filter in
memory with none. Copy the pattern from `searchProducts`.
</details>

<details>
<summary><b>M7 — Store & orders</b></summary>

`/api/orders/quote` · `/api/orders` · `/api/orders/[id]` · `.../status`
· `.../cancel` · `.../payment/sync` · `/api/ops/orders`
· `/api/cron/advance-orders`

**Fix B-1 here** — `POST /api/orders` has no `ownsPet` check; `quote` does. Do
not carry that bug across.
</details>

---

## 3. Cutting over one module

Same six steps every time. One module = one branch = one PR.

```
┌─ 1. BUILD ────────────────────────────────────────────┐
│  Write the .NET module + its tests.                   │
│  Nothing is live. Old backend still serving.          │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ 2. TEST ─────────────────────────────────────────────┐
│  dotnet test                                          │
│  Old and new both pass their own suites.              │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ 3. SWITCH ───────────────────────────────────────────┐
│  Add the paths to next.config.ts rewrites.            │
│  Traffic now goes to .NET. THIS is the cutover.       │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ 4. VERIFY ───────────────────────────────────────────┐
│  npm run e2e  +  click through the affected pages.    │
│  Broken? Delete the rewrite line. Instantly back.     │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ 5. SOAK ─────────────────────────────────────────────┐
│  Leave it a few days. Watch logs.                     │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ 6. DELETE ───────────────────────────────────────────┐
│  Delete that module's app/api/**/route.ts files.      │
│  Leave lib/server/*.ts alone for now — see §4.        │
└───────────────────────────────────────────────────────┘
```

**Step 3, concretely:**

```ts
// next.config.ts
async rewrites() {
  return {
    beforeFiles: [                                    // beforeFiles is REQUIRED
      // M3 — cut over 2026-03-14
      { source: "/api/products/:path*", destination: "http://localhost:5001/api/v1/products/:path*" },
      { source: "/api/brands",          destination: "http://localhost:5001/api/v1/brands" },
      // M4 — cut over 2026-03-28
      { source: "/api/pets/:path*",     destination: "http://localhost:5001/api/v1/pets/:path*" },
    ],
  };
}
```

`beforeFiles` matters. The default (`afterFiles`) only runs when no file route
matched — so `app/api/products/route.ts` would win and .NET would never be
reached.

**Rollback is one line.** That is the whole safety story: you are never more
than a deleted line away from the working old backend.

---

## 4. Removing the old backend

### 4.1 Two different things, deleted at different times

| What | When | Why |
|---|---|---|
| **`app/api/<module>/**/route.ts`** | Immediately at step 6 | Nothing imports these. The rewrite already bypasses them. Safe. |
| **`lib/server/<module>.ts`** | **Only after M12** | The assistant's tools still `import` these. Deleting early breaks the chat. |

**This trips people up.** `lib/server/orders.ts` is not only used by
`app/api/orders/route.ts` — it is also imported by
`lib/server/assistant/tools/reads.ts`. Delete the route handler and the file
stays alive, serving the assistant, until M12 re-points those tools at the .NET
API.

So: **route handlers go per module; `lib/server/` goes in one final sweep.**
Dead code sitting in a folder for a few months is harmless. A broken assistant
is not.

### 4.2 The final cleanup (after M12)

```bash
git rm -r app/api                    # except app/api/assistant/
git rm -r lib/server                 # except lib/server/assistant/
git rm -r prisma
git rm auth.ts auth.config.ts proxy.ts types/next-auth.d.ts
npm uninstall next-auth @prisma/client prisma bcryptjs stripe
```

Keep: `lib/server/assistant/*`, `app/api/assistant/*`, and `zod` if the frontend
uses the schemas for form validation.

### 4.3 What the repo looks like at the end

```
petcare-app/                    ← frontend only, plus one endpoint
├── app/            44 pages, unchanged
│   └── api/assistant/          the one surviving route handler
├── components/     75 components, unchanged
├── lib/
│   ├── api/                    unchanged — now points at .NET
│   ├── store/  content/  media/
│   └── server/assistant/       the agent
└── types/

leash-api/                      ← the .NET solution
├── src/Leash.Api/
├── src/Leash.Database/         db/scripts/*.sql
└── tests/

leash-mobile/                   ← React Native (§5)
```

### 4.4 One rule for later

Once you have more than one server, never rename or drop a column in a single
deploy. Spread it over three:

| Deploy | Database | Code |
|---|---|---|
| 1 | Add new column, backfill | Writes both, reads old |
| 2 | — | Reads new, writes both |
| 3 | Drop old column | Reads/writes new only |

---

## 5. The React Native app

### 5.1 When it can start

**After M7.** At that point auth, pets, search, bookings, appointments and the
store all exist in .NET — the whole customer journey. Mobile development runs in
parallel with M8–M12.

Starting earlier means building against endpoints that are still moving.

### 5.2 Four things to build into the API *now*, not later

These are cheap in M1 and painful to retrofit. **Do not skip them because mobile
feels far away.**

| | What | Where | Days |
|---|---|---|---:|
| **1** | **Dual auth.** Cookie for web, rotating JWT access+refresh pair for mobile. Same login endpoint, chosen by client header. ASP.NET does this with a policy scheme selector. | M1 | 3–4 |
| **2** | **`/api/v1/` prefix** on every route from the first endpoint. You cannot force-update an app store binary — you *will* serve old clients. | M0 | 0.5 |
| **3** | **Cursor pagination** on every list endpoint. Fine to have none on a desktop grid; not fine for mobile infinite scroll. | M3 | 2–3 |
| **4** | **Notification channels** (in-app / email / **push**) behind `notify()`, even with push unimplemented. One function to extend later instead of every call site. | M9 | 1–2 |

Retrofitting dual auth after the web app ships means reopening every auth path.
Do it once, in M1.

### 5.3 Shared code

`lib/api/`, `types/index.ts`, `lib/pricing.ts`, `lib/delivery.ts`, `lib/geo.ts`
are **already plain portable TypeScript** — I checked; the only Next.js coupling
in the whole shared layer is two `process.env` reads in `_client.ts`.

When mobile starts, lift them out:

```
packages/shared/
├── types/          ← types/index.ts
├── api/            ← lib/api/*  (base URL becomes a parameter)
└── logic/          ← pricing, delivery, geo, booking-priority
```

Both web and mobile import it. **Components share nothing** — React Native uses
`View`/`Text`, not `div`/`span` — so don't plan for that.

### 5.4 Scope and effort

A first version is owner-facing only: sign in, pets, search caretakers/vets,
book, appointments, health record, store + orders, notifications. Leave the
caretaker, vet, shelter and admin surfaces on the web.

**Rough: 60–90 days for a first release.** Wide error bars — that is a separate
project, not detailed here. Push notifications, app store review and device
testing are all in there and all take longer than expected.

---

## 6. Timeline

**One developer, sequential:**

```
Month 1      M0, M1              foundation + auth
Month 2      M2, M3              access predicates + catalog
Month 3      M4, M5              pets/records + bookings
Month 4      M6, M7              appointments + store        ← mobile can start
Month 5      M8, M9              payments + notifications
Month 6      M10, M11, M12       admin + adoption + assistant
```

≈ **6 months** to a fully .NET backend.

**Two developers:**

```
Dev A   M0 ─ M1 ─ M2 ─┬─ M4 ─ M5 ─ M7 ─ M8 ─ M11
                      │
Dev B   (joins at M2) └─ M3 ─ M6 ─ M9 ─ M10 ─ M12
```

≈ **4 months.** M0–M2 cannot be parallelised; everything after can.

**With mobile as a third stream:** starts month 4, lands ~4 months later.

---

## 7. Start here

1. Install PostgreSQL 17 and Node 20+ (neither is on this machine).
2. `createdb petapp_dev` / `petapp_test`.
3. Generate `db/scripts/001_baseline.sql` from Prisma. Split the seed dump into
   reference vs demo.
4. Scaffold the .NET solution. Wire the migrator, `Results.cs`, the validation
   filter.
5. **Port `GET /api/brands`.** No auth, no joins, trivial SQL. Add the rewrite,
   and confirm the store page renders brand filters from .NET **with no frontend
   change at all**.
6. Then M1.

Step 5 is the proof. If the React app cannot tell the difference, everything
after it is transcription with a safety net — and you will have measured the
real pace before committing months.
