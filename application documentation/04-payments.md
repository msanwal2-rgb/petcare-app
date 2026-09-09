# 4. Payments, Membership and Billing

## 4.1 Status in one line

**Fully implemented, tested, and dormant.** The code path is complete —
provider, ledger, checkout, webhook, refunds, subscriptions, admin console — but
production runs the **demo provider** because `LEASH_PAYMENTS` is not set to
`stripe` and no Stripe keys are configured. No real money has ever moved.

Activating it is configuration, not code: see `docs/going-live.md`.

## 4.2 The provider seam

`lib/server/payments.ts` defines the interface the store talks to. It never
imports a payment SDK directly.

```ts
export interface PaymentProvider {
  readonly name: string;
  readonly asynchronous: boolean;   // does truth arrive by webhook?
  createIntent(input: { amountCents; currency; orderId; userId;
                        idempotencyKey; customerRef? }): Promise<PaymentIntentRecord>;
  getIntent(ref: string): Promise<PaymentIntentRecord>;
  cancelIntent(ref: string): Promise<PaymentIntentRecord>;
  refund(input: { ref; amountCents; reason?; idempotencyKey }): Promise<RefundRecord>;
}
```

Two implementations:

| | `DemoPaymentProvider` | `StripePaymentProvider` |
|---|---|---|
| File | `lib/server/payments.ts` | `lib/server/payments/stripe-provider.ts` |
| `asynchronous` | `false` — settles inline | `true` — truth arrives by webhook |
| Money | none; mints `demo_pi_…` | real |

`asynchronous` is the important field. It is why the demo provider can settle
during checkout while Stripe cannot, **without a second code path** — both go
through the same reconciler (§4.4).

### Selection fails closed

```ts
// lib/server/payments.ts
const mode = process.env.LEASH_PAYMENTS ?? "demo";
if (mode === "stripe") return new StripePaymentProvider();   // throws without a key
if (mode !== "demo") throw new Error(`Unknown LEASH_PAYMENTS value "${mode}"`);
if (process.env.VERCEL_ENV === "production")
  console.warn("[payments] the demo provider is active in production — no money will move");
```

`LEASH_PAYMENTS=stripe` with no `STRIPE_SECRET_KEY` **throws at startup** rather
than silently falling back to the demo — because that fallback would take
pretend money for real orders and tell customers they had paid. Same posture as
the assistant's 503 without a model credential and the cron's refusal without
`CRON_SECRET`.

`setPaymentProvider(next)` is the test injection point.

**Note on `authorize`/`capture`:** these were the original interface and are
**gone**, not deprecated. Keeping them as no-ops would have repeated the
`canTransitionPayment` mistake — a function that exists, is exported, is tested,
and is never called, which reads as covered and is not.

## 4.3 The ledger

`lib/server/payments/ledger.ts`. The `Payment` table is the record; the
`Order.paymentStatus` column is a denormalised copy for the fulfilment queue.

| Model | Purpose |
|---|---|
| `Payment` | one row per intent or invoice. `providerRef @unique` — the idempotency key |
| `Refund` | written **`pending` before** the provider is called |
| `WebhookEvent` | keyed on the provider's own event id |

**Why `Refund` is written first:** a crash between the write and the provider
call leaves a retryable `pending` row rather than a refund nobody knows was
owed. The previous code called the provider *after* committing an order to
`refunded`, and since `refunded` is terminal in `TRANSITIONS`, a provider failure
stranded the money with no supported path to retry.

### `applyIntentState` — the one reconciler

```ts
applyIntentState(intent, { eventAt }, db) → 
  | { ok: true; status; changed }
  | { ok: false; code: "unknown_payment" | "stale_event" 
                     | "illegal_transition" | "amount_mismatch" }
```

Three callers: the **webhook**, the **inline demo settle** in `createOrder`, and
the **client-initiated sync**. One function for all three is the design — the
demo path and the production path cannot drift because there is only one path.

It is **idempotent** (a `succeeded → succeeded` apply is a no-op that only
records `lastEventAt`), **order-aware** (`eventAt < payment.lastEventAt` →
`stale_event`), and **amount-checked** (a mismatch marks the payment `failed`
and refuses, rather than marking an order paid for the wrong sum).

Every `paymentStatus` write goes through here, and here calls
`canTransitionPayment`. That function was exported and unit-tested for months
without ever being called in production code; this is what made it real.

## 4.4 Checkout — the inversion

`lib/server/orders.ts` → `createOrder(userId, input, db)`.

```
BEFORE:  quote → authorize → capture → [tx: decrement stock, create order @ paid]
                                        ↑ crash here = money taken, no order, no trace

NOW:     quote → [tx: reclaim expired holds, decrement stock,
                      create order @ pending_payment, seed OrderEvent]
               → createIntent(idempotencyKey = orderId)      ← after commit
               → create Payment row, stamp order.paymentRef
               → if provider is synchronous: applyIntentState + settleOrderPayment
               → return { order, payment: { ref, clientSecret, provider } }
```

