import { chromium } from "playwright-core";
const B = process.argv[2] || "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome" });
let pass = 0, fail = 0; const problems = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; problems.push(`${name} — ${detail}`); console.log(`  ✗ ${name}  ${detail}`); }
}

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.problems = [];
  page.on("pageerror", (e) => page.problems.push(`js: ${e.message.slice(0, 90)}`));
  page.on("response", (r) => {
    const u = r.url().replace(B, "");
    if (r.status() >= 400 && !u.startsWith("/api/me")) page.problems.push(`${r.status()} ${u.split("?")[0]}`);
  });
  return { ctx, page };
}
const body = async (p) => (await p.locator("body").innerText());

async function login(page, email) {
  await page.goto(`${B}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "leashdemo123");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(7000);
}

/* Routes behind proxy.ts — the cache-poisoning class. */
const GUARDED = ["/dashboard", "/dashboard/pets/new", "/dashboard/caretaker-profile",
                 "/dashboard/vet-profile", "/dashboard/orders", "/onboarding", "/booking/new",
                 "/dashboard/admin", "/dashboard/admin/users", "/dashboard/admin/payments",
                 "/dashboard/admin/subscriptions", "/dashboard/admin/audit",
                 "/dashboard/admin/settings", "/account/membership"];
/* Gated only in the client with <AuthRequired>. */
const CLIENT_GATED = ["/store/checkout", "/store/orders", "/store/orders/o1",
                      "/vets/book?vetId=v1", "/appointments/a3"];

console.log("\n[A] Guarded route → bounced to login → land back on THAT route");
for (const route of GUARDED) {
  const { ctx, page } = await newPage();
  await page.goto(`${B}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const bounced = page.url().includes("/login");
  await page.locator('button:has-text("Demo")').first().click().catch(() => {});
  await page.waitForTimeout(7000);
  const landed = new URL(page.url()).pathname;
  check(`${route}`, bounced && landed === route, `bounced=${bounced} landed=${landed}`);
  await ctx.close();
}

console.log("\n[B] Client-gated page → log in from the gate → land back on THAT page");
for (const route of CLIENT_GATED) {
  const { ctx, page } = await newPage();
  await page.goto(`${B}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const gate = (await body(page)).includes("not logged in");
  if (!gate) { check(`${route} shows a gate`, false, "no gate rendered"); await ctx.close(); continue; }
  await page.click('a[href*="callbackUrl"]');
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("Demo")').first().click().catch(() => {});
  await page.waitForTimeout(7000);
  const landed = new URL(page.url()).pathname + new URL(page.url()).search;
  check(`${route}`, landed === route, `landed=${landed}`);
  await ctx.close();
}

console.log("\n[C] Every page renders clean, per role");
const ROLES = [
  ["maya.chen@example.com", "owner", ["/", "/search", "/vets", "/store", "/pet-health", "/support", "/plus", "/account/membership", "/dashboard",
    "/dashboard/pets/new", "/dashboard/pets/p1", "/booking/new", "/store/cart", "/store/checkout",
    "/store/orders", "/store/orders/o1", "/store/summit-trail-salmon-dry-dog", "/vets/v1", "/vets/book",
    "/caretaker/c1", "/booking/b1", "/onboarding", "/appointments/a3"]],
  ["elena.petrova@example.com", "caretaker", ["/dashboard", "/dashboard/caretaker-profile"]],
  ["naomi.ruiz@example.com", "vet", ["/dashboard", "/dashboard/vet-profile", "/appointments/a1"]],
  ["rosa.delgado@example.com", "ops", ["/dashboard/orders"]],
  // Staff. Priya is an admin (every console); Tom holds support+finance, which
  // is what makes the role boundaries visible rather than theoretical.
  ["priya.raman@example.com", "admin", ["/dashboard/admin", "/dashboard/admin/users",
    "/dashboard/admin/payments", "/dashboard/admin/subscriptions",
    "/dashboard/admin/audit", "/dashboard/admin/settings", "/dashboard/orders"]],
  ["tom.okafor@example.com", "support+finance", ["/dashboard/admin",
    "/dashboard/admin/users", "/dashboard/admin/payments",
    "/dashboard/admin/subscriptions"]],
];
for (const [email, role, routes] of ROLES) {
  const { ctx, page } = await newPage();
  await login(page, email);
  for (const route of routes) {
    page.problems = [];
    await page.goto(`${B}${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    const txt = await body(page);
    const invisible = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("main *").forEach((el) => {
        const s = getComputedStyle(el);
        if (parseFloat(s.opacity) < 0.05 && el.textContent.trim().length > 12)
          out.push(el.textContent.trim().slice(0, 30));
      });
      return out.slice(0, 3);
    });
    const ok = txt.length > 300 && page.problems.length === 0 && invisible.length === 0;
    check(`${role} ${route}`, ok,
      [txt.length <= 300 && `thin(${txt.length})`, page.problems.join(","), invisible.length && `invisible:${JSON.stringify(invisible)}`].filter(Boolean).join(" "));
  }
  await ctx.close();
}

console.log("\n[D] Internal links resolve");
{
  const { ctx, page } = await newPage();
  await login(page, "maya.chen@example.com");
  const seen = new Set();
  for (const from of ["/", "/search", "/vets", "/store", "/pet-health", "/dashboard", "/store/orders", "/vets/v1"]) {
    await page.goto(`${B}${from}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute("href")));
    hrefs.forEach((h) => seen.add(h.split("#")[0]));
  }
  const links = [...seen].filter((h) => h && !h.startsWith("/api"));
  console.log(`  (${links.length} distinct internal links)`);
  const cookies = await ctx.cookies();
  const jar = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const broken = [];
  for (const href of links) {
    const res = await page.request.get(`${B}${href}`, { headers: { cookie: jar }, maxRedirects: 0 }).catch(() => null);
    const s = res ? res.status() : 0;
    if (s >= 400) broken.push(`${s} ${href}`);
  }
  check("no broken internal links", broken.length === 0, broken.join(", "));
  await ctx.close();
}

console.log(`\n${"=".repeat(52)}\n  PASS ${pass}   FAIL ${fail}`);
if (problems.length) console.log("\nProblems:\n  " + problems.join("\n  "));
await browser.close();
