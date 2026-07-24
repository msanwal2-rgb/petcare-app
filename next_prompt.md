# Start-of-session prompt

Copy–paste the block below into a fresh Claude Code session (run from the
`PET APPLICATION` project directory) to pick up exactly where we left off.

---

You are continuing work on **Leash**, a live full-stack pet-care marketplace
(Next.js 16 + Neon Postgres + Prisma + Auth.js), deployed on Vercel at
https://petcare-app-drab.vercel.app and auto-deploying from the private GitHub
repo `msanwal2-rgb/petcare-app` on every push to `main`.

Read `next_plan.md` in the project root and the project memory first, then
confirm the plan with me before building.

Done so far: frontend, the backend (DB + REST API for users/pets/caretakers/
bookings/reviews), real auth (email+password via Auth.js, server-enforced
authorization), and messaging + email verification + password reset. 81 tests
pass; everything is deployed and live.

**What I want next:** Phase 4 — **Stripe payments** (the "Confirm & Pay" step is
still a mock). Implement Stripe Connect escrow per `docs/pet-care-marketplace-foundation.md`:
authorize/hold on booking confirmation, capture on completion, platform fee,
caretaker payouts. Build it the same way as before — fully autonomous where you
can, and tell me exactly which Stripe credentials/setup you need from me.

Work autonomously (accept-edits/auto mode is fine). Before writing any code,
remember this is a modified Next.js 16 — read the relevant guide under
`node_modules/next/dist/docs/` first. Keep the `/lib/api/*` → route-handler →
`lib/server/*` structure. Add tests and run `npm test` (note: slow, ~18 min).
Push to `main` to deploy, then smoke-test the live URL.

Two smaller activation items you can knock out if I provide credentials:
- **Google sign-in:** set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
- **Real email:** set `RESEND_API_KEY` + `EMAIL_FROM`, then `EMAIL_DEV_MODE=false`.
