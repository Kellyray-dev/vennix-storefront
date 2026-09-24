'use strict';
const { DEFAULT_API_VERSION } = require('../../lib/shopify/config');
/**
 * mock-shopify gateway — a Storefront-API-compatible demo store.
 *
 * WHAT THIS IS
 *   A tiny HTTP GraphQL endpoint that serves the committed fixture catalog
 *   (data/fixtures/shopify-store.json) through the exact operations the
 *   storefront sends to a real Shopify store. It powers:
 *     - local development without store credentials (clearly labelled)
 *     - CI, which exercises the real Shopify data-access code path offline
 *
 * WHAT THIS IS NOT
 *   A second commerce backend. It is never used when SHOPIFY_STORE_DOMAIN is
 *   configured, it never persists anything, and it never talks to Shopify.
 *   Inventory "changes" live only in process memory for the session.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'data', 'fixtures', 'shopify-store.json');

function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function cents(moneyV2) { return moneyV2 ? Math.round(parseFloat(moneyV2.amount) * 100) : 0; }

/* -------------------------------------------------------------------------- */
/* Gateway state (per process): fixture clone + in-memory carts + inventory    */
/* -------------------------------------------------------------------------- */

function createGatewayState() {
  const fixture = loadFixture();
  const inventory = new Map();
  const variantIndex = new Map(); // variantId -> { variant, product }
  const productByHandle = new Map();

  for (const p of fixture.products) {
    productByHandle.set(p.handle, p);
    for (const v of p.variants) {
      inventory.set(v.id, v.quantityAvailable);
      variantIndex.set(v.id, { variant: v, product: p });
    }
  }

  const carts = new Map();
  let lineSeq = 0;

  return { fixture, inventory, variantIndex, productByHandle, carts, lineSeq };
}

/* ------------------------------ cart mechanics ---------------------------- */

function liveVariant(state, variant) {
  const qty = state.inventory.get(variant.id);
  return { ...variant, quantityAvailable: qty, availableForSale: qty > 0 };
}

/**
 * Shape a fixture product into the exact Storefront API response form the
 * client documents request: variants connection, media connection, featured
 * image, metafields list, seo block.
 */
function shapeProduct(state, product) {
  const metafields = Object.entries(product.metafields || {}).map(([key, value]) => ({
    key,
    value: value === null ? null : (typeof value === 'string' ? value : JSON.stringify(value)),
    type: typeof value === 'string' ? 'single_line_text_field' : 'json'
  }));
  return {
    __typename: 'Product',
    id: product.id,
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags || [],
    publishedAt: product.publishedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    descriptionHtml: product.descriptionHtml,
    isGiftCard: !!product.isGiftCard,
    seo: product.seo || { title: product.title, description: '' },
    featuredImage: product.images[0] || null,
    media: { nodes: (product.images || []).map(img => ({ image: img })) },
    variants: { nodes: product.variants.map(v => liveVariant(state, v)) },
    metafields
  };
}

/**
 * Merchandise subtotal, the discount total, and the 2026-07 discount
 * application objects that explain it. Mirrors Shopify: `cost.subtotalAmount`
 * is the post-discount subtotal, and `discountApplications` carries the
 * authoritative per-application allocation totals.
 */
function cartDiscounts(state, cart) {
  let subtotal = 0;
  for (const line of cart.lines) {
    const entry = state.variantIndex.get(line.merchandiseId);
    if (!entry) continue;
    subtotal += cents(entry.variant.price) * line.quantity;
  }
  let discount = 0;
  const apps = [];
  for (const code of cart.discountCodes) {
    const def = state.fixture.discountCodes[code];
    if (!def) continue;
    if (subtotal < def.minSubtotalCents) continue;
    if (def.type === 'percent') {
      const amount = Math.round(subtotal * def.value / 100);
      discount += amount;
      apps.push({
        __typename: 'CartCodeDiscountApplication',
        allocationMethod: 'ACROSS',
        targetType: 'LINE_ITEM',
        totalAllocatedAmount: money(amount)
      });
    }
    // 'shipping' codes only affect shipping, which is calculated in Shopify's
    // checkout — they still count as applicable on the cart, and they are the
    // reason a client must exclude SHIPPING_LINE allocations from a merchandise
    // discount total.
    else if (def.type === 'shipping') {
      apps.push({
        __typename: 'CartCodeDiscountApplication',
        allocationMethod: 'EACH',
        targetType: 'SHIPPING_LINE',
        totalAllocatedAmount: money(0)
      });
    }
  }
  return { subtotal, discount: Math.min(discount, subtotal), apps };
}

