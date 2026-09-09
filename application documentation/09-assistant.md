# 9. The Support Assistant ("Scout")

An in-app chat on every page that answers platform and pet-health questions,
reads the signed-in customer's own records, and cancels orders, bookings and
appointments. It **never** buys, books or commits anything.

Everything under `lib/server/assistant/`, `app/api/assistant/`, and
`components/assistant/`.

## 9.1 Why it is shaped the way it is

The rules the application enforces were all real and all invisible. A customer
had to already know that order tracking lives at `/store/orders/[id]`, or that
an unexpired prescription is what unlocks a prescription-only product. The
assistant exists to answer that, and its design is mostly a series of refusals
about what it must not be able to do.

## 9.2 Request path, traced

```
components/assistant/AssistantLauncher.tsx    mounted in app/layout.tsx, OUTSIDE <main>
  └─ AssistantPanel.tsx     useChat + DefaultChatTransport → POST /api/assistant/chat
                            thread id in sessionStorage ("leash.assistant.conversation")

app/api/assistant/chat/route.ts               maxDuration = 30
  1. readiness()            ASSISTANT_ENABLED === "false" → 503
                            no model credential           → 503
  2. parseBody(assistantChatSchema)    messages 1–40, ≤50 parts each, .loose()
  3. auth()                 ← NOT requireUser(); signed out is a smaller
                              capability set, not a 401
  4. buildContext(request, uid, { path })
  5. checkRateLimit(ctx)    → 429 { window }
  6. ensureConversation()   persists ONLY the newest user turn
  7. loadProfile(ctx)       user + pets + isOps
  8. streamAssistant(...)   → agent.ts

lib/server/assistant/agent.ts   per-request ToolLoopAgent
  model:        resolveModel()            ← model.ts
  instructions: buildInstructions(...)    ← instructions.ts
  tools:        buildTools(ctx, deps)     ← tools/index.ts
  stopWhen:     stepCountIs(6)
  maxOutputTokens: 700

  tools → guards.ts → lib/server/<domain>.ts → present.ts
  searchKnowledge → retrieval.ts → embed.ts + pgvector/tsvector SQL

onFinish → persists the assistant message with modelId()
Response gets an x-conversation-id header
```

`AssistantLauncher` is mounted **outside `<main>`** deliberately: it must survive
`PageTransition`'s pathname-keyed remount (or navigating throws the conversation
away), and `e2e:sweep` scans `main *` for content stuck at `opacity < 0.05`,
which an animating panel transiently is.

The panel is keyed on `currentUser?.id ?? "anonymous"`, so signing in or out
starts a fresh thread.

## 9.3 Model resolution — `model.ts`

Precedence is **explicit → implicit**:

```ts
if (process.env.OPENROUTER_API_KEY) return "openrouter";
if (process.env.ANTHROPIC_API_KEY)  return "anthropic";
return "gateway";
```

**Why that order:** `VERCEL_OIDC_TOKEN` appears in `.env.local` unbidden on a
Vercel-linked project, and must not outrank a key somebody deliberately set.

| Route | Needs | Default model |
|---|---|---|
| `openrouter` | `OPENROUTER_API_KEY` | `nvidia/nemotron-3-super-120b-a12b:free` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-5` |
| `gateway` | `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | `anthropic/claude-sonnet-5` |

With no credential at all, `hasModelCredential()` is false and the route answers
**503** — it fails closed rather than surfacing a provider error.

**Embeddings:** `resolveEmbeddingModel()` returns `null` on the Anthropic route,
because Anthropic publishes no embedding model. That is a documented, coherent
state — a working assistant with an un-ingestable corpus — and
`scripts/ingest-knowledge.ts` exits 1 with an actionable message rather than
dying on the first batch.

Model ids deliberately carry **no date suffix**.

## 9.4 The tool surface

`buildTools(ctx, deps)` in `tools/index.ts`:

