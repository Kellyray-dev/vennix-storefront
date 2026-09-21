# Vennix — full-stack storefront, back office and Shopify theme

The Vennix store, built from the studs up: server-rendered storefront with a
real motion layer, JSON API, admin back office with a point-of-sale till,
transactional email, and a complete **Shopify Online Store 2.0 theme + catalogue
export** so the same brand can go live on Shopify without redesigning anything.

Built for **Vennix** — modern clothing and active essentials — and carrying the
store's real published details: `support@vennixstore.com`, Mon–Fri 9–5 EST
replies, free shipping over $50, and Pinterest, LinkedIn and TikTok at
`@vennixstore`. No phone number is published anywhere, by choice: the theme, the
storefront, the transactional emails and the structured data all read their
brand, support and threshold values from settings, so none of them can drift.

Zero runtime dependencies. Node 18+ and nothing else.

```bash
npm start          # storefront on http://localhost:3000, admin at /admin
npm run reset      # rebuild the demo catalogue, orders, content and customers
npm run verify     # full sweep: module load, render, theme, smoke, links, browser
npm run export     # build dist/shopify/ — catalogue CSVs + uploadable theme.zip
```

Going live on Shopify and pushing this repo to GitHub? **[`docs/SETUP.md`](docs/SETUP.md)**
walks both tracks end to end, including the CI secrets.

## What ships in the box

