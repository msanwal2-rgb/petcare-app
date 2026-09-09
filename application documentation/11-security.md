# 11. Security

## 11.1 Secrets — the finding

**No secret values are reproduced anywhere in this documentation.**

A scan of all **421 tracked files** for Stripe (`sk_live`, `sk_test_…`), Google
(`AIza…`) and generic long-key patterns returned **no matches**. The only
tracked environment file is `.env.local.example`, which contains names and
placeholders. `.gitignore` covers `.env*` with an explicit
`!.env.local.example` exception.

One related history item, already remediated: seeded **staff account emails were
published in the README** alongside a shared demo password. Staff emails were
removed from the README and staff accounts moved to a separate `STAFF_PASSWORD`
which is not published. If this repository is ever made public, audit the git
history for that window before doing so.

## 11.2 The trust boundary, stated once

**Nothing the browser sends is trusted for identity, price, or permission.**

| The client sends | The server uses |
|---|---|
| a cart | its own re-priced quote from the live catalog |
| an address form | the address, but the `userId` from the session |
| `petId` for a prescription | ⚠️ see the gap in §11.7 |
| a role toggle | `staffRoles` read from the database |
| a session store value | the Auth.js JWT, re-checked against `User.status` |

`useSession` in `lib/store/session.ts` is a render convenience with an explicit
header saying a spoofed value grants nothing.

## 11.3 Authentication

Auth.js v5 beta, **JWT sessions, no database adapter**, split across an
edge-safe `auth.config.ts` (no Prisma, no bcrypt) and a Node `auth.ts`.

- Passwords: **bcryptjs**, hashed in `lib/server/auth-logic.ts`.
- **Revocation without a session table:** `requireUser()` compares the token's
  `iat` against `User.sessionsValidFrom` and rejects anything older, and refuses
  any account whose `status` is not `active`. Suspending an account therefore
  takes effect on the next request. See §8.4.
- **Sign-in does not distinguish "no such user" from "wrong password"** and only
  surfaces `RateLimited` separately — the address list must not be enumerable.
- **Google account linking** is by verified email, and only onto an account
  whose email is already verified.
- Password reset and email verification use single-use `VerificationToken` rows.

## 11.4 Authorization

Centralised in `lib/server/access.ts` (§8.3) — pure, db-injectable, and unit
tested, which is exactly why it was split out of `session.ts`.

Three properties worth stating:

- **Roles are self-declared; capabilities are not.** Holding the `vet` role
  grants nothing. A `VetProfile` plus a qualifying appointment does.
- **Staff roles are a separate array** never writable by the user, and `admin`
  implies all others.
- **`Pet.ownedSince` severs stale grants atomically.** One `UPDATE` on ownership
  revokes every caretaker and vet who was granted access under the previous
  owner. Severing is a property of the write, not an action that could partially
  fail.

## 11.5 Input validation

Every request body goes through `parseBody(request, schema)` with a Zod schema
from `lib/validation/schemas.ts`. Two hardening patterns are already applied and
should be copied:

**`.strict()` on `petInputSchema`** — an unexpected key is a loud **400**, not a
silent strip. That is what turned a stale `ownerId` in a client payload from an
invisible ownership rewrite into an error.

**Removing fields rather than validating them.** `updateUserSchema` no longer
accepts `email` (changing the recovery identifier needs re-verification, and
there is no such flow) or `verified`. The corresponding test asserts the
stronger contract: the field *is not accepted at all*.

## 11.6 What is defended, and how

