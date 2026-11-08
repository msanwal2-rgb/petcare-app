# Leash — handoff

For whoever picks this up next. Written at the end of **M10, adoption**, 2026-10-18 — the last module in the plan — and **brought up to date on 2026-11-08** after the client's first round of new work (§0).

---

## 0. The 2026-11-08 session — read this first

**Done and committed** (all on `main_newDev`, rehman427, no trailer, not pushed):

| Commit | What |
|---|---|
| `68bc20b` | Dashboards (STATUS §3-D): three cards counted by the API (`/vets/{id}/stats`, `/caretakers/{id}/stats`, `/me/stats`), the schedule lists' `?from=&to=&status=` window, the shared Upcoming + calendar + day panel, vet **reschedule** (`POST /appointments/{id}/reschedule`, owner notified in-app and by email) |
| `1745cdb` | Vet booking stores slot times in the owner's zone, not UTC |
| `e5f4230` | **Availability editor** on the vet and caretaker profile pages (STATUS §3-AV); the booking calendar is a real month calendar; stricter availability validation |
| `c13fa40` | Upcoming as a card row above a full-width calendar; the day panel scrolls into view |
| `07f2f4f`, `a9f9a8d` | Calendar motion: the day box flies into the panel on every opening, gliding selection, pointer, directional content slide |
| `93e9fa4` | **The server checks every booking and visit against the published calendar** (STATUS §3-G) — signed in or not, 409 `not_available`; requests carry `utcOffsetMinutes`; the caretaker form shows the calendar |
| `2115c01` | **Guest booking API** (STATUS §3-G): `POST /guest/bookings`, `/guest/appointments`, `/auth/set-password`; guest/pending users who cannot sign in; the set-password link; guests emailed by the outbox; `guestContact` for the provider |
| (the commit after) | Guest booking screens (login "Continue as guest", the guest form, `/booking/requested`, `/set-password`) and these docs |

1150 tests pass; web build, `oxlint --deny-warnings` and `verify.sh` are clean.
No schema change — `db/changes` still ends at 005.

**Next:** the **shelter dashboard** is the one dashboard not reworked. The
client has not given its brief — ask what they want before building. Reuse
`web/src/components/dashboard/schedule/` (`ScheduleOverview`, `StatCards`,
`ProfileStrip`) the way the vet, caretaker and owner dashboards do. Anything
else the user brings comes through `FEATURE_PROMPT.md`.

**`petapp_dev` right now:** Dr Ruiz (v1) has Mon–Fri published to early
January plus Saturday 5 December — the only bookable provider; every other
vet and caretaker has only the seed's July 2026 days until someone opens days
in the editor. All seeded bookings and visits are June–July 2026, so
"Upcoming" reads 0 everywhere; page the calendar back to July. Test rows made
during the walks were deleted and v1's response rate recomputed. Since §3-G
the server refuses bookings outside published days, so **only Dr Ruiz can be
booked** on `petapp_dev`. The guest-booking walk's rows were all removed.

**New traps from this session:**

- **Booking now needs published days — in tests and in `petapp_dev`.** A
  suite that books must open the provider's calendar first
  (`Infrastructure/Calendars.cs`: `OpenCaretakerAsync`, `OpenVetAsync`,
  `SetCaretakerDayAsync`…), and book at a fixed hour (`Calendars.DaysAhead(3,
  10)`) rather than "now + 3 days", or a vet visit can straddle midnight UTC.
  On `petapp_dev` no caretaker has future days: open some in the editor (or by
  SQL, then remove them) before walking a caretaker booking.
- **Guest routes are rate-limited in the database** (`rate_limit_hits`,
  buckets `guest-booking:*`, `auth:set-password`): five guest bookings an hour
  from one machine. A repeated walk hits it — clear those buckets.
- **A guest is a user with `status` guest/pending and no password.** Anything
  new that reads `status` must decide what it means for them (login, Google
  linking, the outbox and admin "reactivate" already do). `AccountStatus.IsUnclaimed`.
- **Headless walks: lazy pages render a skeleton first** — wait for text on
  the page, not for the URL, before asserting.
- **`node -e` with JSX or apostrophes breaks in the Bash tool** — write a
  script file in the scratchpad and run that.

- **The user runs their own servers** — the API from Visual Studio on :5001,
  Vite from a VS Code terminal on :5173 or :5174 (`Cors:Origins` in their
  uncommitted `appsettings.Development.json` allows 5174 — never commit that
  file). Check who owns a port before starting anything
  (`Get-NetTCPConnection -LocalPort …` → `Win32_Process` parent chain); if
  theirs is up, use it. Never stop their processes.
- **Stopping a background shell does not stop `npm run dev` or `dotnet run`
  under it** — the node/dotnet child survives and keeps the port. Clean up with
  `taskkill /T /F /PID <the npm or dotnet parent>` after confirming it is yours.
