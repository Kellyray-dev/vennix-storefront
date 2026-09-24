'use strict';
/**
 * preflight.js — prove the connection at boot, before the first shopper asks.
 *
 * A storefront whose Shopify credentials are wrong looks fine at startup and
 * wrong on every page (empty catalogue, carts that silently fail). This module
 * turns that into a loud, actionable boot failure instead:
 *
 *   - shop + product read  → unauthenticated_read_product_listings
 *   - quantityAvailable    → unauthenticated_read_product_inventory
 *   - cartCreate           → unauthenticated_write_checkouts
 *   - pages read           → content scope (journal/CMS pages; warn only)
 *
 * In demo mode it does nothing (there is nothing to prove) and in tests it is
 * skipped with VENNIX_SKIP_PREFLIGHT=1.
 */
const { gql, ShopifyError, CODES } = require('./client');
const { getConfig } = require('./config');
const ops = require('./operations');

const SCOPE_HINTS = {
  products: 'unauthenticated_read_product_listings',
  inventory: 'unauthenticated_read_product_inventory',
  cart: 'unauthenticated_write_checkouts',
  content: 'unauthenticated_read_content'
};

function fail(name, err) {
  const message = err && err.message ? err.message : String(err);
  const code = err && err.code ? err.code : CODES.NETWORK;
  let hint = '';
  if (code === CODES.AUTH || /token|unauthor|access denied/i.test(message)) {
    hint = 'Check SHOPIFY_STOREFRONT_ACCESS_TOKEN: use the *Storefront API* public access token from ' +
      'Shopify admin → Settings → Apps and sales channels → Develop apps → your app → API credentials, ' +
      'and make sure the Storefront API integration is installed on the store.';
  } else if (code === CODES.NETWORK || code === CODES.TIMEOUT) {
    hint = 'The store did not answer. Check SHOPIFY_STORE_DOMAIN (it must be the myshopify domain, ' +
      'e.g. your-store.myshopify.com) and that outbound HTTPS is allowed from this host.';
  }
  return { name, ok: false, detail: message, hint };
}

async function step(name, fn) {
  try {
    const detail = await fn();
    return { name, ok: true, detail: detail || 'ok' };
  } catch (err) {
    return fail(name, err);
  }
}

/**
 * @returns {{mode:'demo'|'live'|'skipped', ok:boolean, checks:Array, shop?:object}}
 */
async function preflight() {
  const cfg = getConfig();
  if (cfg.demo) return { mode: 'demo', ok: true, checks: [] };
  if (process.env.VENNIX_SKIP_PREFLIGHT === '1') {
    return { mode: 'skipped', ok: true, checks: [] };
  }

  const checks = [];
  let shop = null;

  checks.push(await step('shop', async () => {
    const data = await gql(ops.SHOP);
    if (!data || !data.shop) throw new Error('Storefront API returned no shop.');
    shop = data.shop;
    return `${data.shop.name}`;
  }));

  checks.push(await step(`products (${SCOPE_HINTS.products})`, async () => {
    const data = await gql(ops.PRODUCTS, { first: 5, after: null });
    const nodes = (data && data.products && data.products.nodes) || [];
    const total = data && data.products && data.products.pageInfo ? data.products.pageInfo.hasNextPage : false;
    if (!nodes.length) throw new Error('The Storefront API returned zero products. Publish products to the Storefront sales channel.');
    return `${nodes.length}${total ? '+' : ''} products visible`;
  }));

  checks.push(await step(`inventory (${SCOPE_HINTS.inventory})`, async () => {
    const data = await gql(ops.PRODUCTS, { first: 1, after: null });
    const node = data && data.products && data.products.nodes && data.products.nodes[0];
    if (!node) throw new Error('No product to read inventory from.');
    const variant = node.variants && node.variants.nodes && node.variants.nodes[0];
    if (!variant || variant.quantityAvailable === null || variant.quantityAvailable === undefined) {
      throw new Error('quantityAvailable is missing — the token is missing the inventory scope.');
    }
    return `variant stock readable (${variant.quantityAvailable})`;
  }));

  checks.push(await step(`cart + checkout (${SCOPE_HINTS.cart})`, async () => {
    const data = await gql(ops.CART_CREATE, { input: {} });
    const payload = data && data.cartCreate;
    if (!payload) throw new Error('cartCreate returned no payload.');
    if (payload.userErrors && payload.userErrors.length) {
      throw new Error(payload.userErrors.map(e => e.message).join(' '));
    }
    if (!payload.cart) throw new Error('cartCreate returned no cart.');
    return 'cartCreate accepted (empty test cart, expires on its own)';
  }));

  // Non-fatal: a store with no pages or blog simply renders without them.
  const contentCheck = await step(`pages + journal (${SCOPE_HINTS.content})`, async () => {
    const data = await gql(ops.PAGES, { first: 1 });
    return `${((data && data.pages && data.pages.nodes) || []).length >= 0 ? 'pages query accepted' : 'pages query accepted'}`;
  });
  checks.push(contentCheck);

  const hardFailures = checks.filter(c => !c.ok && c.name !== contentCheck.name);
  const ok = hardFailures.length === 0;
  if (!ok && contentCheck.ok === false) {
    // content scope is optional — downgrade its failure to a warning
    contentCheck.warning = true;
  }

  return { mode: 'live', ok, checks, shop, config: { domain: cfg.domain, version: cfg.version } };
}

function formatPreflight(result) {
  const lines = [];
  for (const c of result.checks) {
    lines.push(`  ${c.ok ? '✓' : (c.warning ? '!' : '✗')} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    if (!c.ok && c.hint) lines.push(`      → ${c.hint}`);
  }
  return lines.join('\n');
}

module.exports = { preflight, formatPreflight, SCOPE_HINTS };
