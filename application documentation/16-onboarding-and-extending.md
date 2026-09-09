# 16. Onboarding, and how to extend the application

## 16.1 Your first day

**Read, in this order:** §1 (architecture), §2 (what it does), then §8.1 — the
injectable-`db` convention, because it explains the shape of every server file.

**Then run it:**

```bash
npm install && cp .env.local.example .env.local   # fill in the three required vars
npm run db:migrate && npm run db:seed
npm run build && npm start                        # not `dev` — see below
```

**Then trace one flow yourself.** The recommended one is a caretaker accepting a
booking, traced in §1: page → `lib/api/bookings.ts` → `PATCH
/api/bookings/[id]/status` → `requireUser` → `updateBookingStatus` →
transition table → `notify` → serializer → back. Every subsystem is that same
shape.

**Three things to know before you touch anything:**

1. **Every page is a client component.** No server components fetch data, no
   server actions exist. Everything goes through `/api/*`.
2. **Every timestamp is an ISO string, not a `DateTime`.** They sort correctly
   as strings. Do not introduce a `DateTime` column.
3. **Reproduce auth and animation bugs on `npm run build && npm start`.**
   `next dev` hides the two worst classes of bug in this codebase (§7.4).

## 16.2 Where new code goes

| Adding | Goes in | Also update |
|---|---|---|
| A permission rule | `lib/server/access.ts` | `tests/access.test.ts` |
| Business logic | `lib/server/<domain>.ts`, trailing `db` param, returns a result union | a test file |
| An endpoint | `app/api/**/route.ts` — auth, parse, map codes to statuses, nothing else | `API_CONTRACTS.md` |
| A request body shape | `lib/validation/schemas.ts` | — |
| A response shape | `types/index.ts` + `lib/server/serialize.ts` | — |
| A database column | `prisma/schema.prisma` + a migration | ⚠️ `SEED_TABLES` if it's a new table |
| A constant both sides need | a dependency-free module in `lib/` | — |
| A user-visible label | the label map in `lib/utils.ts` | nothing — options derive from it |
| A shared UI piece | `components/ui/` | — |
| A new page | `app/<route>/page.tsx` | `GUARDED` or `CLIENT_GATED` in `sweep.mjs` |

## 16.3 Worked example — adding a feature end to end

Suppose you are adding "shelter reviews".

1. **Schema** — `Review.kind` gains `"adoption"`. No migration: `kind` is a
   `String`. Add `rating`/`reviewCount` to `ShelterProfile` — *and only now*,
   because a column nothing writes is the `backgroundCheckStatus` mistake.
2. **Validation** — extend `reviewKind` in `lib/validation/schemas.ts`.
3. **Types** — extend the `ReviewKind` union in `types/index.ts`. TypeScript now
   fails everywhere the kind is switched on, which is the point.
4. **Eligibility** — add an arm to `permittedPairs` in `lib/server/reviews.ts`:
   which application status permits a review, and in which direction.
5. **Reputation** — `lib/server/reputation.ts` already forks on kind in five
   named places and `loadProfile` currently short-circuits `"shelter"` to
   `null`. Give it a real arm.
6. **Route** — a third POST handler, or better, parameterise the two identical
   ones (§13.6).
7. **Error mapping** — `review-http.ts`'s `switch` is exhaustive with no
   `default`, so a new code is a compile error. Good.
8. **Tests** — `tests/reviews.test.ts` is the template: eligible, ineligible,
   not-a-participant, wrong-recipient, duplicate, and "does not move the rating
   when the review was refused".
9. **UI** — `LeaveReview` is presentational and takes `onSubmit`; `ReviewCard`
   takes an optional `author` (⚠️ pass it — see B-9).
10. **Docs** — `API_CONTRACTS.md`, and §13 here if anything ships partial.

## 16.4 Patterns to copy

**A result union, not an exception:**

```ts
type Result =
  | { ok: true; thing: Thing }
  | { ok: false; code: "not_found" | "not_yours" | "too_late" };
```

**A conditional `updateMany` for every race:**

```ts
const moved = await tx.thing.updateMany({ where: { id, precondition }, data });
if (moved.count !== 1) { raced = true; return; }
```

**A status machine as four tables:** legal transitions, permitted actors, a
same-status early return, and a `Partial<Record<Status, NotifyInput>>` so the
statuses nobody wants to hear about simply have no entry.

**Refusal as data, not a thrown error** (the assistant's `guards.ts`), and
**identical refusal text** for "exists but not yours" and "does not exist".

## 16.5 Anti-patterns — do not do these here

| Don't | Because |
|---|---|
| Add a `DateTime` column | timestamps sort as strings everywhere else |
| Add a Prisma enum | statuses are Zod-validated strings by convention |
| Add a `userId`/`ownerId` field to a request schema | identity comes from the session; a test exists to fail this for assistant tools |
| Write a domain function without a trailing `db` param | it becomes untestable |
| Import `next/server` into `lib/server/access.ts` | it puts the security predicates beyond the unit suite |
| Return a `Response` from a domain function | routes own HTTP |
| `router.push` across an auth change | the cached-redirect trap (§7.4) |
| `whileInView` + `once` on a stagger container | late-mounting children stay invisible |
| Unify cents and Float USD | the split is documented as load-bearing |
| Accept the `knowledge_chunks_embedding_idx` drop in a migration | it deletes the vector index |
| Turn `fileParallelism` on | tests share one database |
| Use `<AuthRequired/>` in a global widget | it emits the string `sweep.mjs` block [B] greps for |
| Publish staff credentials in the README | it has happened once already |

## 16.6 First tasks, in order of value

1. **Fix S-1** — add the three-line `ownsPet` check to `POST /api/orders`, plus
   the test that should have caught it. Highest value per line in the repo.
2. **Escape the notification email HTML** (B-2).
3. **Add CI** — a GitHub Actions workflow running `typecheck` and `lint` on
   every PR. Fix `sweep.mjs`'s missing `process.exit` first (B-11) so it can
   gate.
4. **Fix assistant rehydration** (B-3) and replay the stored transcript
   server-side (B-4).
5. **Decide about refills** (13.4.1) — either decrement them on purchase or stop
   displaying a count that never moves.
6. **Re-run `npm run kb:ingest`** so the corpus stops describing a store with no
   membership.
7. **Upgrade Node to ≥ 22**, which lifts the Prisma and `ai` pins together.
