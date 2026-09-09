# 17. Risks, assumptions and unknowns

Section 13 lists what is broken. This one lists what could break, and what this
documentation does **not** know.

## 17.1 Structural risks

### R-1 — No CI, and deploys are automatic

There is no `.github/` directory. `lint`, `typecheck`, `test` and the browser
suites are all manual, and a push to `main` deploys to production regardless.
The only thing between a broken commit and live users is whoever pushed it
remembering to run four commands that take forty minutes.

*Mitigation:* a workflow running `typecheck` + `lint` costs nothing. `test`
needs a database, which is why it does not exist yet.

### R-2 — All photography is hotlinked from Unsplash

Every pet, caretaker, vet, shelter and hero image loads from
`images.unsplash.com`, allowed by a single `remotePatterns` entry in
`next.config.ts`. If Unsplash changes a URL, rate-limits the domain, or that one
config line is removed, the app fills with broken images.

`scripts/generate-product-art.ts` exists *precisely* because a 404'd hotlink
breaks a storefront — it makes the 25 product images deterministic local SVGs.
That reasoning was never extended to the rest of the imagery.

### R-3 — Test runtime discourages testing

~40 minutes, almost entirely network round trips to Neon, one run at a time. A
suite that slow gets skipped. A local Postgres in CI, or transaction-rollback
isolation instead of snapshot restore, would fix it.

### R-4 — `useAsync` has no cache, dedupe or abort

44 files depend on it, and `fn` is excluded from its dependency array with the
lint rule disabled. A closure capturing something not in `deps` reads stale data
silently. Every mount refetches; nothing is shared between components on a page.

### R-5 — Seed staleness

Bookings, appointments and medical records are pinned to a fixed
`TODAY = 2026-07-08`, so seeded "upcoming" items drift into the past and demos
degrade over time. Fixable the same way orders were made relative, but many
tests assert on those ids and statuses.

### R-6 — Prisma transaction timeout

`createOrder`'s transaction was observed at **5261 ms** against Prisma's 5 s
default. It passes in isolation, so it presents as a flaky test — but the same
latency in production is a failed checkout.

### R-7 — Version pins are load-bearing and interlocked

`prisma` is held at 6.x and `ai` at v6 by the *same* cause: the dev machine runs
Node 20.18. A routine `npm update` that lifts either will break the build in a
way whose reason is not visible in the diff. This is documented in
`package.json` and in §10.4 and nowhere else.

### R-8 — `Pet.owner` cascade

`onDelete: Cascade` means a hard delete of a shelter user takes its unadopted
animals with it. Not reachable today (admin deletion is soft), so this is a trap
waiting for someone who adds a real delete.

## 17.2 Assumptions this documentation makes

Marked *Inferred* — reasoned from the code, not stated by it:

- **The Vercel Hobby plan is still in use.** The one-cron-per-day limit shaped
  `advanceDueOrders` to be elapsed-time-based rather than step-per-run. On a
  paid plan a more frequent cron would work, and the design would still be
  correct.
- **The single Neon database serves production, `test` and `test_snapshot`.**
  That is what `testdb.ts` connects to and what the "one `npm test` at a time"
  rule implies.
- **The assistant currently runs on OpenRouter with a free model.** The
  precedence order and the pinned `@ai-sdk/openai-compatible` provider both
  point that way, but which key is actually set in production cannot be read
  from the repository.
- **`EMAIL_DEV_MODE` is off in production** — the code forces it off regardless
  of the value, so this is safe to assume.

## 17.3 Unknowns — things that were checked and could not be determined

- **Whether `NOT: { refillsLeft: 0 }` matches NULL rows.** Prisma's handling of
  `NOT` on a nullable column decides whether a prescription with blank refills
  authorises anything. No seeded prescription has `refillsLeft: null` (all
  null-refill seed records are other types), so the path has never executed.
  This is a *correctness* unknown sitting on the money path.
- **Whether any production data exists.** The live deployment is seeded demo
  data as far as this repository shows; whether real customers have used it is
  not knowable from the code.
- **Whether the Stripe, Google and Resend credentials have since been
  provisioned.** The repository can only show that the code paths exist and fail
  closed without them.
- **Actual production traffic, error rates and cost.** There is no analytics,
  APM or error-tracking integration in the codebase, so nothing about live
  behaviour is observable from here. `AssistantMessage`'s token columns, which
  would have given spend visibility, are always 0 (§13.4.4).
- **Whether the git history ever contained secrets.** The current tree is clean
  across all 421 tracked files. History was not audited. The staff-credential
  incident (§11.1) means it is worth doing before the repository is ever made
  public.

## 17.4 The gaps that matter most, in one list

If you fix five things, fix these:

1. **`ownsPet` on `POST /api/orders`** (§11.7 S-1) — a real authorization hole,
   three lines, no test covers it.
2. **CI** (R-1) — nothing currently prevents a broken deploy.
3. **Escape the notification email HTML** (B-2).
4. **Decide about refills** (13.4.1) — the UI states a fact the system does not
   enforce, on the prescription path.
5. **Observability** — no error tracking, no metrics, no working token
   accounting. Today nobody would know if any of the above were being exploited.
