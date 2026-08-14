# Browser tests

Two Playwright scripts that drive a real browser against a running app. They
exist because the bugs that reached production were invisible to the unit
suite and to `next dev`: stale App Router cache entries, and content left at
opacity 0 by a stagger container.

```bash
npm run build && npm start          # a production build — dev hides these bugs
node scripts/e2e/suite.mjs          # 60 checks: journeys
node scripts/e2e/sweep.mjs          # 39 checks: every route, every role
node scripts/e2e/suite.mjs https://petcare-app-drab.vercel.app   # or the live site
npm run db:seed                     # afterwards — the suites place real orders
```

**No Playwright browsers are installed.** Both scripts use the system Chrome via
`chromium.launch({ channel: "chrome" })`. Install the driver with
`npm i playwright` in a scratch directory, or add it as a devDependency.

- **suite.mjs** — user journeys: the three demo dashboards, one-tap login,
  navigation, browse → cart → checkout → tracking, the prescription gate, vet
  search and booking, health records, the ops console and its guard, mobile
  nav, reduced motion, and every way into a guarded route.
- **sweep.mjs** — coverage: every guarded route bounces to login and returns
  you to *that* route; every client-gated page does the same via its own gate;
  every page loads clean per role with no console errors, failed requests or
  invisible content; and every internal link resolves.
