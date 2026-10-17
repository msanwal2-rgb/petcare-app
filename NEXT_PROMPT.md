# Leash — next session brief

**How to use this file:** fill in the client's answers in §1 (tick a box or
write a note), then paste the whole file into a new chat. The session does
only what §1 asks for. Anything left blank is not done and stays as it is.

Read HANDOFF.md first, then STATUS.md (§3-M10 and §4), then ARCHITECTURE.md
before writing code.

---

## 1. The client's answers — fill these in

### D1 — Payments: stay on the demo, or go live with Stripe?
- [ ] Stay on the demo provider (no real money; today's setup)
- [ ] Go live with Stripe. The client provides: secret key `sk_…`, publishable key
      `pk_…`, the webhook signing secret `whsec_…`, and the Stripe price id
      `price_…` for Leash Plus. Start in **test mode** (`sk_test_…`).

### D2 — Adoption: which of the reference's screen gaps to fix? (tick any)
- [ ] **B1** Shelters create, edit, publish and withdraw listings from the app
- [ ] **B2** Support staff can reverse a completed adoption from the console
- [ ] **B3** The applicant sees that their adoption fee is paid (**API change**)
- [ ] **B4** Fix the dashboard buttons: no "Approve" on a new application;
      "Decline" available on an approved one (with the refund)
- [ ] **B5** "Not yet listed" stops showing animals whose listing is pending (**API change**)

### D3 — R7: who may override an open booking when completing an adoption?
- [ ] The shelter, after being shown what will be cancelled (as built, as the reference)
- [ ] Support staff only

### D4 — Prescription refills: one refill per unit bought?
- [ ] Yes — three bags spend three refills (as built)
- [ ] No — one refill per order line

### D5 — Other product gaps (tick any)
- [ ] **C1** Let an owner remove a pet that has health records (soft delete — schema change)
- [ ] **C2** Give refills back when an order is cancelled (schema change)
- [ ] **C3** Google sign-in — the client provides a Google OAuth client id and secret

### Notes from the client
> _(paste anything else they said here)_

---

## 2. State of play (2026-10-18)

Every module in the plan — M0 to M10 — is built, tested, walked in the
running app and committed on `main_newDev` (last commit: M10, `d6895cd`).
970 xUnit tests pass; web build and `oxlint --deny-warnings` are clean;
`./db/verify.sh` prints IDENTICAL. Change scripts run to 005; **006 is next**.

Not yet done by the owner: the redeploy (needs an elevated shell — §5) and the
first push, which is also the first CI run.

### Things already established — do not re-investigate

- **Stripe is set up exactly like the reference app.** The reference had real
  Stripe code (payment intents, refunds, Leash Plus checkout, a signed webhook)
  but ran `LEASH_PAYMENTS=demo` with no Stripe keys, so no real payment ever
  went through Stripe. Ours is the same: real Stripe code, `Payments:Provider`
  unset (demo), no keys. **Neither app has run against Stripe**; ours is tested
  with fakes. Two deliberate differences: our demo provider sells Leash Plus
  (the reference answered 503), and our adoption fee page shows Stripe's card
  form when Stripe is on (the reference's only worked with the demo).
- **The adoption gaps in D2 are all in the reference too.** It had API routes
  for creating, editing and publishing listings and for reversing adoptions,
  but no screen ever called them; its application page could not show a paid
  fee; its dashboard offered "Approve" on new applications and hid "Decline"
  on approved ones; its "Not yet listed" panel read the available-only search.
  They were ported as they were because the build brief allowed only
  REQUIREMENTS §12 fixes to change a screen. **The client's tick in D2 is the
  instruction to change them**, and it covers the API changes it names.

---

## 3. Work packages — do the ones §1 asks for, in this order

Each is one commit, finished before the next (§6).

### A. Go live with Stripe (D1 = go live)

Configuration, not code — `deploy/README.md` §4:

1. Server `appsettings.Production.json`: `"Payments": { "Provider": "stripe",
   "Stripe": { "SecretKey": "sk_…", "WebhookSecret": "whsec_…" } }`.
2. Frontend `config.js`: `stripePublishableKey: "pk_…"`.
3. In Stripe, register the webhook endpoint `https://<api>/api/v1/webhooks/stripe`
   for `payment_intent.*`, `charge.refunded`, `charge.dispute.*`,
   `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`.
4. `UPDATE plans SET "stripePriceId" = 'price_…' WHERE key = 'leash_plus';`
   on the server's database.
5. Restart the API, then in **test mode** buy one of each and check the
   ledger in the admin console: a store order (card `4242 4242 4242 4242`), a
   3-D Secure card (`4000 0025 0000 3155`), Leash Plus, an adoption fee, a
   refund from the console, and a refund from Stripe's dashboard. Record what
   happened in STATUS §4. Go live only after that.

Never put a secret key in the repository. If the client sends keys in the
chat, write them only into the server's settings file, and tell the owner to
rotate any key that was pasted somewhere public.

### B. Adoption screens (D2)

No reference screen exists for B1 and B2, so design them in the style of the
screens next to them (the vet profile form, the admin users page) and list
each in STATUS §3-M10 as a client-requested change.

- **B1 — listing management.** On the shelter dashboard, each animal in "Not
  yet listed" gets "List for adoption", opening a form (fee, headline, story,
  the four yes/no/unknown answers, energy, special needs and notes, neutered,
  microchipped, intake date; the location defaults to the shelter's). Saving
  creates a draft (`POST /adoptions/listings`); "Publish" moves it to
  available (`PATCH …/status`). "Listed animals" gets Edit and Withdraw; a
  withdrawn or adopted listing can be relisted. API: none needed, but the
  shelter must see its own drafts and withdrawn listings — that is B5's
  endpoint, so do B5 with B1.
- **B2 — reverse in the console.** The API exists
  (`POST /admin/adoptions/{id}/reverse { reason }`, support role, audited).
  Staff cannot read applications today, so either (a) **add**
  `GET /admin/adoptions?status=completed` (support role, keyset with total)
  and an "Adoptions" page in the console listing completed adoptions with a
  Reverse button and a reason prompt — recommended; or (b) a field for an
  application id on an existing console page, with no API change. Ask the
  owner which if the client did not say.
- **B3 — the applicant sees a paid fee.** Add `paymentStatus` (null when no
  payment) to the application the applicant reads: `GET /adoptions/applications/{id}`
  and the applicant's list. On `/adoptions/:id`, when it is `paid`, replace
  the Pay button with "Fee paid" and the date; when `pending`/`processing`,
  "Payment in progress". Pin it in `AdoptionEndpointTests`.
- **B4 — the buttons.** `ShelterDashboard.tsx`: "Approve" only on
  `under_review`; "Decline" on `approved` too, with the prompt saying any fee
  paid will be refunded. No API change (the API already refuses the first and
  allows the second).
- **B5 — the shelter's own listings.** Add `GET /adoptions/listings/mine`
  (shelter only, every status, keyset) and use it on the dashboard for
  "Listed animals" and "Not yet listed" (an animal is unlisted only if it has
  no listing at all). Keep the public directory available-only.

### C. Product gaps (D5)

- **C1 — pet soft delete.** `db/changes/006_pet_deleted_at.sql` adds
  `pets."deletedAt"`; deleting a pet with history sets it instead of
  returning 409. Every pet read, the access predicates, search and the
  dashboards ignore deleted pets; the health record stays for the vets who
  wrote it. Settle with the client first what a bereaved owner still sees.
- **C2 — refills back on cancellation.** A schema change records which
  prescription each order line drew on (`order_items."prescriptionId"` and the
  count), and cancelling an unshipped order gives them back in the same
  transaction as the restock.
- **C3 — Google sign-in.** Configuration only: `Auth:Google:ClientId` and
  `:ClientSecret` on the server, and the redirect URI
  `https://<api>/api/v1/auth/google/callback` registered in Google. Walk a
  first sign-in, a returning sign-in, and linking to an existing email account.

### D. Small decisions (D3, D4)

- **D3 = support staff only:** in `AdoptionTransferService.CompleteAsync`,
  refuse `force` from the shelter; add a staff endpoint and console button to
  force a completion (audited), and change the dashboard's confirm to "ask
  support". Update the R7 note in STATUS §3-M10 and the tests.
- **D4 = one per line:** one constant in `Services/PrescriptionCover.cs`;
  update the quote message and its tests. Either answer: move the item from
  STATUS §4 to §5 (decided).

---

## 4. What not to change

- The two-site deployment (API :8080, SPA :8081; `config.js` + `Cors:Origins`;
  `credentials: "include"`). Development: Vite :5173 → API :5001, no proxy.
- Everything in STATUS §5, and the settled points in HANDOFF §4 — including:
  only `TransferPetAsync` moves a pet's owner (with `ownedSince`); reversing
  an adoption does not refund; the demo provider sells Leash Plus.

## 5. For the owner, whatever the client says

1. **Redeploy** from an elevated PowerShell at the repository root:
   `.\deploy\publish-iis.ps1`. It keeps the server's `config.js` and
   `appsettings.Production.json`. The database needs nothing new
   (`leash_review` has 001–005). Then check `/adopt` lists two animals and a
   demo login works.
2. **Push `main_newDev`** and watch the first CI run
   (`.github/workflows/ci.yml`). The likeliest failure is the PGDG apt step.

## 6. How to work

- One package at a time, finished before the next: `cd API && dotnet test`
  green, `cd web && npm run build && npx oxlint src --deny-warnings` clean,
  `./db/verify.sh` IDENTICAL, walked in the running app (Playwright scripts
  in the old session's scratchpad are gone — write a new walk), STATUS,
  HANDOFF and BUILD_PLAN §0 updated — then **commit** as `rehman427` with
  **no Co-Authored-By or other Claude trailer**. Do not push; the owner pushes.
- Any schema change is the next `db/changes/006_*.sql`, mirrored into
  `db/petapp.sql` in the same commit, applied to `petapp_dev` and
  `leash_review`, and new columns appended to positional seed rows.
- Tests first for every behaviour change; the API is checked on every request.
- Demo accounts use `leashdemo123`. `STAFF_PASSWORD` for u21–u23 is in the root
  `.env.local` — read it for a walk, never print it. psql and pg_dump are at
  `C:\Program Files\PostgreSQL\18\bin`, not on PATH.
- If something the client asked for is ambiguous, ask before building it.
- At the end: report what changed, what differs from the reference, and what
  still waits on the client.
