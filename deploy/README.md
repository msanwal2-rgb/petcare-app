# Deploying to IIS: backend and frontend as two sites

| Site | Port | Folder | What it is |
|---|---|---|---|
| Backend | 8080 | `C:\inetpub\wwwroot\leash` | `dotnet publish` of `API/src/Leash.Api` |
| Frontend | 8081 | `C:\inetpub\wwwroot\leashfrontend` | the contents of `web/dist` after `npm run build` |

Two settings connect them:

1. **The frontend's `config.js`** says where the API is.
2. **The backend's `Cors:Origins`** says which frontend may call it.

## 1. The frontend: `config.js`

`config.js` sits next to `index.html` in the frontend folder. Edit it on the
server. You don't need to rebuild.

```js
window.LEASH_CONFIG = {
  apiBaseUrl: "http://localhost:8080",
};
```

Every API call goes to `apiBaseUrl` + `/api/v1/...`. Development works the
same way: `web/public/config.js` points at `http://localhost:5001`.

## 2. The backend: `appsettings.Production.json`

Create this file in the backend folder, next to `Leash.Api.dll`:

```json
{
  "ConnectionStrings": {
    "Default": "Host=localhost;Port=5432;Database=leash_review;Username=leash;Password=devonly"
  },
  "Auth": {
    "Secret": "<64 random characters: openssl rand -base64 48>"
  },
  "App": {
    "Origin": "http://localhost:8081"
  },
  "Cors": {
    "Origins": [ "http://localhost:8081" ]
  }
}
```

- **`Cors:Origins`** is the frontend's address, exactly as the browser shows
  it: scheme, host and port, with no trailing slash.
- **`App:Origin`** is also the frontend's address. Links in emails point
  there.

Then restart the backend: recycle its app pool, or run `iisreset`.

Swagger is at `http://localhost:8080/swagger`. To turn it off, set
`"Swagger": { "Enabled": false }`.

## 3. Publishing a new build

From an **elevated** PowerShell at the repository root:

```powershell
.\deploy\publish-iis.ps1
```

It builds the SPA, publishes the API, takes the API site offline with
`app_offline.htm` while its files are replaced, and mirrors both folders. It
**keeps** the server's `appsettings.Production.json` and the frontend's
`config.js` — the build only ships the development copy of `config.js`, which
is installed on a first deploy only. `.\deploy\publish-iis.ps1 -StageOnly`
builds into `API\src\Leash.Api\bin\iis-staging` and stops, needing no rights.

Then apply any new `db/changes/NNN_*.sql` (see **Database** below).

## 4. Payments and email

All in `appsettings.Production.json`, or as environment variables
(`Payments__Provider`, …):

| Setting | What it does |
|---|---|
| `Payments:Provider` | `demo` (default — no money moves) or `stripe` |
| `Payments:Stripe:SecretKey` | Required with `stripe`. **The API refuses to start without it** rather than taking pretend payments for real orders |
| `Payments:Stripe:WebhookSecret` | The signing secret of the endpoint registered in Stripe at `https://<api>/api/v1/webhooks/stripe`. **Unset, every webhook is refused (403)** |
| `Email:ResendApiKey`, `Email:From` | Real email; unset, emails are only logged |

With Stripe, also set `stripePublishableKey` in the frontend's `config.js`,
and give the Leash Plus plan its Stripe price
(`UPDATE plans SET "stripePriceId" = 'price_…' WHERE key = 'leash_plus'`) —
until then the plan shows as not for sale and checkout answers 503.

## 5. More than one API instance

- **The fulfilment job must run on exactly one.** Set
  `Fulfilment__Enabled=false` on every other instance. Two running it is safe
  (every move is conditional) but does the work twice. The same job retries
  unacknowledged refunds and purges old webhook payloads.
- **The notification email drain is safe on all of them** — it claims rows
  with `FOR UPDATE SKIP LOCKED`. Turn it off with
  `Notifications__Outbox__Enabled=false` if you want it on one.
- **Webhooks are safe on all of them** — each event is claimed once.

## Making it public with Cloudflare Tunnel

The client's browser has to reach **both** sites, so start one tunnel for
each port:

```powershell
cloudflared tunnel --url http://localhost:8080   # prints https://aaa.trycloudflare.com (API)
cloudflared tunnel --url http://localhost:8081   # prints https://bbb.trycloudflare.com (frontend)
```

Then:

1. Set `apiBaseUrl` in the frontend's `config.js` to the API's tunnel
   address.
2. In the backend settings, set `Cors:Origins` and `App:Origin` to the
   frontend's tunnel address.
3. In the backend settings, add `"CrossSiteCookie": true` inside `"Auth"`.
   The two tunnel addresses are different domains, so the login cookie needs
   it.
4. Restart the backend.

**Limits of quick tunnels:**
- Their addresses change on every restart, so repeat these steps each time.
- Safari, which covers every iPhone browser, blocks cross-domain login
  cookies. Logging in fails there.

The fix for both is a domain of your own with permanent tunnels on
`app.yourdomain.com` and `api.yourdomain.com`. They count as one site, so
`CrossSiteCookie` isn't needed and Safari works.

## Database

`load-db.sh` loads the schema, catalogue and demo accounts into an empty
database. The `leash_review` database is already loaded on this PC.

```bash
export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"
createdb -U leash -h localhost leash_review
./deploy/load-db.sh "postgresql://leash:devonly@localhost/leash_review"
```

Database changes are not applied automatically. When a new
`db/changes/NNN_*.sql` arrives, run it once with `psql`. Check what a database
already has with `SELECT script FROM schema_version;` — each script refuses
to run twice. `leash_review` is at `005_audit_log_seq` (2026-10-17).

**Never forward port 5432 on your router.** PostgreSQL accepts connections
from any address with the dev password.

## Demo accounts

All use the password `leashdemo123`:

- `maya.chen@example.com` (owner)
- `liam.novak@example.com` (caretaker)
- `naomi.ruiz@example.com` (vet)

No email is sent; verification and reset emails are only logged.
