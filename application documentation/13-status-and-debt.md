# 13. Status: what is complete, what is not, what is broken

This is the section to read before promising anything to anyone.

## 13.1 There are no TODO markers

Confirmed: `grep -rn "TODO\|FIXME\|HACK\|XXX"` across the codebase returns
**zero** matches. (Every apparent hit was a `placeholder=` prop.)

**Do not read that as "nothing is unfinished."** It means unfinished work is not
marked in the code, so this document and `ROADMAP.md` are the only inventory.
Everything below was found by reading, not by grepping for markers.

## 13.2 Complete and working

| Feature | Evidence |
|---|---|
| Caretaker search, booking, status machine, messaging | route + domain + tests + e2e |
| Vet search, appointments, visit summaries, prescriptions | same |
| Health record, including the prescription → store gate | `medical-records.test.ts`, `orders.test.ts` |
| Store: catalog, filters, cart, quote, checkout, tracking, cancellation | `orders.test.ts`, e2e journeys |
| Payment ledger, refunds, the webhook claim protocol | `webhooks.test.ts`, `stripe-signature.test.ts` |
| Leash Plus entitlements (shipping, consult discount, lead time) | `entitlements.test.ts` |
| Reviews, both directions for bookings, one-way for vets | `reviews.test.ts` |
| Reputation (running average, response rate) | `reputation.test.ts` |
| Notifications + email mirroring | `notifications.test.ts` |
| Admin console: users, professionals, payments, subscriptions, settings, audit | `admin.test.ts` |
| Shelter adoption: listings, applications, fee, transfer, reversal | `adoption-transfer.test.ts` |
| Support assistant: 27 tools, retrieval, rate limits, refusals | 5 test files |
| Auth: password, reset, verification, revocation, staff roles | `auth.test.ts`, `access.test.ts` |

## 13.3 Built but not activated — blocked on credentials only

No code is needed for any of these. Each fails closed and visibly today.

| Feature | State without the credential |
|---|---|
| **Stripe payments** | demo provider settles inline; membership checkout returns **503** rather than pretending |
| **Google sign-in** | the button is hidden on `/login` and `/signup`; it appears on its own once configured |
| **Real email** | `mailer.ts` logs the message instead of sending |
| **AI Gateway route** | needs a card on the Vercel account (the assistant currently runs on OpenRouter) |

## 13.4 Partially implemented — UI exists, the mechanism does not

These are the ones that look finished and are not.

### 13.4.1 Refills are never decremented

`refillsLeft` is written at record creation and **never updated by anything**.
Confirmed by grep: the only references are the schema, the serializer, the
`activePrescriptions` filter and the assistant presenter.

So a prescription with `refillsLeft: 3` authorises **unlimited** purchases until
`expiresAt`. The gate's own docstring — "`refillsLeft === 0` does not count,
since the authorisation is used up" — describes a state the system can only
reach by a vet editing the record by hand. The product page prints "3 refills
left" and that number never moves.

### 13.4.2 Read receipts are dead by construction

`Message.readAt` is written, serialized, exposed on the API type — and read by
**no component**. There is no unread-message badge anywhere.

Worse, `GET /api/bookings/:id/messages` calls `markMessagesRead` *before*
serializing, so the response can never contain an unread inbound message. A
`GET` mutates, and `MessageThread` polls it every 8 seconds, so leaving a
booking page open in a background tab marks everything read continuously. Any
future unread feature has to unpick this first.

### 13.4.3 Assistant conversation rehydration does not render

`AssistantPanel` passes `messages: initial ?? []` to `useChat`, but `initial`
arrives asynchronously and the chat is only recreated when `id` changes — which
it never does. A reloaded thread keeps its server-side id and loses its visible
*and* model-visible history. See §9.10 A-1.

### 13.4.4 Assistant token accounting