function cartCost(state, cart) {
  const { subtotal, discount, apps } = cartDiscounts(state, cart);
  const total = Math.max(0, subtotal - discount);
  return {
    // Shopify's cost.subtotalAmount is the post-discount subtotal
    subtotalAmount: money(total),
    totalAmount: money(total),
    totalTaxAmount: money(0),
    checkoutChargeAmount: money(total),
    apps,
    lineDiscount: discount,
    lineSubtotal: subtotal
  };
}

function money(cents) { return { amount: (cents / 100).toFixed(2), currencyCode: 'USD' }; }

/** Deterministic, Liquid-style view key derived from the line's own identity. */
function viewKeyFor(line) {
  return crypto.createHash('sha256').update(String(line.id)).digest('hex').slice(0, 32);
}

/** 2026-07: a line may be addressed by either its id or its viewKey. */
function findLine(cart, ref) {
  if (!ref) return null;
  if (ref.id) return cart.lines.find(l => l.id === ref.id) || null;
  if (ref.viewKey) return cart.lines.find(l => viewKeyFor(l) === ref.viewKey) || null;
  return null;
}

function serializeCart(state, cart) {
  const cost = cartCost(state, cart);
  // Spread the merchandise discount across the lines by value, the way Shopify
  // allocates an order-level discount — enough for the storefront to show a
  // truthful per-line figure without pretending to be Shopify's allocator.
  const lineValues = cart.lines.map(line => {
    const entry = state.variantIndex.get(line.merchandiseId);
    return entry ? cents(entry.variant.price) * line.quantity : 0;
  });
  const lineSubtotal = lineValues.reduce((s, v) => s + v, 0) || 0;
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalQuantity: cart.lines.reduce((s, l) => s + l.quantity, 0),
    note: cart.note || '',
    attributes: cart.attributes || [],
    buyerIdentity: { email: cart.email || null },
    discountCodes: cartDiscountCodes(state, cart),
    // A plain list in 2026-07 — not a connection, so no `nodes` wrapper.
    discountApplications: cost.apps,
    lines: {
      nodes: cart.lines.map((line, i) => {
        const entry = state.variantIndex.get(line.merchandiseId);
        if (!entry) return null;
        const v = liveVariant(state, entry.variant);
        const lineValue = lineValues[i];
        const lineDiscount = lineSubtotal > 0
          ? Math.round(cost.lineDiscount * (lineValue / lineSubtotal))
          : 0;
        return {
          id: line.id,
          // 2026-07: stable identifier also accepted by cartLinesUpdate /
          // cartLinesRemove, and the same value Liquid exposes as view_key.
          viewKey: viewKeyFor(line),
          quantity: line.quantity,
          attributes: line.attributes || [],
          cost: { totalAmount: money(lineValue - lineDiscount) },
          discountAllocations: lineDiscount > 0 ? [{
            __typename: 'CartCodeDiscountAllocation',
            targetType: 'LINE_ITEM',
            discountedAmount: money(lineDiscount)
          }] : [],
          merchandise: {
            __typename: 'ProductVariant',
            ...v,
            product: {
              id: entry.product.id,
              handle: entry.product.handle,
              title: entry.product.title,
              vendor: entry.product.vendor,
              productType: entry.product.productType,
              isGiftCard: entry.product.isGiftCard,
              featuredImage: entry.product.images[0] || null
            }
          }
        };
      }).filter(Boolean)
    },
    cost
  };
}

