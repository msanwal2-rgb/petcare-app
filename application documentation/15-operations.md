# 15. Running and operating the application

## 15.1 Local setup, from a clean clone

```bash
git clone <repo> && cd "PET APPLICATION"
npm install                     # postinstall runs `prisma generate` — required
cp .env.local.example .env.local
# fill in POSTGRES_PRISMA_URL, POSTGRES_URL_NON_POOLING, AUTH_SECRET at minimum
npm run db:migrate              # migrate deploy
npm run db:seed
npm run dev                     # http://localhost:3000
```

Sign in with any seeded email and the demo password (the README names the
one-tap demo accounts). Staff accounts use `STAFF_PASSWORD`, which is
deliberately not published.

**Node:** the dev machine runs 20.18, which is what pins Prisma to 6.x and `ai`
to v6. Node ≥ 22 lifts both.

## 15.2 Every script

| Command | Does |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` / `npm start` | production build / serve — **use these for anything auth- or animation-related** |
| `npm run lint` / `npm run typecheck` | eslint / `tsc --noEmit` |
| `npm test` | vitest against the `test` schema — ⚠️ one at a time, ~40 min |
| `npm run db:migrate` | `migrate deploy` |
| `npm run db:migrate:dev` | dev migration |
| `npm run db:seed` | full idempotent reseed |
| `npm run db:studio` | Prisma Studio |
| `npm run db:generate` | regenerate the client |
| `npm run e2e` / `e2e:sweep` | browser suites — need a production build and system Chrome |
| `npm run kb:ingest` | embed `lib/content/*` into the assistant corpus |
| `npm run art:generate` | regenerate the 25 deterministic product SVGs |

⚠️ Every `db:*`, `test` and `kb:ingest` script is wrapped in
`dotenv -e .env.local`. **They fail without that file** and do not fall back to
`.env`.

## 15.3 Migrations

```bash
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel   prisma/schema.prisma \
  --script > prisma/migrations/000000000000NN_name/migration.sql
npm run db:migrate
```

The `diff` route avoids Neon's shadow-database problem.

⚠️ **The diff will try to drop `knowledge_chunks_embedding_idx` every single
time.** It is a hand-written pgvector HNSW index Prisma cannot represent. Delete
that line from the generated SQL before applying. Every migration from 07 onward
carries this warning in its header.

## 15.4 Deployment

Vercel, **auto-deploying from `main`**. There is no CI gate (§12.5) — a push
deploys whether or not tests pass.

```bash
gh auth switch --user msanwal2-rgb    # ⚠️ see below
git push origin main                   # auto-deploys
# or
vercel --prod --yes
```

⚠️ **Two GitHub accounts exist in `gh auth`.** The repository belongs to
`msanwal2-rgb`, and a stale active account fails with a misleading
"Repository not found". Switch first.

`.vercel/` is a gitignored local link artifact; a new machine recreates it with
`vercel link`.

**After deploying, verify the new build is actually live** before testing — a
stale `npm start` process serving an old build has caused false 404s locally,
and Vercel's rollout takes a moment. Poll a route that only exists in the new
build.

## 15.5 The cron job

`vercel.json` schedules `GET /api/cron/advance-orders` at `0 3 * * *` —
**once daily, because the Vercel Hobby plan permits exactly one firing a day.**
That constraint shaped the design: `advanceDueOrders` computes each order's
stage from *elapsed time* rather than stepping one status per run, so a daily
cron is survivable and the call is idempotent.

The handler requires `Authorization: Bearer $CRON_SECRET`, compared with
`timingSafeEqual`, and **fails closed if `CRON_SECRET` is unset**. Per run it:

- advances due orders through the fulfilment schedule,
- sweeps abandoned checkouts,
- purges old rate-limit rows,
- purges old `WebhookEvent` rows — **which hold customer emails and card last
  fours**, so this purge is a privacy measure, not housekeeping.

## 15.6 Operating the live app

**Admin console** — `/dashboard/admin`, gated by staff role:

| Page | Role | Does |
|---|---|---|
| `/admin` | support | platform stats |
| `/admin/users` | support / **admin** to delete | search, suspend, adjust roles |
| `/admin/professionals` | support | verify caretaker, vet and shelter licences |
| `/admin/payments` | finance | the ledger; issue refunds |
| `/admin/subscriptions` | finance | memberships |
| `/admin/settings` | admin | `SystemSetting` rows, incl. maintenance mode |
| `/admin/audit` | admin | every admin action, via `recordAdminAction()` |

**Maintenance mode** is a `SystemSetting` row; `MaintenanceBanner` renders under
the header.

**Suspending an account** takes effect on the *next request*: `requireUser()`
refuses any account whose `status` is not `active`, and bumping
`sessionsValidFrom` invalidates every live JWT.

**Ops fulfilment** — `/dashboard/orders`. Note there is deliberately no "Mark
paid".

## 15.7 Runbook: things that will go wrong

| Symptom | Cause | Fix |
|---|---|---|
| Sign in bounces straight back to `/login` | the App Router cached a `proxy.ts` redirect | use `navigateAfterAuth`; reproduce only on a production build |
| A page section is blank but its data loaded | a stagger container stuck at `opacity: 0` | persistent `animate` from `useInView`, never `whileInView`+`once`; `e2e:sweep` [C] catches it |
| Local routes 404 after a change | a stale `npm start` serving an old build | kill and rebuild |
| `type "vector" does not exist` on `db push` | schema-engine `search_path` | the column must be `public.vector(1536)` |
| Tests corrupt each other | two `npm test` runs, or `fileParallelism` on, or a table missing from `SEED_TABLES` | one run at a time; keep the list current |
| A migration wants to drop an index | the pgvector HNSW index | delete that line from the SQL |
| "Repository not found" on push | wrong `gh` account | `gh auth switch --user msanwal2-rgb` |
| Emails not arriving in production | no `RESEND_API_KEY`, or the fire-and-forget teardown (B-5) | set the key; consider `waitUntil` |
| Membership checkout returns 503 | no Stripe key — **correct behaviour** | provision Stripe |
| Assistant returns 503 | no model credential, or `ASSISTANT_ENABLED=false` | set a key |
| Seeded "upcoming" bookings are in the past | seed staleness (§5.6) | reseed, or make those dates relative |
| E2E leaves junk orders | the suites place real orders | `npm run db:seed` afterwards |
