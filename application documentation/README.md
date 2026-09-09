# Leash — Application Technical Documentation

Developer handover documentation for the Leash codebase, written from a full
audit of the source rather than from filenames. Every claim here was traced
through the implementation; where something could not be determined from the
code, it says so.

**Repository:** `github.com/msanwal2-rgb/petcare-app` (private)
**Production:** https://petcare-app-drab.vercel.app
**Documented at commit:** `33d6550` — "Shelter adoption, on the shared health record"

---

## Read these in order

Documents 1–4 and 7–17 are **narrative** — they explain how the system works and
why. Documents 5, 6 and 18 are **reference** — full field, endpoint and prop
tables to look things up in.


| # | Document | What it covers |
|---|---|---|
| 1 | [Overview and architecture](./01-overview-and-architecture.md) | What the app is, the stack, the system diagram, request flow, project structure |
| 2 | [Features](./02-features.md) | Every major feature: purpose, implementation, code locations, status |
| 3 | [Authentication and authorization](./03-auth.md) | Sessions, Google OAuth, roles, staff roles, the access predicates |
| 4 | [Payments, membership and billing](./04-payments.md) | The provider seam, the ledger, checkout, webhooks, Leash Plus |
| 5 | [Database](./05-database.md) | All 32 models, relationships, conventions, migrations, seed data |
| 6 | [API reference](./06-api-reference.md) | All 81 route handlers with guards, bodies and errors |
| 7 | [Frontend architecture](./07-frontend.md) | Routing, state, hooks, primitives, styling, how to add things |
| 8 | [Backend architecture](./08-backend.md) | The layer contract, conventions, where logic belongs |
| 9 | [The support assistant](./09-assistant.md) | The LLM subsystem: tools, guards, retrieval, rate limits |
| 10 | [Integrations, environment and configuration](./10-integrations-and-config.md) | Stripe, Google, Resend, Neon, OpenRouter; every env var; every config file |
| 11 | [Security review](./11-security.md) | Findings with severities, and the defences that exist |
| 12 | [Testing](./12-testing.md) | The harness, what is covered, what is not, how to run it |
| 13 | [Status: complete vs incomplete](./13-status-and-debt.md) | Feature matrix with evidence, technical debt, known issues |
| 14 | [End-to-end workflows](./14-workflows.md) | Traced flows: signup, checkout, adoption, admin action, cron |
| 15 | [Operations: setup, running, deployment](./15-operations.md) | Local setup, migrations, seeding, build, deploy |
| 16 | [Onboarding and extending](./16-onboarding-and-extending.md) | Day-one guide, and step-by-step recipes for common changes |
| 17 | [Risks, cautions and unknowns](./17-risks-and-unknowns.md) | Architectural risks, "do not break this", what needs verification |
| 18 | [Component reference](./18-component-reference.md) | All 75 components and both hooks, with props |

---

## The one-paragraph version

Leash is a two-sided pet-care marketplace with four domains over **one shared
pet health record**: owners book **caretakers** (walking, sitting, boarding,
daycare), book **licensed vets** who write into the animal's record, buy from a
**store** whose prescription-only products are unlocked by the prescriptions in
that record, and **adopt** from shelters — where the whole record transfers with
the animal. It is a Next.js 16 App Router application with Postgres behind
Prisma, Auth.js sessions, Stripe payments, and an LLM support assistant. It runs
on Vercel and deploys from `main`.

The health record is the point. Every domain reads or writes the same `Pet` row,
and the seams between them — a prescription unlocking a product, an adoption
carrying a vaccination history — are the parts worth understanding first.

---

## Conventions used in this documentation

Claims are labelled where the distinction matters:

- **Confirmed** — observed directly in the source, with a file path.
- **Inferred** — a reading of the code that is likely but not stated. Always
  labelled as such.
- **Unknown** — cannot be determined from the repository. Collected in
  [document 17](./17-risks-and-unknowns.md).

File paths are repo-relative. Line numbers are given only where they aid
navigation and are accurate as of the documented commit; treat them as hints,
not addresses.

No secrets appear anywhere in this documentation. Where a credential exists,
only its variable name and purpose are given.

---

## Three things to know before you touch anything

1. **Every page that fetches data is a client component.** There are no server
   actions and no server-side data loading; the handful of server components
   that exist (`app/layout.tsx`, `SiteFooter`, and `app/store/page.tsx`, which
   only wraps a client child in `<Suspense>`) render static shells. Data always
   flows page → `lib/api/<domain>.ts` → route handler →
   `lib/server/<domain>.ts` → Prisma. Fetching on the server would be a genuine
   architectural departure, not a local choice.

2. **All timestamps are ISO-8601 strings, not `DateTime`, and there are no
   Prisma enums.** Both are deliberate and load-bearing — see
   [document 5](./05-database.md). Ordering and range filters rely on the fact
   that ISO-8601 sorts lexicographically.

3. **The test suite shares one Postgres schema.** Run `npm test` one instance at
   a time; two concurrent runs corrupt each other's global setup. See
   [document 12](./12-testing.md).