- **AnimatePresence revives an exiting child with the same key** — state set
  once at mount does not run again. The day panel's flight therefore follows
  its `origin` prop (DayPanel.tsx). Anything else animated on mount inside an
  AnimatePresence needs the same care.
- **Headless walks: scroll well past 8px before clicking.** The site header
  shrinks at 8px of scroll and can loop by 1px at that exact point (STATUS §4),
  which makes Playwright report "element not stable".
- **FluentValidation names a `x!.Value` rule `x.Value`** — use
  `.OverridePropertyName("x")` so the envelope's `path` matches the field.
- **No Python on this machine**, and long heredocs with backticks can break the
  Bash tool — write files with the editor instead.

This file is the short version and the things that are true *right now*. It does
not repeat the permanent docs — read them in this order:

| | |
|---|---|
| `STATUS.md` | What is done, what is next, what is open, what is decided. **Start here.** |
| `ARCHITECTURE.md` | How the code is organised and how to add a feature. **Read before writing code.** |
| `REQUIREMENTS.md` | The durable spec. §9 is M7. |
| `BUILD_PLAN.md` | Order of work, the decisions, the risks. §0 is where the plan stands. |
| `API_CONTRACTS.md` | Every endpoint of the reference implementation. |
| `NEXT_PROMPT.md` | The next session's brief: the client's decisions to fill in (§1), the work for each answer (§3), and the owner's deploy steps (§5). |
| `FEATURE_PROMPT.md` | A fill-in prompt for any later improvement or new feature: how the API and web app are laid out, the rules, and the steps. |

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

**All 11 modules** (M0–M10), the landing page, the UI parity pass, release
hardening, and an IIS deployment (`deploy/README.md`).

```bash
cd API && dotnet test        # 1150 passing, ~7 min
cd web && npm run build && npx oxlint src --deny-warnings
./db/verify.sh               # must print ✓ IDENTICAL
```

All three green at the end of M10. M10 needed no schema change, so change
scripts still run to `005`; **006 is next**.
`petapp_dev` and `leash_review` are both at 005 (`leash_review` is updated by
hand — deploy/README.md). `psql` and `pg_dump` are at
`C:\Program Files\PostgreSQL\18\bin` and are not on PATH.

The architecture since `727490f`: **two sites**. The SPA reads the API's
address from `web/public/config.js`; the API allows the SPA in `Cors:Origins`;
every call sends `credentials: "include"`. In development Vite on :5173 calls
the API on :5001 directly — there is no `/api` proxy. Keep new endpoints
working cross-origin; do not revert this.

---

## 3. What to do next

**The client's work since M10 is in §0** — dashboards (vet, caretaker, owner)
and the availability editor are done; the shelter dashboard waits for a brief.

**Still outstanding from before: the redeploy** — the one hardening step this session could not do,
because writing to `C:\inetpub` needs elevation. From an elevated PowerShell
at the repository root: `.\deploy\publish-iis.ps1`. It keeps the server's
`config.js` (currently a Cloudflare tunnel address) and
`appsettings.Production.json`. `leash_review` already has scripts 001–005.

There is no next module. M10 was the last. **What happens next depends on the
client**: `NEXT_PROMPT.md` §1 is a checklist of their decisions (payments,
adoption screens, R7, refills, other gaps) to fill in, and §3 says exactly what
to build for each answer. A session started without answers does only the
owner's operational steps.

Two facts settled on 2026-10-18, so nobody re-investigates them: **Stripe is
set up exactly as in the reference** — real Stripe code, demo provider on, no
keys, never run against Stripe in either app — and **every adoption screen gap
in STATUS §3-M10 exists in the reference too**.

**Watch the first CI run.** `.github/workflows/ci.yml` has never run on GitHub;
every command in it passes locally. The likeliest surprise is the PGDG apt
step.

### Owner decisions still open

- **One refill per unit** (STATUS §4) — leave it as built.
- **R7 — who may override the live-engagement refusal** (STATUS §3-M10): built
  as the reference, the shelter.
- **Four adoption screen gaps the reference has** (STATUS §3-M10): no listing
  management or reversal UI, the applicant cannot see a paid fee, the
  Approve/Decline buttons, "Not yet listed". Left as ported until told.

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
| **The demo provider sells Leash Plus** | Deliberate (STATUS §3-M7). It settles through the same reconciler as the webhook; do not "fix" it back to the reference's 503 |
| **C14 warns on bookings and vet appointments** | Owner, 2026-10-10 and 2026-10-17. UI only |
| **Only `TransferPetAsync` moves a pet's owner** | And it moves `ownedSince` in the same statement. Never add an owner field to the pet PATCH |
| **Reversing an adoption does not refund** | As the reference. Rejecting or withdrawing an *approved* application does |

---

## 5. What is still between here and a release