`AssistantMessage.inputTokens` / `outputTokens` are **always 0** — `onFinish`
never passes usage. The schema comment calls them "the cost dashboard". Dead
columns.

### 13.4.5 Deep-link pre-fill is partial

`startCaretakerBooking` and `startVetAppointment` produce links carrying
service, dates and pet. `/booking/new` reads only `caretakerId`; `/vets/book`
reads only `vetId` and `date`. The remaining parameters are ignored, so the form
opens partly filled rather than fully.

### 13.4.6 The assistant corpus is stale

`npm run kb:ingest` needs re-running: the ingested corpus **describes a store
with no membership**, and predates refunds and the lead-time rules.

## 13.5 Known bugs

Ranked. All confirmed by reading the code.

| # | Bug | Where | Severity |
|---|---|---|---|
| **B-1** | `POST /api/orders` performs no `ownsPet` check, so a stranger's `petId` can be used to buy Rx products and to probe which prescriptions that pet holds. `/api/orders/quote` does check. | `app/api/orders/route.ts` | **High** |
| **B-2** | Notification email interpolates `title`, `body` and `user.name` into HTML with no escaping; `appointment.reason` and `application.petName` are user-controlled. | `notifications.ts` | Medium |
| **B-3** | Assistant rehydration never renders (13.4.3). | `AssistantPanel.tsx` | Medium |
| **B-4** | The assistant passes the client-supplied `messages` array to the model, defeating the stated reason for persisting only the newest turn. No data leak. | `assistant/chat/route.ts` | Medium |
| **B-5** | `void emailIfPossible(...)` is not awaited; on serverless the invocation can be torn down before the mail is sent, silently. | `notifications.ts` | Medium |
| **B-6** | `admin/professionals.ts` sends `kind: "membership_started"` for "Your profile has been verified". Wrong kind; there is no `profile_verified` in the union. It survives because the icon happens to fit. | `admin/professionals.ts` | Low |
| **B-7** | Opening the notification bell calls `markNotificationsRead()` with no id, clearing **all** unread rows — but the list is capped at 30, so items the user never saw are marked read. | `NotificationBell.tsx` | Low |
| **B-8** | The bell does not poll. A notification arriving while a page is open is invisible until navigation — inconsistent with `MessageThread`, which polls the same class of update every 8s. | `NotificationBell.tsx` | Low |
| **B-9** | Booking reviews render with no `author`, so every one shows "Verified customer" and a grey circle. The vet and caretaker pages do pass an author. | `app/booking/[id]/page.tsx` | Low |
| **B-10** | `VisitSummaryForm` writes `refillsLeft: Number("")` → `0` if the vet clears the field, silently creating a prescription the gate reads as exhausted. Its default type list also **excludes `allergy`**, which the server permits and which drives allergen filtering. | `VisitSummaryForm.tsx` | Low |
| **B-11** | `scripts/e2e/sweep.mjs` never calls `process.exit`, so it exits 0 even when checks fail. | `sweep.mjs` | Low |
| **B-12** | `ProgressLeash` divides by `steps.length - 1`; a one-step array yields `NaN` coordinates and an unrenderable SVG. No guard. | `ProgressLeash.tsx` | Low |
| **B-13** | `getReviewsForSubject` and the duplicate-review check filter on `bookingId` only, not `kind`. Safe today because ids are globally unique; a collision would cross the two review types. | `reviews.ts` | Low |
| **B-14** | `createRecord` does not validate `appointmentId` against the pet or the vet. A record can be stamped with an unrelated appointment's id and mis-file itself on the appointment page. | `medical-records.ts` | Low |
| **B-15** | `createOrder`'s transaction has been observed at 5261 ms against Prisma's 5 s default interactive-transaction timeout. Passes in isolation. | `orders.ts` | Low |

