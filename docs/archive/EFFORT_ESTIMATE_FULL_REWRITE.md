# Effort estimate — full move to .NET + Postgres + React (Vite), with mobile to follow

Scope priced here: replace the Next.js backend with ASP.NET Core + Dapper,
rewrite the frontend as a Vite React SPA, run local Postgres, and leave the API
in a state where a mobile app can be built against it without rework.

Companion to `MIGRATION_PLAN_DOTNET.md`, which has the technical detail. This
document is about **cost and sequencing**.

---

## 1. The number

**≈ 105–155 working days** for one experienced full-time developer.

- **Solo:** roughly **5–7.5 months** at a realistic pace.
- **Two developers:** roughly **4–6 months calendar**, not half — see §6. The
  backend is the critical path and does not parallelise cleanly until phase 2
  lands.

| Workstream | Days | Note |
|---|---:|---|
| .NET backend port (81 endpoints, 66 domain files) | 65–95 | From `MIGRATION_PLAN_DOTNET.md` §7 |
| Mobile-readiness work, done inline | 6–10 | §4 — cheap now, expensive later |
| Support assistant, ported to .NET | 8–12 | Now unavoidable — §5 |
| Next.js → Vite SPA rewrite | 25–40 | §3 |
| **Total** | **104–157** | |

Test-porting (28 suites) is ~25–35% of the backend figure and is already inside
it. It is the line item most often cut and least safely cut — those suites are
the specification for the transition tables, the access predicates and the money
rules.

---

## 2. ⚠️ The correction worth making before you commit

**Going Vite does not get you closer to a mobile app.** I want to be direct
about this, because it appears to be the reason driving the decision.

The mobile app consumes the .NET API. Whether the *web* frontend is Next.js or
Vite has no bearing on that — it is a separate client either way.

The usual second argument is code sharing with React Native. I checked, and it
does not hold here either. Grepping the whole shared layer for Next.js coupling:

```
lib/api/_client.ts:20   process.env.NEXT_PUBLIC_SITE_URL
lib/api/_client.ts:22   process.env.VERCEL_URL
```

**Two lines.** That is the entire Next.js dependency across `lib/api/` (20
files), `lib/store/`, `types/index.ts` (964 lines), `lib/pricing.ts`,
`lib/delivery.ts`, `lib/geo.ts`, `lib/booking-priority.ts` and `lib/utils.ts`.
(`lib/media/photos.ts` only *mentions* `next/image` in comments.)

Everything you would want to share with React Native — the API client, the
types, the Zod schemas, the pricing and delivery rules, the Zustand stores — is
**already plain portable TypeScript**. You can extract it into a shared package
today, under either frontend.

And what you cannot share, you cannot share either way: React Native uses
`View`/`Text`, not `div`/`span`. **Zero components port**, from Next.js or from
Vite.

So the honest position:

> Vite is worth doing for **operational simplicity**, not for mobile. If mobile
> is the only reason, the 25–40 days buys you nothing toward it.

### The real case for Vite — which is legitimate

One deployable. ASP.NET serves the built SPA as static files with a fallback
route. **No Node in production at all.** Given you have also ruled out Docker,
that is a genuinely meaningful reduction in what you have to install, patch,
monitor and deploy on a Windows box. One runtime, one process, one thing to
restart.

That is a real benefit and a defensible reason to spend the 25–40 days. It is
just a different reason than the one you gave.

### What it costs you

You give up the *option* of cheap SSR later. Note you are not losing something
you have: only **9** metadata/`generateStaticParams` declarations exist across
44 pages, and every data page is already client-rendered. You are making
permanent a position you are already in.

If SEO on caretaker, vet, product or adoption-listing pages ever becomes a
business priority, the answer under a Vite SPA is a prerender service or a
separate marketing surface — not a cheap flag flip. Worth deciding with open
eyes rather than discovering later.

---

## 3. Frontend rewrite — where the 25–40 days goes

Measured surface area, not guesswork:

| Next.js API | Files affected | Replacement |
|---|---:|---|
| `next/link` | **56** | `react-router` `<Link>` |
| `next/navigation` | **29** (20 `useRouter`, 20 `useParams`, 16 `useSearchParams`, 10 `usePathname`) | React Router hooks — **similar but not identical return shapes** |
| `next/image` | **32** | `<img>` + rework of `lib/media/photos.ts` |
| `next/font` | 2 | `@font-face` or a Google Fonts link |
| `"use client"` | 88 | Delete |
| App Router file routing | 44 pages | React Router route config + nested layouts |

