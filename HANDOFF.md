# Leash — handoff

For whoever picks this up next. Written at the end of **M8 (notifications)**,
2026-10-17.

This file is the short version and the things that are true *right now*. It does
not repeat the permanent docs — read them in this order:

| | |
|---|---|
| `STATUS.md` | What is done, what is next, what is open, what is decided. **Start here.** |
| `ARCHITECTURE.md` | How the code is organised and how to add a feature. **Read before writing code.** |
| `REQUIREMENTS.md` | The durable spec. §9 is M7. |
| `BUILD_PLAN.md` | Order of work, the decisions, the risks. §0 is where the plan stands. |
| `API_CONTRACTS.md` | Every endpoint of the reference implementation. |
| `NEXT_PROMPT.md` | The brief for the remaining modules, in order. It restarts the work: skip what STATUS marks done. |

---

## 1. Where the history is

Everything is committed; the working tree is clean. Commits after
`727490f` (the IIS deployment) are local until the owner pushes — the owner
pushes, never the session.

Two local-only backup refs from the pre-M0 authorship rewrite still exist —
`backup/main_newDev-pre-rewrite` and `backup/main_newDev-pre-name-rewrite`.
Never pushed. Delete them when the old hashes no longer need to be recoverable.
**No `Co-Authored-By` or other Claude trailer** on any commit — the history was
rewritten without them on purpose.

---

## 2. Where the build is

**8 of 11 modules** (M0–M6 and M8), the landing page, the UI parity pass, and
an IIS deployment (`deploy/README.md`).

```bash
cd API && dotnet test        # 584 passing, ~3 min
cd web && npm run build && npx oxlint src
./db/verify.sh               # must print ✓ IDENTICAL
```

All three green at the end of M8. Change scripts run to `004`; **005 is next**.
`petapp_dev` and `leash_review` are both at 004 (`leash_review` is updated by
hand — deploy/README.md). `psql` and `pg_dump` are at
`C:\Program Files\PostgreSQL\18\bin` and are not on PATH.

The architecture since `727490f`: **two sites**. The SPA reads the API's
address from `web/public/config.js`; the API allows the SPA in `Cors:Origins`;
every call sends `credentials: "include"`. In development Vite on :5173 calls
the API on :5001 directly — there is no `/api` proxy. Keep new endpoints
working cross-origin; do not revert this.

---

## 3. What to do next — M7, payments and membership

`NEXT_PROMPT.md` has the full brief; `REQUIREMENTS.md` §9 is the spec.
`BUILD_PLAN.md` calls it *"the highest-risk days of the project"*. **Port
`tests/orders.test.ts` lines 434–868, `tests/webhooks.test.ts`,
`tests/stripe-signature.test.ts` and `tests/entitlements.test.ts` before
writing the implementation.**

What M6 left for M7, all at the safe default and all marked in code:

| Seam | Where | What M7 does |
|---|---|---|
| The payment provider | `Payments/IPaymentProvider.cs`, registered in `AddLeashCore` | Choose `demo` or `stripe` by configuration; `stripe` without a key fails at startup (M2). `OrderService` already creates the order before the intent |
| Retryable refunds | `OrderLifecycle.RefundAsync` | Write a pending refund row **before** calling the provider. Today the refund runs after the status commits; the demo cannot fail, Stripe can |
| Free shipping (S5, S6) | `OrderService.PriceAsync`, `const bool freeShipping = false` | Read Leash Plus entitlements. The quote's `membership`, `shippingWaivedByMembership` and `membershipSavingsCents` already exist |
| Consult discount (V5) | `AppointmentService.CreateAsync`, `ConsultFee(…, 0)` | Pass the plan's `vet_consult_discount` |
| Priority booking (C13) | `Services/LeadTime.cs`, `member: false` at both call sites | Ask whether the caller holds `priority_booking` |
| The payment state machine | — | The reference's `PAYMENT_TRANSITIONS`; M6 writes only `unpaid`, `paid`, `refunded` |
| Notifications | `INotifier`, `Services/Notices.cs` | M8 is done: `order_payment_failed` and the four `membership_*` kinds are declared in `NotificationKinds` and want a `Notices` entry and a call **inside** the webhook reconciler's transaction |

What the parity pass left for M7 in `web/`:

