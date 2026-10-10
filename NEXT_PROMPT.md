Continue the Leash build. Read HANDOFF.md first, then STATUS.md, then
BUILD_PLAN.md §0 — especially "The UI parity pass" — then ARCHITECTURE.md §6
(the web app, and the Next.js → React Router porting table).

State of play: M0–M6 are done and verified, plus the landing page. 531 xUnit
tests passing, web build + oxlint clean, ./db/verify.sh IDENTICAL. M0–M4 are
committed and pushed (main_newDev at c585829). **M5, the landing page and M6
are NOT committed** — they are in the working tree. Do not commit unless I ask.

## This session: the UI parity pass, before M8 and M7

The app works, but it does not look like the original. BUILD_PLAN.md §4 said
the reference's pages would be *ported mechanically*; instead most M1–M6 screens
were written fresh against the new API. Only 27 of the reference's 69
components exist in web/, and 34 of the missing ones belong to modules already
marked done. The dashboard is the worst: the reference has one role-aware
dashboard (owner / caretaker / vet views with live sections), and web/ has a
profile summary with a list of links.

**The job is to make every screen built so far look and be structured like the
reference app.** The reference is the design. BUILD_PLAN.md §0 has a ten-row
inventory in priority order — work through it in that order:

  1. **Dashboard first.** Port app/dashboard/page.tsx and
     components/dashboard/{OwnerDashboard,CaretakerDashboard,VetDashboard,
     BookingListRow}.tsx and AuthRequired.tsx. One page that switches by role
     with the "Viewing as" toggle. Owner: pets → vet appointments + orders on
     their way → recommended products → upcoming bookings → past bookings.
     Caretaker: incoming requests with inline accept/decline → active bookings
     → availability calendar → history. Vet: requests → schedule → your clinic
     → past appointments. ShelterDashboard waits for M10.
  2. **Routes must match the reference.** /vet/:id → /vets/:id;
     /appointment/new → /vets/book; /appointment/:id → /appointments/:id. The
     standalone /dashboard/pets, /dashboard/bookings and /dashboard/appointments
     pages do not exist in the reference — their content is the owner
     dashboard. Remove them, and redirect every old URL so no link 404s. Check
     every <Link to=…> and navigate() in web/src for the old paths.
  3. Then the shared UI kit (Panel, ProfileHero, ResultsGrid, SelectFilter,
     ToggleChips, PetCard, ReviewCard, the status badges), then find care,
     find a vet, the health record, the store, login/signup, the missing
     /pet-health and /support pages, and the dev account switcher — rows 3–10
     of the inventory.

Rules (BUILD_PLAN.md §0 has them in full):

  - **Port, don't redesign.** Copy the reference component, apply the
    ARCHITECTURE.md §6 table, delete "use client". If it looks different
    afterwards, the port is not finished. Use the existing web/src/components
    where the reference's equivalent is already ported — do not make a second
    copy of anything.
  - **Change only the data access.** Swap lib/api/* calls for web/src/api/*
    ones. Known differences: lists are cursor pages ({ items, nextCursor }),
    not arrays; CaretakerWithUser and VetWithUser are nested ({ profile, user })
    not flat; self-only lists take no user id (listMyBookings(), not
    getBookingsByOwner(id)). useAsync (web/src/hooks) and getUsersByIds
    (GET /users?ids=) already exist.
  - **Keep the deliberate fixes.** The hero's city picker, `allergy` in the
    visit summary form, no "complete" button on an appointment (the summary
    completes it), the cart's server quote with allergen warnings, per-unit
    refills. Where a reference component reproduces a REQUIREMENTS.md §12
    defect, the fix wins.
  - **No API changes expected.** If a reference screen needs something the API
    does not have, stop and tell me rather than widening an endpoint.
  - The reference implementation at the repo root is read-only. Read it; never
    run it, never edit it.

Out of scope this session: PaymentForm (M7), NotificationBell (M8), AdminShell
(M9), adoption and shelter screens (M10) — they arrive with their modules. The
six deploy blockers in BUILD_PLAN.md §0 also wait, unless one is directly in
your way.

## Settled — do not re-open

STATUS.md §5. In particular: the skipped week-4 checkpoint; refillsLeft
(0 = exhausted, null = no limit, spent at checkout — "one refill per unit" is
still pending my answer, so leave it as implemented); 409 on deleting a pet with
history; no booking cancellation cutoff; the one-way vet review.

## Before you say it is done

  - Compare each screen in the inventory side by side with the reference, and
    list any difference that remains and why (only rule-3 fixes should remain).
  - `cd web && npm run build && npx oxlint src` clean.
  - `cd API && dotnet test` still green — nothing in the API should have
    changed; if it did, say what and why.
  - Walk the main screens in the running app (API on :5001 via
    `dotnet run --launch-profile http`, web on :5173 via `npm run dev`) as each
    demo account: maya.chen (owner), liam.novak (caretaker), naomi.ruiz (vet),
    password leashdemo123.

When you finish, update STATUS.md, HANDOFF.md and BUILD_PLAN.md §0 (mark the
parity pass done), and write a new NEXT_PROMPT.md for the session after — which
is M8 (notifications) then M7 (payments), with the rule that from now on every
module ports the reference screens first and adapts them to the API second.
Then tell me which screens still differ from the original and where you are
least confident.
