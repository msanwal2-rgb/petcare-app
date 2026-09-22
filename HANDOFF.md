# Leash — handoff

For whoever picks this up next. Written at the end of **M4**, 2026-09-22.

This file is the short version and the things that are true *right now*. It does
not repeat the permanent docs — read them in this order:

| | |
|---|---|
| `STATUS.md` | What is done, what is next, what is open, what is decided. **Start here.** |
| `ARCHITECTURE.md` | How the code is organised and how to add a feature. **Read before writing code.** |
| `REQUIREMENTS.md` | The durable spec. §7 is M5. |
| `BUILD_PLAN.md` | Order of work, the decisions, the risks. §6 is the calendar. |
| `API_CONTRACTS.md` | Every endpoint of the reference implementation. |

---

## 1. Read this before you touch anything

**The working tree has 38 uncommitted files** — all of M3 and all of M4. They
are complete and green, not half-finished. Commit them as two commits before
starting new work, or the next diff is unreviewable:

```bash
git status --short          # 38 files: M3 pets/records, M4 caretakers/bookings
```

Everything below assumes that is done first.

---

## 2. Where the build actually is

**5 of 11 modules. 15 of the plan's 40 working days.** M0, M1, M2, M3, M4 are
done and verified. M5 is next.

```bash
cd API && dotnet test        # 312 passing, ~95s
cd web && npm run build && npx oxlint src
./db/verify.sh               # must print ✓ IDENTICAL
```

**All three must be green before you say anything is done.** `psql` and
`pg_dump` are at `C:\Program Files\PostgreSQL\18\bin` and are not on PATH.

---

## 3. What to do next — M5, vets & appointments

`REQUIREMENTS.md` §7 is the spec. `BUILD_PLAN.md` puts it at days 16–18, and
**days 19–20 are the week-4 checkpoint and the first deploy** — see §6 below,
because that matters more than it sounds.

The shape is deliberately close to M4, and most of the scaffolding is already
there waiting:

| Already exists | What M5 does with it |
|---|---|
| `IAppointmentRepository` | Has one read method (`ListForPetAsync`, added by M3). **Grow it — do not start a second interface.** |
| `AppointmentTimelineDto` | One record whose `Fee` is written conditionally, replacing the reference's two TypeScript types. **Extend it — do not add a parallel appointment DTO.** |
| `IReputationService` | Built to take the vet arm. Only the answered-status list differs: an appointment says `confirmed` where a booking says `accepted`. |
| `ReviewKinds.VetAppointment` | Already written by `ReviewService` and exercised by read tests against seeded rows. M5 adds the **write** path. |
| `IAccessService.IsAppointmentParticipantAsync` | Written in M2, still has no caller. M5 is its caller. |
| `IAccessService.CanAccessPetRecordsAsync` | Returns `AsVetId`. A visit summary that writes a medical record **must** stamp it with that id, not look one up. |

Three rules specific to M5:

1. **A vet review is one-directional.** The owner reviews the vet. A clinician
   rating the client is a different and much worse product — this is why
   `ReviewKinds` exists at all.
2. **The appointment status machine is `REQUIREMENTS.md` §11.2**, not §11.1.
   It differs from bookings: `confirmed`, not `accepted`. Read it before
   copying `BookingService`'s tables.
3. **A visit summary writes into the health record**, which is what gates the
   store in M6. That seam — prescription written in M5, Rx product purchasable
   in M6 — is called out in `BUILD_PLAN.md` as the thing that justifies the
   whole architecture. Do not let it drift.

Port `tests/appointments.test.ts` and `tests/vets.test.ts` as you go, not at the
end. 10 of the reference's 28 suites are ported so far.

---

## 4. Decisions that are settled — do not re-open them

These were decided by the owner. `STATUS.md` §5 is the full list; these are the
recent ones a newcomer is most likely to "fix":