| Where | What M7 does |
|---|---|
| `pages/CheckoutPage.tsx` | The reference's third step ("Pay") with `PaymentForm`. The `STEPS` label is already there; the step is skipped while the demo provider settles synchronously |
| `pages/OrderDetailPage.tsx` | `?paid=1` already calls `syncPayment` on arrival. "Retry payment" for `pending_payment` becomes "finish paying" |
| `/plus`, `/account/membership` | `/plus` is a named placeholder (the cart links to it); `/account/membership` is not registered yet |
| `pages/BookingDetailPage.tsx` | **C14**: when a caretaker booking starts within 12 hours, "Cancel booking" warns and asks to confirm — UI only, no server rule. **Ask the owner whether vet appointments get the same warning** |

### Owner decisions still open

- **One refill per unit** (STATUS §4) — leave it as built.
- **C14 for vet appointments** — ask before building it on the appointment page.

---

## 4. Decisions that are settled — do not re-open them

`STATUS.md` §5 is the full list. The ones most likely to be "fixed" by mistake:

| | |
|---|---|
| **`refillsLeft`**: 0 = exhausted, null = no limit, **spent at checkout** | One refill per unit is pending the owner's confirmation |
| **Deleting a pet with clinical history is a 409** | Not a bug. Soft delete is a later pass |
| **No booking cancellation cutoff, no penalty** | Only the 12-hour warning (C14), not built yet |
| **A cookie copied before sign-out keeps working** | Deliberate. Do **not** bump the watermark on logout |
| **A vet review is one-directional** | The owner reviews the vet |
| **Completing a visit requires a summary** | There is no status button for `completed` |
| **Ops moves of an order check authority before legality** | The opposite of bookings and appointments, on purpose |
| **Marking notifications read takes the ids that were shown** | N7. `{}` is a 400, never "all" |

---

## 5. What is still between here and a release

The deployment exists now (two IIS sites, `deploy/`), so "nothing builds the
SPA" is moot for that topology. What remains is BUILD_PLAN §0's release
hardening, all in `NEXT_PROMPT.md`: **CI** (`.github/workflows/` is empty;
`verify.sh` needs a committed baseline or a mode without the delta half), the
**vulnerable transitive packages** in the test project, the **M5/M6 endpoint
suites**, the **fulfilment job on one instance** (document
`Fulfilment__Enabled=false` for the others — the outbox drain is safe
everywhere), **route-level code splitting**, and a redeploy with every change
script applied to `leash_review`.

---

## 6. Traps in this codebase that cost real time

`ARCHITECTURE.md` §9 has the standing list. New in the parity pass:

- **The reference serves files from `public/`.** Product art lives at
  `/products/*.svg`; `web/public/products/` was missing until this pass, so
  every store image had been broken since M6. Anything else a ported screen
  references by absolute path needs the same copy.
- **Many root files are CRLF.** Multi-line find-and-replace that assumes `\n`
  silently matches nothing. Normalise, edit, and write back with the original
  ending.
- **Next.js scrolled to the top on navigation; React Router does not** unless
  `ScrollRestoration` is mounted (it is now, in `App.tsx`).