`pending_payment` was **dead code** before this — the happy path skipped it —
yet it already had a `TRANSITIONS` entry, `EVENT_COPY`, and a place in
`CUSTOMER_CANCELLABLE`. It finally means what it always said.

**Stock is reserved at order creation, not at settlement.** Deferring the
decrement to the webhook would let two customers both be told "order placed" for
the last unit and both succeed — and refunding a successful charge for goods
that do not exist is worse than a 15-minute hold. The `gte` race guard is
unchanged:

```ts
const { count } = await tx.product.updateMany({
  where: { id: line.productId, stockQty: { gte: line.quantity } },
  data:  { stockQty: { decrement: line.quantity } },
});
if (count === 0) throw new StockRaceError(line.productId);
```

The transaction timeout is raised to 15s (`{ timeout: 15_000, maxWait: 10_000 }`)
— ROADMAP records a real 5261ms observation against Prisma's 5s default.

### Reservation expiry without a cron

`lib/server/reservations.ts`. Holds last `RESERVATION_TTL_MINUTES = 15`, but
Vercel Hobby fires a cron **at most once a day**, so a 15-minute reaper cannot
exist. Instead holds are **reclaimable rather than reclaimed**:
`releaseExpiredReservations(productIds, now, tx)` runs *inside* `createOrder`'s
transaction, on exactly the products someone is trying to buy — the only moment
the answer matters. The daily cron then only tidies the *status* of abandoned
orders so they stop sitting in a customer's list.

This mirrors `advanceDueOrders`, which is time-based rather than
step-per-tick for the same reason.

## 4.5 The Stripe webhook

`app/api/webhooks/stripe/route.ts`, `runtime = "nodejs"`.

**This is the one route that must not use `parseBody`.** Signature verification
is computed over the exact bytes Stripe sent; parsing as JSON and
re-serialising produces a different string and the signature never matches. It
reads `await request.text()` and verifies before looking at the contents.

With `STRIPE_WEBHOOK_SECRET` unset it **refuses everything with 403** — the same
fail-closed posture as the cron.

### Idempotency: a claim protocol, not dedupe-on-insert

`lib/server/webhooks/store.ts`. The naive version — insert `received`, on
conflict return 200 — **loses events**: crash halfway through processing, the
retry hits the conflict, and the event is gone permanently with no symptom
except an order that never got marked paid.

| Claim | Meaning | Route answers |
|---|---|---|
| `new` | nobody has seen it | process |
| `duplicate` | already processed/skipped | 200 |
| `retry` | stale lock past `LOCK_TTL` (5 min), or previously failed | process again |
| `in_flight` | another worker holds it | **500**, so Stripe redelivers |
| `exhausted` | `MAX_ATTEMPTS` (5) reached | 200; a human replays it |

### Status codes are the design

**A business-level "no" answers 200.** `unknown_type`, `unknown_subject`,
`stale`, `noop_transition` — none of these become possible on a retry, and a 500
buys a three-day redelivery storm on an event that will be refused identically
every time. Only a genuine failure (database unreachable, a throw) answers 500.

### Events handled

`lib/server/webhooks/stripe.ts` → `handleStripeEvent(event, db)`:

`payment_intent.{succeeded, payment_failed, processing, requires_action, canceled}`,
`charge.refunded`, `charge.dispute.{created, closed}`,
`checkout.session.completed`, `customer.subscription.{created, updated, deleted}`,
`invoice.{paid, payment_failed, payment_action_required}`.

Two subtleties worth knowing:

- **`payment_intent.payment_failed` maps to `failed` from the event type, not
  the object.** The intent it carries has already reverted to
  `requires_payment_method` because Stripe keeps declines retryable — reading
  the status off the object would record a decline as "pending" and lose the
  failure code entirely.
- **`charge.refunded` reconciles refunds issued from the Stripe dashboard.**
  Finance staff will do that, and this is what makes it flow back into the app.

**Ordering is by `event.created`, never arrival.** Subscription payloads carry
complete state, so last-writer-wins is correct only if "last" means most
recently *created*. `lastEventAt` on `Payment` and `Subscription` guards it —
without which a delayed `past_due` landing after a later `invoice.paid` silently
strips a paying member's benefits.

## 4.6 Leash Plus — the membership

One plan, seeded by migration `…09` into the `plans` table:
`leash_plus`, $9.99/month, entitlements
`["free_shipping", "vet_consult_discount", "priority_booking"]`,
`consultDiscountPct: 20`.

### Membership is never a session claim

`lib/server/entitlements.ts` → `getMembership(userId, now, db)` reads the
database in the same request that prices the thing.

