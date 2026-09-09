# 14. Key workflows, traced

Five flows worth reading before changing anything near them. Each is traced
through real code.

## 14.1 Placing an order

```
/store/cart          quoteCart(lines, petId)  → POST /api/orders/quote
                     re-quotes on EVERY quantity change
                     problems.length > 0 blocks the button

/store/checkout      Address → Review → Pay   (ProgressLeash)
                     placeOrder()             → POST /api/orders
```

`createOrder` — the ordering here is the whole design:

1. `quoteCart` re-prices every line against the live catalog and evaluates the
   prescription gate. The client's price snapshot is ignored.
2. **The order row is created first**, then stock is taken with the conditional
   `updateMany`, all in one transaction.
3. **Only then** is a payment intent created.

**Checkout is inverted deliberately.** The row exists and holds its stock before
money moves, so a provider failure is `502 { orderId }` — retry the payment
step, not the whole cart — rather than a charge with no order behind it.

Then:
- the browser confirms the card with Stripe Elements (cards never touch a Leash
  server) and the cart is `clear()`ed *immediately*, because the order already
  holds the stock and a full cart would allow a duplicate;
- `?paid=1` on the order page triggers `syncOrderPayment` — *the browser knowing
  the card cleared is not the server knowing*;
- the authoritative update arrives on the Stripe webhook and runs through
  `applyIntentState`, keyed on `providerRef`.

## 14.2 Cancelling an order

`canCustomerCancel(status)` (`lib/delivery.ts`) allows
`pending_payment | paid | processing | packed`. `updateOrderStatus`:

- issues a refund through the ledger on cancel,
- **restocks only if the order never shipped**,
- guards the transition with a conditional `updateMany`,
- **re-reads the order after a refund**, because the in-transaction snapshot
  predates it (this was a real bug: the response showed stale totals).

The ops console at `/dashboard/orders` deliberately has **no "Mark paid"
action** — it would let staff ship an unpaid order past the payment provider.

## 14.3 A prescription unlocking a store product

Two lines in `quoteCart` are the entire mechanism:

```ts
const authorized = petId ? await authorizedProductSlugs(petId, undefined, db) : null;
...
if (product.requiresPrescription && !authorized?.has(product.slug)) {
  problems.push(problem(product.id, "prescription_required", …));
  continue;
}
```

Three properties follow:

- **No `petId` ⇒ every Rx product is blocked.** `?.has()` on `null` is
  `undefined`. Fails closed.
- **The slug list is the whole authorisation.** Species, the record's
  `medicationName`, the vet's identity — none of it is consulted. Only
  `productSlugs` from an unexpired, non-exhausted `prescription` record.
- **A blocked line is `continue`d**, so it never reaches the quote and
  contributes nothing to the subtotal.

⚠️ Two known problems live here: `POST /api/orders` does not verify the caller
owns the pet (§11.7 S-1), and refills are never decremented (§13.4.1).

## 14.4 Completing an adoption — the highest-stakes flow

`lib/server/adoptions/transfer.ts`. Actors are split on purpose:
**`/payment` is applicant-only** (money moves when the payer acts) and
**`/complete` is shelter-only** (handover is recorded by the party who hands
over).

**Phase 0 — preconditions, all reads.** Application is `approved`; the actor
owns the shelter profile; `pet.ownerId` is still the shelter's (the idempotency
guard); the fee is zero or settled; **no live `Booking` or `VetAppointment`** —
and the ids come back so the UI can name them.

**Phase 1 — one transaction.**

```ts
const moved = await tx.pet.updateMany({
  where: { id: pet.id, ownerId: shelter.userId },
  data:  { ownerId: application.applicantId, ownedSince: now },
});
if (moved.count !== 1) { raced = true; return; }
```

The `where` clause re-asserts the precondition inside the transaction, because
Phase 0 ran outside it and two concurrent completes could both pass. Exactly one
wins. Then the listing → `adopted`, the application → `completed`, and every
rival application on the listing → `rejected` with a note.

> **Severing appears nowhere in this list. It *is* the ownership write.**
> Because `canViewPet` and `canAccessPetRecords` both require the engagement's
> `createdAt >= pet.ownedSince`, that one `UPDATE` revokes every caretaker and
> vet granted under the shelter — atomically, with no revocation rows and no
> partially-severed state. The mechanism runs both ways for free, which is what
> makes the reversal route thirty lines.

**Phase 2 — after commit, best effort.** `notify` the adopter and each closed
co-applicant. `notify()` never throws.

**The live-engagement override.** Refusing is the default, because cancelling a
sitter's booking out from under them while the animal is in their house, from a
flow they are not party to, is worse than refusing. But in this data model a
*fostered* animal is a pet under a long boarding booking, so a bare refusal
would block most real adoptions. The override cancels the named engagements and
notifies both parties — deliberate, with the ids shown, never a silent sweep.

**Return and relist.** `POST /api/admin/adoptions/:id/reverse`,
`requireStaff("support")`, audited: ownership back to the shelter with a fresh
`ownedSince` (severing the *adopter's* caretakers and vets in the same motion),
listing reopened. It exists because adoptions fall through, and without a path
someone would reopen the ownership backdoor by hand in production.

**Failure modes.** The one real money-stranding path is "payment settled,
`complete` never called" — detectable as `approved` + `paid`, and surfaced at the
top of the shelter's queue. A refund after completion does **not** auto-reverse
ownership; reversing programmatically would reopen every grant just severed.

## 14.5 Signing in, and the redirect trap

```
/login → loginWithPassword() → signIn("credentials", { redirect: false })
       → navigateAfterAuth(fallback)   ← full window.location.assign
```

**Never use `router.push` across an auth change.** Visiting a guarded route
while signed out — by clicking it *or by Next prefetching it* — makes `proxy.ts`
answer 307 → `/login`, and the App Router **caches that redirect against the
route**. A later client navigation replays it: the user signs in and bounces
back to `/login` with nothing to explain it. `router.refresh()` does not evict
it.

`navigateAfterAuth` honours a same-origin `?callbackUrl` via `safeInternalPath`;
sign-out passes `honorCallback: false`. `AuthRequired` carries the current page
as `callbackUrl` so client-gated pages behave identically. `SiteHeader` only
prefetches guarded links once a session exists.

**Reproduce with `npm run build && npm start`. `next dev` hides it.**

## 14.6 The webhook claim protocol

Not dedupe-on-insert, which loses events. Every incoming Stripe event is
*claimed* into `WebhookEvent` with one of five outcomes — **new**, **duplicate**,
**retry**, **in_flight**, **exhausted** — and only `new` and `retry` proceed to
handling. `applyIntentState` is the single reconciler and keys on
`providerRef`, which is why adding `Payment.kind = "adoption_fee"` required no
change to it at all.
