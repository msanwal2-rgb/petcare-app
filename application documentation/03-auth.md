# 3. Authentication and Authorization

The security-critical part of the application. Read this before changing
anything under `lib/server/access.ts`, `lib/server/session.ts`, `auth.ts` or
`auth.config.ts`.

## 3.1 The shape of it

Auth.js v5 (`next-auth@5.0.0-beta.32`) with **JWT sessions and no database
adapter**. The application owns its own `users` table; Auth.js only issues and
verifies the cookie.

That one decision explains most of what follows. With no adapter there is **no
session table**, so there is nothing to delete when you want to revoke a
session — which is why revocation is enforced where it is (§3.5).

### Split configuration, and why

| File | Runtime | Contains |
|---|---|---|
| `auth.config.ts` | Edge-safe | Callbacks, session strategy, pages. **No database, no bcrypt imports.** |
| `auth.ts` | Node | Providers (Credentials, Google), the `signIn` callback |
| `proxy.ts` | Edge | Imports only `auth.config.ts` |

*Confirmed:* `auth.config.ts:1-5` states the constraint explicitly. `proxy.ts`
runs on the Edge runtime and loads the config; importing Prisma into
`auth.config.ts` would break the proxy. This is the reason membership and staff
roles are **not** JWT claims — see §3.6.

## 3.2 What is in the token and the session

```ts
// auth.config.ts
jwt({ token, user })    { if (user?.id) token.uid = user.id; return token; }
session({ session, token }) {
  if (token.uid && session.user) session.user.id = token.uid;
  if (typeof token.iat === "number" && session.user) session.user.issuedAt = token.iat;
  return session;
}
```

The token carries **`uid` and nothing else**. The session additionally exposes
`issuedAt`, copied from the JWT's own `iat` claim — that is what makes
revocation possible without a database read inside an edge-safe file.

Types are augmented in `types/next-auth.d.ts`.

Cookie settings are **Auth.js defaults**: `authjs.session-token`, `httpOnly`,
`SameSite=Lax`, `Secure` in production, 30-day expiry. There is no custom
`cookies` block. `trustHost: true` is set unconditionally — see §3.9.

## 3.3 Registration

`POST /api/signup` → `lib/server/auth-logic.ts` → `registerUser()`

1. Rate limited per client: `RATE_LIMITS.signup` — 5/hour.
2. Refused if the `signupsOpen` system setting is false (503).
3. `signupSchema` — password `min(8)`.
4. `registerUser()` lowercases and trims the email, rejects a duplicate with
   `EmailTakenError` → 409, hashes with bcrypt (10 rounds), creates the row with
   `roles: []` and `verified: false`.
5. Fires a verification email through `requestEmailVerification()`,
   **best-effort** — a mail failure does not fail the signup.

New accounts have no roles, so `/dashboard` shows them a "finish setting up"
empty state pointing at `/onboarding`.

## 3.4 Sign-in

### Email and password

`Credentials` provider in `auth.ts`. `authorize()`:

1. Zod-parses the credentials.
2. `consume(RATE_LIMITS.signinEmail, subjectKey(email))` — 8 attempts per
   15 minutes **per address**, hashed so the table never holds addresses.
   Exceeding it throws `TooManyAttempts extends CredentialsSignin` with
   `code = "RateLimited"`, which Auth.js surfaces as `?error=RateLimited`
   without revealing whether the account exists.
3. `verifyCredentials()` returns `null` for unknown email, no password hash, or
   wrong password — **the caller cannot distinguish these**, deliberately.
4. On success: `clear()` the counter (so an honest user who mistypes twice
   starts fresh) and stamp `lastLoginAt`.

**Confirmed gap:** the per-*client* limit (`RATE_LIMITS.signinClient`, 20 per
15 min) is defined in `lib/server/rate-limit.ts` but **is not currently applied
anywhere**. A provider `authorize()` has no access to request headers, and no
route wraps the credentials callback. A distributed attempt spread across many
addresses is therefore limited only per-address. See
[document 11](./11-security.md), finding S-3.

### Google OAuth

Added **only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are both set**
(`auth.ts:20-22`). The button on `/login` and `/signup` asks `getProviders()`
and hides itself otherwise. Not currently configured in production.

The `signIn` callback runs `linkOrCreateOAuthUser()`:

```
Google sign-in
  → profile.email_verified !== true            → "/login?error=EmailUnverified"
  → googleId already linked                    → sign in
  → email matches an account with NO password  → link it (verified = true)
  → email matches an account WITH a password   → "/login?error=AccountExists"
  → no match                                   → create (roles: [], verified from the claim)
```

