# Vennix Storefront — Audit Report

Date: 2026-09-21
Branch: `arena/01a0c182-vennix-storefront`
Base commit: `0623e3b` ("Add files via upload")
Node: v22.22.3 (project requires `>=18`)

## Fixes applied in this session

The Critical / High issues listed in this report were fixed directly. Verifying
with `npm run check && npm run smoke && npm run features && npm run links && npm
run theme:check` — **119/119 smoke, 41/41 features, 43 pages OK, 13/13 theme
checks pass**. A summary of the changes:

| Fix | Files |
|---|---|
| Missing source restored (zip extracted into tree; zip deleted from repo) | `lib/`, `public/`, `scripts/`, `shopify-theme/`, `data/`, `docs/`, `.github/`, `seo/` |
| `.gitignore` expanded to cover corrupt-DB backups, temp files, `.env` | `.gitignore` |
| `Set-Cookie` overwrite bug fixed (now uses array + append, so session + cart cookies both land) | `lib/auth.js`, `lib/cart.js` |
| Session/cart cookies now `Secure` under `NODE_ENV=production`, `SameSite=Lax`, `HttpOnly` (cart was previously readable from JS) | `lib/auth.js`, `lib/cart.js` |
| Security headers added (`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`) on both HTML and JSON responses | `server.js` |
| CSRF defense via `Origin`/`Referer` check on every non-GET request (covers `/api/*`, `/admin/*`, and form POSTs). Cross-origin POSTs return 403. | `server.js` |
| Password-reset email now links to `/account/reset?token=…` (was `/account/reset/<token>` → 404) | `lib/emails.js` |
| Password reset links now enforce the one-hour `resetExpires`, invalidate on use, and wipe existing customer sessions after reset | `server.js` |
| Admin credentials: no longer pre-filled in the HTML; `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars supported; auto-generated one-time password printed to stdout on first boot when running in `NODE_ENV=production` without a password; boot banner no longer prints the password | `lib/seed.js`, `lib/admin/router.js`, `server.js` |
| Admin login rate-limited (8 attempts/min/IP) | `lib/admin/router.js` |
| Storefront login and order-tracking endpoints rate-limited | `server.js` |
| DOM XSS in the search overlay fixed (user query escaped before `.innerHTML`) | `public/js/main.js` |
| Checkout idempotency — a hidden `_checkoutToken` ties a successful order to the cart, so refresh/back-button resubmits redirect to the existing order instead of charging twice | `server.js`, `lib/pages/checkout.js` |
| Payment sandbox now refuses real PANs: only the documented test cards are approved when `settings.payments.testMode` is true (prevents "paid" orders from being created against numbers that look real) | `lib/commerce.js` |
| Email shell now uses `settings.address` and `settings.supportEmail` instead of the hardcoded Vennix/Brooklyn address — rebranding works end-to-end | `lib/commerce.js` |
| Unknown US states no longer silently default to 6% tax (they now show "Tax (XX) — not configured" with a 0% rate so the merchant can add the correct rate instead of over-charging) | `lib/commerce.js` |
| Boot banner no longer prints "(sandbox) (sandbox)" twice | `lib/seed.js`, `server.js` |

Items still outstanding (not fixed here, see §7 for full list): a proper
per-form CSRF token (the Origin check gives solid baseline protection but a
synchronizer token is stricter), full CSP and HSTS (infrastructure-dependent),
non-sequential public order IDs, cache-busted asset filenames, splitting
`lib/admin/router.js`, a production process manager / Dockerfile, and locking
down the CI jsdom install with a pinned devDependency.


## Executive Summary

The repository as checked into Git is **not runnable**. The initial commit
`0623e3b` only contains top-level files (`server.js`, `package.json`,
`README.md`, `brand.example.json`, `LICENSE`, `.gitignore`,
`.gitattributes`) plus an uploaded binary `vennix-storefront (1).zip`
(3.1 MB) that holds the actual source tree (`lib/`, `public/`, `scripts/`,
`shopify-theme/`, `data/`, `docs/`, `.github/`, `seo/`). `npm start` as
cloned crashes with `MODULE_NOT_FOUND` for every `require('./lib/...')`
in `server.js`. After extracting the zip, `npm run check`, `npm run smoke`
(119/119), `npm run features` (41/41), `npm run links` (43 pages, 0
broken) and `npm run theme:check` (13/13) all pass — but several real
security, correctness and repository-hygiene issues remain.

**Severity key:** 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low · ℹ️ Info

---

## 1. Repository hygiene

| Sev | Issue | Evidence |
|---|---|---|
| 🔴 | **Missing source from the working tree — `npm start` fails on a fresh clone.** Only the root files are committed; every `require('./lib/...')` in `server.js` (lines 13–30) fails. The actual code lives only inside the un-ignored zip `vennix-storefront (1).zip`. | `find . -not -path '*/.git/*'` returns 8 files + zip before extraction. |
| 🔴 | **A 3.1 MB vendor zip is committed to the repo.** `vennix-storefront (1).zip` is not in `.gitignore` and duplicates the rest of the codebase as a binary blob. This will bloat the Git history permanently once pushed. | `ls -la "vennix-storefront (1).zip"` → 3,297,043 bytes. |
| 🟠 | **Runtime data is not actually ignored.** `.gitignore` lists `data/db.json` and `data/emails/`, but the committed tree had no `data/` directory at all. Once seeded, running `git add .` would pick up `data/db.json`, `data/emails/*.html`, and a directory that is not in any branch baseline. Additionally, nothing ignores the `data/db.*.corrupt-*.json` files that `lib/store.js` writes when the DB is unreadable (line 43 of `lib/store.js`). | `.gitignore` lines 2–3; `lib/store.js:43`. |
| 🟠 | **`seo/` directory exists but is neither documented nor ignored.** It contains a Python script, CSVs of meta descriptions, and a REVIEW.md. The README makes no mention of it; it looks like an artifact of an SEO pass that was shipped by accident. | `ls seo/` → `README.md  REVIEW.md  build-meta-descriptions.py  meta-descriptions-audit.csv  meta-descriptions-deploy.csv`. |
| 🟡 | **`package.json` points at placeholder repo URLs.** `repository.url`, `bugs.url` and `homepage` all reference `https://github.com/your-org/vennix-storefront` rather than `Kellyray-dev/vennix-storefront`. | `package.json:33–40`. |
| 🟡 | **CI only runs on `push` to `main` and on PRs.** Branch pushes (e.g. to `arena/...`) won't trigger `verify.yml` because of `branches: [main]`. | `.github/workflows/verify.yml:3–5`. |
| ℹ️ | **`npm test` is not defined.** The README advertises `npm run verify`, which is fine, but tools that assume `npm test` will fail. | `package.json` scripts. |
| ℹ️ | **`brand.example.json` shows the "Northline" example, not Vennix.** README tells the user to copy it and edit, but the example is a different brand and the `_comment`/`_noPhone`/`_socials` noise keys will be picked up by naive JSON consumers. | `brand.example.json`. |

---

## 2. Security

### 2.1 🔴 Hardcoded admin credentials

`lib/seed.js` seeds the admin account with a fixed email and password:

```js
admin: { email: 'admin@vennixstore.com' },
...
const adminCreds = auth.hashPassword('vennix123');
db.settings.admin.passwordHash = adminCreds.hash;
```

The login form (lib/admin/router.js:889-893) **pre-fills** the password
field with `vennix123`, and the server logs the credentials on boot:

```
Admin  http://localhost:3000/admin  (admin@vennixstore.com / vennix123)
```

These credentials are never rotated: there is no first-run password
change, no env-var override, and no generated secret. Anyone who can
reach the deployed server gets the admin panel on the first try.

**Fix:** Read admin email/password from `process.env.ADMIN_EMAIL` /
`process.env.ADMIN_PASSWORD` (with a random one-time password printed to
stdout if unset in production), force a password change on first login,
and remove the value from the `<input value="vennix123">` autocomplete.

### 2.2 🟠 No CSRF protection on state-changing routes

Every POST endpoint — checkout, account updates, admin order actions
(fulfil, refund, cancel, product/discount/settings saves), cart
mutations, contact, newsletter, reviews — accepts
`application/x-www-form-urlencoded` or JSON bodies with no CSRF token,
no `Origin`/`Referer` check, and no double-submit cookie. The session
cookie is `SameSite=Lax`, which mitigates cross-site form submits in
modern browsers for most endpoints, **but not** for top-level POST
navigations (e.g. a third-party site submitting to `/checkout` or
`/admin/...`) and not at all for older browsers / API calls made with
credentials.

Examples:
- `server.js:433` `/checkout` POST creates a paid order.
- `lib/admin/router.js` `/admin/orders/:id/fulfil`, `/refund`,
  `/cancel`, `/admin/products/save`, `/admin/discounts/save`,
  `/admin/settings/save` all take form posts without a token.
- `lib/api.js` accepts JSON POSTs without requiring any header that a
  cross-origin script cannot force (no `X-Requested-With` or custom
  token check).

**Fix:** Add a per-session CSRF token, render it into every form and
require it for POST (and for any non-idempotent API route). For API
endpoints, reject non-JSON content-types or require a custom header.

### 2.3 🟠 Cookie handling is broken — `Set-Cookie` gets overwritten

Node's `res.setHeader('Set-Cookie', …)` **replaces** any existing
`Set-Cookie` header instead of appending. `lib/auth.js` and `lib/cart.js`
both use `setHeader`:

```js
// lib/auth.js:65
res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, id, ...));
// lib/cart.js:27
res.setHeader('Set-Cookie', auth.serializeCookie(CART_COOKIE, id, ...));
```

On any response that sets both (e.g. first-hit add-to-cart when a new
cart is created AND the session is simultaneously issued — or a
register-then-add flow where the cart ID is freshly allocated), **only
one cookie survives**. Verified empirically with curl:

```
POST /account/register ... → Set-Cookie: vnx_sid=...   (cart cookie lost)
```

Because the cart cookie is also client-readable (`httpOnly: false`,
see 2.4) and the session is 30 days, the observable symptom is "my cart
occasionally empties on sign-in/up". More importantly any future code
that sets a second cookie (e.g. a `Set-Cookie` on a flash message) will
silently nuke the session.

**Fix:** Always use `res.appendHeader('Set-Cookie', …)` (Node ≥ 18) or
build an array and call `setHeader('Set-Cookie', arrayOfCookies)`.

### 2.4 🟠 Session cookie is missing `Secure` and partitioned flags; cart cookie is readable from JS

`serializeCookie` in `lib/auth.js:57-61` emits `HttpOnly`, `Path=/` and
`SameSite=Lax` but never adds `Secure`, so cookies are sent over
plaintext HTTP in production (there is no TLS redirect). The cart
cookie is explicitly set `httpOnly: false` (lib/cart.js:27), so XSS can
steal cart IDs and tie them to visitor sessions. There is no
`__Host-` prefix and no `SameSite=Strict` option for admin sessions.

**Fix:**
- Add `Secure` when `NODE_ENV === 'production'`.
- Consider `SameSite=Strict` for `/admin/*` (or a separate admin cookie
  scope).
- Make the cart cookie `HttpOnly` (the client JS doesn't need to read
  it — it already talks to the server via `/api/cart/*`).

### 2.5 🟠 No brute-force / rate-limit / lockout on auth endpoints

`/admin/login`, `/account/login`, `/account/recover`, `/api/*` (cart
add, notify, newsletter, reviews, contact) have no rate limiting and no
CAPTCHA. `admin.login_failed` is logged but never throttled, so a
credential-stuffing attack on the publicly-documented admin account is
unbounded. The demo password `vennix123` is in the HTML source of the
login page, trivially scannable.

### 2.6 🟠 DOM XSS in client-side search "nothing matched"

In `public/js/main.js:202`:

```js
searchResults.innerHTML = html || '<p class="sr-empty">Nothing matched "' + q + '". Try … </p>';
```

`q` is read straight from the `<input>` via an on-input keystroke
handler and inserted as HTML. A search term like
`<img src=x onerror=alert(1)>` fires in the visitor's own browser. The
server-rendered `/search` page correctly uses `ui.esc(q)` — the bug is
only on the live-search overlay, but it is a real reflected/self XSS
that can be triggered by a crafted `#q=...` URL if the query is seeded
from the URL (need to confirm; at minimum typing HTML into the search
box pops an alert).

The "cart drawer" and quickview HTML also use `.innerHTML = h.drawer`,
`.innerHTML = res.html` but those come from the server which HTML-escapes
user fields. The search empty-state is the only confirmed sink I found
using raw client-side strings.

**Fix:** Replace the literal `q` with `esc` on the client, or set that
text via `textContent`.

### 2.7 🟠 Password-reset token is never expired server-side

`server.js:513` writes `resetExpires: now + 36e5` (one hour), but the
verification at `server.js:521` checks only `c.resetToken === body.token`
— it never consults `resetExpires`. An old reset link works forever
until the token is overwritten by a new reset request.

Additionally, the reset link emailed by `lib/emails.js:85` points to
`/account/reset/${token}` (a path segment), but the server only registers
`/account/reset` and reads `?token=` from the query string
(server.js:395-398). The emailed link 404s — **the reset flow is broken
out of the box**. The in-app flash notice (`/account/reset?token=...`)
works, but actual email recipients cannot reset their password.

**Fix:**
1. Check `resetExpires` in the POST handler.
2. Invalidate `resetToken` after use (it is set to `null`, good — but
   also invalidate any session created before the reset).
3. Change the email URL to
   `https://${settings.domain}/account/reset?token=${encodeURIComponent(token)}`
   (or add a matching `/account/reset/:token` GET route).

### 2.8 🟠 Order-lookup endpoint is trivially enumerable

`server.js:371-377`:

```js
/orders/([A-Za-z0-9\-]+)
...
const emailOk = !order || !order.email ||
  (query.email || '').toLowerCase() === order.email;
```

Order numbers are sequential (`VEN-1001`, `VEN-1002`, … — see
`createOrder` in `server.js`). The email check is case-insensitive but
there is no rate limit or constant-time comparison, so an attacker who
knows a customer's email can walk every order they've placed (and
because order numbering is predictable and starts at 1001, email
confirmation of any single order leaks the entire sequence).

**Fix:** Use non-sequential order identifiers in URLs (e.g. a random
`publicId`) or add an HMAC signature over the order id + email; rate
limit `/orders/*` and `/track`.

### 2.9 🟡 Missing security headers

The only security-related header emitted is
`Referrer-Policy: strict-origin-when-cross-origin` and
`X-Content-Type-Options: nosniff`, both only on HTML responses
(server.js:51-53). Missing:

- `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`) — the admin
  can be clickjacked.
- `Content-Security-Policy` — none at all, so the XSS in §2.6 runs
  inline.
- `Strict-Transport-Security` — no HSTS, no TLS redirect in-app.
- `Permissions-Policy` — nothing set.
- `X-XSS-Protection: 0` (to disable the deprecated redundant filter
  that can introduce issues).

### 2.10 🟡 Payment flow accepts any Luhn-valid card (including real PANs)

`lib/commerce.js:authorize` approves any card that passes Luhn + expiry
+ CVV + name, except the seven explicit test-card numbers. Entering a
real live card number will show a successful order ("paid",
`authCode`, `last4`, "live-sandbox" network). The order is recorded as
paid, the stock is decremented and a confirmation email is written —
even though there is no real processor. That's fine for a demo, but
nothing warns a production deployer:

- `settings.payments.testMode` exists but is never checked before
  authorizing.
- There is no webhook/capture step, no idempotency key, and
  double-submit of the checkout POST will create multiple orders
  (e.g. a user refreshing the POST response).

**Fix:** Gate `authorize` on `settings.payments.testMode === true`, and
require an idempotency key or short-lived checkout token for POST
`/checkout`.

### 2.11 🔵 Demo customer password seeded in plaintext

Seed data creates `hannah.b@example.com / password123`
(lib/seed.js:683, and README "Demo accounts"). Harmless for a seed, but
document it as "do not deploy without changing".

### 2.12 🔵 HTML-injection potential from brand/settings strings

Most templates use `ui.esc()` for user-generated content, but several
bits of `settings` (brand name, social URLs, announcement bar copy, tagline)
are interpolated without escaping on the assumption they come from the
admin. The admin settings form does not validate that e.g.
`settings.brandName` doesn't contain `</script><script>…`. Since admin
already has HTML-injection capability this is not a privilege
escalation, but a defense-in-depth fix would `esc()` settings values at
the view layer too.

---

## 3. Correctness / functional bugs

| Sev | Issue | Location |
|---|---|---|
| 🟠 | **Password-reset email link is broken (404).** Email uses `/account/reset/<token>` path; server only handles `/account/reset?token=`. Recovery links sent to customers dead-end. | `lib/emails.js:85` vs `server.js:395`. |
| 🟠 | **Password-reset tokens never expire.** `resetExpires` is written but never read. | `server.js:520-527`. |
| 🟠 | **Checkout double-submit creates duplicate paid orders.** No idempotency / no post-redirect-get PRG on POST `/checkout` — a refresh or back-button resubmits the form and charges/captures again. The stock re-check runs per request, so double-clicks can over-sell low stock. | `server.js:433` (returns 303, but a second POST before the redirect still runs to completion). |
| 🟠 | **`Set-Cookie` overwrites** (see §2.3) cause cart/session cookies to be dropped on responses that set both. Manifests as "cart empties after sign-up" intermittently. | `lib/auth.js:65`, `lib/cart.js:27`. |
| 🟡 | **Email shell hardcodes "support@vennixstore.com" and a Brooklyn address.** After running `npm run brand` these strings in `lib/commerce.js:emailShell` still read "44 Wythe Ave, Brooklyn NY 11249 · support@vennixstore.com", so a rebranded store's transactional footer still says Vennix. | `lib/commerce.js` line ~160. |
| 🟡 | **Search filter / sort / pagination parameters are not validated before being interpolated.** They appear to be coerced safely but the catalog page trusts `query.sort` to index into a list; if an attacker passes an unexpected value the sort falls back to default silently — not a bug but a missed 400. | `lib/pages/catalog.js`. |
| 🟡 | **`commerce.TAX_RATES[state] === undefined ? 0.06 : …`** defaults unknown states to **6% tax** rather than 0, mis-taxing exempt states and territories. If `shipProvince` is garbage (e.g. a client sent "XX"), tax is still charged. | `lib/commerce.js:98`. |
| 🔵 | **Server console prints passwords on boot.** The admin credentials string is printed every boot (`server.js:623`). Fine for demo, remove for production. | `server.js:623`. |
| 🔵 | **`PORT` default message prints `localhost:${PORT}` even when bound to `0.0.0.0`**. Minor cosmetic; also the banner always says "Card Payments (sandbox) (sandbox)" (the word "sandbox" is duplicated — `payments.provider` already ends with "(sandbox)"). | `server.js:621-623`, `lib/seed.js:596`. |

---

## 4. Code quality & architecture

**Positives**

- **Truly zero runtime dependencies** — Node built-ins only. The
  `package.json` has no `dependencies` block, `devDependencies` is used
  only for an opt-in `jsdom` for browser smoke tests. Supply-chain
  attack surface is minimal.
- **Good cryptographic hygiene where it matters**:
  `crypto.scryptSync` with per-user 16-byte salt and
  `crypto.timingSafeEqual` for password verify (`lib/auth.js`); random
  session IDs with `crypto.randomBytes(24)`; 30-day rolling sessions
  stored server-side.
- **Server-authoritative cart** (`lib/cart.js`): prices, discounts,
  shipping, tax and stock are all recomputed from the catalogue on
  every request; the client sends only variant id + quantity. This is
  the right shape for an e-commerce app and is why `npm run smoke`
  passes with no price-manipulation bugs found.
- **Money in cents** end to end, with a single `money()` formatter at
  the edge (`lib/commerce.js:40-42`). No float arithmetic in prices.
- **Personalization / monogramming logic** correctly prevents merging
  monogrammed and un-monogrammed lines (`lib/cart.js:48-51`, the
  `lineKey` comment is excellent).
- **Tests are real** — `scripts/smoke.js` boots the server over HTTP,
  hits 119 assertions across storefront, admin, POS, fulfilment,
  refunds, SEO, and checks the response bodies rather than just status
  codes. The theme check validates Liquid references offline.
- **HTML escaping** is centralized (`ui.esc`, `ui.attr`) and used
  consistently across the ~2200 lines of server-rendered HTML in
  `lib/pages/*` and `lib/admin/router.js` — I did not find any
  server-side XSS sink in the rendered HTML.

**Things to improve**

- **One ~9000-line file (`lib/admin/router.js`)** mixes routing, auth,
  order workflow, product CRUD, settings and POS. It would benefit from
  being split into `lib/admin/{orders,products,customers,...}.js`.
- **Callback-based static file serving** (`sendFile` in `server.js:67`)
  while everything else is async/await — mixing styles makes the error
  paths harder to reason about.
- **No logging library.** `console.log`/`console.error` go to stdout
  with no levels, timestamps, or request IDs; `logActivity` is only for
  the admin audit trail.
- **Atomic JSON store is coarse-grained.** Every `save()` writes the
  entire DB 120ms after the first mutation; concurrent requests (the
  server is single-threaded but awaits) can race: `insert` pushes to an
  array, then `save()` writes `db` — two inserts in the same tick will
  both make it in (sync), but an async span between read and write can
  drop updates. For a single-process demo this is fine; for production
  it needs a real DB or a lock.
- **No input schema validation.** Fields like
  `values.firstName/lastName/city` are not length-bounded consistently
  across checkout vs admin vs account. `String(body.message).slice(0, 4000)`
  is done ad-hoc.
- **No HTTP request size/rate guards beyond the 512KB body cap** in
  `parseBody` (server.js:82) — that's good for JSON but large form
  uploads (e.g. future product image uploads) would need more.
- **`auth.sign` is exported but never used.** Cookies carry raw session
  IDs looked up server-side; signing is dead code.
- **Client JS uses ES5-style `var` and string concatenation everywhere
  in `public/js/main.js`** (741 lines). It works, but there's no
  bundler, no minification, no source maps, and no cache-busting
  fingerprint on `/js/main.js`, `/css/main.css` — returning visitors
  will see stale assets after deploys.

---

## 5. Configuration & operability

- **No `.env.example` and no environment-variable config surface.** The
  only env vars read are `PORT` and `HOST`. Everything else (domain,
  brand, payment provider, free-shipping threshold, admin credentials)
  comes from `data/db.json` which is itself seeded. `npm run brand`
  overwrites the seed, which is awkward for 12-factor deploys.
- **No TLS, no trust proxy, no health endpoint.** Running behind a
  reverse proxy is assumed (the README says nothing about it) but the
  app does not honor `X-Forwarded-Proto` — absolute URLs in emails,
  sitemap, password-reset links all use `https://${settings.domain}`
  directly, which is correct, but there's no way to run HTTPS locally.
- **CI installs jsdom from npm at verify time**
  (`npm install --no-save jsdom`, `.github/workflows/verify.yml:22`).
  That makes the verify job non-reproducible (a future jsdom release
  could break it). Pinning to a version or committing a
  devDependency is safer.
- **No `engines` lockfile** — there's no `package-lock.json`, so
  installs are non-reproducible. (The README advertises "zero runtime
  dependencies" but `npm install` in CI still populates node_modules
  with transitive deps from jsdom.)
- **No Dockerfile, no systemd unit, no deploy script beyond the Shopify
  exporter.** `docs/SETUP.md` mentions CI but not production hosting.

---

## 6. Verification results (after extracting the zip)

```
npm run check        → all modules load cleanly           (pass)
npm run smoke        → 119 passed, 0 failed              (pass)
npm run features     → 41 passed, 0 failed               (pass)
npm run links        → 43 pages OK · 0 broken            (pass)
npm run theme:check  → 13 checks passed                  (pass)
npm run start        → boots, serves storefront + admin  (pass)
```

`npm run check:render`, `npm run browser:test` require jsdom and a
spare port; they were not run in this audit (browser-smoke needs jsdom
installed in `/tmp/jsdom` per the README).

---

## 7. Recommended priority order

**Do before any deployment (even a demo):**

1. Extract `vennix-storefront (1).zip` into the working tree and
   delete/ignore the zip so that `git clone && npm start` works.
2. Remove the hardcoded admin password; generate a one-time secret or
   read from `ADMIN_PASSWORD`. Delete the pre-filled password from the
   login HTML.
3. Add CSRF tokens (or at least an `Origin` check for same-origin and a
   custom header for JSON API calls).
4. Fix the `Set-Cookie` overwrite bug with `appendHeader`.
5. Fix the password-reset email URL **and** enforce `resetExpires`.
6. Add basic security headers: `X-Frame-Options`, `Content-Security-Policy`,
   `Strict-Transport-Security` (when deployed behind TLS), and
   `Permissions-Policy`.
7. Gate payment authorization on `settings.payments.testMode === true`
   and add an idempotency key to `/checkout`.

**Do soon:**

8. Add rate limiting to `/admin/login`, `/account/login`, `/track`,
   `/orders/:id`, `/api/newsletter`, `/api/contact`, `/api/notify`.
9. Make session/cart cookies `Secure` in production; make cart cookie
   `HttpOnly`.
10. Replace sequential public order numbers with random IDs or sign
    them.
11. Fix the hardcoded Vennix support address in
    `lib/commerce.js:emailShell` so `npm run brand` actually rebrands
    emails end-to-end.
12. Add CSRF tokens to admin POSTs.
13. Fix the DOM XSS in `public/js/main.js` search empty-state.
14. Add `.gitignore` entries for `data/db.*.corrupt-*.json`,
    `data/db.json.tmp`, `/dist`, `/coverage`.

**Nice-to-have:**

15. Split `lib/admin/router.js` into per-domain modules.
16. Add a `package-lock.json` and pin jsdom in devDependencies.
17. Add cache-busting fingerprints to static assets or at least
    `Cache-Control: immutable` with hashed filenames.
18. Add request logging (pino/morgan-style) and request IDs.
19. Fix the duplicated "(sandbox)" word in the boot banner.
20. Decide whether `seo/` belongs in the repo; if so document it, if not
    add it to `.gitignore`.

---

## 8. Files I extracted for this audit

Because the working tree was incomplete, I extracted
`vennix-storefront (1).zip` into `/tmp/vennix-extract/` and copied the
missing directories into the repo root to run the test suite:

```
.github/  data/  docs/  lib/  public/  scripts/  seo/  shopify-theme/
```

I did **not** commit those copies; they exist only in the snapshot so
you can inspect them. The cleanest path forward is to delete
`vennix-storefront (1).zip`, re-add the extracted directories in a
single commit, and update `.gitignore` so `data/db.json`,
`data/emails/`, `data/db.*.corrupt-*.json` and `dist/` stay out of Git.