| | |
|---|---|
| **`refillsLeft`**: 0 = exhausted, null = no limit | M6 decrements it inside the checkout transaction, alongside stock. Half-done on purpose |
| **Deleting a pet with clinical history is a 409** | Not a bug. Soft delete is a later pass |
| **No booking cancellation cutoff** | §11.1 as written. Revisit in M7 with penalties and refunds |
| **A cookie copied before sign-out keeps working** | Deliberate, pinned by a test. Do **not** bump the watermark on logout — it signs every device out |
| **`Species` is three values** (`dog`, `cat`, `other`) | Matches `web/src/types/index.ts`. Widening it is a contract change across three files in one commit |

---

## 5. Traps in this codebase that cost real time

Learned the hard way during M3 and M4. `ARCHITECTURE.md` §9 has the M0–M1 list;
these are the newer ones.

- **Dapper reads `jsonb` as a string.** `EnableDynamicJson` does not help,
  because Dapper goes through `IDataReader.GetValue` before Npgsql sees a
  destination type. Ten tests failed on this. The fix is a handler in
  `Persistence/DapperSetup.cs` — `JsonHandler<T>` is there now, registered for
  `SlotDto[]`. **Register a new one for each jsonb-backed type you add.**
- **`COALESCE(@x, col)` needs an explicit cast** — `COALESCE(@Name::text, name)`.
  An omitted property arrives as an untyped NULL and PostgreSQL answers
  "could not determine data type of parameter" rather than guessing.
- **`count(*)` is `bigint`.** Cast to `::int` or Dapper cannot materialise the
  row into an `int` property.
- **Positional records break Dapper.** Row types are mutable classes with
  parameterless constructors. DTOs stay positional records. (§2 of `ARCHITECTURE.md`.)
- **Check who the seeded demo accounts actually are.** `elena.petrova@example.com`
  is named in `STATUS.md` as the caretaker demo login and *is* one — but she is
  u10/profile c4 and sits Luna. The caretaker who can see Biscuit (p1) is
  `liam.novak@example.com` (u7/c1). An endpoint test 404'd on this.
- **The actor check runs before the transition check** in `BookingService`. A
  test that names the wrong caller passes for the wrong reason, because
  `NotParticipant` looks like a refusal too. Resolve fixture ids from the
  database in tests rather than hardcoding them.

---

## 6. The thing most likely to go wrong from here

**Days 19–20 are a deploy, and nothing has ever been deployed.**

`BUILD_PLAN.md` §7 is blunt about it: *"Deployment problems found in week 8 are
the classic way a two-month project becomes ten weeks."* The plan wants a
deploy in week 4 **even though the product is incomplete**, precisely so that
the week-8 deploy is routine.

Nothing about deployment has been exercised yet. There is also no CI — §9 of the
plan wants a throwaway database built from `petapp.sql`, the suite, and
`verify.sh`. Neither exists.

Treat the checkpoint as real work, not a formality after M5.

---

## 7. How to verify you have not broken anything

```bash
cd API && dotnet test                      # 312 at the end of M4
cd web && npm run build && npx oxlint src
./db/verify.sh                             # ✓ IDENTICAL
```

If you add a `db/changes/*.sql`: update `db/petapp.sql` in the same commit, then
run `verify.sh`. `db/petapp_at_last_release.sql` is gitignored and local-only —
if it is missing, copy the current `petapp.sql` to it *before* adding the change
script.

---

## 8. The rule that governs everything else

From `AGENTS.md`, and it has not stopped being true:

> **The reference implementation at the repo root is the answer to "how should
> this behave?"** It is working, tested code for every rule in
> `REQUIREMENTS.md`. When behaviour is unclear, `lib/server/<domain>.ts` is
> authoritative — **do not guess**. Read it; never run it, never edit it.

The reference is also wrong in places, on purpose — M2's `access.ts` header, the
transfer backdoor in its pet patch schema, the read-that-mutates in its messages
route. `REQUIREMENTS.md` flags those with ⚠. Where the spec and the reference
disagree, the spec wins and the reference explains why it was changed.
