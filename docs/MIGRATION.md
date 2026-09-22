# VENNIX — Shopify Migration Plan

Date: 2026-09-22
Branch: `arena/01a0c683-vennix-storefront`
Goal: **Keep the storefront experience, keep the theme, keep the features — replace the
custom commerce backend with Shopify as the single source of truth.**

---

## 1. Current architecture map (before)

```
Browser
  │  HTML (server-rendered) + public/js/main.js + motion.js
  ▼
server.js ─────────────────────────────────────────────────────────────┐
  │ routes: /, /collections/*, /products/*, /search, /cart,            │
  │         /checkout (custom!), /orders/*, /track, /account/*,        │
  │         /pages/*, /blogs/journal/*, /gift-cards, /admin/*          │
  ▼                                                                    │
lib/pages/*      render views (home, catalog, product, cart,           │
                 checkout, account, content)                           │
lib/layout.js    shell: header/nav/cart drawer/search/quick view       │
lib/ui.js        escaping, icons, product card, price block            │
lib/api.js       JSON API: cart, search, quickview, notify, fit,       │
                 monogram, style, newsletter, contact, reviews         │
lib/cart.js      server-authoritative cart (in JSON db)                │
lib/commerce.js  pricing engine: discounts, shipping, tax,             │
                 MOCK payment gateway (Luhn test cards)                │
lib/personalize.js  monogram rules      ┐ reusable business/UX logic   │
lib/fit.js          size finder         │ (presentation-adjacent)      │
lib/style.js        shop-the-look       ┘                              │
lib/auth.js      scrypt sessions/passwords                             │
lib/emails.js    fake transactional email writer → data/emails/        │
lib/admin/router.js  FULL ADMIN BACK OFFICE + POS (1,369 lines)        │
lib/seed.js      demo catalog, FAKE orders, FAKE customers, reviews    │
lib/store.js     atomic JSON document DB  ◄── data/db.json             │
                                                                       │
shopify-theme/   complete OS 2.0 theme (32 sections, 19 templates)     │
scripts/export-shopify.js  catalog CSV export INTO Shopify             │
scripts/import-shopify-catalog.js  Shopify CSV → local db.json         │
```

Commerce-critical state (products, inventory, pricing, customers, carts,
checkout, orders, discounts, payments) all lives in `data/db.json` and is
maintained by custom code. That is the part being replaced.

## 2. Feature inventory (what exists and must not be lost)

### Storefront experience (`lib/pages/*`, `lib/layout.js`, `public/`)
| Feature | Where | Status |
|---|---|---|
| Editorial homepage: hero, marquee, category triptych, bestseller rail, spotlight PDP-in-home, store pulse, reviews, journal teasers, lookbook, newsletter band | `lib/pages/home.js` | KEEP |
| Men/Women/category collection browsing | `lib/pages/catalog.js` | KEEP |
| Faceted filtering (colour, size, type, tag, availability, price) + active chips + counts | `catalog.js` `filterSidebar` | KEEP |
| 7 sort modes + "load more" + numbered pagination (no-JS fallback) | `catalog.js` | KEEP |
| Product cards: hover image, swatches, badges (new/sale/low/sold out/bestseller), ratings, quick add, wishlist heart | `lib/ui.js` `productCard` | KEEP |
| PDP: gallery + zoom, variant picker (colour swatches / size), live price + compare-at + savings, stock pills, delivery estimate | `lib/pages/product.js` | KEEP |
| Sticky add-to-cart bar, "Buy it now" express | `product.js` + `main.js` | KEEP (checkout handoff changes) |
| Back-in-stock alert UI (sold-out sizes stay selectable) | `product.js` + `/api/notify` | KEEP |
| Size finder modal ("What's my size?") with reasoning + confidence | `lib/fit.js` | KEEP |
| Monogramming UI (toggle, live preview, live re-price, counter) | `product.js` + `lib/personalize.js` | KEEP (charging model aligned with Shopify — see §3) |
| Shop-the-look rail (complementary pieces, add-all, honest bundle code) | `lib/style.js` | KEEP (data source → Shopify recommendations) |
| Reviews UI (breakdown bars, helpful votes, honest zero-review state, JSON-LD only when real) | `product.js`, `home.js` | KEEP UI; data → Shopify metafields/app hook |
| Cart drawer: free-shipping progress bar, upsell rail, quantity steppers | `lib/layout.js` | KEEP |
| Cart page: gift note, order note, discount code form, save-for-later | `lib/pages/cart.js` | KEEP |
| Checkout (custom address/payment forms, sandbox cards) | `lib/pages/checkout.js` | **REPLACE with Shopify checkout redirect** |
| Order confirmation/status/tracking pages | `checkout.js` | **REPLACE with Shopify-hosted order status** |
| Account (login/register/recover/reset/addresses/orders/details) | `lib/pages/account.js`, server.js | **REPLACE with Shopify customer accounts** |
| Wishlist (localStorage + panel + /account/wishlist) | `main.js` | KEEP (client-side, no backend) |
| Search overlay (predictive) + results page (products/collections/journal/pages) + remembered searches | `main.js`, `catalog.js`, `/api/search` | KEEP (data → Shopify search) |
| Quick view modal | `/api/quickview` + `main.js` | KEEP |
| Recently viewed | `main.js` (localStorage) | KEEP |
| CMS pages: about, sustainability, FAQ (+FAQPage JSON-LD), size guide (+charts), shipping/returns, privacy, terms, accessibility, contact | `lib/pages/content.js` | KEEP design; text source → Shopify pages where present |
| Journal (blog) listing + articles | `content.js` | KEEP (data → Shopify blog) |
| Gift cards page | `content.js` | KEEP (uses Shopify gift-card product when present) |
| 404 with product picks | `content.js` | KEEP |
| Motion system: scroll reveals, parallax, counters, fly-to-cart, ticker, smooth accordions | `public/js/motion.js` + CSS | KEEP |
| `prefers-reduced-motion` support everywhere | CSS + motion.js | KEEP |
| SEO: meta title/description, canonical, OG/Twitter, JSON-LD (Organization, WebSite, ItemList, Product, CollectionPage, BreadcrumbList, BlogPosting, FAQPage), sitemap.xml, robots.txt | layout + pages + server | KEEP (data from Shopify) |
| Accessibility: skip link, aria labels/pressed/expanded on all controls, focus states, semantic landmarks, keyboard drawers/menus | layout + CSS | KEEP |
| Responsive mobile: burger menu, filter panel, drawers, rails | CSS + main.js | KEEP |
| Security hardening: CSRF origin check, rate limiting, security headers, HttpOnly/Secure cookies | server.js | KEEP |