function cartDiscountCodes(state, cart) {
  const subtotal = cart.lines.reduce((s, l) => {
    const entry = state.variantIndex.get(l.merchandiseId);
    return s + (entry ? cents(entry.variant.price) * l.quantity : 0);
  }, 0);
  return cart.discountCodes.map(code => {
    const def = state.fixture.discountCodes[code];
    if (!def) return { code, applicable: false };
    if (subtotal < def.minSubtotalCents) return { code, applicable: false };
    return { code, applicable: true };
  });
}

function validateLines(state, lines) {
  const errors = [];
  for (const [i, input] of lines.entries()) {
    const entry = state.variantIndex.get(input.merchandiseId);
    if (!entry) {
      errors.push({ field: `lines.${i}.merchandiseId`, message: 'That product is no longer available.' });
      continue;
    }
    const available = state.inventory.get(input.merchandiseId);
    if (available <= 0) {
      errors.push({ field: `lines.${i}.quantity`, message: `${entry.product.title} (${entry.variant.title}) is sold out.` });
      continue;
    }
    if ((input.quantity || 1) > available) {
      errors.push({ field: `lines.${i}.quantity`, message: `Only ${available} of ${entry.product.title} (${entry.variant.title}) available.` });
    }
  }
  return errors;
}

/* ------------------------------- query handlers --------------------------- */

function matchText(text, term) {
  return text.toLowerCase().includes(term);
}

function searchScore(product, term) {
  const hay = `${product.title} ${product.productType} ${product.vendor} ${(product.tags || []).join(' ')}`.toLowerCase();
  if (!hay.includes(term)) return 0;
  let score = 1;
  if (product.title.toLowerCase().includes(term)) score += 4;
  if (product.title.toLowerCase().startsWith(term)) score += 2;
  return score;
}

const PAIRS = {
  'Hoodie': ['Joggers', 'T-Shirt', 'Shorts', 'Base Layer'],
  'Sweatshirt': ['Joggers', 'T-Shirt', 'Shorts'],
  'T-Shirt': ['Joggers', 'Shorts', 'Hoodie', 'Jacket'],
  'Base Layer': ['Shorts', 'Joggers', 'Jacket', 'T-Shirt'],
  'Shorts': ['T-Shirt', 'Base Layer', 'Hoodie'],
  'Joggers': ['Hoodie', 'T-Shirt', 'Jacket'],
  'Jacket': ['Base Layer', 'Joggers', 'T-Shirt'],
  'Leggings': ['Sports Bra', 'T-Shirt', 'Hoodie'],
  'Sports Bra': ['Leggings', 'T-Shirt', 'Hoodie'],
  'Gift Card': ['Hoodie', 'Leggings', 'T-Shirt']
};