```ts
return {
  ...readTools(ctx, deps),      // 17
  ...linkTools(ctx),            //  5
  ...clientTools(),             //  1
  ...(ctx.uid ? writeTools(ctx) : {}),   // 4, signed-in only
};
```

**23 tools anonymous, 27 signed in.**

### The three guarantees

**1. No tool takes a user id.** *Confirmed* — no `userId`/`ownerId`/`uid`/
`customerId`/`clientKey` appears in any `inputSchema`. `uid` is closed over from
`ctx`. Asking about another customer is **unrepresentable, not refused**. A
regression test walks every tool's schema shape and exists to fail the day
somebody adds one "to be helpful".

**2. No tool creates a commitment.** *Confirmed* — there is no `placeOrder`,
`createBooking`, `createAppointment`, `createReview`, `createRecord`,
`sendMessage`, or anything gated on `isOps`. **Absence is the guarantee**: a
hallucinated call yields a dead link, not a booking. The four write tools all
*cancel* something. A test asserts a `startVetAppointment` link appeared *and*
the appointment count did not change.

Booking messages are also deliberately absent — "a support bot must not be able
to speak to a caretaker as the customer".

**3. Anonymous callers get a smaller tool list — partly.** *Confirmed with a
caveat.* The difference is exactly the four write tools. The ~13 account **read**
tools are still present for anonymous callers and refuse at execute time with
`needs_sign_in`. The module header claims the design is "a smaller tool list, not
refusals"; that is true for writes and not for reads. See §9.10.

### Categories

- **Reads (17)** — `getMyOrders`, `getOrder`, `getMyBookings`, `getBooking`,
  `getMyAppointments`, `getAppointment`, `getMyPets`, `getPetHealthRecord`,
  `getActivePrescriptions`, `getMyNotifications`, `searchProducts`, `getProduct`,
  `recommendProductsForPet`, `searchCaretakers`, `searchVets`, `searchKnowledge`,
  `getStoreFacts`.
- **Writes (4, signed in)** — `cancelOrder`, `cancelBooking`,
  `cancelAppointment`, `markNotificationsRead`. The first three take
  `confirm: z.literal(true)` — *"`confirm: false` should not typecheck as a
  call."*
- **Links (5)** — `openPage`, `startCheckout`, `startCaretakerBooking`,
  `startVetAppointment`, `offerSignIn`. All return
  `{ kind: "deep_link", href, label, summary }`. `KNOWN_PAGES` is a fixed
  10-entry map, so a hallucinated path is unrepresentable, and ids are validated
  against the database before appearing in a URL.
- **Client (1)** — `addToCart` is defined **with no `execute`**, so the SDK
  forwards it to the browser. The handler re-fetches the product by slug and
  never trusts a model-supplied price; checkout re-prices every line anyway.

## 9.5 Guards — `guards.ts`

Refusals are **data, never thrown errors**: *"a thrown error reaches the model as
a stack trace it cannot act on; a code like `not_yours` it can explain in a
sentence."*

```ts
type RefusalCode = "needs_sign_in" | "not_yours" | "not_found" | "too_late" | "not_allowed";
```

Each tool's `execute` does `if (typeof uid !== "string") return uid;`, so the
refusal becomes the tool *result* and streams to the model as normal output.

**Anti-probing:** `NOT_YOURS = "That doesn't belong to this account."` is
returned **byte-identically** for a record that exists but is someone else's and
one that does not exist at all. A test asserts `expect(missing).toEqual(theirs)`.
Same reasoning as the 404-not-403 on conversations.

## 9.6 Retrieval

Hybrid: dense (pgvector) + lexical (tsvector), fused with **Reciprocal Rank
Fusion** (`RRF_K = 60`, 20 candidates per leg).

