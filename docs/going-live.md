# Going live

Three integrations are coded, tested and dormant. Each one activates by setting
environment variables — no code changes. This is what to do, in the order that
avoids taking money you can't email a receipt for.

Everything here is also true off Vercel; see **Portability** at the end.

---

## 1. Google sign-in

**Where to apply:** <https://console.cloud.google.com/apis/credentials>

The "Continue with Google" button already exists on `/login` and `/signup`. It
is hidden until the two variables below are set, and appears on its own once
they are — `getProviders()` decides, so there is nothing to switch on in code.

### Steps

1. **Create or pick a project** — <https://console.cloud.google.com/projectcreate>

2. **Configure the consent screen** — <https://console.cloud.google.com/auth/branding>
   (older accounts: *APIs & Services → OAuth consent screen*)
   - User type: **External**
   - App name: `Leash`, plus a support email and a developer contact
   - Scopes: the defaults are enough. This app asks only for `email` and
     `profile` — it never requests Gmail, Drive or anything that would drag you
     into Google's verification review.
   - While the app is in **Testing**, only accounts you list as test users can
     sign in. Publish it when you want the public to.

3. **Create the OAuth client** — <https://console.cloud.google.com/apis/credentials>
   → *Create credentials* → *OAuth client ID* → **Web application**

4. **Authorised redirect URIs** — add both, exactly:
   ```
   https://petcare-app-drab.vercel.app/api/auth/callback/google
   http://localhost:3000/api/auth/callback/google
   ```
   Add your custom domain too if you have one. A mismatch here is the single
   most common failure, and Google reports it as `redirect_uri_mismatch`.

   *Authorised JavaScript origins* can be left empty — this is a server-side
   flow, not a browser-side one.

5. **Copy the client ID and secret** into `.env.local` and every Vercel scope:
   ```
   AUTH_GOOGLE_ID=...apps.googleusercontent.com
   AUTH_GOOGLE_SECRET=GOCSPX-...
   ```

### What the app does that a default setup wouldn't

- **A Google sign-in whose email matches an existing password account is
  refused**, not merged. That direction is account pre-hijacking: register an
  account at someone's address before they arrive, and a naive email lookup
  hands you their Google sign-in. The user is sent to
  `/login?error=AccountExists` and told to sign in with their password first.
- **`email_verified` is checked**, not assumed. An unverified Google address is
  refused.
- Accounts are linked by Google's stable `sub`, not by email — so a user who
  changes their Gmail address is still recognised.

See `lib/server/auth-logic.ts` → `linkOrCreateOAuthUser`.

---

## 2. Payments and the Leash Plus membership

**Where to apply:** provision through the Vercel Marketplace rather than signing
up directly — it wires the environment variables into every scope for you.

```bash
vercel integration add stripe
vercel env pull            # bring the keys into .env.local
```

If the CLI hands off to a browser step, finish it there and re-run
`vercel env pull`. Signing up at <https://dashboard.stripe.com/register> and
pasting keys by hand works too; you then set the three variables yourself.

### Steps

1. **Provision Stripe** (above). You should end up with:
   ```
   STRIPE_SECRET_KEY=sk_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
   ```
   The publishable key is *meant* to be in client code — it identifies the
   account and authorises nothing. The secret key must never leave the server.

2. **Create the membership product** — <https://dashboard.stripe.com/products>
   - Product: `Leash Plus`
   - Price: **$9.99 / month, recurring**
   - Copy the **price id** (`price_...`) and write it into the database:
     ```sql
     UPDATE plans SET "stripePriceId" = 'price_...' WHERE key = 'leash_plus';
     ```
     Until this is set, `/plus` renders the price but the subscribe button is
     disabled and the checkout endpoint answers 503 — deliberately, rather than
     signing somebody up to nothing.

3. **Register the webhook** — <https://dashboard.stripe.com/webhooks>
   - Endpoint URL: `https://<your-domain>/api/webhooks/stripe`
   - Events to send:
     ```
     payment_intent.succeeded
     payment_intent.payment_failed
     payment_intent.processing
     payment_intent.requires_action
     payment_intent.canceled
     charge.refunded
     charge.dispute.created
     charge.dispute.closed
     checkout.session.completed
     customer.subscription.created
     customer.subscription.updated
     customer.subscription.deleted
     invoice.paid
     invoice.payment_failed
     invoice.payment_action_required
     ```
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET=whsec_...`

   ⚠️ **Register the production URL, not a preview.** Vercel's deployment
   protection puts a login page in front of preview deployments, so Stripe's
   events bounce off it and orders sit unpaid with the money taken.

4. **Turn it on:**
   ```
   LEASH_PAYMENTS=stripe
   ```
   This **fails closed**: `stripe` with no `STRIPE_SECRET_KEY` throws at
   startup rather than quietly falling back to the demo provider and taking
   pretend money for real orders.

### Testing before real cards

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger payment_intent.succeeded
```

