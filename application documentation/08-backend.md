# 8. The backend

**66 files under `lib/server/`.** No server actions, no server components doing
data work — every piece of server logic is reached through a route handler, and
every route handler delegates to this layer.

## 8.1 The one convention that explains the whole layer

Every exported domain function ends with an injectable client:

```ts
export async function createReview(
  subjectId: string,
  kind: ReviewKind,
  input: CreateReviewBody,
  db: PrismaClient = defaultPrisma,
): Promise<CreateReviewResult>
```

**Why:** the unit suite runs against a real Postgres `test` schema and passes in
a client bound to it (§12). Without this argument the domain layer would only be
testable through HTTP.

⚠️ **A new domain function without a trailing `db` parameter is untestable.**
That is the review comment to leave.

The second half of the convention: **domain functions never import
`next/server` and never return a `Response`.** They return a discriminated
union:

```ts
type CreateReviewResult =
  | { ok: true; review: Review }
  | { ok: false; code: "not_found" | "not_completed" | "already_reviewed"
                     | "not_a_participant" | "wrong_recipient" };
```

The route maps codes to statuses. Where two routes map the same union — booking
reviews and appointment reviews — the mapping is factored into
`lib/server/review-http.ts` so it is not written twice. Its `switch` is
exhaustive with no `default`, so **a new code is a compile error**.

## 8.2 Layer map

```
app/api/**/route.ts          auth, parse, HTTP status
   │
   ├── lib/server/session.ts     requireUser / requireStaff / ownsPet
   │      └── lib/server/access.ts   the pure predicates  ← no Auth.js import
   │
   ├── lib/server/<domain>.ts    the work
   │      ├── lib/server/serialize.ts   rows → API types
   │      ├── lib/server/notifications.ts
   │      └── lib/server/audit.ts
   │
   └── lib/server/http.ts        ok / error / parseBody
```

⚠️ **`access.ts` must never import `@/auth`.** It used to be inside
`session.ts`, which dragged `next-auth` → `next/server` into anything touching a
guard and put the app's most security-sensitive predicates beyond the unit
suite. The split is the fix; `session.ts` re-exports for compatibility.

## 8.3 Authorization predicates — `lib/server/access.ts`

| Predicate | Grants |
|---|---|
| `ownsPet(uid, petId)` | `pet.ownerId === uid` |
| `canViewPet(uid, petId)` | owner, **or** a caretaker with a non-declined/cancelled `Booking` containing the pet, **created at or after `pet.ownedSince`** |
| `canAccessPetRecords(uid, petId)` | owner → `{allowed, asVetId: null}`; **or** a vet with such a `VetAppointment`, same `ownedSince` clause → `{allowed, asVetId}` |
| `isBookingParticipant(uid, bookingId)` | owner or the booking's caretaker (via `caretakerProfile.userId`) |
| `staffRoles(uid)` / `hasStaffRole(uid, role)` | `admin` implies every role |

`canAccessPetRecords` is **write** access, and that is why its `ownedSince`
clause carries the strongest comment in the codebase: a vet who kept it could go
on writing `prescription` records, and an unexpired prescription unlocks Rx
products in the store. Without the clause, adopting an animal would hand every
vet who ever treated it at the shelter a standing line of credit against the
adopter's account.

Note what `ownedSince` does **not** fix: unboundedness *in time*. Under a single
owner, a vet who saw a pet once in 2019 still has write access. A trailing
window is a separate change (see §17).

## 8.4 Session and revocation — `lib/server/session.ts`

`requireUser()` does more than read the JWT. Because Auth.js runs with **JWT
sessions and no database adapter**, a token stays valid until it expires — so
the check happens here:

```ts
if (!account || account.status !== "active")
  return { response: unauthorized("Your account is not active") };

if (account.sessionsValidFrom) {
  const issuedAt = session?.user?.issuedAt;          // token.iat
  if (!issuedAt || issuedAt * 1000 < Date.parse(account.sessionsValidFrom))
    return { response: unauthorized("Please sign in again") };
}
```

Suspending an account or bumping `sessionsValidFrom` therefore invalidates every
live token on the next request, without a session table.

## 8.5 Status machines

Bookings, appointments, orders, adoption applications and adoption listings all
follow the same pattern, and copying it is the right move for anything new:

1. A `Record<Status, Status[]>` of legal transitions.
2. An `ACTOR_ALLOWED` table saying **who** may make each move.
3. A same-status early return (idempotence).
4. A `Partial<Record<Status, NotifyInput>>` table, then
   `const told = TABLE[status]; if (told) await notify(...)`.

Step 4 is what makes "picking and packing happen in a warehouse and nobody wants
a notification about either" an enforceable statement rather than a habit.

## 8.6 Concurrency

There is no advisory locking. Every race is closed with a **conditional
`updateMany` whose `where` clause encodes the precondition**, then a count
check:

```ts
// stock, in orders.ts
const taken = await tx.product.updateMany({
  where: { id, stockQty: { gte: qty } },
  data: { stockQty: { decrement: qty } },
});
if (taken.count !== 1) { raced = true; return; }
```

```ts
// ownership, in adoptions/transfer.ts
const moved = await tx.pet.updateMany({
  where: { id: pet.id, ownerId: shelter.userId },
  data: { ownerId: application.applicantId, ownedSince: now },
});
if (moved.count !== 1) { raced = true; return; }
```

Use this shape. It is the codebase's only concurrency primitive and it is
correct.

⚠️ `createOrder`'s transaction has been observed at **5261 ms** during a full
suite run, against Prisma's default 5 s interactive-transaction timeout. It
passes in isolation. This is not only a test flake — the same latency could bite
in production. Raising the timeout on that one `$transaction` is the fix.

## 8.7 Serialization

`lib/server/serialize.ts` is the single boundary between Prisma rows and the
types in `types/index.ts`. It reconstructs nested shapes the schema flattens
(`address`, `vetContact`, `homeEnvironment`, `priceRange`), and it is where
`Review.bookingId` becomes `subjectId`.

Reduced serializers exist where an audience should see less:
`toClinicalAppointment` drops `fee`/`baseFee`/`discountPct`/`priority` for
anyone who is not the booker — an adopter needs the clinical history, not what
the shelter paid.

## 8.8 Cross-cutting services

| Module | Contract |
|---|---|
| `notifications.ts` | `notify()` is the **only** writer, and it **never throws** — a failed notification must not fail the status change that caused it. Mirrors to email fire-and-forget. |
| `mailer.ts` | Posts to Resend when `RESEND_API_KEY` is set, otherwise `console.log`s. Its own failures are caught. |
| `audit.ts` | `recordAdminAction()` — every admin mutation. |
| `rate-limit.ts` | Postgres-backed sliding window. No Redis in this stack. |
| `ids.ts` | `genId(prefix)` and **`nowIso()`** — the single timestamp producer. |
| `settings.ts` | `SystemSetting` rows: maintenance mode, feature switches. |
| `origin.ts` | The canonical base URL. ⚠️ Does **not** trust the `Host` header. |
| `seed.ts` | Idempotent full reseed. |

## 8.9 Where new code goes

| You are adding | Put it in |
|---|---|
| A rule about who may do something | `lib/server/access.ts` (+ a test) |
| Business logic | `lib/server/<domain>.ts`, with a trailing `db` param |
| An HTTP endpoint | `app/api/**/route.ts` — auth, parse, map codes; nothing else |
| A response shape | `types/index.ts` + `lib/server/serialize.ts` |
| Request validation | `lib/validation/schemas.ts` |
| A constant both sides need | a dependency-free module in `lib/` |
| A user-visible label | the label map in `lib/utils.ts` |