**Why:** with no adapter there is no session to invalidate, so a `plus: true`
claim would keep asserting itself after a cancellation for the token's whole
30-day life — and the *user* controls when they re-authenticate. Refreshing it
per request means a database read anyway, in a file that must stay Prisma-free
for the Edge proxy.

`active` is true when the subscription is `trialing | active | past_due` **and**
(not past-due, or `now < graceEndsAt`) **and** `now < currentPeriodEnd`.
`DUNNING_GRACE_DAYS = 7`: a card expiring should not strip someone's free
shipping mid-order while Stripe is still retrying.

### The three benefits are enforced, not displayed

| Benefit | Enforced in | How |
|---|---|---|
| Free shipping | `quoteCart` → `shippingFor(subtotal, { freeShipping })` | `lib/pricing.ts` stays dependency-free; it takes a boolean, and `quoteCart` reads the membership itself |
| 20% consult discount | `createAppointment` | snapshots `baseFee`, `discountPct`, `fee` — a later lapse cannot rewrite a quote |
| Priority booking | `createAppointment` | members may request a slot 2h out, others 24h (`lib/booking-priority.ts`) |

**There is no membership field in `quoteCartSchema` or `createOrderSchema`.**
There is nothing for a client to lie about; `userId` comes from `requireUser()`.

### Lifecycle

Signup is **Stripe Checkout** (hosted redirect), not a home-built form — it
brings SCA/3DS, tax and promo codes, and the Billing Portal removes an entire
admin surface for card updates and invoice history.

The redirect back is **not the truth**; the webhook is. `/account/membership`
polls `POST /api/membership/sync` up to five times while a checkout settles.

Endpoints: `GET /api/membership`, `POST /api/membership/{checkout, cancel,
resume, portal, sync}`. Cancellation is **at period end** — they bought the
month, they keep the month.

## 4.7 Adoption fees

`lib/server/adoptions/payment.ts`. The same ledger, with `Payment.kind =
"adoption_fee"` and `Payment.adoptionApplicationId @unique`.

**`applyIntentState` needed no change at all** — it keys on `providerRef`. That
is the payoff of the ledger design.

Two rules:

- **The applicant pays; the shelter completes.** Money moves when the payer
  acts; the handover is recorded by the party who hands over.
- **Zero-fee adoptions skip intent creation entirely.** Many shelters waive
  fees, and a $0 intent would be rejected by Stripe and throw in the demo
  provider.

Rejecting or withdrawing an application that has already paid **refunds it**
(`lib/server/adoptions/applications.ts` calls `refundAdoptionFee`). Reversing a
*completed* adoption deliberately does **not** — that is a conversation between
a shelter and a person, and auto-refunding would quietly make every returned
animal free.

## 4.8 Order status machine

`lib/server/orders.ts` → `updateOrderStatus`.

```
pending_payment → paid → processing → packed → shipped → out_for_delivery → delivered
                    ↘ cancelled / refunded (terminal)
```

Four corrections live here, all money bugs rather than tidying:

1. **It no longer calls the payment provider.** `refunded` is a state the order
   *reaches* when `charge.refunded` arrives.
2. **Cancelling a paid order refunds it.** It used to restock and set
   `cancelled` while leaving `paymentStatus: "paid"` — the customer's money
   simply stayed.
3. **Restocking only when the goods never shipped.** `delivered → refunded` is
   legal, and restocking it credited inventory for a bag of food in someone's
   kitchen. An explicit `restock` flag covers a physical return.
4. **The status write is conditional** —
   `updateMany({ where: { id, status: from } })` → `concurrent_change`. There are
   three writers now: the ops console, the cron, and the webhook.

The console's `NEXT_STEP` map deliberately has **no `pending_payment` entry**:
once that status is real, "Mark paid" would let ops ship an unpaid order,
bypassing the provider. `getOrdersForFulfillment` excludes it too.

## 4.9 Admin visibility

`/dashboard/admin/payments` (role `finance`) — the ledger with captured/refunded
totals over the *filtered* set, and full or partial refunds through the same
`requestRefund` a cancellation uses.

`/dashboard/admin/subscriptions` (role `finance`) — members, dunning state,
cancel-at-period-end, extend grace, normalised MRR (an annual plan contributes a
twelfth of itself).

## 4.10 What to be careful about

- **Never re-add `authorize`/`capture`.** The asynchronous shape is the correct
  one; the synchronous one cannot express a 3-D Secure challenge.
- **Never let `updateOrderStatus` call the provider again.**
- **Never widen `proxy.ts`'s matcher to `/api`** — it would put a redirect in
  front of the webhook.
- **Register the production webhook URL, not a preview.** Vercel's deployment
  protection puts a login page in front of previews; Stripe's events bounce off
  it and orders sit unpaid with money taken.
- `WebhookEvent.payload` contains email addresses and card last-fours. The daily
  cron purges `processed`/`skipped` events older than 90 days.