**The lexical leg was dead on arrival** with `websearch_to_tsquery`, which ANDs
every term — so "how do I return something I bought" became
`return & someth & bought` and matched nothing, silently. It now pushes the query
through `to_tsvector('english', $1)` and ORs the surviving lexemes. On a small
corpus the lexical leg is the *strong* one: dense vectors put "cancel my booking"
and "cancel my order" a hundredth apart.

**The similarity floor is 0.30**, and it only rejects **dense-only** matches —
anything the lexical leg also found bypasses it. Calibrated against real
embeddings, where gibberish still scores ≈0.15 against an arbitrary chunk
because all English text shares some direction. The 0.15 that looks right against
the bag-of-words test embedder lets gibberish through.

### Two schema-qualification hazards

Both bite, and they have *different* rules:

- **Query engine:** Prisma's `?schema=x` does **not** move `search_path` — it
  stays `"$user", public`. So raw SQL on `knowledge_chunks` must be
  hand-qualified, or a test run silently reads and writes the **production**
  table. `tableFor(schema)` validates the name against
  `/^[a-z_][a-z0-9_]*$/i` and interpolates it quoted.
- **Schema engine:** sets `search_path` to the target schema alone, so
  `Unsupported("vector(1536)")` fails with `type "vector" does not exist` when
  pushed into `test`. It must be `public.vector(1536)` — see
  `prisma/schema.prisma`.

Nullable on that column is also load-bearing: a *required* `Unsupported` column
strips `create` and `update` off the generated client for the whole model.

### Ingest

`npm run kb:ingest` → `scripts/ingest-knowledge.ts`. Idempotent by SHA-256 of the
embeddable text; re-running with unchanged content makes **zero API calls**.
Flags: `--dry-run`, `--force`, `--offline` (deterministic hash embedder),
`--schema=test`.

`RED_FLAGS` are **excluded from the corpus deliberately** — they are inlined in
the system prompt instead. *"Making 'my cat is straining in the litter tray'
depend on a similarity search returning the right row is a bet that is fine
ninety-nine times and unforgivable the hundredth."*

Products are excluded too: they are rows, not prose, and an embedded description
is a stale price waiting to be quoted.

## 9.7 Rate limiting

```ts
LIMITS = { anonymous: { perHour: 10, perDay: 30 },
           signedIn:  { perHour: 40, perDay: 200 } };
```

Counted in Postgres — this stack has no Redis and adding one for two counters
would be the wrong trade. A **true sliding window**, not an hourly bucket, which
works because ISO-8601 strings sort chronologically: `createdAt: { gte: <an hour
ago> }` is a plain indexed comparison. A bucket would let someone spend two
hours' budget in the two minutes either side of the hour.

Only `role: "user"` rows count — the customer controls how many questions they
ask, not how many times the model answers.

The anonymous key is `sha256(salt:ip:user-agent)` truncated to 32 chars, salted
so the table never becomes a list of visitor IPs.

## 9.8 Conversations

```ts
scopeFor(ctx) = ctx.uid ? { userId: ctx.uid }
                        : { userId: null, clientKey: ctx.clientKey };
```

Anonymous threads require `userId: null` **and** a matching client key — never
either alone — so a shared device cannot surface the previous visitor's thread,
and a signed-in user cannot claim an anonymous one.

**A thread belonging to someone else reads as 404, not 403**, because 403 would
confirm the id exists and turn the endpoint into an enumeration oracle.

Storage detail worth knowing: the `title` key is **omitted** rather than set to
`undefined`, because Prisma reads an explicit `{ set: undefined }` as a
malformed update.

## 9.9 Presentation — `present.ts`

Money is formatted **at the tool boundary and nowhere else**. The model sees
`"$59.98"`, never `5998` — *"the model cannot divide by 100 incorrectly if it
never receives a number to divide."* A test asserts every money field matches
`/^\$\d+\.\d{2}$/`.

`presentOrder(..., { detailed: true })` explicitly omits `paymentRef`,
`paymentStatus` and the full shipping address, exposing only
`shippingTo: "City, State"`.

