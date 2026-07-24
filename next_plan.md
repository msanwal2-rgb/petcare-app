# Leash — Next Plan

_Last updated: 2026-07-24. Written for the next session to hit the ground running._

## Where things stand (all done, tested, deployed)

| Phase | What | Status |
|---|---|---|
| 0 | Frontend MVP (Next.js 16, React 19, Tailwind v4) | ✅ live |
| 1 | Backend: Neon Postgres + Prisma + Route Handlers for users/pets/caretakers/bookings/reviews, Zod validation | ✅ live |
| 2 | Real auth: Auth.js (email+password, Google-ready), JWT sessions, server-enforced authorization, `proxy.ts` route protection | ✅ live |
| 3 | Messaging (booking chat), email verification, password reset (pluggable Resend mailer) | ✅ live |

- **Live:** https://petcare-app-drab.vercel.app · **Repo:** `msanwal2-rgb/petcare-app` (private) · push to `main` auto-deploys.
- **Tests:** `npm test` — 81 pass (slow, ~18 min; each test reseeds the Neon `test` schema over the network).
- **Demo login:** any seed email (e.g. `maya.chen@example.com`) + password `leashdemo123`.

## Architecture to preserve
- `/lib/api/*` — thin `fetch` clients (browser). Signatures are the contract; keep them stable.
- `app/api/**/route.ts` — thin handlers: parse (Zod) → authorize (`lib/server/session.ts`) → call domain logic → respond.
- `lib/server/*` — all business logic, each fn takes an injectable `PrismaClient` (so tests pass `testPrisma`).
- Migrations: `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` into a new `prisma/migrations/NN_name/` folder, then `npm run db:migrate` + `npm run db:seed`. (Avoids Neon's shadow-DB limitation — do NOT use `migrate dev`.)
- This is a **modified Next.js 16** — read `node_modules/next/dist/docs/` before using a framework feature. (Gotchas already hit: `middleware`→`proxy.ts`; async route `params`; Prisma pinned to 6.x because 7 needs Node ≥20.19.)

## Immediate activation items (need user credentials — quick)
1. **Google sign-in** — user creates a Google OAuth app (redirect `https://petcare-app-drab.vercel.app/api/auth/callback/google`); set `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` on all Vercel scopes. Code already handles it; button auto-appears.
2. **Real email delivery** — user creates a Resend account + verified sender; set `RESEND_API_KEY` + `EMAIL_FROM`; then flip `EMAIL_DEV_MODE=false`. Until then, verify/reset links are logged / surfaced in dev mode.

## Phase 4 — Stripe payments (recommended next build)
Goal: replace the mock "Confirm & Pay" with real Stripe Connect escrow (see `docs/pet-care-marketplace-foundation.md` §3/§5).

**Needs from user:** Stripe account → test-mode **secret key** + **publishable key** + **webhook signing secret**; enable **Connect** (Express accounts for caretakers). I can do everything else autonomously.

Suggested sequence:
1. **Schema/data:** add `Payment` (bookingId, amount, platformFee, stripePaymentIntentId, status) and caretaker `stripeAccountId`. Migrate + seed.
2. **Deps:** `stripe` (server SDK), `@stripe/stripe-js` + `@stripe/react-stripe-js` (client).
3. **Connect onboarding:** endpoint to create/refresh a caretaker Express account + onboarding link; surface in caretaker dashboard/profile.
4. **Payment intent on confirm:** when owner confirms an `accepted` booking, create a PaymentIntent with `application_fee_amount` (platform cut) and `transfer_data.destination` = caretaker's connected account; **authorize/hold** (manual capture).
5. **Capture on completion:** capture the PaymentIntent when the booking → `completed`; handle cancellations/refunds (release the hold).
6. **Webhooks:** `app/api/webhooks/stripe/route.ts` verifying the signing secret; reconcile PaymentIntent status → `Payment` + booking.
7. **UI:** real card form (Stripe Elements) in the Confirm & Pay step; payment status on the booking detail page.
8. **Tests:** payment state machine + authorization; use Stripe test mode. **Security-review the money paths.**
9. Push → deploy → smoke-test with Stripe test cards.

## Other options (if not payments)
- **Auth hardening:** require email verification for sensitive actions, rate-limit login/reset, account settings (change email/password, link Google).
- **Notifications:** email/in-app on booking status changes and new messages (rides on the Resend mailer).
- **Test-suite speedup:** switch per-test reseed to a transaction-rollback or once-per-file seed (currently ~18 min).
- **Realtime messaging:** replace 8s polling with SSE/websockets.

## How to start next session
Paste the block in `next_prompt.md`. It tells the agent to read this file, confirm the plan, then build Phase 4 (or whichever you pick).
