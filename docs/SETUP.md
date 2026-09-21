# From this repo to your live Shopify store

Two tracks, and you can do them in either order. Track A gets your catalogue,
copy and theme onto **your** Shopify store. Track B puts this repo on GitHub with
CI and one-click theme deploys.

Everything below assumes you are in the project root.

---

## Track A — your store on Shopify (about 30 minutes)

### 1. Check the deployment bundle

```bash
npm run export
ls dist/shopify
#  catalog/products.csv  collections.csv  pages.csv  articles.csv
#  customers.csv  discounts.csv  menu.json  catalog.json
#  theme.zip
```

`theme.zip` is the finished Online Store 2.0 theme. The CSVs are Shopify's own
import formats, so nothing needs transforming on their side.

### 2. Import the catalogue

In Shopify admin → **Products → Import** → `dist/shopify/catalog/products.csv`.
Shopify creates every product, variant, image reference, tag, SEO field and
collection membership from that file. Wait for the import to report completion
before moving on (9 products / 159 variants takes a few seconds).

Then:

| What | Where | File |
| --- | --- | --- |
| Collections | **Products → Collections → Import** | `collections.csv` |
| Pages | **Online Store → Pages → Import** | `pages.csv` |
| Blog posts | **Online Store → Blog posts → Import** | `articles.csv` |
| Customers | **Customers → Import** | `customers.csv` |
| Discount codes | **Discounts → Create** (one per row) | `discounts.csv` |
| Navigation | **Online Store → Navigation** | paste from `menu.json` |

Customers import without passwords (Shopify never accepts them) — send them an
account invite from the customer list when you are ready.

### 3. Upload the theme

**Online Store → Themes → Add theme → Upload zip file** → pick
`dist/shopify/theme.zip` → **Publish**.

Check **Online Store → Navigation → Main menu** points at your real collections,
then open the theme editor: every section (hero, trust bar, store pulse, category
grid, showcase, story, testimonials, journal, lookbook, newsletter, FAQ, contact)
is editable and reorderable without touching code.

### 4. Wire the theme to real data

| Feature | What to switch on |
| --- | --- |
| Payments | Settings → Payments (Shopify Payments, PayPal, etc.) |
| Shipping rates | Settings → Shipping and delivery |
| Taxes | Settings → Taxes and duties |
| Reviews | Install a reviews app (Judge.me, Loox, Okendo). The theme renders metafield ratings from any of them and shows an honest "no reviews yet" state until real ones arrive. |
| Search, wishlist, cart | Already native — no app needed |
| Metafield rows | Product → Metafields → `custom.fit_notes` powers the "Fit notes" accordion |

---

## Track B — GitHub, CI and one-click theme deploys (about 15 minutes)

### 1. Push the repo

```bash
git init
git add .
git commit -m "Vennix storefront, admin and Shopify theme"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

`data/db.json`, `data/emails/` and `dist/` are gitignored on purpose: runtime
data and build output should never fight with your history. Regenerate them with
`npm run seed` and `npm run export`.

### 2. Watch CI pass

`.github/workflows/verify.yml` runs on every push: module load check, theme
structure check, seed, boot the server, the HTTP end-to-end suite, the dead-link
crawl, the browser click test, and the Shopify export — then uploads
`dist/shopify/` as a downloadable artifact.

### 3. Connect the theme to your store

Create a **Theme Access** token (Shopify admin → **Apps → Develop apps → Create
app → Admin API access** with `write_themes`, or `shopify theme token` from the
CLI). Then add three repository secrets under **Settings → Secrets and
variables → Actions**:

| Secret | Value |
| --- | --- |
| `SHOPIFY_STORE` | `your-store.myshopify.com` |
| `SHOPIFY_CLI_THEME_TOKEN` | the Theme Access token |
| `SHOPIFY_THEME_ID` | *(optional)* the theme id to publish to |

The workflow uses a locked install so deploys are reproducible:

- `/.github/shopify-cli/package.json` pins `@shopify/cli@3.69.4` exact
- `/.github/shopify-cli/package-lock.json` is checked in with integrity hashes
- the job runs `npm ci` in that folder, verifies `npx shopify version | grep 3.69.4`, then `npx shopify theme push --path ../../shopify-theme`

Local equivalent if you need to test the same path:

```bash
SHOPIFY_FLAG_STORE=your-store.myshopify.com \
SHOPIFY_CLI_THEME_TOKEN=shptka_xxx \
npx --prefix .github/shopify-cli shopify theme push --path shopify-theme --unpublished
```

Now **Actions → Deploy Shopify theme → Run workflow** pushes `shopify-theme/`
to your store — pick `unpublished` to review in the theme editor first, or
`live` to publish. Pushing a `v*` tag does the same automatically.

### 4. Production env vars and everyday workflow

**Storefront hardening you should know before deploying:**

| Env | What it does |
| --- | --- |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Override admin credentials on boot. If `ADMIN_PASSWORD` is not set in production the seed prints a one-time password only when the stored credential is still the demo `vennix123` — it never rotates on every boot. Set `ADMIN_PASSWORD` for a stable login. |
| `TRUST_PROXY` | Set to `1` only when behind a trusted reverse proxy (Fly, Render, Nginx). Rate limiters (`/track`, `/api/notify`, admin login, storefront login) use `socket.remoteAddress` by default and only trust `X-Forwarded-For` when `TRUST_PROXY=1`, preventing XFF bypass. |
| `NODE_ENV=production` | Switches payments badge to LIVE, hides demo password hint, enables first-run admin password generation path. |

**Cart reuse fix:** after a successful checkout the cart keeps `_lastOrderId` for idempotency while empty. If the customer adds items again, `clearCheckoutReuse()` clears the marker so a fresh order can be created instead of redirecting to the old order.

```bash
npm start                 # storefront + admin on http://localhost:3000
npm run reset             # rebuild demo catalogue/orders/content
npm run verify            # modules + theme + HTTP + link + browser suites
npx shopify theme dev --path ./shopify-theme   # live preview against your store
```

---

## Making it genuinely yours

This repo ships as **Vennix** — modern clothing and active essentials, support
`support@vennixstore.com`, free shipping over $50, Pinterest + LinkedIn + TikTok
at `@vennixstore`, no published phone number.

Two scripts move all of that to a different brand without you editing templates
— they read and write `data/db.json`, and the theme picks the result up on
export.

```bash
# 1. Brand identity everywhere: header word mark, page copy, journal,
#    SEO defaults, emails, structured data, legal name.
node scripts/format-catalog.js \
  --brand "Northline" --suffix "Supply Co" \
  --domain northline.co --email help@northline.co --phone "+1 512 555 0139" \
  --address "1201 Comal St" --city Austin --province TX --zip 78702 \
  --tiktok https://www.tiktok.com/@northline \
  --pinterest https://www.pinterest.com/northline

