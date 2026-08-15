# What's left

A companion to `README.md`, which describes what the app *is*. This is what it
still isn't. Ordered by what actually blocks the product, not by effort.

## Blocked on credentials — no code changes needed

| | What to do | Effect |
|---|---|---|
| **Google sign-in** | Create a Google Cloud OAuth client. Redirect URIs `https://petcare-app-drab.vercel.app/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` on every Vercel scope and in `.env.local`. | The "Continue with Google" button is already built on both `/login` and `/signup`; it is hidden until the provider is configured and appears on its own once it is. |
| **Real email** | Create a Resend account, set `RESEND_API_KEY` and `EMAIL_FROM`, then `EMAIL_DEV_MODE=false`. | Notifications, email verification and password resets already route through `lib/server/mailer.ts`. Without a key it logs the message; with one it sends. |

## The one substantial piece: real payments

`lib/server/payments.ts` defines a `PaymentProvider` interface — `authorize`,
`capture`, `refund` — with a demo implementation that does all three instantly
without collecting a card. Everything around it is already real: the
`paymentStatus` machine, the refund on a failed checkout, order totals computed
server-side, and a test that drives a recording provider to prove the seam.

Going live is:

1. Provision a provider **through the Vercel Marketplace** rather than
   hardcoding an SDK.
2. Implement `PaymentProvider` against it.
3. Add a webhook that calls `updateOrderStatus`, so an asynchronous capture or
   chargeback moves the order the same way the ops console does.

Payouts to caretakers and vets, and a platform fee, belong with this work —
they are meaningless before it.

## Smaller, unblocked

- **Notification preferences.** Per-user opt-out per kind. `notify()` is the
  single place every notification passes through, so this is one gate.
- **A `/notifications` page.** The header bell shows the most recent 30 and has
  no "see all".
- **Search relevance.** Caretaker and vet search filter in memory and sort by
  distance or rating — no text search, no pagination. The store's
  `searchProducts` already does this properly in Postgres and is the pattern to
  copy.
- **Seed freshness.** Orders are timed relative to when the database is seeded,
  so the fulfilment cron has something to move. Bookings, appointments and
  medical records are still pinned to a fixed `TODAY`, so seeded "upcoming"
  items drift into the past as real time passes. Fixable the same way, but many
  tests assert on those ids and statuses.
- **Trust and safety.** `backgroundCheckStatus` is display-only. Real
  verification needs a vendor (Checkr, Stripe Identity).
- **Test runtime.** ~20 minutes, almost entirely network round trips to Neon. A
  local Postgres in CI, or transaction-rollback isolation instead of the
  snapshot restore, would cut it sharply.

## Deliberately not planned

Background checks and ID verification beyond the field above; SMS and push
channels; and anything that would make the demo accounts harder to explore.