**Why refusing matters.** The previous implementation set
`allowDangerousEmailAccountLinking: true` and returned any row matching the
email. That is *account pre-hijacking*: register a password account at
`victim@gmail.com` before they ever visit, and when the real owner signs in with
Google they land inside an account you control, with your password still on it.
The only safe ordering is to sign in with the password you already have and link
Google afterwards from a signed-in context.

`auth.ts` now passes `allowDangerousEmailAccountLinking: false` explicitly, so
the absence is visible rather than implied.

**Confirmed gap:** `linkGoogleToUser()` exists in `lib/server/auth-logic.ts` and
is tested, but **no route or UI calls it**. There is no "link Google" button in
account settings, so a user with a password account currently has no path to
adding Google at all. See [document 13](./13-status-and-debt.md).

## 3.5 Session revocation

Because there is no session table, revocation lives in `requireUser()`
(`lib/server/session.ts`), the single choke point every authenticated request
passes through:

```ts
const account = await prisma.user.findUnique({
  where: { id: uid }, select: { status: true, sessionsValidFrom: true },
});
if (!account || account.status !== "active") return unauthorized("Your account is not active");
if (account.sessionsValidFrom) {
  const issuedAt = session?.user?.issuedAt;          // the JWT's iat
  if (!issuedAt || issuedAt * 1000 < Date.parse(account.sessionsValidFrom))
    return unauthorized("Please sign in again");
}
```

`sessionsValidFrom` is bumped by:

- `resetPassword()` — `lib/server/email-flows.ts`
- `suspendUser()`, `forceSignOut()`, `softDeleteUser()` — `lib/server/admin/users.ts`

**Cost:** one indexed primary-key lookup per authenticated request. Accepted
because every route already makes several queries. **Trade-off:** a suspended
user is refused with 401, not 403 — deliberately, because the correct client
response is to sign out rather than retry the same cookie.

## 3.6 Roles

Two orthogonal systems, and conflating them is the mistake to avoid.

### Marketplace roles — `User.roles: String[]`

`"owner" | "caretaker" | "vet" | "shelter"` (`types/index.ts:7`).

**Self-declared at `/onboarding`**, and that is intentional: a professional
*claim* is free, and what it is *worth* is decided by verification. `roles` is
accepted by `updateUserSchema` for exactly this reason.

Roles drive UI only — `RoleToggle`, the dashboard switch, nav. **No server
authorization decision reads `User.roles`.** Every server check is
ownership-based (does this user own this profile / pet / booking?).

### Staff roles — `User.staffRoles: String[]`

`"ops" | "support" | "finance" | "admin"` (`lib/server/access.ts`).

Replaced a single `isOps` boolean. `"admin"` satisfies every other role, stated
once in `hasStaffRole()` rather than remembered at each call site:

```ts
export async function hasStaffRole(uid, role, db = defaultPrisma) {
  const held = await staffRoles(uid, db);
  return held.includes("admin") || held.includes(role);
}
export async function isOps(uid, db) { return hasStaffRole(uid, "ops", db); }
```

`isOps` survives as a named predicate because three order routes already read
that way. The legacy `User.isOps` **column** still exists and is kept in step by
`setStaffRoles()` and the seeder, so a rollback to the previous release still
finds the fulfilment console reachable. It should be dropped once a release has
run clean — see [document 13](./13-status-and-debt.md).

`staffRoles` **is** exposed to the client on the session user (`toUser`), which
is safe: it only ever describes the user it is sent to, and nothing is
authorised by it. It exists so the header can decide whether to render the Admin
link. Every endpoint behind that link re-checks with `requireStaff`.

Two refusals live in the **domain**, not the route (`lib/server/admin/users.ts`):

- **Nobody edits their own staff roles** — otherwise "admin" is a starting point
  rather than a role, and the audit log records the promotion as routine.
- **The last active admin cannot be demoted or deleted** — losing every admin
  means nobody can grant it back, and recovery is a hand-written UPDATE against
  production.

## 3.7 The authorization predicates

`lib/server/access.ts` is the security-critical file. It deliberately imports
**nothing from Auth.js or `next/server`**, which is what lets the unit suite
exercise it against a real schema — its own header says being able to test these
was the point of splitting it out of `session.ts`.

| Predicate | Answers |
|---|---|
| `staffRoles(uid)` / `hasStaffRole(uid, role)` / `isOps(uid)` | staff privilege |
| `isBookingParticipant(uid, bookingId)` | owner or the caretaker's user |
| `ownsCaretakerProfile` / `ownsVetProfile` / `ownsShelterProfile` | profile ownership |
| `ownsPet(uid, petId)` | pet ownership |
| `isAppointmentParticipant(uid, appointmentId)` | owner or the vet's user |
| `canViewPet(uid, petId)` | the pet *as a booking sees it* |
| `canAccessPetRecords(uid, petId)` | the clinical record; returns `asVetId` |