# 2. The same identity in the Shopify theme + shopify.theme.toml
node scripts/format-theme.js --accent "#2F6E4F"

# 3. Rebuild the deployment bundle
npm run export
```

Prefer a file to a long command? Copy `brand.example.json` to `brand.json`, fill in
your details, then run `npm run brand -- --file brand.json` followed by
`npm run brand:theme -- --file brand.json`. Both scripts accept `--dry-run`, and
both print every field they touch — nothing is renamed silently.

Three details worth knowing:

- **Socials are merged, not replaced.** Pass only the networks you actually run,
  so a brand with no Instagram never ends up with a dead Instagram link. Pass
  `"instagram": "none"` to delete a demo link outright.
- **`--no-phone` clears the phone.** The storefront, the contact page, the
  checkout sidebar and the Organization JSON-LD all skip an empty phone rather
  than publishing a blank one.
- **The admin login and the order-number prefix follow the brand.** `npm run brand`
  derives the order prefix from the new name (first three letters: `VEN` for
  Vennix) and moves the admin email onto the new domain, so `data/db.json` never
  ships with a stale order number or a login on the old domain.
- **Change money once.** `settings.freeShippingThreshold` drives the announcement
  bar, the cart's free-shipping progress bar, the shipping charge itself and the
  theme's cart drawer — they cannot contradict each other.

### Bringing your real catalogue in

Two sources, both supported:

```bash
# From a Shopify product export CSV
node scripts/import-shopify-catalog.js --csv ~/Downloads/products.csv --dry-run
node scripts/import-shopify-catalog.js --csv ~/Downloads/products.csv

# Straight from the Admin API
SHOPIFY_STORE=your-store.myshopify.com \
SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxx \
node scripts/import-shopify-catalog.js
```

The run prints a report: products and variants imported, collections created,
and warnings for anything the source left thin (no image, zero price, empty
description). Nothing is invented to fill the gaps — a product without images
gets a placeholder and a warning, and ratings always start at zero.

Useful flags: `--replace` swaps the catalogue instead of merging,
`--dry-run` previews, `--keep-copy` leaves the journal and CMS pages alone.

### Selling the monogram add-on on Shopify

The demo storefront prices monogramming itself. On Shopify only **variants** can
carry a fee, so the theme supports both honest routes and never advertises a
charge it cannot collect:

| Theme setting | What happens |
| --- | --- |
| **By a Monogrammed variant** (default) | Create a `Monogrammed` variant per product with the fee baked into its price. The theme swaps the cart's variant to it when the customer types their letters, and the button price updates. |
| **As a free note on the line item** | The letters are recorded as a line-item property — visible in the cart, the order and the packing slip, but not charged. The theme drops the price claim. |

Either way the monogram travels with the line: `Online Store → Themes → Customise
→ Product page`. The size finder has its own toggle in the same panel, and the
"Load more" versus numbered pagination choice lives in the collection section.

### Back-in-stock alerts on Shopify

The theme's alert posts to the **contact form** with the piece and size already
filled in, so it arrives as a normal customer request. Shopify's own "notify me"
requires an app; rather than ship a button that quietly does nothing, the theme
routes the request somewhere the merchant will actually see it. Swap it for your
app's snippet if you install one.

### Reviews

Seeded reviews are deliberately thin and imperfect: 11 published reviews across
4 of 9 products (one of them 3-star and critical), reviewers never repeat across
products, helpful counts stay in single digits, and four products start at zero.
The homepage says so out loud in the store pulse band.

When you go live, delete the seeded reviews and let real ones accumulate:
**Admin → Reviews** to manage, or run `npm run reset` and only keep your own
content. The storefront automatically swaps to invite-a-first-review copy for
anything unrated, and stops emitting `aggregateRating` structured data until a
piece has real reviews — so you never advertise ratings you do not have.