`stripe listen` prints its own `whsec_...` — use that one locally.

| Card | What it does |
|---|---|
| `4242 4242 4242 4242` | succeeds |
| `4000 0000 0000 9995` | declined, insufficient funds |
| `4000 0025 0000 3155` | requires a 3-D Secure challenge |
| `4000 0000 0000 0341` | attaches fine, then **fails at charge** — the async failure path, and the one worth exercising |

### Before real money: upgrade the plan

**Vercel's Hobby plan is not licensed for commercial use.** The moment a real
charge succeeds this stops being a personal project. Upgrade to Pro *before*
setting `LEASH_PAYMENTS=stripe`. Pro also lifts the once-a-day cron limit that
shaped `lib/server/fulfillment.ts`.

---

## 3. Email

**Where to apply:** <https://resend.com/signup>

Without this the mailer logs messages instead of sending them, which is fine in
development and quietly bad in production: a membership whose renewal fails will
tell nobody, and those members simply lapse.

1. Create an account and **verify a sending domain** —
   <https://resend.com/domains>. A verified domain is what stops your mail
   landing in spam.
2. Create an API key — <https://resend.com/api-keys>
3. Set:
   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=Leash <hello@yourdomain.com>
   ```

`EMAIL_DEV_MODE` needs no attention: it is **forced off in production**
regardless of its value, because with it on `/api/forgot-password` returns a
working reset link for any address to an anonymous caller.

---

## 4. Set `APP_ORIGIN`

```
APP_ORIGIN=https://petcare-app-drab.vercel.app
```

The origin used to build links in verification and password-reset emails. It is
**configuration, never a request header**: Auth.js runs with `trustHost: true`,
so a request carrying a spoofed `Host` would otherwise put an attacker's domain
into a genuine email from you, carrying a valid single-use token.

Falls back to `AUTH_URL` → `NEXTAUTH_URL` → `VERCEL_URL` → localhost.

---

## Order of operations

1. Upgrade Vercel to **Pro** (licensing, before any real charge)
2. `APP_ORIGIN` and **Resend** — so anything that happens next can be emailed
3. **Google** — independent of the rest; do it whenever
4. **Stripe** last: keys → product and price id → webhook → `LEASH_PAYMENTS=stripe`
5. Place one real order with a live card, refund it from
   `/dashboard/admin/payments`, and confirm the refund shows in both the console
   and the Stripe dashboard

---

## Portability — moving off Vercel later

The app is deliberately not welded to Vercel. Four couplings exist, all with
fallbacks:

| Where | What it reads | On another host |
|---|---|---|
| `lib/server/origin.ts` | `VERCEL_URL` | set `APP_ORIGIN` — already the first thing it checks |
| `lib/api/_client.ts` | `VERCEL_URL` | set `NEXT_PUBLIC_SITE_URL` — checked first |
| `lib/server/payments.ts` | `VERCEL_ENV` | only a warning that the demo provider is live in production; harmless if absent |
| `lib/server/assistant/model.ts` | `VERCEL_OIDC_TOKEN` | only for the AI Gateway route; an `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` outranks it anyway |

Two things genuinely need replacing:

- **`vercel.json` crons.** `GET /api/cron/advance-orders` needs calling on a
  schedule with `Authorization: Bearer $CRON_SECRET`. Any scheduler does —
  systemd timer, GitHub Actions, `cron` and `curl`. The job is time-based and
  idempotent, so the interval is a free choice; more often than daily is
  strictly better.
- **The build and deploy pipeline.** `next build` then `next start` behind a
  reverse proxy, or a container. You take on TLS, process supervision and
  rollbacks, which is the actual cost of moving.

**Neon is already independent.** It happens to have been provisioned through
Vercel's marketplace, but it is a normal Postgres database reachable by
connection string from anywhere. Migrating hosts does not mean migrating data.

Nothing in `lib/server/*` imports anything Vercel-specific, which is what keeps
this list short.