### The ownership-change rule

`canViewPet` and `canAccessPetRecords` both gate their grant on
`createdAt: { gte: pet.ownedSince }`:

```ts
const booked = await db.booking.findFirst({
  where: { caretakerId: caretaker.id, petIds: { has: petId },
           status: { notIn: ["declined", "cancelled"] },
           createdAt: { gte: pet.ownedSince } },
});
```

**Why.** Both grants were previously unbounded — `completed` is not in either
exclusion list, so a finished engagement granted access forever. Once an animal
can change hands (adoption), that means every vet who treated it at a shelter
keeps *write* access to the adopter's pet, including writing `prescription`
records that unlock Rx products on the adopter's store account.

`ownedSince` was chosen over the more obvious `Booking.ownerId === pet.ownerId`
because the latter makes authorization depend on a **mutable** column;
`createdAt` is written once and never touched. The doc-comment in
`prisma/schema.prisma` records this so nobody "simplifies" it back.

The consequence worth appreciating: **severing is not an action.** One
`UPDATE pets SET ownerId, ownedSince` ends every caretaker's and every vet's
access atomically. There is no list of grants to walk and no half-severed state.

**Still open:** `ownedSince` fixes access that outlives *ownership*, not access
that outlives *time*. Under a single owner, a vet who saw a pet once in 2019
still has record access today. A trailing window on `canAccessPetRecords` is the
fix and is deliberately out of scope — see [document 13](./13-status-and-debt.md).

## 3.8 Password reset and email verification

`lib/server/tokens.ts` + `lib/server/email-flows.ts`.

- Tokens are stored as **SHA-256 hashes** (`VerificationToken.tokenHash`), never
  in plaintext. Single-use.
- Verification: 24h expiry. Reset: 1h expiry.
- `POST /api/forgot-password` **always** answers `{ ok: true }`, so the endpoint
  cannot be used to discover which addresses exist.
- Both are rate limited per client (`RATE_LIMITS.emailSend`, 5/hour).
- Links are built from `appOrigin()` — see §3.9.

**Confirmed sharp edge:** `resetPassword()` sets a `passwordHash` on *any*
account, including one created purely through Google. That converts an
OAuth-only account into a password account. Arguably correct (it is a legitimate
recovery path for someone who has lost access to their Google account) but it is
not stated anywhere in the code.

## 3.9 `EMAIL_DEV_MODE` and the host header

Two fixes worth knowing about because both were live vulnerabilities:

**`emailDevMode()` is forced off in production** regardless of the environment
variable (`lib/server/mailer.ts`). With it on, `POST /api/forgot-password`
returns a working reset link for **any** address to an unauthenticated caller —
and `EMAIL_DEV_MODE=true` is the committed default in `.env.local.example`.

**`appOrigin()`** (`lib/server/origin.ts`) builds emailed links from
configuration — `APP_ORIGIN` → `AUTH_URL` → `NEXTAUTH_URL` →
`NEXT_PUBLIC_SITE_URL` → `VERCEL_URL` → localhost — and **never** from
`new URL(request.url).origin`. With `trustHost: true` set, a spoofed `Host`
header would otherwise put an attacker's domain into a genuine reset email from
this application, carrying a valid single-use token.

## 3.10 Client-side session state

`lib/store/session.ts` is a **Zustand cache, not the source of truth**. The real
state is the Auth.js cookie. `components/SessionSync.tsx` hydrates the store
from `GET /api/me` on mount. There is no `persist` middleware — a stale local
value cannot grant anything, because every server route re-checks.

### The navigation trap

`lib/auth/session-client.ts` → `navigateAfterAuth()` performs a **full
`window.location.assign`**, never `router.push`.

**Why (confirmed by the comment there):** visiting a proxy-guarded route while
signed out — by clicking it *or by Next prefetching it* — makes `proxy.ts`
answer 307 → `/login`, and the App Router **caches that redirect against the
route**. A later `router.push()` replays it: the user signs in and bounces
straight back to `/login` with nothing to explain it. `router.refresh()` does not
evict that entry and Next exposes no API that does.

`SiteHeader`'s `NAV` array marks guarded links so they are not prefetched while
signed out, for the same reason.

**This only reproduces against a production build** (`npm run build && npm start`);
`next dev` hides it. It cost three passes to get right. Do not replace
`navigateAfterAuth` with a router call.
