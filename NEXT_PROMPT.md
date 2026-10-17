The Leash build is complete. Every module in the plan — M0 to M10 — is
built, tested, walked in the running app and committed on `main_newDev`.
Read HANDOFF.md first, then STATUS.md (§3-M10 and §4).

## State of play

970 xUnit tests passing, web build + `oxlint --deny-warnings` clean,
`./db/verify.sh` IDENTICAL. Change scripts run to 005; M10 needed none.
21 of the reference's 28 Vitest suites are ported in full; the rest are the
out-of-scope assistant and the Zod `validation` cases.

The architecture is two IIS sites (API :8080, SPA :8081; `config.js` +
`Cors:Origins`). Do not redo or revert it. In development, Vite on :5173
calls the API on :5001 directly.

## What is left

Nothing is left to build. What remains is operational, plus decisions only
the owner can make.

### 1. Redeploy (owner — needs an elevated shell)

From an elevated PowerShell at the repository root:

```powershell
.\deploy\publish-iis.ps1
```

It builds the SPA, publishes the API with the site offline while its files
are replaced, and keeps the server's `appsettings.Production.json` and
`config.js`. `-StageOnly` builds without touching `C:\inetpub`.

The database needs nothing: `leash_review` already has 001–005, and M10 added
no script. To check a database:
`psql -U leash -h localhost -d leash_review -c "SELECT script FROM schema_version"`
(psql is at `C:\Program Files\PostgreSQL\18\bin`).

After it runs, walk it once: `/adopt` lists two animals, a demo login
(`maya.chen@example.com` / `leashdemo123`) reaches the dashboard, and
`/dashboard/admin` answers for a staff account.

### 2. Watch the first CI run

`.github/workflows/ci.yml` has never run on GitHub. It will on the first push
of `main_newDev`. Every step passes locally; the likeliest failure is the
PGDG apt step that installs the PostgreSQL 18 client.

### 3. Before real money

Stripe and real email are configured, not built (`deploy/README.md` §4):

- `Payments:Provider = stripe`, `Payments:Stripe:SecretKey`,
  `Payments:Stripe:WebhookSecret` (endpoint `https://<api>/api/v1/webhooks/stripe`),
  and `stripePublishableKey` in the frontend's `config.js`.
- `UPDATE plans SET "stripePriceId" = 'price_…' WHERE key = 'leash_plus'`.
- `Email:ResendApiKey`, `Email:From`.

None of the Stripe path — orders, Leash Plus, the adoption fee, refunds,
the webhook — has run against Stripe itself; it is tested with fakes and
Stripe.net's own signature check. Do one test-mode purchase of each before
going live.

### 4. Owner decisions still open (STATUS.md §4)

1. **One refill per unit** — built that way; confirm or change the constant
   in `PrescriptionCover`.
2. **R7** — the shelter overrides a live booking at completion (as the
   reference). Change it only if R7 meant support staff.
3. **Adoption screen gaps the reference also has**: no UI to create, publish
   or edit a listing, or to reverse an adoption; the applicant's page cannot
   show a paid fee (needs an API field); "Approve" offered on a new
   application and "Decline" hidden once approved; "Not yet listed" includes
   pending animals. Each is a small change once decided.
4. Refills spent on a cancelled order are not returned (needs a schema
   change); a pet with clinical history cannot be deleted (needs soft delete);
   Google sign-in is unconfigured.

## How to work on anything further

The rules from the build still hold: one change at a time, tests green, web
build + oxlint clean, `verify.sh` IDENTICAL, walked in the running app,
STATUS/HANDOFF updated, then commit as `rehman427` with **no Co-Authored-By
or other Claude trailer**. Do not push; the owner pushes. Any schema change is
the next `db/changes/006_*.sql`, mirrored into `db/petapp.sql` in the same
commit. `STAFF_PASSWORD` is in the root `.env.local`; read it for a walk,
never print it.