### Shopify theme (`shopify-theme/`)
Complete Online Store 2.0 theme: hero, trust bar, category grid, showcase,
brand story, testimonials, journal, lookbook, newsletter, FAQ, contact,
full product/collection/cart/search/customer templates, native faceted
filtering, predictive search, cart drawer, metafield hooks, structured data,
locales, settings schema. **KEPT UNCHANGED** — it is already 100% Shopify-native.

### Custom backend (being retired from the production path)
Admin back office + POS, mock payment gateway, tax/shipping engine, discount
engine, JSON database, seeding, fake orders/customers/reviews, transactional
email writer, Shopify CSV exporter/importer, rebrand scripts.

## 3. Shopify migration map (after)

| Concern | Before (custom) | After (Shopify) |
|---|---|---|
| Products / variants / options | `db.products` in db.json | **Storefront API** `product(handle:)`, `products(first:)` |
| Collections | `db.collections` | **Storefront API** `collection(handle:)`, `collections(first:)` |
| Inventory / availability | `variant.stock` in db.json | **Storefront API** `quantityAvailable`, `availableForSale` |
| Pricing / compare-at | db.json, custom money math | Storefront API `price`, `compareAtPrice` (MoneyV2) |
| Search | substring match over db.json | **Storefront API** `search(query:, types: PRODUCT)` |
| Recommendations / upsells | rules over db.json | **Storefront API** `productRecommendations(productId)` (+ rule fallback) |
| Cart | server-side JSON cart | **Storefront API cart**: `cartCreate`, `cartLinesAdd/Update/Remove`, `cartDiscountCodesUpdate`, `cartNoteUpdate` — cart id in HttpOnly cookie |
| Discount codes | custom engine | Shopify validates codes in `cartDiscountCodesUpdate` |
| Checkout | custom forms + mock gateway | **Shopify checkout**: `cart.checkoutUrl` redirect |
| Orders / tracking / confirmation | custom order records | **Shopify** (confirmation emails, order status page, tracking) |
| Payments | fake Luhn sandbox | **Shopify Payments** (and the store's configured gateways) |
| Customers / accounts | local scrypt accounts | **Shopify customer accounts** (storefront links to hosted `/account`) |
| Shipping rates / taxes | hardcoded tables | **Shopify** settings (rates, tax regions) — storefront shows "calculated at checkout" |
| Gift cards | fake `var_gift_*` variants | Shopify gift-card product when present in the catalog |
| CMS pages / blog | db.json pages/posts | **Storefront API** `pages`, `blog(handle:"journal").articles` |
| Reviews | seeded fake reviews | UI kept; data via product metafield hook (`custom.reviews`) / reviews app; honest zero state otherwise |
| Newsletter / contact / back-in-stock | db.json (commerce db) | Small **local leads store** (`data/leads.json`) — marketing/support captures, explicitly non-commerce; swappable for an app |
| Brand display settings (name, threshold, socials, badges) | db.json settings | `config/storefront.json` (presentation config, versioned) |
| Admin back office | `/admin` | **Shopify admin** (custom admin isolated to `legacy/`) |

### What stays local (and why it is not a "second database")
- `data/leads.json`: newsletter signups, contact messages, back-in-stock alert
  captures, pending review submissions. None of it is products/prices/stock/
  orders — it cannot contradict Shopify. Documented swap points for
  Klaviyo/Judge.me/etc. are in `README.md`.
- `config/storefront.json`: brand presentation (word mark, announcement bar,
  trust badges, free-shipping display threshold, colour swatch hexes). No
  commerce state.

### Monogramming on Shopify (honest charging, mirrors the theme)
1. If the product has a variant whose options/title include **"Monogrammed"**
   (merchant-created, fee baked into the variant price), the storefront adds
   that variant — the customer is charged exactly what the button quoted.
2. Otherwise the monogram is added as a **line-item attribute**
   (`Monogram: ABC`) — carried into the Shopify cart, order and packing slip —
   and the UI drops the fee claim ("recorded with your order"), exactly like
   the theme's documented behaviour.

## 4. KEEP / REPLACE / REMOVE classification

### KEEP (unchanged or lightly adapted)
- `public/css/main.css`, `public/js/main.js`, `public/js/motion.js`, all `public/images/`, `public/favicon.svg`
- `lib/layout.js`, `lib/ui.js` (presentation; settings source swapped)
- `lib/pages/home.js`, `lib/pages/catalog.js`, `lib/pages/product.js`,
  `lib/pages/cart.js`, `lib/pages/content.js`, `lib/pages/account.js`
  (design preserved; data source swapped to Shopify)
- `lib/fit.js`, `lib/personalize.js`, `lib/style.js` (store-dependency removed)
- `shopify-theme/**` (entire theme, unchanged)
- `scripts/theme-check.js`, `scripts/link-check.js` (theme/link validation)
- SEO/a11y/performance: meta, canonical, JSON-LD, lazy loading, image
  dimensions, reduced motion, skip links, aria wiring
- Security: CSRF origin check, rate limits, security headers, HttpOnly cookies

### REPLACE (same UX, Shopify behind it)
- `lib/cart.js` → orchestration over Shopify cart mutations
- `lib/api.js` → endpoints proxy to Shopify (cart/search/quickview/buy-now),
  keep lead-capture endpoints
- `server.js` → routing minus admin/custom-checkout/custom-accounts;
  `/checkout` becomes the Shopify checkout handoff
- `lib/pages/checkout.js` → checkout handoff + Shopify-pointing order info
- `/account/*` → Shopify customer accounts (wishlist stays local)
- `lib/store.js` → slim local **leads** store (`lib/leads.js`)
- Tests → rewritten around a Storefront-API-compatible **demo gateway**
  (`tools/mock-shopify/`) so the exact same code path is exercised in CI/dev

### REMOVE from production path (isolated to `legacy/`, not deleted yet)
- `lib/admin/router.js`, `public/js/admin.js`, `public/css/admin.css` (POS/back office)
- `lib/seed.js` (fake catalog/orders/customers/reviews seeder)
- `lib/emails.js` (fake transactional mail)
- `lib/commerce.js` payment/tax/shipping/discount engine (money formatter kept as `lib/money.js`)
- `scripts/export-shopify.js`, `scripts/import-shopify-catalog.js`,
  `scripts/format-catalog.js`, `scripts/format-theme.js` (one-way migration
  tooling — the real Shopify store must never be overwritten from this repo)
- `AUDIT.md` stays as history; `seo/` meta-description tooling stays as-is

### NEW
- `lib/shopify/{config,client,operations,normalize,catalog,cart-api}.js` — Shopify data access
- `lib/settings.js`, `lib/money.js`, `lib/leads.js`
- `tools/mock-shopify/gateway.js` — Storefront-API-compatible demo store
  (serves the committed fixture catalog; used for local dev + CI)
- `data/fixtures/shopify-store.json` — demo catalog in Storefront API shape
  (generated once from the old seed definitions; dev fixture only)
- `scripts/build-fixtures.js`, `scripts/test-shopify.js`
- `.env.example`, rewritten `README.md`, rewritten `docs/SETUP.md`

## 5. Files that change

| File | Change |
|---|---|
| `server.js` | rewrite: Shopify-backed routing; admin/custom-order/custom-account routes removed; checkout = redirect to Shopify |
| `lib/api.js` | rewrite: cart/search/quickview/buy-now via Shopify; leads endpoints kept |
| `lib/cart.js` | rewrite: Shopify cart orchestration + cookie |
| `lib/layout.js` | async catalog data; settings source; remove admin link |
| `lib/ui.js` | settings source swap; no db access |
| `lib/pages/home.js` | data via `lib/shopify/catalog` |
| `lib/pages/catalog.js` | data via catalog facade; filtering preserved server-side |
| `lib/pages/product.js` | data via catalog facade; recommendations from Shopify; metafield reviews |
| `lib/pages/cart.js` | Shopify totals; "calculated at checkout" rows |
| `lib/pages/checkout.js` | becomes checkout handoff + thank-you redirect page |
| `lib/pages/account.js` | Shopify account hub + wishlist (local) |
| `lib/pages/content.js` | pages/articles from Shopify with design fallbacks |
| `lib/personalize.js`, `lib/fit.js`, `lib/style.js` | store dependency removed |
| `package.json` | scripts updated (`dev`, `test`, `verify`), engines |
| `.github/workflows/verify.yml` | new pipeline (demo gateway, no export job) |
| `README.md`, `docs/SETUP.md`, `.env.example` | rewritten |
| `scripts/smoke.js`, `scripts/features.js`, `scripts/render-check.js`, `scripts/browser-smoke.js`, `scripts/link-check.js` | rewritten for the new architecture |
| moved to `legacy/` | `lib/admin/`, `lib/seed.js`, `lib/emails.js`, `lib/commerce.js`, `lib/store.js`, `lib/auth.js`, `scripts/export-shopify.js`, `scripts/import-shopify-catalog.js`, `scripts/format-*.js`, `public/js/admin.js`, `public/css/admin.css` |

## 6. Potential breaking changes

1. **`/admin` disappears from the running app.** Anyone using the custom back
   office must use Shopify admin. (Code preserved under `legacy/`.)
2. **Custom checkout forms gone.** `/checkout` redirects to Shopify. Any
   bookmarked order-confirmation URLs (`/orders/VEN-…`) become a helpful
   "orders live with Shopify" page instead of 404.
3. **Local customer accounts are retired.** `/account` points at the Shopify
   store's hosted account pages. Demo logins (`hannah.b@example.com` etc.) no
   longer exist. Wishlist remains (client-side).
4. **Demo data is clearly labelled.** Without `SHOPIFY_STORE_DOMAIN` the app
   boots against the built-in demo catalog and prints a loud notice; no fake
   path can be mistaken for production.
5. **Money is still cents internally** but now originates from Shopify MoneyV2;
   currency display follows the store's currency (assumption: USD storefront
   copy like "$50 free shipping" is a display setting).
