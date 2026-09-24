# Vennix — Shopify Online Store 2.0 theme

A complete, deployable Shopify theme (Liquid) built to match the Vennix
storefront that ships in this repo as a standalone Node app.

It is a **JSON-template OS 2.0 theme**: every page is composed of sections that
merchants can rearrange in the theme editor, with matching `{% schema %}` blocks,
presets, settings and translation keys.

## Deploying

### Option 1 (recommended): GitHub Sync — "Deploy with Shopify"

Shopify's first-party GitHub integration keeps the theme in this repo synced
to the store on every push. No server, no CLI install, no secrets in the repo.

1. Shopify admin → **Online Store → Themes → Deploy with Shopify →
   Set up your repository**.
2. Authorise Shopify's GitHub app for this repository
   (`kellyraydev/vennix-storefront`) — it is scoped to this repo and only
   reads theme files from it.
3. Configure the sync:
   - **Branch:** `main` — only merged changes can reach the store;
     `arena/*` and feature branches never do.
   - **Path to theme files:** `shopify-theme`
   - **Theme to update:** pick a theme in the store. Point it at an
     **unpublished** theme to stage and publish manually, or at the
     **published** theme for live updates on every merge.
4. Every push to `main` deploys to the connected theme within about a minute.
   Verify the first sync by touching any theme file (even a comment in
   `assets/theme.css`) and watching it appear in the theme editor.

CI keeps the theme safe: `npm run verify` — which includes
`npm run theme:check` — runs on every push and PR, so a structurally broken
theme fails in GitHub before it can ever be published.

### Option 2: Shopify CLI (manual pushes, live previews)

```bash
npm install -g @shopify/cli @shopify/theme   # once
shopify theme check                          # optional lint
shopify theme dev --store your-store.myshopify.com   # live preview, hot reload
shopify theme push --store your-store.myshopify.com --unpublished
```

The included workflow `.github/workflows/theme-deploy.yml` (push a `v*` tag,
or run **Actions → Deploy Shopify theme**) does the same with a pinned CLI.
Use it when the GitHub app isn't installed.

Or zip and upload: **Shopify admin → Online Store → Themes → Add theme →
Upload zip** (the zip must contain the folders below at its root).

## What's inside

```
shopify-theme/
├── assets/            theme.css (full design system), theme.js (cart API, drawers, pickers)
├── config/            settings_schema.json, settings_data.json
├── layout/            theme.liquid (meta, JSON-LD, sections, cart drawer)
├── locales/           en.default.json — every translation key used by the theme
├── sections/          header, footer, announcement-bar, hero, trust-bar, category-grid,
│                      product-showcase, brand-story, testimonials, featured-collection,
│                      journal, instagram, newsletter, faq, contact-form, main-* pages
├── snippets/          icon, product-card, price, badges, rating, pagination, variant-picker,
│                      quantity-input, meta-tags, cart-drawer, address-fields
└── templates/         index, product, collection, list-collections, cart, page,
                       page.contact, blog, article, search, 404, gift_card, customers/*
```

## Storefront features

- **Merchandising:** hero, trust bar, category grid, product showcase, featured collection
  rails, journal, lookbook, testimonials, FAQ (with `FAQPage` JSON-LD), newsletter.
- **Product:** media gallery with thumbs, colour/size variant picker with live price and
  stock, sticky add-to-cart, quantity steppers, size-guide hook, accordions, metafield rows,
  complete-the-look, product structured data.
- **Collection:** faceted filtering (Shopify native `collection.filters`), sorting, active
  filter chips, pagination or load-more, empty states, `CollectionPage` JSON-LD.
- **Cart:** AJAX cart drawer with free-shipping progress bar, gift notes, order notes,
  discount codes via `/discount/`, line quantity updates, plus a full cart page.
- **Search:** overlay predictive search (Shopify Predictive Search API) and a results page.
- **Customer:** login, register, recover, reset, activate, account dashboard, order history,
  order detail, address book with add/edit/delete/default.
- **Extras:** wishlist (localStorage), size-guide modal, share, delivery estimate,
  responsive 3-breakpoint layout, print styles, `prefers-reduced-motion` support.

## Wiring it to real data

There is nothing to wire: the theme renders whatever is in the store.
Products, variants, prices, inventory, collections, pages, blog posts,
discount codes, carts, customers and orders all come straight from Shopify,
so the catalogue is maintained in the Shopify admin (or any tool that writes
to the store) and appears in the theme automatically — no export/import
step, and nothing bespoke needs to be hosted.

The pre-migration catalogue scripts (CSV export/import between the retired
JSON backend and Shopify) live in `legacy/` for reference only; the
production flow is Shopify → theme.
