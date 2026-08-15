import { chromium } from "playwright-core";

const BASE = process.argv[2] || "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome" });
let pass = 0, fail = 0;
const problems = [];

function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; problems.push(`${name} ${detail}`); console.log(`  ✗ ${name} ${detail}`); }
}

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 500) page.errors.push(`${r.status()} ${u.replace(BASE, "")}`);
  });
  return { ctx, page };
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "leashdemo123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 25000 });
  await page.waitForTimeout(3500);
}

const text = async (page) => (await page.locator("body").innerText());
const textLower = async (page) => (await text(page)).toLowerCase();

/* ── 1. Dashboards ─────────────────────────────────────────────── */
console.log("\n[1] Dashboards for every demo role");
for (const [email, marker, extra] of [
  ["maya.chen@example.com", "Owner dashboard", "Your pets"],
  ["elena.petrova@example.com", "Caretaker dashboard", "Incoming requests"],
  ["naomi.ruiz@example.com", "Vet dashboard", "Requests"],
]) {
  const { ctx, page } = await newPage();
  try {
    await login(page, email);
    const t = await textLower(page);
    check(`${marker} loads`, page.url().endsWith("/dashboard"), page.url());
    check(`${marker} renders`, t.includes(marker.toLowerCase()) && t.includes(extra.toLowerCase()),
      `marker=${t.includes(marker.toLowerCase())} extra=${t.includes(extra.toLowerCase())}`);
    check(`${marker} no page errors`, page.errors.length === 0, page.errors.join("; "));
  } catch (e) { check(`${marker}`, false, e.message.slice(0, 120)); }
  await ctx.close();
}

/* ── 2. Demo one-tap buttons ───────────────────────────────────── */
console.log("\n[2] One-tap demo buttons");
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const n = await page.locator('button:has-text("Demo")').count();
  check("three demo buttons", n === 3, `got ${n}`);
  await page.locator('button:has-text("Demo")').first().click();
  await page.waitForURL("**/dashboard", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(3000);
  check("demo button reaches dashboard", page.url().endsWith("/dashboard"), page.url());
  check("demo dashboard has content", (await text(page)).includes("Welcome back"));
  await ctx.close();
}

/* ── 3. Navigation + sliding indicator ─────────────────────────── */
console.log("\n[3] Navbar");
{
  const { ctx, page } = await newPage();
  await login(page, "maya.chen@example.com");
  for (const [label, path] of [["Find care", "/search"], ["Vets", "/vets"], ["Store", "/store"], ["Dashboard", "/dashboard"]]) {
    await page.click(`nav a:has-text("${label}")`);
    await page.waitForTimeout(1800);
    check(`nav → ${label}`, page.url().includes(path), page.url());
  }
  // the shared-element pill should exist on the current item
  await page.waitForTimeout(600);
  const pill = await page.locator('nav a[aria-current="page"] span').count();
  check("active nav pill present", pill > 0, `${pill}`);
  // scroll-reactive header
  await page.goto(`${BASE}/store`, { waitUntil: "networkidle" });
  const h1 = await page.locator("header > div").first().boundingBox();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(900);
  const h2 = await page.locator("header > div").first().boundingBox();
  check("header compresses on scroll", h2.height < h1.height, `${h1.height} → ${h2.height}`);
  await ctx.close();
}