**Unknown, not confirmed:** `activePrescriptions` filters with
`NOT: { refillsLeft: 0 }` on a **nullable** column. No seeded prescription has
`refillsLeft: null` (all null-refill seed records are `visit_note`,
`vaccination`, `weight` or `allergy`), so whether Prisma's `NOT` includes NULL
rows here has never been exercised. If it excludes them, a vet who leaves
refills blank creates a prescription that silently unlocks nothing. Worth an
explicit `OR: [{ refillsLeft: null }, { refillsLeft: { gt: 0 } }]` and a test.

## 13.6 Duplication worth removing

**Not deliberate:**
- **Allergen matching exists three times** — `allergenClash()` in
  `StoreCatalog.tsx`, an inline copy in `app/store/[slug]/page.tsx`, and a
  server-side twin.
- **"Is this prescription active?" exists four times** — `activePrescriptions`
  (SQL), `HealthRecordSection`, `MedicalRecordCard.prescriptionActive`, and an
  inline `.find` on the product page. **Only the first gates money**; the other
  three agree with it by coincidence.
- **The max-quantity 20** is `MAX_PER_LINE` in `lib/store/cart.ts` and a bare
  `Array.from({length: 20})` in the cart page.
- **Both review POST routes are byte-identical** but for two string literals;
  only the error mapping was factored out.
- **`fromUserId` in the review body** is redundant — both routes carry the same
  `if (body.fromUserId !== auth.uid) return forbidden()`. Passing `auth.uid` as
  an argument, as `createAppointmentSchema` already does, deletes both checks.
- **`DEFAULT_EMBED_MODEL`** is duplicated as a string literal in two other
  files — one value, three copies.

**Deliberate, documented, leave alone:** the bezier curves in `lib/motion.ts`
vs `globals.css`; the palette hexes in `ToastProvider`, `StatusBadge`,
`ProgressLeash` and the Stripe appearance object (Framer, SVG and Stripe cannot
read Tailwind theme variables); client display arithmetic vs the server quote,
reconciled through the shared `lib/pricing.ts`.

## 13.7 Dead code

`isRefusal` (exported, never imported) · `toolNames()` · `AssistantUIMessage` ·
`listConversationsByUser` (self-documented as not yet surfaced) ·
`StreamOptions.deps` (test-only seam) · a re-exported `EASE_OUT` ·
`DEFAULT_EMBED_MODEL`.

**Stale comments** — worth fixing because they mislead:
- `embed.ts`'s header says embedding happens "at ingest time, never on a
  request". It is wrong: `searchKnowledge` embeds the query at request time.
- `model.ts` says "a 25-tool surface"; it is 27 signed in, 23 anonymous.
- `context.ts` and `tools/index.ts` say `uid` comes from `requireUser()`; the
  chat route deliberately uses `auth()`.
- `authorizedProductSlugs`'s docstring claims the product page calls it. It does
  not — the page re-derives from `getRecordsForPet`.

## 13.8 Not built at all

- **Payouts.** Money comes in; nothing goes out. Caretakers, vets and shelters
  are paid nothing and Leash takes no commission. This is the next substantial
  phase and it is bigger than it looks: Stripe Connect onboarding, making
  bookings and appointments *payable* at all, payout scheduling, reversals, 1099
  reporting. Note the money-representation split (cents vs Float USD) spans it.
- **Notification preferences.** `notify()` is the single gate; nothing exists.
- **A `/notifications` page.** The bell caps at 30 with no "see all".
- **Review edit, delete or moderation.** No inverse exists for the running
  average.
- **Text search and pagination for caretakers and vets.** Both filter in memory
  and sort by distance or rating. The store's `searchProducts` does it properly
  in Postgres and is the pattern to copy.
- **Email change.** `updateUserSchema` no longer accepts `email`; re-verifying a
  new address is unbuilt, though the token type exists.
- **Background checks / ID verification.** `backgroundCheckStatus` is
  admin-writable and display-only; a real integration needs a vendor.
- **Shelter reviews, foster placements, meet-and-greet scheduling.**
