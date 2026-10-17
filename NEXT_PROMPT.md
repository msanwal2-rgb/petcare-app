Finish the Leash build. Everything that remains is in this prompt, in order.
Read HANDOFF.md first, then STATUS.md, then BUILD_PLAN.md §0, then
ARCHITECTURE.md (§6 has the porting table).

## State of play

M0–M6, the landing page and the UI parity pass are done, committed and pushed
(main_newDev = origin at 6a057e3). 539 xUnit tests passing, web build + oxlint
clean, ./db/verify.sh IDENTICAL.

**The deployment is done** (deploy/README.md): the API and the SPA run as two
IIS sites (API :8080, frontend :8081), the frontend finds the API through
web/public/config.js, and the API allows it in `Cors:Origins`. In development
the same way: Vite on :5173 calls the API on :5001 directly — there is no /api
proxy. Treat this as the current architecture: do not redo or revert it, and
keep any new endpoint working cross-origin (cookies travel with
`credentials: "include"`).

Remaining, in this order: **M8 notifications → M7 payments & membership → M9
admin console → release hardening → M10 adoption (stretch).**

## How to work

  - **One module at a time, finished before the next**: tests green, web
    build + oxlint clean, verify.sh IDENTICAL, walked in the running app,
    STATUS/HANDOFF/BUILD_PLAN §0 updated — then **commit** that module with
    the repo's configured identity (rehman427). **No Co-Authored-By or other
    Claude trailer** — the history was deliberately rewritten without them.
    Do not push; I push.
  - **If the session runs long, stop at a module boundary**, commit, and make
    HANDOFF.md say exactly where the next session resumes. This same prompt
    must be able to restart the work: skip whatever STATUS.md marks done.
  - **Port the reference screens first, adapt them to the API second.**
    Copy the reference component, apply ARCHITECTURE.md §6, delete "use
    client". If it looks different afterwards, the port is not finished. Only
    a REQUIREMENTS.md §12 fix may change what a screen does, and every such
    difference is listed in STATUS.md beside the parity-pass list.
  - **No API change just to make a screen fit.** If a reference screen needs
    something the API lacks, stop and ask me.
  - **Port each module's reference test suite to xUnit as you build it**, not
    at the end. The tests/*.test.ts files are the specification.
  - **Schema changes**: next script is `db/changes/004_…`. Update db/petapp.sql
    in the same commit, run ./db/verify.sh (✓ IDENTICAL), apply to petapp_dev,
    and append any new column's value to the positional rows in
    db/devseed/D001_demo_data.sql. Also apply each new script to
    `leash_review` (deploy/README.md says changes are applied by hand) — check
    first whether 003 has been applied there.
  - psql and pg_dump are at C:\Program Files\PostgreSQL\18\bin, not on PATH.

## M8 — notifications (REQUIREMENTS.md §10.1)

  - Reference: lib/server/notifications.ts, lib/server/mailer.ts,
    app/api/notifications/route.ts, lib/api/notifications.ts,
    components/notifications/NotificationBell.tsx — mounted in SiteHeader in
    two places (desktop and mobile bar); web's header has the gaps.
  - Port tests/notifications.test.ts, and the fulfilment suite's "notifies the
    customer" case M6 left waiting.
  - Hooks: OrderLifecycle.MoveAsync (shipped, out for delivery, delivered);
    booking accepted/declined; appointment confirmed/declined/completed — one
    place in each service. Each notification carries an `href` (N9).
  - Do **not** port the two §12 defects: N5, escape every user-controlled
    string in email HTML (title, body, user.name, appointment.reason); N6,
    never fire email unawaited — an outbox table (`004`) drained by a hosted
    service. N3: channel abstraction (in-app / email / push), push
    unimplemented. N7: marking read affects only what was actually seen.
  - The support page already promises shipping notifications; M8 makes that
    true.

## M7 — payments and membership (REQUIREMENTS.md §9)

  - **Port tests/orders.test.ts lines 434–868, tests/webhooks.test.ts,
    tests/stripe-signature.test.ts and tests/entitlements.test.ts BEFORE
    writing the implementation.** BUILD_PLAN calls this the highest-risk week.
  - Reference: lib/server/payments.ts, lib/server/payments/*,
    lib/server/webhooks/*, app/api/membership/*, app/api/webhooks/stripe,
    components/store/PaymentForm.tsx, app/plus/page.tsx,
    app/account/membership/page.tsx.
  - HANDOFF §3 lists the seams M6 left (provider, retryable refunds — write
    the pending refund row before calling the provider, free shipping,
    consult discount, priority booking, the payment state machine) and the
    web seams (checkout "Pay" step, the order page's ?paid=1 sync, /plus,
    /account/membership).
  - M2: `stripe` without a secret key fails at startup. M6: the webhook
    refuses every request when its signing secret is unset. M14: membership
    checkout with no provider is a 503. The demo provider settles through the
    same reconciler the webhook uses (M3).
  - **C14, decided** (STATUS §5): no penalty, cancelling always allowed. When
    a caretaker booking starts within 12 hours, warn and ask to confirm —
    a UI warning only, no server rule. Build it on the booking page's "Cancel
    booking". Ask me whether vet appointments get the same warning.
  - Stripe keys: I have none configured. Everything must run and be walkable
    on the demo provider; the Stripe path is proven by the ported signature
    and webhook tests.

## M9 — admin console (REQUIREMENTS.md §10.2)

  - Reference: components/admin/AdminShell.tsx, app/dashboard/admin/*
    (dashboard, users, users/[id], professionals, payments, subscriptions,
    settings, audit), app/api/admin/*, lib/api/admin.ts. Port
    tests/admin.test.ts (and users.test.ts if not already covered).
  - Every action re-checks the staff role server-side (`support`, `finance`,
    `admin`) and writes AdminAuditLog. V11: staff — and only staff — set a
    vet's or caretaker's verification status. The /dashboard/admin/*
    placeholder route goes; the header's Admin link already exists.
  - Settings: signupsOpen, maintenanceBanner, demoLoginVisible — already read
    by /config and the banner.

## Release hardening (BUILD_PLAN §0, days 43–44)

  - **CI** in .github/workflows/: throwaway PostgreSQL from db/petapp.sql,
    `dotnet test`, web build + oxlint, and verify.sh — which needs a committed
    baseline (petapp_at_last_release.sql is gitignored) or a mode that skips
    the delta half. Pick one and document it.
  - The vulnerable transitive packages in the test project (Azure.Identity
    1.3.0, System.Drawing.Common 5.0.0) — upgrade or pin so a vulnerability
    gate passes.
  - Endpoint suites for M5 and M6 (`VetEndpointTests`, `StoreEndpointTests`)
    — S9 and price tampering are HTTP-shaped and only ever hand-checked.
  - The fulfilment job on one instance (document `Fulfilment__Enabled=false`
    for the others), route-level code splitting (the bundle is 847 kB in one
    chunk).
  - Redeploy the finished build to the IIS sites with deploy/publish-iis.ps1
    and apply every new change script to leash_review.

## M10 — adoption (stretch, only if everything above is done)

  - Reference: app/adopt/*, app/adoptions/[id], app/shelters/[id],
    app/dashboard/shelter-profile, components/adoption/*,
    components/dashboard/ShelterDashboard.tsx,
    components/shelter/ShelterProfileForm.tsx, app/api/adoptions/*,
    app/api/shelters/*. Port tests/adoption-transfer.test.ts.
  - The transfer sets `ownerId` and `ownedSince` **in one statement** (STATUS
    §3d) — that is what ends the old household's caretaker and vet access.

## Settled — do not re-open

STATUS.md §5: the skipped week-4 checkpoint; refillsLeft (0 = exhausted, null
= no limit, spent at checkout, **one refill per unit — still pending my
answer, leave it as built**); 409 on deleting a pet with history; no booking
cancellation cutoff and no penalty (only the 12-hour warning); the one-way vet
review; completing a visit requires a summary; the clinic phone
(db/changes/003); no allergen flags on store cards; GET /users?ids= public;
the pet page keeps the owner's Remove link.

## Before you say each module is done

  - `cd API && dotnet test` green, new suites listed in STATUS.md §2.
  - `cd web && npm run build && npx oxlint src` clean.
  - `./db/verify.sh` ✓ IDENTICAL after every change script.
  - Each new screen compared side by side with the reference; differences
    listed with the reason.
  - Walked in the running app (API :5001 via `dotnet run --launch-profile
    http`, web :5173 via `npm run dev`) as maya.chen (owner), liam.novak
    (caretaker), naomi.ruiz (vet), password leashdemo123, and a staff account
    for M9 (STAFF_PASSWORD). For M8/M7 at least: accept a booking and see the
    owner's bell; walk an order to delivered; buy Leash Plus on the demo
    provider and see free shipping in the quote and the consult discount on a
    vet booking; deliver one webhook event twice and show it processed once.

When everything is done — or at the last module boundary you reach — update
STATUS.md, HANDOFF.md and BUILD_PLAN.md §0, write a NEXT_PROMPT.md for
whatever is left (or a short "the build is complete" note with the deploy
runbook if nothing is), and tell me what differs from the reference and where
you are least confident.