| Task | Days |
|---|---:|
| Scaffold Vite + Tailwind v4 plugin + router + env plumbing (`NEXT_PUBLIC_*` → `VITE_*`) | 2–3 |
| Route tree: 44 routes, nested dashboard/admin layouts, auth guards | 5–8 |
| `next/link` → React Router (56 files, mechanical) | 2–3 |
| `next/navigation` → React Router (29 files, 66 call sites) | 3–4 |
| `next/image` → `<img>` + `photos.ts` blur/aspect rework | 3–5 |
| `next/font` + theme CSS variables | 0.5 |
| Auth: rewrite `session-client.ts`, guards, post-login navigation | 3–4 |
| Head/title management (`react-helmet-async`) | 1 |
| Assistant chat UI against a custom SSE contract | 3–5 |
| **Regression sweep across all 44 pages** | 5–8 |
| **Total** | **27.5–41.5** |

**This is the least predictable number in the estimate** — it is breadth, not
depth. Nothing here is hard; there is simply a lot of it, and the failure mode
is a long tail of small broken things found late. The regression sweep line is
not padding.

**What survives untouched** (and it is most of the value): Tailwind v4 and the
whole `@theme` token set, Zustand, React Hook Form, Framer Motion, sonner,
`@stripe/react-stripe-js`, all 75 components' internals, and every file in
`lib/api/`.

---

## 4. What actually buys you the mobile app — decide these in phase 1

These are cheap now and painful to retrofit. This is the work that genuinely
serves the mobile goal.

### 4.1 Dual authentication — the one that must be right on day one

Cookie auth is correct for web and awkward for React Native. Do not pick one and
regret it.

**Issue both from the same endpoints:** an HttpOnly cookie for the browser, a
JWT bearer pair (access + rotating refresh) for mobile, selected by client
header or a parallel route. ASP.NET Core handles this natively with a policy
scheme selector:

```csharp
options.DefaultScheme = "smart";
// forward to JwtBearer when Authorization: Bearer present, else Cookies
```

Retrofitting this after the web app ships means reopening every auth path.
**+3–4 days now. Multiples of that later.**

### 4.2 Version the API from the first endpoint

`/api/v1/...`. You cannot force-update a mobile app — you *will* be serving old
clients while shipping new ones. Costs nothing today; there is no cheap way to
add it once a binary is in an app store. **+0.5 days.**

### 4.3 Cursor pagination on every list endpoint

Caretaker and vet search currently filter **in memory** with no pagination
(`PROJECT_ANALYSIS.md` §10.4). That is survivable on a desktop grid and is not
survivable on a mobile infinite-scroll list.

The store's `searchProducts` already does this properly in Postgres — copy that
pattern while you are rewriting the queries anyway. **+2–3 days**, and it closes
a known gap.

### 4.4 Notification channels

`notify()` is the single gate every notification passes through. Give it a
channel abstraction now (in-app / email / **push**) even with push unimplemented.
Adding a third channel later to one well-shaped function is trivial; adding it
to a hardcoded two-channel function is a refactor across every call site.
**+1–2 days.**

### 4.5 OpenAPI as the contract

`.NET` emits the spec for free. Generate the TypeScript client from it for web
today and mobile later, so both clients cannot drift from the server. **Already
in the backend estimate.**

---

## 5. The assistant is no longer optional — and gets cheaper

In `MIGRATION_PLAN_DOTNET.md` I recommended leaving `/api/assistant/*` as the
last surviving Next.js route handler, dodging the hardest part of the port.

**Killing Next.js removes that option.** Three remain:

| Option | Days | |
|---|---:|---|
| Port to .NET with a **custom SSE contract** ✅ | 8–12 | Recommended |
| Keep a tiny Node service (Hono/Express) just for it | 3–5 | Undercuts "one runtime" |
| Drop the feature | 0 | |

**Recommendation: port it with your own stream protocol.** The expensive part
was never the tool loop — it was matching the Vercel AI SDK's SSE wire format
that `useChat` expects. **Since you are rewriting the chat UI anyway, you are no
longer bound to that format.** Define a simple SSE contract (`text-delta`,
`tool-call`, `tool-result`, `done`) and implement both ends.

That turns a 15–25 day protocol-reimplementation problem into an 8–12 day
feature port. It is the one place where the Vite rewrite genuinely saves money.

`Microsoft.Extensions.AI` gives you the tool loop. The 26 tools port as ordinary
service methods. Keep the security properties intact — no tool takes a user id,
anonymous callers get a smaller tool list, every id is re-checked server-side.

