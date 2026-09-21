# Vennix — Shopify Online Store 2.0 theme

A complete, deployable Shopify theme (Liquid) built to match the Vennix
storefront that ships in this repo as a standalone Node app.

It is a **JSON-template OS 2.0 theme**: every page is composed of sections that
merchants can rearrange in the theme editor, with matching `{% schema %}` blocks,
presets, settings and translation keys.

## Deploy in three commands

```bash
npm install -g @shopify/cli @shopify/theme   # once
shopify theme check                          # optional lint
shopify theme dev --store your-store.myshopify.com   # live preview
shopify theme push --store your-store.myshopify.com --unpublished
```

Or zip and upload: **Shopify admin → Online Store → Themes → Add theme → Upload zip**
(the zip must contain the folders below at its root).

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

The repo's Node app (`..`) defines the catalogue; `scripts/export-shopify.js` turns
`data/db.json` into Shopify-ready artefacts:

- `dist/shopify/catalog/products.csv` — Shopify product import CSV (variants, prices, images)
- `dist/shopify/catalog/collections.csv` — collections + smart-collection rules
- `dist/shopify/catalog/pages.csv` — CMS pages, blog posts and snippets
- `dist/shopify/catalog/customers.csv` — customer list (no passwords)
- `dist/shopify/theme.zip` — this theme, zipped and ready to upload

Then in Shopify: **Products → Import** for the CSVs, **Content → Import** for pages,
and push/upload the theme. The theme uses Shopify's own sections, filters, cart API and
customer accounts, so nothing bespoke needs to be hosted.