`canStillCancel` is stated up front rather than left to inference — the most
common question about an order and the easiest one to get wrong.

## 9.10 Known issues in this subsystem

Found during this audit and **not yet fixed**. Ranked.

| # | Issue | Impact | Severity |
|---|---|---|---|
| A-1 | **Conversation rehydration does not render.** `AssistantPanel` passes `messages: initial ?? []` to `useChat`, but `initial` arrives asynchronously and `@ai-sdk/react` only recreates the chat when `id` changes — which it never does. A reloaded thread keeps its server-side id but loses its visible and model-visible history. | A returning customer's context is silently empty | High |
| A-2 | **The model's context is the client-supplied `messages` array.** The route persists only the newest turn — the stated reason being that trusting the client's history would let it rewrite what it had been told — but then passes that same untrusted array straight to `streamAssistant`. A crafted request can forge prior assistant turns ("you confirmed the refund of $200"). **Data access is unaffected**: every guard re-checks the database and no tool takes a user id. The missing half is replaying the stored transcript server-side. | Model can be made to assert false things; no data leak | Medium |
| A-3 | `inputTokens`/`outputTokens` on `AssistantMessage` are **always 0** — `onFinish` never passes usage. The schema calls them "the cost dashboard". Dead columns. | No spend visibility | Low |
| A-4 | With neither `ASSISTANT_CLIENT_SALT` nor `AUTH_SECRET` set, the client key is an **unsalted** hash of IP + user agent — exactly the rainbow-table case the salt exists to prevent. | Dev-only in practice | Low |
| A-5 | `ingest.ts` metadata writes follow the **connection's** schema while vector writes use the **`schema` argument**. If they ever disagree, metadata and vectors land in different tables and every chunk reads back as un-embedded. | Silent corpus failure | Low |
| A-6 | `embed.ts`'s header states embedding happens "at ingest time, never on a request". **It is wrong** — `searchKnowledge` defaults to `gatewayEmbed()`, so every knowledge tool call embeds the query over the network. Behaviourally fine; the comment misleads about latency and cost. | Misleading comment | Low |
| A-7 | `ingest.ts` is **not transactional**. An interrupted run leaves fresh hashes with stale vectors — self-healing on re-run because the skip predicate requires `hasEmbedding`, but partially unsearchable until then. | Recoverable | Low |
| A-8 | Anonymous callers still carry ~13 account read tools that can only refuse, costing prompt tokens every turn and contradicting the module's stated design. | Cost, clarity | Low |

**Dead code:** `isRefusal` (exported, never imported), `toolNames()`,
`AssistantUIMessage`, `listConversationsByUser` (self-documented as not yet
surfaced), `StreamOptions.deps` (test-only seam), a re-exported `EASE_OUT`, and
`DEFAULT_EMBED_MODEL` — which is duplicated as a string literal in two other
files, so one value has three copies.

**Stale comments:** `model.ts` says "a 25-tool surface" (it is 27/23);
`context.ts` and `tools/index.ts` say `uid` comes from `requireUser()`, but the
chat route deliberately uses `auth()`.

## 9.11 Tests

`tests/assistant-tools.test.ts` is described in-file as the most important test
in the feature. Every guarded tool is checked three ways: owner gets the record,
another user gets `not_yours` with no detail, anonymous does not find the tool.

Also covered: `assistant-prompt.test.ts` (pure, no DB — asserts every red flag
appears verbatim, and that an anonymous prompt contains no customer name),
`assistant-retrieval.test.ts` (deterministic via the hash embedder — asserts
gibberish returns `[]`), `assistant-rate-limit.test.ts` (sliding-window
boundaries), `assistant-conversations.test.ts` (scope isolation).

**Not covered:** the chat route itself (readiness, 429, the header, `onFinish`),
`model.ts`, `agent.ts`, and every React component. A-1 and A-2 both live in that
gap.
