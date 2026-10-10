# Leash — handoff

For whoever picks this up next. Written at the end of **M6**, 2026-10-10.

This file is the short version and the things that are true *right now*. It does
not repeat the permanent docs — read them in this order:

| | |
|---|---|
| `STATUS.md` | What is done, what is next, what is open, what is decided. **Start here.** |
| `ARCHITECTURE.md` | How the code is organised and how to add a feature. **Read before writing code.** |
| `REQUIREMENTS.md` | The durable spec. §9 is M7. |
| `BUILD_PLAN.md` | Order of work, the decisions, the risks. §6 week 7 is M8 + M7. |
| `API_CONTRACTS.md` | Every endpoint of the reference implementation. |

---

## 1. Where the history is

M0–M4 are committed and pushed; `main_newDev` and `origin/main_newDev` are both
at `c585829`. **M5, the landing page and M6 are complete and verified but not
committed.** That is three bodies of work in one working tree — worth
committing as three commits (`git add -p` by path splits cleanly: M5 is the vet
and appointment files, the landing page is `web/src/pages/HomePage.tsx` plus
`components/{HeroSection,SearchBar,FeaturedCaretakers,CaretakerCard,RatingStars,
ServiceTypeChip}.tsx` and `lib/cities.ts`, and M6 is everything store-shaped).

```
c585829  m4 completed
41f57ef  m3 completed with refill left and pet delete not possible if have history
ce34802  m2 completed
9ff75e2  commited auth steps
```

Two local-only backup refs from the pre-M0 authorship rewrite still exist —
`backup/main_newDev-pre-rewrite` and `backup/main_newDev-pre-name-rewrite`.
Never pushed. Delete them when the old hashes no longer need to be recoverable.

---

## 2. Where the build actually is

**7 of 11 modules, plus the landing page.** M0–M6 are done and verified. The
week-4 checkpoint and first deploy were **skipped by the owner's decision**
(STATUS §5) — see §5 below for what that leaves.

```bash
cd API && dotnet test        # 531 passing, ~3–4 min
cd web && npm run build && npx oxlint src
./db/verify.sh               # must print ✓ IDENTICAL
```

**All three were green at the time of writing.** `psql` and `pg_dump` are at
`C:\Program Files\PostgreSQL\18\bin` and are not on PATH.

No schema change in M5 or M6 — every column both needed already existed.

---

## 3. What to do next — the UI parity pass, then M8, then M7

**Changed 2026-10-10, after this file was first written:** the owner put a UI
parity pass first. Most M1–M6 screens were written fresh rather than ported from
the reference, so the app works but looks like a different product — the
dashboard most of all. `BUILD_PLAN.md` §0 ("The UI parity pass") has the rules
and a ten-row inventory, starting with the role-based dashboard. Do that first;
the M7 notes below still apply once it is done.

### Then M7, payments and membership

`REQUIREMENTS.md` §9 is the spec. `BUILD_PLAN.md` calls week 7 *"the
highest-risk days of the project"* and says to port `tests/webhooks.test.ts` and
`tests/stripe-signature.test.ts` **before** writing the implementation. Add to
that list the second half of `tests/orders.test.ts` (lines 434–868) — M6 ported
only the first half, deliberately.

The plan puts **M8 (notifications) first in week 7**, because orders generate
notifications. That order still makes sense: M8 is small, and the one place it
hooks into orders is `OrderLifecycle.MoveAsync`.

What M6 left for M7, all at the safe default and all marked in code:

| Seam | Where | What M7 does |
|---|---|---|
| The payment provider | `Payments/IPaymentProvider.cs`, registered in `AddLeashCore` | Register the Stripe implementation in place of `DemoPaymentProvider`. `OrderService` already creates the order before the intent — the ordering a real card needs — so it should not change shape |
| Retryable refunds | `OrderLifecycle.RefundAsync` | Write a pending refund row **before** calling the provider. Today the refund runs after the status commits; the demo cannot fail, Stripe can |
| Free shipping (S5, S6) | `OrderService.PriceAsync`, `const bool freeShipping = false` | Read Leash Plus entitlements. The quote's `membership`, `shippingWaivedByMembership` and `membershipSavingsCents` already exist and are always "not a member" |
| Consult discount (V5) | `AppointmentService.CreateAsync`, `ConsultFee(…, 0)` | Pass the plan's `vet_consult_discount`. The three money columns are already written |
| Priority booking (C13) | `Services/LeadTime.cs`, `member: false` at both call sites | Ask whether the caller holds `priority_booking` |
| The payment state machine | — | The reference's `PAYMENT_TRANSITIONS`; M6 writes only `unpaid`, `paid`, `refunded` |

---

## 4. Decisions that are settled — do not re-open them

`STATUS.md` §5 is the full list. The ones most likely to be "fixed" by mistake:

| | |
|---|---|
| **`refillsLeft`**: 0 = exhausted, null = no limit, **spent at checkout** | Implemented in M6. **One refill per unit is pending the owner's confirmation** — see STATUS §4 |
| **Deleting a pet with clinical history is a 409** | Not a bug. Soft delete is a later pass |
| **No booking cancellation cutoff** | §11.1 as written. Revisit in M7 with penalties and refunds |
| **A cookie copied before sign-out keeps working** | Deliberate. Do **not** bump the watermark on logout |
| **A vet review is one-directional** | The owner reviews the vet. `ReviewKinds` exists for exactly this |
| **Completing a visit requires a summary** | There is no status button for `completed` |
| **The checkpoint and first deploy were skipped** | Owner's call, 2026-10-09 |
| **Ops moves of an order check authority before legality** | The opposite of bookings and appointments, on purpose — a customer is not a party to fulfilment |

---

## 5. The thing most likely to go wrong from here

**Nothing has ever been deployed, and the checkpoint that was meant to prove
otherwise was skipped.** That is the owner's decision and it stands; what it
means in practice is that every deploy problem is now deferred to week 8, which
is precisely the outcome `BUILD_PLAN.md` §7 warns about. The known ones, all in
STATUS §4:

1. **Nothing builds the SPA into `wwwroot`.** A deploy today serves the API and
   404s every page.
2. **`.github/workflows/` is empty** — no CI at all.
3. **`verify.sh` cannot run in CI** — its baseline is gitignored.
4. **Vulnerable transitive packages in the test project** — trips any
   vulnerability gate.
5. **The fulfilment job must run on one instance** once there is more than one.
6. **Host configuration** — `ConnectionStrings__Default`, `Auth__Secret`,
   `App__Origin` (never the `Host` header) — none of it exercised anywhere yet.

None of these is hard. All of them are cheaper now than in week 8.

---

## 6. Traps in this codebase that cost real time

`ARCHITECTURE.md` §9 has the standing list (now ten items). New in M6:

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

---

## 7. What was checked by hand over HTTP

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