- **`GET /users?ids=` is public now** (the owner's call); the unfiltered
  `GET /users` is not — it still needs a session and a Development host.
- **A new column on a positionally-seeded table goes at the end.** The dev seed
  is `INSERT … VALUES (…)` with no column list, so a column appended by a change
  script needs its value appended to every seed row (as 003 did) — or it takes
  the default.
- **Reference shapes are flat, ours are nested.** `caretaker.id` is
  `caretaker.profile.id`, `vet.userId` is `vet.user.id`. A port that compiles
  can still be wrong where the reference used a field both shapes share.

New in M6:

- **Event ordering needs a tie-break that is not the id.** Ids are random
  UUIDs. Anything that writes several rows with one timestamp — the fulfilment
  job catching up, checkout placing and paying in one millisecond — sorts
  randomly unless something else breaks the tie. `OrderLifecycle.Timeline`
  uses lifecycle position. The reference never hit this because its cuids were
  time-ordered; anything ported from it that relied on id order has the same
  latent bug.
- **A no-op is a valid outcome of a concurrent move.** The second of two
  identical moves may read the already-moved status and succeed as a no-op
  rather than fail. Test "applied exactly once", not "one caller errors".
- **FluentValidation does not stop at a failed `NotNull()`** by default. A
  `.Must(...)` after it receives the null. Use `.Cascade(CascadeMode.Stop)`.
- **The fulfilment job is off under `LeashApp`** (`Fulfilment__Enabled=false`).
  Left on, it would start moving seeded orders thirty seconds into a long test
  run. In development it is on, so a local `petapp_dev` will see o3 advance to
  delivered on the first hourly tick — that is it working.
- **`petapp_dev` now has smoke-test orders in it** from the HTTP walks below.
  Re-seed it if a clean demo matters.


New in M8:

- **Notify inside the transaction you already have.** `INotifier.NotifyAsync`
  takes the caller's scope; pass it. Without one it opens its own and swallows
  failures — right for a caller with no transaction, wrong for a status
  machine, where a crash between two commits loses the notice.
- **Anything listed "newest first" needs a tie-break that is not the id.**
  `notifications.seq` exists for that. Same trap as the order timeline.
- **The test `RecordingMailer` is shared state.** Its `Sent` is a snapshot and
  `FailWith` simulates an outage; the outbox tests drain from two tasks at once.
- **The outbox drain is off under `LeashApp`** (`Notifications__Outbox__Enabled=false`).
  Endpoint tests that need email should drive `INotificationOutbox` at the
  service level, as `NotificationServiceTests` does.
- **`STAFF_PASSWORD` is in the root `.env.local`** (gitignored). The staff
  accounts u21–u23 use it; read it from there for a walk, never print it.

---

## 7. What was checked by hand

- **M8** (2026-10-17, headless Chrome against `petapp_dev`): Liam accepted b1
  from the booking page → Maya's bell "1 unread" → the panel showed "Your
  booking was accepted", the count cleared, the item linked to `/booking/b1`.
  Maya bought dental chews; Rosa (ops) walked the order to delivered from the
  console → Maya's bell "3 unread", newest first. The API log shows the outbox
  sending all four emails. No console errors, no failed API calls. **This
  mutated `petapp_dev`**: b1 is accepted and there is one more delivered order.

- **Parity pass:** a headless Chrome walk (Playwright from the root
  `node_modules`, the system Chrome) of every screen as signed out, maya.chen,
  liam.novak and naomi.ruiz — no console errors, no failed API calls except the
  expected signed-out `401 /me`; every retired URL redirected. The product page
  checked against the quote: Biscuit refused the Rx diet, Luna's prescription
  recognised with expiry and refills, quantity 4 against 3 refills refused, and
  "Contains chicken, which Luna reacts to". **Nothing was mutated** — no
  booking accepted, no visit completed, no order placed — so the
  summary-completes-the-visit path is covered by the API suite, not by a click.

Over HTTP, earlier:


Because neither M5 nor M6 has an endpoint suite yet (STATUS §4), each was walked
with curl against a running API. Recorded so the endpoint tests know what to
pin:

- **M5:** guards (401 on every private route, 200 on the three public ones),
  owner confirming → 403, illegal skip → 409 with `appointmentId` merged,
  owner writing the visit summary → 403, records stamped with the access check's
  vet id, a body `appointmentId` overwritten, the prescription visible in the
  pet's record, vet reviewing the client → 403, not-yours → 404.
- **M6:** anonymous quote → 401, Maya ordering Luna's Rx food → 403 (S9), Rx
  with no pet → 409 with `quote` beside `error`, a body claiming
  `unitPriceCents: 1, totalCents: 1` charged **2005**, Priya buying Luna's Rx
  food → 201, a customer PATCHing status → 403, someone else's order → 404.
- **Landing page:** the hero's city picker producing nearest-first results with
  distances, the featured strip returning the top four, a future `startDate`
  emptying the list.

---

## 8. The rule that governs everything else

From `AGENTS.md`:

> **The reference implementation at the repo root is the answer to "how should
> this behave?"** When behaviour is unclear, `lib/server/<domain>.ts` is
> authoritative — **do not guess**. Read it; never run it, never edit it.

It is also wrong in places, and the spec says where. M6 closed the worst of
them — the missing `OwnsPet` on `POST /orders`, REQUIREMENTS S9 — and the
landing page fixed a search bar whose location box filtered nothing. Where the
spec and the reference disagree, the spec wins.
