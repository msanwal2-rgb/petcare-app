# 12. Testing

**28 unit test files** (Vitest), **two browser suites** (Playwright driving
system Chrome). No CI — see §12.5.

```
npm test              vitest run, against a real Postgres `test` schema
npm run typecheck     tsc --noEmit
npm run lint          eslint
npm run e2e           journeys, ~69 checks
npm run e2e:sweep     every route × every role, ~39 checks
```

## 12.1 The unit suite runs against a real database

Not mocks, not SQLite — the same Neon database, in an isolated `test` schema.
`tests/helpers/testdb.ts` builds a `testPrisma` pointed at it, and because every
domain function takes `db: PrismaClient = defaultPrisma` as its last argument
(§8.1), tests simply pass it in. **No env juggling, no module mocking.**

Resetting between tests goes through a **snapshot**, not a reseed:

> The seeder is ~20 round trips plus a bcrypt hash, and the database is across
> the network — running it before every test dominated the suite's wall-clock.
> Instead the seed runs once in global setup, gets copied into a parallel
> `test_snapshot` schema, and each test restores from that copy in a single
> batched transaction: one round trip, no hashing, same data.

⚠️ **`SEED_TABLES` in `tests/helpers/testdb.ts` must list every seeded table in
FK-safe insert order.** Add a table to the schema and forget this list, and
`resetToSnapshot` silently corrupts the whole suite.

⚠️ **`knowledge_chunks` is deliberately absent from that list.** It is read-only
reference data ingested once in global setup with the offline deterministic
embedder; leaving it out is what keeps it intact across resets.

⚠️ **`fileParallelism: false`** in `vitest.config.mts` — files share one
database. Turning it on produces flaky, unreproducible failures.

⚠️ **One `npm test` at a time.** Two concurrent runs share the `test` schema and
corrupt each other's global setup.

⚠️ **`npm test` requires `.env.local`** — the script is wrapped in
`dotenv -e .env.local` with no fallback to `.env`.

**Runtime is roughly 40 minutes**, almost entirely network round trips to Neon.
A local Postgres, or transaction-rollback isolation instead of snapshot restore,
would cut it sharply.

## 12.2 What is covered

| File | Covers |
|---|---|
| `access.test.ts` | the authorization predicates — the highest-value file here |
| `adoption-transfer.test.ts` | ownership move, severing, the race guard, reversal |
| `orders.test.ts` | pricing, the stock race, the prescription gate, cancellation, refunds |
| `webhooks.test.ts`, `stripe-signature.test.ts` | the claim protocol, signature verification |
| `entitlements.test.ts` | the three Leash Plus benefits |
| `reviews.test.ts`, `reputation.test.ts` | eligibility, one-per-person, the running average |
| `medical-records.test.ts` | who may author what, prescription expiry, slug authorisation |
| `notifications.test.ts` | *what the status machines announce*, and what they don't |
| `assistant-tools.test.ts` | owner / other-user / anonymous for every guarded tool |
| `assistant-prompt.test.ts` | every red flag appears verbatim; an anonymous prompt carries no customer name |
| `assistant-retrieval.test.ts` | deterministic via the hash embedder; gibberish returns `[]` |
| `validation.test.ts` | that removed fields are **not accepted**, not merely stripped |
| plus | `auth`, `admin`, `appointments`, `bookings`, `caretakers`, `email-flows`, `fulfillment`, `messages`, `pets`, `products`, `users`, `vets`, `assistant-conversations`, `assistant-rate-limit` |

Several tests exist specifically to fail if a guarantee is quietly removed —
`assistant-tools.test.ts` walks every tool's schema shape and fails the day
somebody adds a `userId` parameter "to be helpful". Treat those as
specifications, not coverage.

## 12.3 The gap in coverage, stated plainly

**Test posture is inverted from the risk.** Domain functions are well covered.
**Route guards are covered only where the predicate was extracted into
`lib/server/access.ts`.**

Not covered by any test:
- the messages route's participant guard,
- the record-type guard in `POST /api/pets/:id/medical-records`,
- **the missing `ownsPet` on `POST /api/orders`** — which is why S-1 (§11.7)
  survived,
- the assistant chat route itself (readiness, 429, `onFinish`),
- every React component.

## 12.4 Browser suites

Both drive **system Chrome** (`channel: "chrome"`, hence `playwright-core` with
no browser download) and both must run against a **production build**:

```
npm run build && npm start
npm run e2e
npm run e2e -- https://<deployment-url>
npm run db:seed          # afterwards — the suites place real orders and reviews
```

⚠️ `next dev` hides the App Router redirect-caching bug and the opacity bug
these suites exist to catch.

**`scripts/e2e/suite.mjs`** — journeys: demo dashboards, one-tap logins, the
navbar indicator, browse → cart → checkout → tracking, the prescription gate,
vet search and booking, health records, the ops console and its guard, mobile
nav, reduced motion, guarded-route entry, reviews, and an assistant block gated
behind `ASSISTANT_E2E=1`. Exits non-zero on failure.

**`scripts/e2e/sweep.mjs`** — coverage in four blocks: [A] every guarded route
bounces to `/login` and returns *to that route* after login; [B] every
client-gated page does the same via `<AuthRequired>`; [C] every page loads clean
for every role — >300 chars of text, zero console errors, no ≥400 responses, and
**no element under `<main>` with `opacity < 0.05` and >12 chars of text**; [D]
every distinct internal link resolves.

⚠️ **`sweep.mjs` never calls `process.exit`, so it always exits 0 regardless of
failures.** It can never gate a build. If you add CI, fix this first.

⚠️ Do not use `<AuthRequired/>` in a global widget — it renders the literal
string "not logged in", which sweep block [B] greps for to detect a page-level
gate. A global component emitting it would make [B] pass vacuously everywhere.

## 12.5 There is no CI

**There is no `.github/` directory at all** — no workflows, no PR checks,
nothing runs on push. `lint`, `typecheck`, `test`, `e2e` are all manual, and
deploys to Vercel happen on push to `main` regardless of whether any of them
passed.

This is the single biggest process gap in the project. A workflow running
`typecheck` + `lint` on every PR would cost nothing; running `test` needs a
database, which is the reason it does not exist yet.
