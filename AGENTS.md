# Leash — orientation

Two codebases live in this repository. Know which one you are in.

| | |
|---|---|
| **`API/` + `web/` + `db/`** | **The build.** A fresh .NET 10 API + React/Vite SPA + PostgreSQL 18. This is what you change. |
| **everything at the root** (`app/`, `components/`, `lib/`, `prisma/`, `types/`, `tests/`) | **The reference implementation.** A working Next.js app. **Read it; never run it, never edit it.** |

## Read these first

| | |
|---|---|
| `STATUS.md` | What is done, what is next, and the open items. **Start here.** |
| `HANDOFF.md` | Picking up mid-build: uncommitted work, the next module, and the traps that cost time. Written at each milestone boundary. |
| `ARCHITECTURE.md` | How the code is organised and how to add a feature. **Read before writing code.** |
| `REQUIREMENTS.md` | What the system must do. The durable spec. |
| `BUILD_PLAN.md` | Decisions, order of work, and the risks. |
| `API_CONTRACTS.md` | Every endpoint of the reference implementation. |

## The reference implementation is the answer to "how should this behave?"

It is working, tested code for every rule in `REQUIREMENTS.md`. When behaviour
is unclear, `lib/server/<domain>.ts` is authoritative — **do not guess**. The 28
Vitest suites in `tests/` are the specification; port each module's suite to
xUnit as you build it, not at the end.

Its Next.js version has breaking changes from what you may expect — APIs,
conventions and file structure may all differ from your training data. If you
need to reason about how the *framework* behaves, read the relevant guide in
`node_modules/next/dist/docs/` and heed deprecation notices. None of that
applies to `web/`, which is plain Vite + React Router.

## Non-negotiables

- **Authorization is checked in the API on every request**, re-checked on every
  write, never inferred from a previous request. The client is never trusted.
- **The server owns the truth about money.** Client-supplied prices are never
  trusted; totals are recomputed from the live catalogue.
- **A write touching more than one row or table runs in a transaction.**
- **One error envelope** (`Http/ApiResults.cs`). Never `BadRequest(...)` or
  `NotFound()` in a controller — they emit a different shape.
- **Integer cents in storage.** Never `double`/`float` for money.
- **Timestamps serialise as `yyyy-MM-ddTHH:mm:ss.fffZ`.** The frontend compares
  them as strings.
- **All routes under `/api/v1/`.**
- **`Leash.Core` never references ASP.NET Core.**
- After any `db/changes/*.sql`: update `db/petapp.sql` in the same commit, then
  run `./db/verify.sh` — it must print `✓ IDENTICAL`.

## Verify before claiming done

```bash
cd API && dotnet test                      # 69 passing at end of M1
cd web && npm run build && npx oxlint src
./db/verify.sh
```

psql and pg_dump are at `C:\Program Files\PostgreSQL\18\bin` and are **not on
PATH** by default.
