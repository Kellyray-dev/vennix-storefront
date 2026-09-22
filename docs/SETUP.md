# Setup — running the Vennix storefront with Shopify

The storefront is a zero-dependency Node app that renders the editorial
experience and reads/writes commerce through the **Shopify Storefront API**.
There are three ways to run it:

1. **Demo mode** — no Shopify store needed (mock gateway + fixture catalog)
2. **Against your store** — read-only catalog + Shopify carts/checkout
3. **Theme-only** — deploy `shopify-theme/` to Shopify Online Store 2.0

---

## 1. Demo mode (default, no credentials)

```bash
node server.js
# [vennix] DEMO MODE — no SHOPIFY_STORE_DOMAIN configured.
# [vennix] Mock Shopify gateway on ephemeral port; using fixture catalog.
```

What happens:

- `tools/mock-shopify/gateway.js` boots on an ephemeral port and serves
  `data/fixtures/shopify-store.json` through the exact GraphQL operations the
  storefront uses (products, collections, search, recommendations, cart
  mutations, checkout URLs).
- The storefront talks to it with the same `lib/shopify/client.js` code path
  as production — demo mode swaps the endpoint, not the code.
- The UI shows a *Demo mode* banner. Carts, discounts (`WELCOME10`,
  `FREESHIP`, `CAPSULE20`), oversell rules and the monogram service product
  all behave like a real store.

Regenerate the fixture after changing `scripts/build-fixtures.js`:

```bash
npm run fixtures
```

> The fixture is a **development visual fixture**, not production data. It is
> never written to a real Shopify store, and real-store data is never
> overwritten by this repo.

---

## 2. Connecting your Shopify store

### a. Create a Storefront API token

In the Shopify admin of your store:

1. **Settings → Apps and sales channels → Develop apps** (enable custom app
   development if prompted).
2. Create an app (e.g. *vennix-storefront*).
3. Under **Configuration → Storefront API access scopes**, grant:
   - `unauthenticated_read_product_listings`
   - `unauthenticated_read_product_inventory`
   - `unauthenticated_write_checkouts`
4. Install the app and copy the **Storefront API access token**.

Nothing else is required: the storefront reads the published catalog and
operates carts; checkout, payments, shipping, taxes, orders and customers are
all Shopify-hosted.

### b. Configure the environment

```bash
export SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
export SHOPIFY_STOREFRONT_ACCESS_TOKEN=…
# optional
export SHOPIFY_PRIMARY_DOMAIN=www.yourbrand.com   # canonical domain
export SHOPIFY_API_VERSION=2025-10
node server.js
# [vennix] Live mode — reading catalog and carts from your-store.myshopify.com (2025-10).
```

Or copy `.env.example` to `.env` and load it with your process manager. See
`.env.example` for the full reference. **Never commit tokens** — `.env` is
git-ignored.

### c. What the storefront uses from your store, as-is

- Published products + variants (the hidden `vennix-service`-tagged
  monogram product is treated as the monogram fee; it is filtered from the
  catalog but can be added as a paired cart line).
- Collections (nav + collection pages are generated from them; a virtual
  `sale` collection is computed from compare-at pricing).
- Pages (`/pages/:handle`) and the blog `journal` (`/blogs/journal`).
- Product `reviews` metafield (from any reviews app) — rendered as-is;
  `aggregateRating` is emitted only when reviews exist.
- Discount codes are validated by Shopify carts — the storefront never keeps
  its own list.

> The storefront **does not write to your catalog**. It never creates or
> mutates products, prices, inventory or content.

### d. Monogramming (optional)

If you sell a monogram/embroidery add-on, create a published product
(handle `monogramming`, tag `vennix-service`, price = the fee). The storefront
detects it and charges monograms as a real second cart line. Without it, the
monogram UI degrades to a free-note mode and stops quoting a fee.

### e. Checkout handoff

- `GET/POST /checkout` → 302/303 to `cart.checkoutUrl` (Shopify-hosted).
- `/api/buy-now` returns the checkout URL for the client.
- Order confirmation, tracking and account pages point customers to Shopify
  (confirmation email / `/account` on the store). `/track` explains this;
  legacy `/orders/:number` URLs get a helpful pointer page.

---

## 3. Deploying the OS 2.0 theme

`shopify-theme/` is a complete Online Store 2.0 theme. Deploy it with the
Shopify CLI:

```bash
cd shopify-theme
shopify theme dev --store your-store.myshopify.com     # preview
shopify theme push --store your-store.myshopify.com    # upload
```

…or use the included workflow: **Actions → Deploy Shopify theme** (needs the
`SHOPIFY_STORE`, `SHOPIFY_CLI_THEME_TOKEN`, optional `SHOPIFY_THEME_ID`
secrets). The theme is self-contained and works without the Node storefront.

**Ownership rule:** the Node storefront and the theme are two front doors to
the same Shopify data. Don't let both render the same domain — either serve
the storefront on your domain and keep the theme unpublished (or on a
password-protected theme for reference), or publish the theme and retire the
Node server.

---

## Production hosting notes

- Bind `HOST=0.0.0.0`, put TLS termination in front, set `NODE_ENV=production`
  (cart cookies become `Secure`) and `TRUST_PROXY=1` behind a reverse proxy.
- `PUBLIC_SITE_DOMAIN` should match the public hostname for canonical URLs;
  the sitemap is generated live from the Shopify catalog.
- The catalog cache (`SHOPIFY_CACHE_TTL_MS`, default 15s) keeps page fan-out
  cheap; carts are always read fresh.
- Local state is limited to non-commerce leads in `data/leads.json`
  (newsletter, contact messages, back-in-stock alerts, review submissions for
  moderation). Mount that path on persistent storage if you need the captures
  to survive deploys, or wire `lib/leads.js` to your own sink.

---

## Verification

```bash
npm install --no-save jsdom     # dev-only, for the browser click test
npm run verify
```

Runs module load check, the Shopify data-layer suite (mock gateway), render
check (self-boots a server), theme structure check, then boots the demo
storefront and runs the HTTP smoke, feature, link-crawl and browser suites.
CI runs the same pipeline on every push (`.github/workflows/verify.yml`).