6. **Collection filtering/sorting** is applied server-side over the fetched
   collection (first 250 products); very large catalogs would need Shopify
   native `filters` — documented in README.
7. **`npm run export/import/brand` scripts are gone** from npm scripts —
   the real store is never overwritten from this repo.
8. Env contract changes: `ADMIN_EMAIL`/`ADMIN_PASSWORD` no longer read;
   Shopify credentials are the new contract (`.env.example`).

## 7. Target architecture

```
Browser
  │  same HTML/CSS/JS experience (preserved)
  ▼
server.js (Node 18+, zero runtime deps)
  ├─ presentation:  lib/pages/* · lib/layout.js · lib/ui.js · public/
  ├─ storefront logic (kept): lib/fit.js · lib/personalize.js · lib/style.js
  ├─ Shopify data access: lib/shopify/
  │     config.js    env → { mode: live | demo, endpoint, token, version }
  │     client.js    GraphQL over fetch: timeouts, retry, userErrors
  │     operations.js  pinned query/mutation documents (API 2025-10)
  │     normalize.js   Shopify JSON → internal storefront shapes
  │     catalog.js     cached reads: products, collections, pages, blog,
  │                    search, recommendations
  │     cart-api.js    cartCreate/Add/Update/Remove/Discount/Note/checkoutUrl
  ├─ local (non-commerce): lib/leads.js (newsletter/contact/restock/review
  │     captures → data/leads.json), config/storefront.json (brand display)
  └─ demo mode only: tools/mock-shopify/gateway.js
        Storefront-API-compatible HTTP GraphQL endpoint serving
        data/fixtures/shopify-store.json — same client code path,
        used for local preview + CI. Never used when SHOPIFY_STORE_DOMAIN set.

shopify-theme/   unchanged OS 2.0 theme (the Shopify-hosted storefront option)
Shopify          products · variants · inventory · pricing · carts · checkout ·
                 orders · payments · taxes · shipping · discounts · customers
```

**Single source of truth:** Shopify. The Node app caches catalog reads for
seconds (TTL) purely for latency; it never writes commerce data, and it never
serves a price/stock figure that did not come from the Storefront API
response it is rendering.
