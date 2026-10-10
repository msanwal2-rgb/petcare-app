Continue the Leash build. Read HANDOFF.md first, then STATUS.md (§3-0 is the
UI parity pass), then BUILD_PLAN.md §0 and §6 week 7, then ARCHITECTURE.md —
§6 has the porting table, which grew in the parity pass.

State of play: M0–M6 are done and verified, plus the landing page and the UI
parity pass — every screen built so far is now a port of the reference screen.
539 xUnit tests passing, web build + oxlint clean, ./db/verify.sh IDENTICAL.
Everything is committed (main_newDev at 6c1e030: the parity pass in eff89bf,
the clinic phone and public GET /users?ids= in 6c1e030). Do not commit unless
I ask.

## This session: M8 (notifications), then M7 (payments and membership)

M8 first, because orders generate notifications and M7's payment failures do
too. REQUIREMENTS.md §10.1 is M8's spec and §9 is M7's.

### The rule from now on: port the reference screens first

The parity pass existed because M1–M6 wrote their screens fresh against the
new API. Do not repeat it. For every screen a module owns:

  1. **Copy the reference component**, apply the ARCHITECTURE.md §6 table,
     delete "use client". If it looks different afterwards, the port is not
     finished.
  2. **Then adapt the data access** to web/src/api/* — cursor pages, nested
     { profile, user } shapes, self-only lists with no user id.
  3. **Only a REQUIREMENTS.md §12 fix may change what the screen does**, and
     every such difference goes in STATUS.md next to the parity-pass list.
  4. **No API change to make a screen fit.** If a reference screen needs
     something the API does not have, stop and tell me.

### M8 — notifications

  - Reference: lib/server/notifications.ts, lib/server/mailer.ts,
    app/api/notifications/route.ts, lib/api/notifications.ts,
    components/notifications/NotificationBell.tsx (mounted in SiteHeader in two
    places — the desktop bar and the mobile bar; web's header has the gaps).
  - Port tests/notifications.test.ts to xUnit **as you build**, and the
    fulfilment suite's "notifies the customer" case that M6 left waiting.
  - The hook into orders is one place: OrderLifecycle.MoveAsync (shipped, out
    for delivery, delivered). Bookings and appointments notify on accept/
    decline/confirm/complete — find the one place in each service.
  - Two §12 defects are M8's and must not be ported: N5, escape every
    user-controlled string in email HTML (title, body, user.name,
    appointment.reason); N6, never fire email without awaiting — an outbox
    table drained by a hosted service. That is a schema change: db/changes/,
    update db/petapp.sql in the same change, run ./db/verify.sh. Recreate
    db/petapp_at_last_release.sql from petapp.sql first (it is gitignored).
  - N3: build the channel abstraction (in-app / email / push) with push
    unimplemented. N7: marking read affects only what was actually seen —
    the same rule as C10 for messages.
  - The support page already promises a notification on shipped, out for
    delivery and delivered. M8 is what makes that true.

### M7 — payments and membership

  - **Port tests/orders.test.ts lines 434–868, tests/webhooks.test.ts and
    tests/stripe-signature.test.ts BEFORE writing the implementation**, and
    tests/entitlements.test.ts with it. BUILD_PLAN calls this the highest-risk
    week; the tests are the spec.
  - Reference: lib/server/payments.ts, lib/server/payments/*,
    lib/server/webhooks/*, app/api/membership/*, app/api/webhooks/stripe,
    components/store/PaymentForm.tsx, app/plus/page.tsx,
    app/account/membership/page.tsx.
  - HANDOFF §3 has the seams M6 left (provider, retryable refunds, free
    shipping, consult discount, priority booking, the payment state machine)
    and the web/ seams the parity pass left (checkout's "Pay" step, the order
    page's ?paid=1 sync, the /plus placeholder, /account/membership).
  - M2: `stripe` without a secret key fails at startup. M6: the webhook refuses
    every request when the signing secret is unset. M14: membership checkout
    without a provider is a 503.
  - C14 (the booking cancellation window) is decided (STATUS §5): **no
    penalty**, and cancelling stays allowed at any time. When a booking starts
    within 12 hours, warn the person cancelling and ask them to confirm — a
    warning only, no refusal, no fee, no server rule change. Build it on the
    booking page's "Cancel booking" button.

## Settled — do not re-open

STATUS.md §5. In particular: the skipped week-4 checkpoint; refillsLeft
(0 = exhausted, null = no limit, spent at checkout, one per unit — still
pending my confirmation, so leave it); 409 on deleting a pet with history; no
booking cancellation cutoff and no penalty (only the 12-hour warning above); the one-way vet
review; completing a visit requires a summary.

Decided 2026-10-10 (STATUS §4): the clinic phone is in (db/changes/003, so the
next change script is 004), allergen flags on store cards are not, and
GET /users?ids= is public. The pet page keeps the owner's Remove link.

## Before you say it is done

  - `cd API && dotnet test` green, with the new suites ported and listed in
    STATUS.md §2.
  - `cd web && npm run build && npx oxlint src` clean.
  - `./db/verify.sh` prints ✓ IDENTICAL after every change script.
  - Compare the bell, /plus, /account/membership and the checkout's pay step
    side by side with the reference, and list any difference and why.
  - Walk it in the running app (API on :5001 via `dotnet run --launch-profile
    http`, web on :5173 via `npm run dev`) as maya.chen (owner), liam.novak
    (caretaker), naomi.ruiz (vet), password leashdemo123: accept a booking and
    see the owner's bell; walk an order to delivered; buy Leash Plus with the
    demo provider and see free shipping in the quote and the consult discount
    on a booking. Deliver one webhook event twice and show it processed once.

When you finish, update STATUS.md, HANDOFF.md and BUILD_PLAN.md §0, and write
a new NEXT_PROMPT.md for the session after — M9 (the admin console), which
also starts with porting the reference screens (components/admin/AdminShell.tsx
and app/dashboard/admin/*). Then tell me what differs from the reference and
where you are least confident.