**pgvector on Windows without Docker remains a build-from-source job**
(`MIGRATION_PLAN_DOTNET.md` §2). Budget half a day of yak-shaving, or defer
retrieval and ship the assistant with tools only at first.

---

## 6. Sequencing — the scheduling insight that matters

**The frontend rewrite is almost entirely independent of the backend port.** It
needs exactly two things frozen: the error envelope and the auth contract. Both
land in backend phases 0–1.

```
Dev A  ├─ P0 Foundation ─ P1 Auth ─ P2 Access ─┬─ P3 Catalog ─ P4 Pets ─ P5 Bookings ─ P6 Store ─ P7 Jobs ─ P8 Admin ─ P9 Adoption ─ P10 Timestamps
       │                                        │
Dev B  └────────── (waits for P1) ──────────────┴─ Vite rewrite ──────── Assistant ──────── Regression sweep
```

- **Phases 0–2 are strictly sequential and on the critical path.** No amount of
  people compresses them.
- From phase 3, domains parallelise.
- A second developer owning the frontend end-to-end means calendar time is
  bounded by the **backend** (80–120 days), not the sum.

So: two developers ≈ **4–6 months**, not 2.5–4. The backend is the floor.

### The decoupling I would actually recommend

**These two workstreams do not have to ship together, and I would not ship them
together.**

| | Scope | Days | Gets you |
|---|---|---:|---|
| **A** | .NET backend + mobile-readiness, frontend stays Next.js | **75–110** | A production API. **Mobile can start here.** |
| **B** | Vite rewrite + assistant port | **33–52** | One deployable, no Node in prod |

Do **A**, ship it, start the mobile app. Do **B** when it suits — or never.

The reason is straightforward: **B contributes nothing to the mobile app, and
doing it first delays mobile by 1.5–2.5 months.** If mobile is the actual
business driver, that ordering is expensive. The Next.js frontend keeps working
against the .NET API throughout A with no changes beyond the four auth files
(`MIGRATION_PLAN_DOTNET.md` §5.4).

If you have already decided Vite is happening regardless — fair, the ops
argument stands on its own — then run it as Dev B's parallel track rather than
as a phase that blocks anything.

---

## 7. What moves these numbers

**Upward:**

| Risk | Impact |
|---|---|
| Access predicates get subtle authorization details wrong | Rework + a security incident. `Pet.ownedSince` has non-obvious semantics. Mitigate: port phase 2 fully tested before anything depends on it. |
| Test-porting cut to "save time" | Fastest way to turn a 5-month project into a 9-month one. The suites are the spec. |
| Stripe webhook claim protocol | Concurrency-sensitive, and bugs mean double-processing real money. |
| Frontend long tail | 44 pages × small breakages found late. The regression line is real. |
| Timestamp conversion done too early | Every failure becomes ambiguous — port bug or timestamp bug? Defer to phase 10. |
| .NET 8 EOL **10 Nov 2026** | ~2 months away; an unplanned upgrade mid-project. Target `net10.0`. |

**Downward:**

- The backend is a **transcription with a specification**, not a design job. The
  domain logic exists, is documented, and is tested. That is the single biggest
  reason this is estimable at all.
- `prisma migrate diff` gives you the baseline schema free; `pg_dump` gives you
  seed data free (`MIGRATION_PLAN_DOTNET.md` §3.1, §3.4).
- **Local Postgres takes the test suite from ~40 minutes to 1–2.** This changes
  the inner loop for the entire project, not just test runs.
- The strangler rewrite proxy means you are never in a broken state and can stop
  at any endpoint boundary.

---

## 8. What I'd do

1. **Confirm the Vite decision on the ops argument, not the mobile one.** If
   one deployable and no Node in production is worth 25–40 days to you, it is a
   sound call. If mobile was the reason, reconsider — it buys you nothing there.
2. **Target `net10.0`.**
3. **Extract the shared layer into a package now** — `lib/api/`, `types/`,
   `lib/pricing.ts`, `lib/delivery.ts`, `lib/geo.ts`. It is already portable
   (two lines to fix). This is the actual mobile groundwork, it is a day's work,
   and it pays off under either frontend.
4. **Decide dual auth before writing phase 1.** It is the one thing that is
   genuinely expensive to retrofit.
5. **Run the week-one proof** from `MIGRATION_PLAN_DOTNET.md` §13 — port
   `GET /api/brands` behind the rewrite proxy and confirm the existing React app
   cannot tell the difference. Get that signal before committing months.