function handleOperation(state, operation, body) {
  const vars = body.variables || {};

  switch (operation) {
    case 'Shop':
      return { shop: state.fixture.shop };

    case 'Products': {
      const nodes = state.fixture.products.map(p => shapeProduct(state, p));
      return { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } };
    }

    case 'ProductByHandle': {
      const p = state.productByHandle.get(vars.handle);
      return { product: p ? shapeProduct(state, p) : null };
    }

    case 'Collections':
      return { collections: { nodes: state.fixture.collections.map(c => ({ ...c, products: undefined })) } };

    case 'CollectionProducts': {
      const c = state.fixture.collections.find(x => x.handle === vars.handle);
      if (!c) return { collection: null };
      const handles = c.productHandles.slice(0, vars.first || 250);
      return { collection: { ...c, products: { nodes: handles.map(h => ({ handle: h })) } } };
    }

    case 'Search': {
      const term = String(vars.query || '').trim().toLowerCase();
      const scored = state.fixture.products
        .map(p => ({ p, score: searchScore(p, term) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, vars.first || 24)
        .map(x => shapeProduct(state, x.p));
      return { search: { nodes: scored } };
    }

    case 'Recommendations': {
      const source = state.fixture.products.find(p => p.id === vars.productId);
      if (!source) return { productRecommendations: [] };
      const wanted = PAIRS[source.productType] || ['Hoodie', 'T-Shirt', 'Joggers', 'Leggings'];
      const ranked = state.fixture.products
        .filter(p => p.id !== source.id && !p.tags.includes('vennix-service'))
        .map(p => {
          const idx = wanted.indexOf(p.productType);
          const inStock = p.variants.some(v => state.inventory.get(v.id) > 0);
          return { p, score: (idx > -1 ? 60 - idx * 10 : 0) + (inStock ? 25 : -40) };
        })
        .sort((a, b) => b.score - a.score)
        .map(x => shapeProduct(state, x.p));
      return { productRecommendations: ranked };
    }

    case 'Pages':
      return { pages: { nodes: state.fixture.pages } };

    case 'Blog': {
      const blog = state.fixture.blog;
      if (!blog || blog.handle !== vars.handle) return { blog: null };
      return { blog: { title: blog.title, articles: { nodes: blog.articles } } };
    }

    case 'GetCart': {
      const cart = state.carts.get(vars.id);
      return { cart: cart ? serializeCart(state, cart) : null };
    }

    case 'CartCreate': {
      const input = vars.input || {};
      const lines = input.lines || [];
      const errors = validateLines(state, lines);
      if (errors.length) return { cartCreate: { cart: null, userErrors: errors } };
      const token = crypto.randomBytes(16).toString('base64url');
      const cart = {
        id: `gid://shopify/Cart/${token}`,
        // Same shape as a real cart: a Shopify-hosted checkout URL. The storefront
        // allowlists checkout hosts, so the demo gateway must look like Shopify too.
        checkoutUrl: `https://${state.fixture.checkoutDomain || 'vennix-demo.myshopify.com'}/cart/c/${token}`,
        lines: [],
        discountCodes: [],
        note: input.note || '',
        attributes: input.attributes || [],
        email: null
      };
      for (const line of lines) {
        cart.lines.push({
          id: `gid://shopify/CartLine/${++state.lineSeq}`,
          merchandiseId: line.merchandiseId,
          quantity: line.quantity || 1,
          attributes: line.attributes || []
        });
        state.inventory.set(line.merchandiseId, state.inventory.get(line.merchandiseId) - (line.quantity || 1));
      }
      state.carts.set(cart.id, cart);
      return { cartCreate: { cart: serializeCart(state, cart), userErrors: [] } };
    }

    case 'CartLinesAdd': {
      const cart = state.carts.get(vars.cartId);
      if (!cart) return { cartLinesAdd: { cart: null, userErrors: [{ field: ['cartId'], message: 'Cart not found.' }] } };
      const errors = validateLines(state, vars.lines || []);
      if (errors.length) return { cartLinesAdd: { cart: serializeCart(state, cart), userErrors: errors } };
      for (const line of vars.lines) {
        cart.lines.push({
          id: `gid://shopify/CartLine/${++state.lineSeq}`,
          merchandiseId: line.merchandiseId,
          quantity: line.quantity || 1,
          attributes: line.attributes || []
        });
        state.inventory.set(line.merchandiseId, state.inventory.get(line.merchandiseId) - (line.quantity || 1));
      }
      return { cartLinesAdd: { cart: serializeCart(state, cart), userErrors: [] } };
    }

    case 'CartLinesUpdate': {
      const cart = state.carts.get(vars.cartId);
      if (!cart) return { cartLinesUpdate: { cart: null, userErrors: [{ field: ['cartId'], message: 'Cart not found.' }] } };
      for (const upd of vars.lines || []) {
        const line = findLine(cart, upd);
        if (!line) return { cartLinesUpdate: { cart: serializeCart(state, cart), userErrors: [{ field: ['id'], message: 'That line is no longer in the cart.' }] } };
        const entry = state.variantIndex.get(line.merchandiseId);
        const currentHeld = line.quantity;
        const available = (state.inventory.get(line.merchandiseId) || 0) + currentHeld;
        if (upd.quantity > available) {
          return { cartLinesUpdate: { cart: serializeCart(state, cart), userErrors: [{ field: ['quantity'], message: `Only ${available} of ${entry ? entry.product.title : 'that item'} available.` }] } };
        }
        state.inventory.set(line.merchandiseId, available - upd.quantity);
        line.quantity = upd.quantity;
      }
      return { cartLinesUpdate: { cart: serializeCart(state, cart), userErrors: [] } };
    }

    case 'CartLinesRemove': {
      const cart = state.carts.get(vars.cartId);
      if (!cart) return { cartLinesRemove: { cart: null, userErrors: [{ field: ['cartId'], message: 'Cart not found.' }] } };
      // 2026-07: cartLinesRemove takes either lineIds or viewKeys.
      const refs = (vars.lineIds || []).map(id => ({ id }))
        .concat((vars.viewKeys || []).map(viewKey => ({ viewKey })));
      for (const ref of refs) {
        const line = findLine(cart, ref);
        const idx = line ? cart.lines.indexOf(line) : -1;
        if (idx > -1) {
          const line = cart.lines[idx];
          state.inventory.set(line.merchandiseId, (state.inventory.get(line.merchandiseId) || 0) + line.quantity);
          cart.lines.splice(idx, 1);
        }
      }
      return { cartLinesRemove: { cart: serializeCart(state, cart), userErrors: [] } };
    }

    case 'CartDiscountCodesUpdate': {
      const cart = state.carts.get(vars.cartId);
      if (!cart) return { cartDiscountCodesUpdate: { cart: null, userErrors: [{ field: ['cartId'], message: 'Cart not found.' }] } };
      const codes = (vars.discountCodes || []).map(c => String(c).trim().toUpperCase()).filter(Boolean);
      for (const code of codes) {
        if (!state.fixture.discountCodes[code]) {
          return { cartDiscountCodesUpdate: { cart: serializeCart(state, cart), userErrors: [{ field: ['discountCodes'], message: `Discount code “${code}” is invalid or has expired.` }] } };
        }
      }
      cart.discountCodes = codes;
      return { cartDiscountCodesUpdate: { cart: serializeCart(state, cart), userErrors: [] } };
    }

    case 'CartNoteUpdate': {
      const cart = state.carts.get(vars.cartId);
      if (!cart) return { cartNoteUpdate: { cart: null, userErrors: [{ field: ['cartId'], message: 'Cart not found.' }] } };
      cart.note = vars.note || '';
      return { cartNoteUpdate: { cart: serializeCart(state, cart), userErrors: [] } };
    }

    default:
      return null;
  }
}

/* --------------------------------- server --------------------------------- */

function operationName(query) {
  const m = String(query || '').match(/^\s*(query|mutation)\s+([A-Za-z0-9_]+)/m);
  return m ? m[2] : null;
}

function startMockGateway({ port = 0, host = '127.0.0.1' } = {}) {
  const state = createGatewayState();

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, mode: 'mock-shopify-gateway' }));
    }
    const isGraphql = req.method === 'POST' && (/^\/api\/[^/]+\/graphql\.json/.test(req.url) || req.url === '/graphql');
    if (!isGraphql) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ errors: [{ message: 'Not found' }] }));
    }

    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ errors: [{ message: 'Invalid JSON body' }] }));
      }
      const op = operationName(body.query);
      if (!op) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ errors: [{ message: 'Missing or anonymous operation' }] }));
      }
      try {
        const data = handleOperation(state, op, body);
        if (data === null) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ errors: [{ message: `Unknown operation: ${op}` }] }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ message: err.message }] }));
      }
    });
  });

  return new Promise(resolve => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        url: `http://${host}:${addr.port}/api/${(process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim()}/graphql.json`,
        port: addr.port,
        state,
        close: () => new Promise(r => server.close(r))
      });
    });
  });
}

/* Allow running standalone for manual inspection: node tools/mock-shopify/gateway.js 4210 */
if (require.main === module) {
  const port = Number(process.argv[2] || process.env.MOCK_SHOPIFY_PORT || 4210);
  startMockGateway({ port, host: '0.0.0.0' }).then(g => {
    console.log(`[mock-shopify] Storefront API mock listening at ${g.url}`);
    console.log('[mock-shopify] Demo catalog only — never used when SHOPIFY_STORE_DOMAIN is set.');
  });
}

module.exports = { startMockGateway, loadFixture };