/* ── 4. Store: browse → cart → checkout → track ────────────────── */
console.log("\n[4] Store purchase journey");
{
  const { ctx, page } = await newPage();
  await login(page, "maya.chen@example.com");
  await page.goto(`${BASE}/store`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const cards = await page.locator('a[href^="/store/"]').count();
  check("catalog renders products", cards > 3, `${cards}`);

  await page.goto(`${BASE}/store/summit-trail-salmon-dry-dog`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  check("product page renders", (await text(page)).includes("Salmon & Sweet Potato"));
  check("feeding guide present", (await text(page)).includes("Feeding guide"));
  await page.click('button:has-text("Add to cart")');
  await page.waitForTimeout(1200);
  const badge = await page.locator('a[href="/store/cart"] span').first().innerText().catch(() => "");
  check("cart badge updates", badge.trim() === "1", `"${badge}"`);

  await page.goto(`${BASE}/store/cart`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const cartText = await text(page);
  check("cart lists the item", cartText.includes("Salmon & Sweet Potato"));
  check("cart shows a server total", /Total\s*\$\d/.test(cartText.replace(/\n/g, " ")), cartText.slice(0,80));

  await page.goto(`${BASE}/store/checkout`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.fill("#c-line1", "1204 Grove Street");
  await page.fill("#c-zip", "78704");
  await page.click('button:has-text("Review order")');
  await page.waitForTimeout(1200);
  check("checkout review step", (await text(page)).includes("Check everything over"));
  await page.click('button:has-text("Pay ")');
  await page.waitForURL("**/store/orders/**", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const orderTxt = await text(page);
  check("order placed → tracking page", page.url().includes("/store/orders/"), page.url());
  check("tracking timeline renders", orderTxt.includes("Tracking history") && orderTxt.includes("Payment confirmed"));
  check("no page errors in store flow", page.errors.length === 0, page.errors.join("; "));
  await ctx.close();
}

/* ── 5. Prescription gate ──────────────────────────────────────── */
console.log("\n[5] Prescription gate");
{
  const { ctx, page } = await newPage();
  await login(page, "maya.chen@example.com");
  await page.goto(`${BASE}/store/vetline-hydrolyzed-protein-dog-dry`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const t = await text(page);
  check("Rx product shows the gate", t.includes("Vet prescription required"));
  const disabled = await page.locator('button:has-text("Prescription needed")').count();
  check("add-to-cart is blocked", disabled > 0, `${disabled}`);
  check("offers a route to a vet", t.includes("Book a vet visit"));
  await ctx.close();
}

/* ── 6. Vets: search → profile → book ──────────────────────────── */
console.log("\n[6] Vet booking");
{
  const { ctx, page } = await newPage();
  await login(page, "maya.chen@example.com");
  await page.goto(`${BASE}/vets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  check("vet search lists vets", (await page.locator('a[href^="/vets/v"]').count()) >= 4);
  await page.selectOption("#f-specialty", "dermatology");
  await page.waitForTimeout(2000);
  check("specialty filter narrows", (await page.locator('a[href^="/vets/v"]').count()) === 1);

  await page.goto(`${BASE}/vets/v1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  check("vet profile renders", (await text(page)).includes("South Austin Animal Hospital"));
  await page.click('a:has-text("Request appointment")');
  await page.waitForTimeout(2500);
  check("booking flow opens", (await text(page)).includes("Request an appointment"));
  await ctx.close();
}

/* ── 7. Health record ──────────────────────────────────────────── */
console.log("\n[7] Pet health record");
{
  const { ctx, page } = await newPage();
  await login(page, "priya.nair@example.com");
  await page.goto(`${BASE}/dashboard/pets/p4`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.click('button:has-text("Health record")');
  await page.waitForTimeout(2500);
  const t = await text(page);
  check("health timeline renders", t.includes("Health timeline"));
  check("active prescription shown", t.includes("Active prescriptions"));
  check("store link from prescription", t.includes("View in store"));
  await ctx.close();
}

/* ── 8. Ops console ────────────────────────────────────────────── */
console.log("\n[8] Ops fulfilment console");
{
  const { ctx, page } = await newPage();
  await login(page, "rosa.delgado@example.com");
  await page.goto(`${BASE}/dashboard/orders`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  check("ops queue renders", (await text(page)).includes("Fulfilment queue"));
  const advance = page.locator('button:has-text("Start picking"), button:has-text("Hand to carrier"), button:has-text("Out for delivery"), button:has-text("Mark packed"), button:has-text("Mark delivered")').first();
  if (await advance.count()) {
    await advance.click();
    await page.waitForTimeout(2500);
    check("order advances", true);
  } else check("order advances", false, "no advance button");
  await ctx.close();
}

/* ── 9. Non-owner is refused the ops console ───────────────────── */
console.log("\n[9] Ops console is gated");
{
  const { ctx, page } = await newPage();
  await login(page, "maya.chen@example.com");
  await page.goto(`${BASE}/dashboard/orders`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  check("non-ops sees refusal", (await text(page)).includes("Store operations only"));
  await ctx.close();
}

/* ── 10. Mobile nav ────────────────────────────────────────────── */
console.log("\n[10] Mobile menu");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.click('button[aria-label="Open menu"]');
  await page.waitForTimeout(700);
  check("menu opens", await page.locator('button[aria-label="Close menu"]').isVisible());
  check("menu links visible", await page.locator('header nav a:visible:has-text("Vets")').first().isVisible());
  await page.click('button[aria-label="Close menu"]');
  await page.waitForTimeout(700);
  check("menu closes", (await page.locator('button[aria-label="Open menu"]').count()) > 0);
  check("no mobile page errors", page.errors.length === 0, page.errors.join("; "));
  await ctx.close();
}

/* ── 11. Public pages + reduced motion ─────────────────────────── */
console.log("\n[11] Public pages (reduced motion)");
{
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  for (const path of ["/", "/search", "/vets", "/store", "/pet-health", "/login", "/signup"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const body = await text(page);
    check(`${path} renders`, body.length > 400, `${body.length} chars`);
  }
  check("no errors under reduced motion", page.errors.length === 0, page.errors.join("; "));
  await ctx.close();
}


/* ── 12. Auth entry points ─────────────────────────────────────────
   Every way a user can arrive at a guarded route. The regression this
   guards: clicking a guarded link while signed out caches proxy.ts's
   redirect, and a client-side push after signing in replays it. */
console.log("\n[12] Ways into a guarded route");

async function reachesDashboard(label, arrive) {
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await arrive(page);
  await page.waitForTimeout(6000);
  const body = await text(page);
  const ok = page.url().includes("/dashboard") && body.includes("Welcome back,");
  check(label, ok, `url=${page.url().replace(BASE, "")}`);
  await ctx.close();
}

const demoClick = async (page) => {
  await page.locator('button:has-text("Demo")').first().click();
};
const formLogin = async (page) => {
  await page.fill('input[type="email"]', "maya.chen@example.com");
  await page.fill('input[type="password"]', "leashdemo123");
  await page.click('button[type="submit"]');
};

await reachesDashboard("nav click → bounced to login → demo button", async (page) => {
  await page.click('header nav a:has-text("Dashboard")');
  await page.waitForTimeout(2500);
  await demoClick(page);
});

await reachesDashboard("nav click → bounced to login → password form", async (page) => {
  await page.click('header nav a:has-text("Dashboard")');
  await page.waitForTimeout(2500);
  await formLogin(page);
});

await reachesDashboard("direct URL → bounced to login → demo button", async (page) => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await demoClick(page);
});

await reachesDashboard("straight to /login → demo button", async (page) => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await demoClick(page);
});

/* Signing out, then in again as a different person. */
{
  const { ctx, page } = await newPage();
  await login(page, "maya.chen@example.com");
  await page.click('header button:has-text("Log out")');
  await page.waitForTimeout(4000);
  check("logout returns home", !page.url().includes("/dashboard"), page.url().replace(BASE, ""));

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.locator('button:has-text("Demo")').nth(2).click();
  await page.waitForTimeout(6000);
  const body = await textLower(page);
  check("sign in again as a different role", body.includes("vet dashboard"), page.url().replace(BASE, ""));
  await ctx.close();
}

/* A guarded route still refuses an anonymous visitor. */
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  check("guarded route still bounces when signed out", page.url().includes("/login"), page.url().replace(BASE, ""));
  await ctx.close();
}


/* ── 13. Vet reviews ───────────────────────────────────────────────
   Owner reviews the vet after a completed visit; one direction, once. */
console.log("\n[13] Vet reviews");
{
  const { ctx, page } = await newPage();

  await page.goto(`${BASE}/vets/v1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  const profile = await text(page);
  check("vet profile lists written reviews", profile.includes("food trial has to be strict"));
  check("vet profile shows a review count", /Reviews\s*\(\d+\)/.test(profile.replace(/\n/g, " ")));

  await login(page, "maya.chen@example.com");
  await page.goto(`${BASE}/appointments/a8`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  check("completed visit offers a review form", (await text(page)).includes("Leave a review for"));

  await page.locator('button[aria-label="5 stars"]').click();
  await page.fill("textarea", "Sorted the limp with a plan, not a prescription.");
  await page.click('button:has-text("Post review")');
  await page.waitForTimeout(8000);
  const after = await text(page);
  check("review is posted and shown", after.includes("Sorted the limp"));
  check("form retires once used", !after.includes("Leave a review for"));

  // and it reaches the vet's public profile
  await page.goto(`${BASE}/vets/v1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  check("review appears on the vet's profile", (await text(page)).includes("Sorted the limp"));
  await ctx.close();
}

/* An unreviewable visit must not offer the form. */
{
  const { ctx, page } = await newPage();
  await login(page, "maya.chen@example.com");
  await page.goto(`${BASE}/appointments/a3`, { waitUntil: "networkidle" }); // confirmed, not completed
  await page.waitForTimeout(3500);
  check("upcoming visit offers no review form", !(await text(page)).includes("Leave a review for"));
  await ctx.close();
}

/* The vet sees the review but is not invited to review the client back. */
{
  const { ctx, page } = await newPage();
  await login(page, "naomi.ruiz@example.com");
  await page.goto(`${BASE}/appointments/a1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  const vetView = await text(page);
  check("vet sees the owner's review", vetView.includes("food trial has to be strict"));
  check("vet is not offered a review form", !vetView.includes("Leave a review for"));
  await ctx.close();
}

console.log(`\n${"=".repeat(50)}\n  PASS ${pass}   FAIL ${fail}`);
if (problems.length) console.log("\nFailures:\n  " + problems.join("\n  "));
await browser.close();
process.exit(fail ? 1 : 0);
