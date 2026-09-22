# legacy/ — retired custom commerce backend

Everything in this folder belonged to the pre-Shopify architecture: a custom
JSON document store (`store.js` + `data/db.json`), a pricing/order engine
(`commerce.js`), customer/admin sessions and emails (`auth.js`, `emails.js`,
`admin/`), demo seed data (`seed.js`) and one-off CSV migration tools
(`export-shopify.js`, `import-shopify-catalog.js`, `format-catalog.js`,
`format-theme.js`).

It was retired — not deleted — when the storefront moved to Shopify as the
commerce backend, per the migration plan (`docs/MIGRATION.md`):

- **Products, variants, pricing, inventory, collections, carts, checkout,
  orders, discounts, customers** are owned by Shopify and read through
  `lib/shopify/` by the live storefront.
- **Presentation logic** that used to live next to this code (pages, layout,
  fit finder, monogram rules, style pairing) was kept and rewired onto the
  Shopify data layer — see `lib/` and `lib/pages/`.
- **Nothing in this folder is required or loaded by the live server.** It is
  kept only so the retired behaviour can be inspected or referenced while
  the migration is verified. It is safe to delete once the Shopify-backed
  storefront has been in production use.

Do not build new features on these modules, and do not re-introduce
`data/db.json` — a second product/order database next to Shopify is exactly
what the migration removed.
