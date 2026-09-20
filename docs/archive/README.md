# Archived planning documents — DO NOT FOLLOW

These four documents describe a **migration** approach that was considered and
then **abandoned**: incrementally replacing the Next.js backend endpoint by
endpoint (a "strangler" cutover behind a rewrite proxy) while keeping the
existing Next.js frontend.

**That is not what is being built.** The decision was made to build a
**completely fresh application** — a new .NET 10 API in `API/` and a new React +
Vite SPA in `web/` — with the existing Next.js project kept only as reference
material.

Following anything in here will send you down the wrong path.

## The live documents

| File | Purpose |
|---|---|
| **`/REQUIREMENTS.md`** | What to build. The durable functional specification. |
| **`/BUILD_PLAN.md`** | How and when to build it. |
| `/PROJECT_ANALYSIS.md` | Still accurate — describes the existing Next.js app, which is the reference implementation. |

## What is in here, and why it was kept

| File | Was |
|---|---|
| `MIGRATION_PLAN_DOTNET.md` | The original migration approach and the reasoning behind each stack choice. Some rationale (Dapper vs EF, why not Redis, the DB conventions) still holds and carried into `BUILD_PLAN.md`. |
| `MIGRATION_RUNBOOK.md` | The module-by-module strangler cutover procedure. Obsolete — there is nothing to strangle in a fresh build. |
| `IMPLEMENTATION_PLAN_DOTNET10.md` | An intermediate plan that kept the Next.js frontend. Superseded by the decision to move to Vite. |
| `EFFORT_ESTIMATE_FULL_REWRITE.md` | Effort analysis comparing the migration and rewrite paths. Its numbers informed the two-month plan. |

Kept for the reasoning, not the instructions.