| Attack | Defence | Where |
|---|---|---|
| Price tampering | server re-prices every line; the client snapshot is display-only | `quoteCart` |
| Buying without paying | order rows exist before money moves; status advances only via the ledger | `orders.ts`, `payments/ledger.ts` |
| Replayed / forged webhooks | `stripe.webhooks.constructEvent` signature check + a claim protocol (new/duplicate/retry/in_flight/exhausted) | `webhooks/stripe.ts` |
| Enumeration | not-yours reads as not-found; identical refusal strings for "exists but not yours" and "does not exist" | assistant `guards.ts`, conversations |
| Open redirect after login | `safeInternalPath` on every `callbackUrl` | `session-client.ts` |
| Host-header injection into email links | `origin.ts` uses configured values, not the request header | `origin.ts` |
| Cron abuse | Bearer `CRON_SECRET` compared with `timingSafeEqual`, **fails closed if unset** | `cron/advance-orders` |
| Brute force | Postgres sliding-window rate limits on sign-in and the assistant | `rate-limit.ts` |
| Assistant acting on the customer's behalf | no tool takes a user id; no tool creates a commitment | `assistant/tools/index.ts` |
| Privilege escalation via the API | staff roles read from the DB per request; every admin mutation audited | `access.ts`, `audit.ts` |
| Ownership hijack | `ownerId` removed from the pet schemas; ownership moves only through `adoptions/transfer.ts` | §14 |

Cards never touch a Leash server — Stripe Elements confirms client-side and the
server learns the outcome from a webhook.

## 11.7 Open security findings

Ranked. All *Confirmed* by reading the code during this audit.

### S-1 (High) — `POST /api/orders` does not check pet ownership

`POST /api/orders/quote` does:

```ts
// Quoting against someone else's pet would leak which prescriptions it has.
if (parsed.data.petId && !(await ownsPet(auth.uid, parsed.data.petId))) {
  return forbidden();
}
```

`POST /api/orders` does not. It parses `createOrderSchema` — which carries an
optional `petId` — and calls `createOrder(auth.uid, parsed.data)`, which passes
that `petId` straight into `quoteCart` and therefore into
`authorizedProductSlugs`.

**Consequences.** Any signed-in user can (a) purchase prescription-only products
against a stranger's pet's prescription, and (b) use the 201-vs-409 difference
as an oracle for which prescriptions a stranger's pet holds — precisely the leak
the quote route's comment exists to prevent.

**Fix:** the same three lines, in `app/api/orders/route.ts`. There is no test
covering it, which is why it survived.

### S-2 (Medium) — HTML injection into notification email

`emailIfPossible` in `lib/server/notifications.ts` interpolates `input.title`,
`input.body` and `user.name` directly into an HTML string with no escaping. At
least one body is user-controlled: `appointments.ts` passes `a.reason`, a free
text field (`reason: z.string().min(1)`); adoption notices interpolate
`application.petName`. A pet named `<img src=x onerror=…>` ships into the
recipient's inbox. Escape, or move to a template.

### S-3 (Medium) — the assistant's model context is client-supplied

The chat route persists only the newest turn — the stated reason being that
trusting the client's history would let it rewrite what it had been told — but
passes that same untrusted `messages` array straight to the model. Forged prior
assistant turns are possible. **No data leak**: every guard re-checks the
database and no tool takes a user id. See §9.10 A-2.

### S-4 (Low) — unsalted assistant client key

With neither `ASSISTANT_CLIENT_SALT` nor `AUTH_SECRET` set, the anonymous client
key is an unsalted SHA-256 of IP + user agent — the rainbow-table case the salt
exists to prevent. Dev-only in practice, since `AUTH_SECRET` is required.

### S-5 (Low) — fire-and-forget email on serverless

`void emailIfPossible(...)` is not awaited. On Vercel the invocation can be
frozen or torn down after the response returns, and the mail never goes out —
silently, because the failure path is a `console.error` in a dead process. Await
it, or hand it to `waitUntil`.

### S-6 (Latent) — `Pet.owner` is `onDelete: Cascade`

Hard-deleting a shelter would take its unadopted animals. Not currently
reachable: admin deletion is a status change, not a row delete.

## 11.8 Not defended, and known

- **No CSRF token beyond Auth.js's own.** Same-origin `fetch` with a session
  cookie; there are no cross-origin form posts.
- **No CSP, HSTS or security headers** are configured in `next.config.ts`.
- **No dependency scanning, no CI** (§12.5).
- **`Review.rating` accepts `0` and non-integers** (`z.number().min(0).max(5)`).
  The UI enforces 1–5 integers; the API does not, and a scripted `0.1`
  permanently drags a running average that has no inverse.