Every module is built and release hardening is done (STATUS §3-H): CI, no
vulnerable packages, endpoint suites for every module, a split bundle, a
two-site publish script, and the deploy README covering payments settings and
multiple instances. What remains is operational: run the redeploy (§3), watch
CI's first run, and — before real money — configure Stripe and Resend
(`deploy/README.md` §4). `NEXT_PROMPT.md` is the runbook.

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


New in M10:

- **Staff accounts don't have the demo password.** `AdoptionEndpointTests`
  copies the demo hash onto u23 as `AdminEndpointTests` does; forgetting it
  shows up as a 401 at sign-in, not at the endpoint under test.
- **Two concurrent completions both pass the preconditions.** They are reads
  outside the transaction. Only the conditional `UPDATE pets … WHERE "ownerId"
  = @from` decides, and the loser rolls back everything after it, notices
  included. Keep anything new that must happen once *after* that statement.
- **A forced completion cancels bookings and appointments as the shelter**,
  through `IBookingService`/`IAppointmentService`. That works because the
  shelter is the owner of record on them; an engagement booked by somebody
  else would be refused, and the completion with it.
- **The directory search returns available listings only, for everyone** —
  including the shelter reading its own. The dashboard's counts come from it.

New in M9:

- **Admin authority is checked in the service, not the controller.** A new
  admin endpoint gets its check by calling an `IAdmin*Service` method; do not
  add a role attribute to the controller and assume that is enough.
- **Anything that can remove an admin takes `LockActiveAdminsAsync` first**, and
  re-reads the caller's own authority under that lock.
- **Session issue times are in the `iat_ms` claim.** The cookie's `IssuedUtc`
  and a JWT's `iat` are whole seconds; the watermark is milliseconds.
- **The suite signs staff in by copying the demo password's hash** onto
  u21–u23 (`AdminEndpointTests`); the real `STAFF_PASSWORD` is only in `.env.local`.

New in M7:

- **`SubscriptionStatuses` exists in both our enums and Stripe.net.** Files that
  `using Stripe;` alias ours (`using SubscriptionStatuses = Leash.Core.Models.Enums.SubscriptionStatuses;`).
- **Webhook fixtures are real Stripe JSON.** `StripeEvents.Json` in
  `WebhookTests.cs` builds them and Stripe.net parses them; every object needs
  its `"object"` field (`"payment_intent"`, `"charge"`, …) or it will not
  deserialise into the typed class the handler switches on.
- **Test event timestamps are in 2027** (`created: 1_800_000_000`). A payment
  touched by one has a `lastEventAt` in the future, so a later sync (event time =
  now) is refused as stale. Harmless in the suite; remember it when debugging.
- **`LeashApp(cs, webhookSecret)` sets the secret through an environment
  variable**, and every `LeashApp` resets it — a secret left behind would open
  the webhook for the next test.
- **`CoreHost(cs, configure)`** replaces registrations after `AddLeashCore`;
  that is how `FakeStripe` and `FakeSubscriptions` get in.

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

- **M10** (2026-10-18, headless Chrome against `petapp_dev`): a visitor browsed
  `/adopt` (2 waiting; "good with cats" → 1, in the URL), an animal and a
  shelter page. Maya applied for Pepper; Austin Pets Alive started a review and
  approved her (listing → pending); Maya paid $25 (ledger `paid`); the shelter
  saw "Fee paid" and completed — Pepper became Maya's, Sofia's rival
  application was closed, and Maya opened Pepper's record from the
  application page. Tom paid $150 for Juniper, who was in a live foster
  booking; Hill Country pressed Complete, was shown the confirm, accepted, and
  the booking was cancelled through its machine. Hill Country edited its
  profile. Support staff reversed Pepper's adoption over the API; a shelter
  trying the same got 403; Maya's bell showed the reversal. No console errors;
  the only failed calls were the expected 409 and 403. **`petapp_dev`'s adoption
  rows, the two pets and the shelter profiles were restored to the seed
  afterwards**; the notifications from the walk remain.

- **M9** (2026-10-17, headless Chrome against `petapp_dev`): Tom suspended and
  reactivated Daniel (his open session 200 → 401), verified a professional,
  refunded $5.00 of Maya's o1 (her order: `partially_refunded`); Priya read the
  audit log and set a maintenance banner Maya then saw; Rosa saw Overview and
  Fulfilment only; Maya saw "Staff only". **This mutated `petapp_dev`**: o1 is
  partially refunded, one professional is verified, and the audit log has rows.

- **M7** (2026-10-17, headless Chrome against `petapp_dev`, API with a local
  webhook secret): Maya joined Leash Plus on the demo provider → free shipping in
  quote and cart, a vet appointment at $68 against the clinic's $85, a
  caretaker booking 3 hours out accepted, the C14 warning dismissed then
  confirmed, cancel → resume. A signed `invoice.paid` posted twice: one ledger
  row, `processed, attempts 1`. **This mutated `petapp_dev`**: Maya is a Leash
  Plus member now, with one more appointment and a cancelled booking.

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
