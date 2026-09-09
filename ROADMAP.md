# What's left

A companion to `README.md`, which describes what the app *is*. This is what it
still isn't. Ordered by what actually blocks the product, not by effort.

## Blocked on credentials — no code changes needed

| | What to do | Effect |
|---|---|---|
| **Stripe keys** | Provision through the Vercel Marketplace: `vercel integration add stripe`, then `vercel env pull`. Create the Leash Plus product and price in Stripe and write the price id into `plans.stripePriceId`. Register `/api/webhooks/stripe` as an endpoint and set `STRIPE_WEBHOOK_SECRET`. Then `LEASH_PAYMENTS=stripe`. | Real card payments and real memberships. Everything around them is built and tested: the ledger, refunds, the webhook, the entitlements, the admin consoles. Until the keys exist the demo provider settles inline and the membership checkout answers 503 rather than pretending. |
| **Google sign-in** | Create a Google Cloud OAuth client. Redirect URIs `https://petcare-app-drab.vercel.app/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` on every Vercel scope and in `.env.local`. | The "Continue with Google" button is already built on both `/login` and `/signup`; it is hidden until the provider is configured and appears on its own once it is. |
| **Real email** | Create a Resend account, set `RESEND_API_KEY` and `EMAIL_FROM`. | Notifications, email verification and password resets already route through `lib/server/mailer.ts`. Without a key it logs the message; with one it sends. (`EMAIL_DEV_MODE` is now forced off in production regardless of its value.) |

## The next substantial piece: payouts

Money now comes *in*. It does not yet go *out*: caretakers and vets are paid
nothing, and Leash takes no commission. That is the natural next phase now that
the ledger exists, and it is a bigger piece than it looks —

- Stripe Connect express accounts for caretakers and vets, with onboarding and
  identity verification.
- A platform fee on bookings and appointments, which means bookings and
  appointments have to become *payable* at all. Today they record a price and
  charge nobody; `Booking.priceTotal` and `VetAppointment.fee` are
  server-authoritative, which is the prerequisite, but no payment intent is
  ever created for either.
- Payout scheduling, reversals when a booking is cancelled after payout, and the
  1099 reporting that follows from holding money on someone's behalf.

Note the money-representation split before starting: the store is integer cents,
bookings and vet appointments are Float USD. Payouts span both.

## The support assistant: what is left

The assistant ships answering questions, reading the signed-in customer's
records, and cancelling orders, bookings and appointments. Two things around it
are unfinished:

- **A production corpus.** `npm run kb:ingest` needs a real embedding model, and
  the corpus should be re-ingested now that membership, refunds and the
  lead-time rules exist — it currently describes a store with no membership.
- **Deep-link pre-fill.** `startCaretakerBooking` and `startVetAppointment`
  produce links carrying service, dates and pet. `/booking/new` reads
  `caretakerId` and `/vets/book` reads `vetId` and `date`; the remaining params
  are ignored, so the form opens partly filled rather than fully.

## Adoption: what is left

The module ships with listings, applications, the fee, the transfer and a
staff route to put an animal back. Three things around it are deliberate gaps:

- **Shelter reviews.** `ShelterProfile` has no `rating` or `reviewCount`, and
  should not until `Review.kind` grows an `"adoption"` arm and
  `reputation.ts` gets a third `applyRating` path. Shipping the columns first
  is what `backgroundCheckStatus` did, and it meant a badge nothing could
  write. `responseRatePct` *is* wired, because it is computable.
- **Foster as a first-class thing.** Today a fostered animal is a pet under a
  long boarding booking, which is why completing an adoption refuses while one
  is open and offers an explicit override. A real foster model would make that
  refusal unnecessary.
- **Meet-and-greet scheduling.** Shelters arrange these by phone right now.
  The booking machinery already exists and could carry them.

Also worth knowing: `ownedSince` fixes access that outlives *ownership*, not
access that outlives *time*. Under a single owner, a vet who saw a pet once in
2019 still has record access — and record access includes writing prescriptions,
which unlock Rx products in the store. A trailing window on
`canAccessPetRecords` is the fix, and it needs its own change with its own seed
adjustments (the seeded appointments are only ~90 days old).

## Smaller, unblocked

- **Notification preferences.** Per-user opt-out per kind. `notify()` is the
  single place every notification passes through, so this is one gate. Now more
  worth doing: membership dunning adds a category people will want to control.
- **A `/notifications` page.** The header bell shows the most recent 30 and has
  no "see all".
- **Review moderation.** The admin console can suspend an author but cannot
  remove a review, and that is deliberate rather than forgotten: ratings fold
  into a **running average** in `lib/server/reputation.ts`, and `reviewCount`
  includes reputation that predates this database. There is no arithmetic that
  un-folds one review. Doing this properly means storing the accumulator's
  inputs, or recomputing from rows and accepting that pre-database reputation is
  lost.
- **Search relevance.** Caretaker and vet search filter in memory and sort by
  distance or rating — no text search, no pagination. The store's
  `searchProducts` does this properly in Postgres, and the admin user list and
  payments ledger now follow it too; those are the pattern to copy.
- **Seed freshness.** Orders, memberships and payments are timed relative to
  when the database is seeded. Bookings, appointments and medical records are
  still pinned to a fixed `TODAY`, so seeded "upcoming" items drift into the
  past. Fixable the same way, but many tests assert on those ids and statuses.
- **Email change.** `updateUserSchema` no longer accepts `email`, because
  changing the identifier an account is recovered by needs re-verification of
  the new address and there is no such flow. Building it is a small, contained
  piece: a token type already exists.
- **Test runtime.** Around 40 minutes now. Almost entirely network round trips
  to Neon. A local Postgres in CI, or transaction-rollback isolation instead of
  the snapshot restore, would cut it sharply.

## Deliberately not planned

Background checks and ID verification beyond the status field the admin console
now writes — a real integration needs a vendor (Checkr, Stripe Identity). SMS
and push channels. Anything that would make the demo accounts harder to explore.
