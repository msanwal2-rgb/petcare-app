# 10. Integrations and configuration

## 10.1 External services

| Service | Used for | Without it |
|---|---|---|
| **Neon Postgres** | everything | the app does not run |
| **Auth.js v5 (beta)** | sessions | — |
| **Google OAuth** | "Continue with Google" | the button is **hidden**, password login unaffected |
| **Stripe** | card payments, Leash Plus | the demo provider settles inline; membership checkout answers **503** rather than pretending |
| **Resend** | email | `mailer.ts` `console.log`s the message instead |
| **OpenRouter / Anthropic / Vercel AI Gateway** | the assistant | `/api/assistant/chat` answers **503** |
| **Unsplash** | every photo | broken images — see the risk in §17 |
| **Vercel** | hosting, cron | — |

Every one of these fails *closed and visibly*. There is no code path that
pretends a payment happened, and none that leaks a provider error to a customer.

## 10.2 Environment variables

**⚠️ No secret values appear in this documentation, and none were found in the
repository.** A scan of all 421 tracked files for Stripe, Google and generic
API-key patterns returned nothing. The only tracked env file is
`.env.local.example`, which contains names and placeholders only. `.gitignore`
covers `.env*` with an explicit `!.env.local.example` exception.

Names only, grouped by what breaks without them:

### Required
```
POSTGRES_PRISMA_URL          pooled connection, used by the app
POSTGRES_URL_NON_POOLING     direct connection, used by migrations
AUTH_SECRET                  JWT signing; also the fallback assistant client salt
```

### Optional — each gates one feature
```
AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET      Google sign-in button appears
RESEND_API_KEY / EMAIL_FROM              real email instead of console.log
EMAIL_DEV_MODE                           forced off in production regardless of value
LEASH_PAYMENTS                           "stripe" | anything else = demo
STRIPE_SECRET_KEY                        ⚠️ LEASH_PAYMENTS=stripe without it fails closed
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY       empty ⇒ the checkout UI shows "Demo payment"
STRIPE_WEBHOOK_SECRET                    signature verification
CRON_SECRET                              ⚠️ unset ⇒ /api/cron/* refuses everything
APP_ORIGIN / NEXT_PUBLIC_SITE_URL        canonical base URL for links in email
STAFF_PASSWORD                           seeded staff accounts
```

### Assistant
```
OPENROUTER_API_KEY        ← highest precedence
ANTHROPIC_API_KEY         ← next
AI_GATEWAY_API_KEY        ← gateway route
VERCEL_OIDC_TOKEN         ← implicit gateway credential; deliberately lowest
ASSISTANT_ENABLED         "false" hides the launcher and 503s the route
ASSISTANT_MODEL / ASSISTANT_OPENROUTER_MODEL / ASSISTANT_ANTHROPIC_MODEL
ASSISTANT_EMBED_MODEL
ASSISTANT_CLIENT_SALT     ⚠️ falls back to AUTH_SECRET; unsalted if neither is set
ASSISTANT_DB_SCHEMA       raw-SQL schema qualification
ASSISTANT_E2E             gates the assistant block in the e2e suite
```

The precedence order in `model.ts` is **explicit before implicit** on purpose:
`VERCEL_OIDC_TOKEN` appears in `.env.local` unbidden on a Vercel-linked project
and must not outrank a key somebody deliberately set.

## 10.3 Config files

| File | What to know |
|---|---|
| `package.json` | **`postinstall: prisma generate` — removing it breaks a fresh clone.** Every db/test script is wrapped in `dotenv -e .env.local`, so **`npm test` will not run without `.env.local`** and there is no fallback to `.env`. |
| `tsconfig.json` | `strict`, `moduleResolution: bundler`, `paths: {"@/*": ["./*"]}`. `include` covers `**/*.mts` so `vitest.config.mts` is typechecked; the e2e `.mjs` files are **not**. |
| `eslint.config.mjs` | Flat config. One override: `no-unused-vars` → `warn` with a `^_` ignore pattern — the codebase's "deliberately unused" convention for route handlers ignoring `request`. Tightening it to `error` fails lint on many handlers. |
| `postcss.config.mjs` | One plugin. **There is no `tailwind.config.js`** — Tailwind v4 theming is `@theme` in `app/globals.css`. |
| `next.config.ts` | Only `images.remotePatterns` for `images.unsplash.com`. Remove it and every remote `next/image` throws. |
| `vitest.config.mts` | **`fileParallelism: false`** — tests share one database. Turning it on produces flaky, unreproducible failures. `hookTimeout: 120_000`. |
| `vercel.json` | One cron: `GET /api/cron/advance-orders` at `0 3 * * *`. ⚠️ Rejects unknown keys — a `comment` field inside a cron entry fails deploy validation. |
| `AGENTS.md` / `CLAUDE.md` | A warning that this Next.js version differs from training data; read `node_modules/next/dist/docs/`. |

`.agents/`, `.claude/` and `skills-lock.json` are gitignored local tooling
artifacts. Deleting them changes no runtime behaviour.

## 10.4 Pinned versions, and why

| Package | Pin | Reason |
|---|---|---|
| `next` `16.2.10` | exact | middleware is `proxy.ts` in this version; `eslint-config-next` matches exactly |
| `react` / `react-dom` `19.2.4` | exact | the `set-state-in-effect` and ref rules are enforced |
| `prisma` / `@prisma/client` `^6.19.3` | major | **Prisma 7 needs Node ≥ 20.19; the dev machine runs 20.18** |
| `ai` `6.0.266` + `@ai-sdk/*` | exact | `ai` v7 needs Node ≥ 22 — the same constraint |
| `@ai-sdk/openai-compatible` | exact | `@openrouter/ai-sdk-provider` requires `ai` v7, so OpenRouter is reached through the openai-compatible provider instead |

**Upgrading Node lifts both the Prisma and the `ai` pin at once.** That is the
single highest-leverage maintenance action available.

## 10.5 Activating the blocked integrations

Full instructions live in `docs/going-live.md` and `ROADMAP.md`. Summary:

**Google sign-in** — create an OAuth client at
<https://console.cloud.google.com/apis/credentials>. Authorised redirect URIs:
`https://<your-domain>/api/auth/callback/google` and
`http://localhost:3000/api/auth/callback/google`. Set `AUTH_GOOGLE_ID` and
`AUTH_GOOGLE_SECRET` on every Vercel environment and in `.env.local`. The button
appears on `/login` and `/signup` by itself — `/api/config` reports which
providers are configured.

**Stripe** — provision through the Vercel Marketplace
(`vercel integration add stripe`, then `vercel env pull`) rather than
hardcoding. Create the Leash Plus product and price, write the price id into
`plans.stripePriceId`, register `/api/webhooks/stripe` as an endpoint, set
`STRIPE_WEBHOOK_SECRET`, then `LEASH_PAYMENTS=stripe`.

**Email** — a Resend account, `RESEND_API_KEY` + `EMAIL_FROM`.