| Area | Where | Notes |
| --- | --- | --- |
| Storefront | `lib/pages/`, `lib/layout.js`, `public/` | Home, collections, faceted search, PDP, cart, checkout, order status, tracking, account, CMS pages, journal, gift cards, 404 |
| Personalisation | `lib/personalize.js` | Paid monogramming sold as a line-item add-on: server-validated, re-priced on every cart pass, never silently truncated, and carried through to the order, packing slip and email |
| Size finder | `lib/fit.js` | "What's my size?" — three questions, a body-measurement band, adjustments for the cut and for how you like a garment to sit, always shown with its reasoning and a confidence level |
| Styling | `lib/style.js` | Shop-the-look rails that pick genuine complements, only ever in stock, addable in one request, quoting only discount codes the basket really qualifies for |
| Motion layer | `public/js/motion.js`, `public/css/main.css` | Scroll reveals, hero parallax, animated stat counters, fly-to-cart, pointer depth on cards, live activity ticker, scroll progress bar, smooth accordions — all progressive and disabled under `prefers-reduced-motion` |
| JSON API | `lib/api.js` | Cart CRUD, search, quick view, quote/shipping/tax, newsletter, contact, reviews, reorder, wishlist |
| Admin back office | `lib/admin/router.js` | Dashboard, orders, products, collections, customers, discounts, reviews, pages, messages, subscribers, POS, settings, email outbox |
| Commerce engine | `lib/commerce.js`, `lib/cart.js` | Cents-based pricing, discounts, shipping rules, tax, mock payment authorisation/capture/refund, stock ledger |
| Data layer | `lib/store.js` | Atomic JSON document store, activity log, email writer, seeding |
| Shop theme | `shopify-theme/` | OS 2.0 theme: 32 sections, 12 snippets, 19 JSON templates, locale file, `theme.css` + `theme.js`, mirrored motion layer |
| Deployment tooling | `scripts/export-shopify.js`, `scripts/import-shopify-catalog.js` | Catalogue export (CSV + menu JSON + theme.zip) and a catalogue importer that rebuilds `db.json` from Shopify CSV or the Admin API |
| Rebranding | `scripts/format-catalog.js`, `scripts/format-theme.js` | Rebrand the whole store — brand name, domain, support email, address, socials, SEO, order copy, the **admin login** and the **order-number prefix** — from one command, plus the matching theme settings |
| Tests | `scripts/`, see Verification | 119 HTTP assertions, 41 storefront-feature assertions, 27 server-rendered pages, 43 crawled links, 91 real-DOM click assertions, and an offline Liquid/JSON/i18n validator |

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@vennixstore.com` | `vennix123` |
| Customer | `hannah.b@example.com` | `password123` |

Checkout runs in sandbox payment mode — use `4242 4242 4242 4242`, any future
expiry and any CVC to approve; `4000 0000 0000 0002` declines.

## Storefront highlights

- Editorial homepage: hero, trust bar, store pulse, category grid, product
  showcase, brand story, testimonials, journal, lookbook, newsletter.
- Collection pages with real faceted filtering (category, colour, size, type,
  availability, price), 7 sort modes, active-filter chips, pagination.
- Product pages with variant switching that live-updates price, compare-at,
  savings, stock messaging, gallery image, add-to-cart button and the sticky
  purchase bar.
- Cart drawer + full cart page with free-shipping progress, gift notes, order
  notes, discount codes, quantity steppers, upsell rail.
- Checkout with live shipping/tax quote per state and country, express payment
  shortcuts, address book reuse, sandbox card form with brand detection, and an
  order confirmation page with timeline, tracking and printable receipt.
- Accounts: register, sign in, password recovery and reset, address book, order
  history, order detail, reorder one click, wishlist (localStorage + server sync).
- Support: contact form routed to the admin inbox, FAQ, size guide, shipping and
  returns policies, journal posts, gift cards.

### Added after benchmarking a modern retail storefront

Features taken from what a good apparel site actually does well — not every bell
and whistle, just the ones that earn their place:

- **Monogramming.** An optional paid add-on on three pieces (hoodie, tee, fleece
  jogger). Letters are sanitised server-side, the character limit is enforced
  rather than quietly truncating, the add-to-cart button re-prices live, and the
  monogram follows the line through the cart, checkout, order record and email.
  A monogrammed line never merges into a blank one.
- **"What's my size?"** A three-question size finder that answers with a size,
  the reasoning behind it and an honest confidence level — and never suggests a
  size the product does not make or hide that it is an estimate.
- **Shop the look.** A styling rail that pairs real complements (never three more
  hoodies), shows what each piece costs, adds the whole look in a single request,
  and only ever quotes a bundle saving that comes from a real discount code.
- **Load more.** Collections append the next page in place while the numbered
  pagination stays in the markup for crawlers and no-JavaScript visitors.
- **Remembered searches.** Recent searches are kept locally and offered back next
  time, with a one-tap clear.
- **Back-in-stock alerts.** Sold-out sizes stay selectable rather than dead ends,
  and selecting one opens a real email capture that lands in the admin under
  *Support inbox → Back-in-stock requests*. Duplicates are ignored, alerts are
  refused for sizes you can simply buy, and the promise is kept — nothing invites
  you to "join the waitlist" without a waitlist to join.

### Reviews are deliberately uneven

Eleven published reviews across nine products, and **four products carry no
reviews at all** — the new arrivals and the gift card. Products without reviews
say so honestly instead of showing a fabricated average, and the homepage
"store pulse" band counts only what is really in the database. The theme carries
the same policy: `sections/store-pulse.liquid` renders configurable counters,
`main-product.liquid` has a real zero-review state, and every default that used
to imply a review total has been removed. If you want a perfect-looking store,
faking ratings is the fastest way to look fake.

## Admin highlights

- KPI dashboard (revenue, orders, AOV, conversion, low stock, unfulfilled).
- Order workflow: view, fulfil with carrier + tracking, unfulfil, refund (partial or
  full, optionally restocking), cancel with inventory restoration, notes, packing slips.
- Catalogue: create/edit/duplicate/delete products with variants, pricing, stock,
  collections, badges, SEO fields; collection editor; discount editor with toggles.
- Customers, reviews moderation with merchant replies, CMS pages, FAQ, messages inbox
  with reply + resolve, subscriber list, and a searchable transactional email outbox.
- POS till: search the catalogue, build a basket, apply tax, take payment and drop the
  sale into the same order pipeline as the web store.

## Shopify deployment

```bash
npm run export          # → dist/shopify/catalog/*.csv + dist/shopify/theme.zip
```

Then in Shopify: **Products → Import** the products CSV, **Content → Import** pages
and articles, **Customers → Import** the customer list, recreate the discount codes,
paste the navigation from `catalog/menu.json`, and upload `theme.zip` under
**Online Store → Themes**. `shopify-theme/README.md` covers the theme itself, and
`node scripts/theme-check.js` validates every template, section, snippet, schema,
asset reference and translation key offline before you push.

Bringing data back the other way is a single command — it reads a Shopify product
export or talks to the Admin API, and rebuilds the local catalogue from it:

```bash
node scripts/import-shopify-catalog.js --csv ~/Downloads/products_export.csv --dry-run
node scripts/import-shopify-catalog.js --csv ~/Downloads/products_export.csv --replace
```

### Making it your brand

```bash
cp brand.example.json brand.json           # fill in your name, domain, address, socials
npm run brand -- --file brand.json         # rebrand catalogue, orders, CMS, emails, SEO
npm run brand:theme -- --file brand.json   # same brand → theme settings + theme.toml
npm run export                             # rebuild the bundle from your brand
```

Both scripts support `--dry-run` and print every field they touch. Socials are
merged rather than replaced — pass only the networks you run, so a brand with no
Instagram never ships a dead Instagram link — `--no-phone` clears the phone
entirely for email-only brands, and the admin login and order-number prefix are
derived from the new brand automatically. Product handles are intentionally left
alone so existing links keep working.

## GitHub and CI

The repo is ready to push: `.github/workflows/verify.yml` runs the whole
verification matrix on every push and pull request, and
`.github/workflows/theme-deploy.yml` ships the theme to a real store with the
Shopify CLI on demand. Setup, required secrets (`SHOPIFY_STORE`,
`SHOPIFY_CLI_THEME_TOKEN`) and a local-first workflow are in
[`docs/SETUP.md`](docs/SETUP.md).

## Verification

```bash
npm run verify        # everything below, in order
npm run check         # every module loads, syntax clean
npm run check:render  # boots a spare server, renders 27 pages, fails on stack traces
npm run theme:check   # Liquid/JSON structure + i18n coverage
npm run smoke         # 119 assertions across every route and flow
npm run features      # 41 assertions on monogramming, sizing, styling, alerts, load more
npm run links         # crawls the storefront, fails on any broken link
npm run browser:test  # real DOM: loads pages and clicks the interactive bits
```

`check:render` starts its own server on port 3099; `smoke`, `links` and
`browser:test` expect the app already running on port 3000. `browser:test` needs
jsdom, which is intentionally kept out of the runtime dependencies:
`mkdir -p /tmp/jsdom && cd /tmp/jsdom && npm install jsdom`.

## Architecture notes

- **Money** is stored and computed in cents end to end; formatting happens at the edge.
- **The cart is server-authoritative**: every mutation goes through `lib/cart.js`, is
  persisted per session, and is re-priced on read, so discounts, stock and tax can
  never drift out of sync with the client.
- **Templates return data, not strings**: each page module exports render functions
  that hand back title, meta, JSON-LD and body content, which keeps SEO and layout in
  one place.
- **The theme mirrors the app**: same sections, same copy, same interaction model, so
  the Shopify deployment is a genuine port rather than a second design.
- **Nothing about your brand is hardcoded twice**: `settings.brandName`,
  `settings.supportEmail`, `settings.supportPhone`, `settings.socials` and
  `settings.freeShippingThreshold` drive the word mark, the footer, the contact
  page, the announcement bar, the cart's free-shipping progress and the theme's
  own settings — change the value once and every surface follows.
- **Charges are only claimed when they are charged**: the app prices the monogram
  itself because it owns the money; the Shopify theme switches to a real
  "Monogrammed" variant when one exists and otherwise records the monogram as a
  free note, rather than advertising a fee it cannot collect.
- **Motion degrades**: every animation is additive. Scripts that fail to load, or a
  visitor with reduced-motion enabled, get the fully usable static page.
