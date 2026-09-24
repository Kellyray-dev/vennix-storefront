'use strict';
/**
 * cart.js — storefront cart orchestration over Shopify carts.
 *
 * Shopify owns the actual cart, pricing, discount validation and checkout;
 * this module keeps the UX contract the storefront was built around:
 *   - the cart id lives in an HttpOnly cookie (the browser never holds it)
 *   - monogram validation and the monogram service product pairing
 *   - the free-shipping progress display (a brand promise, shown from the
 *     storefront settings while real shipping is calculated by Shopify)
 *   - display merging of monogram service lines into their garment line
 */
const auth = require('./auth');
const security = require('./security');
const locks = require('./locks');
const settings = require('./settings');
const money = require('./money');
const catalog = require('./shopify/catalog');
const cartApi = require('./shopify/cart-api');
const personalize = require('./personalize');

const CART_COOKIE = 'vnx_cart';
const CART_TTL_DAYS = 60;
const MAX_QTY_PER_LINE = 20;

function getCartId(req) {
  return auth.cookieValue(req, CART_COOKIE) || null;
}

/** Secure cookies as soon as the connection is TLS — including behind a proxy. */
function cookieSecure(req) {
  return auth.requestSecure(req);
}

function setCartIdCookie(res, id, req = null) {
  if (!res) return;
  auth.setCookie(res, CART_COOKIE, id, {
    maxAge: CART_TTL_DAYS * 86400, httpOnly: true, sameSite: 'Lax', secure: cookieSecure(req)
  });
}

/** Expire the cookie (cart checked out, expired, or rejected by Shopify). */
function clearCartIdCookie(res, req = null) {
  if (!res) return;
  auth.clearCookie(res, CART_COOKIE, {
    httpOnly: true, sameSite: 'Lax', secure: cookieSecure(req)
  });
}

/**
 * Turn Shopify's cart userErrors into copy a shopper can act on. Shopify is
 * still the authority — this only translates, never decides.
 */
function friendlyCartError(message) {
  const msg = String(message || '').trim() || 'The store could not update your cart. Please try again.';
  const onlyLeft = /only\s+(\d+)\s+(?:left|available|remaining)/i.exec(msg)
    || /(\d+)\s+available/i.exec(msg)
    || /only add\s+(\d+)/i.exec(msg)
    || /add\s+(\d+)\s+or fewer/i.exec(msg);
  if (onlyLeft && /not enough inventory|quantity available|exceeds the quantity|only add|or fewer|available/i.test(msg)) {
    return `Only ${onlyLeft[1]} left in that size — lower the quantity to continue.`;
  }
  if (/sold out|not available for sale|no longer available/i.test(msg)) {
    return 'That piece just sold out. Pick another size or colour to continue.';
  }
  if (/maximum|limit of/i.test(msg)) {
    return 'That is more than we can ship in a single order.';
  }
  if (/discount|code/i.test(msg)) return msg; // Shopify's discount wording is already shopper-facing
  return msg;
}

/* ------------------------------ display layer ----------------------------- */

function freeShippingFor(subtotal, discountAmount) {
  const threshold = settings.get().freeShippingThreshold || 0;
  const effective = Math.max(0, subtotal - discountAmount);
  return {
    threshold,
    remaining: Math.max(0, threshold - effective),
    qualified: threshold > 0 && effective >= threshold
  };
}

function parseNotes(note) {
  const out = { giftNote: '', note: '' };
  for (const part of String(note || '').split('\n')) {
    if (part.startsWith('Gift note: ')) out.giftNote = part.slice('Gift note: '.length);
    else if (part.startsWith('Note: ')) out.note = part.slice('Note: '.length);
    else out.note = out.note ? `${out.note} ${part}` : part;
  }
  return out;
}

function composeNotes(giftNote, note) {
  const parts = [];
  if (giftNote) parts.push(`Gift note: ${giftNote}`);
  if (note) parts.push(`Note: ${note}`);
  return parts.join('\n');
}

/**
 * Map a Shopify-normalized cart into the display shape the templates render.
 * Monogram service lines are merged into their garment line so the cart reads
 * the way it did before — while Shopify still sees honest, priced lines.
 */
function displayCart(cart) {
  const s = settings.get();
  if (!cart) {
    return {
      id: null, count: 0, lines: [], subtotal: 0, savings: 0,
      discount: null, discountAmount: 0,
      shipping: { method: 'shopify', label: 'Calculated at checkout', amount: 0 },
      tax: { name: 'Estimated tax', amount: 0 },
      total: 0, costSubtotal: 0,
      freeShipping: freeShippingFor(0, 0),
      giftNote: '', note: '', email: null, checkoutUrl: null,
      currency: s.currency || 'USD'
    };
  }

  const serviceHandle = s.personalization.serviceProductHandle;
  const garmentByVariant = new Map();
  for (const l of cart.lines) garmentByVariant.set(l.attributes['Monogram for'] || '', l);

  const lines = [];
  const mergedService = new Set();
  for (const line of cart.lines) {
    const appliesTo = line.attributes['Monogram for'];
    if (line.handle === serviceHandle && appliesTo) {
      const garment = cart.lines.find(g => g.merchandiseId === appliesTo);
      if (garment) { mergedService.add(line.id); continue; } // folded below
    }
    const service = cart.lines.find(l =>
      l.handle === serviceHandle && l.attributes['Monogram for'] === line.merchandiseId && !mergedService.has(l.id));
    if (service) mergedService.add(service.id);

    const qty = line.quantity;
    lines.push({
      id: line.id,
      serviceLineId: service ? service.id : null,
      productId: line.productId,
      handle: line.handle,
      title: line.title,
      variantTitle: line.variantTitle,
      color: line.color,
      size: line.size,
      sku: line.sku,
      quantity: qty,
      price: line.price,
      compareAtPrice: line.compareAtPrice,
      unitCompare: line.compareAtPrice,
      image: line.image,
      productImage: line.image,
      url: line.url,
      stock: line.stock,
      vendor: line.vendor,
      digital: line.giftCard,
      personalization: service || (line.personalization && line.personalization.text) ? {
        text: service ? (service.attributes.Monogram || '') : line.personalization.text,
        label: settings.get().personalization.label || 'Monogram',
        placement: service ? (service.attributes['Monogram placement'] || '') : (line.personalization.placement || ''),
        price: service ? service.price : 0,
        note: settings.get().personalization.note
      } : null
    });
  }
  // service lines whose garment vanished still show on their own
  for (const line of cart.lines) {
    if (line.handle === serviceHandle && !mergedService.has(line.id) && !lines.some(l => l.id === line.id)) {
      lines.push({
        id: line.id, serviceLineId: null, productId: line.productId, handle: line.handle,
        title: line.title, variantTitle: line.variantTitle, color: line.color, size: line.size,
        sku: line.sku, quantity: line.quantity, price: line.price, compareAtPrice: null,
        image: line.image, productImage: line.image, url: line.url, stock: line.stock,
        vendor: line.vendor, digital: false,
        personalization: line.attributes.Monogram ? { text: line.attributes.Monogram, label: settings.get().personalization.label || 'Monogram', placement: '', price: line.price, note: '' } : null
      });
    }
  }

  const subtotal = cart.subtotal; // full-price sum of every Shopify line
  const savings = cart.lines.reduce((sum, l) => sum + (l.compareAtPrice ? (l.compareAtPrice - l.price) * l.quantity : 0), 0);
  const discount = cart.discountCodes[0] || null;
  const notes = parseNotes(cart.note);
  const total = cart.total;

  return {
    id: cart.id,
    count: cart.count,
    lines,
    subtotal,
    savings,
    discount: discount ? { code: discount.code, label: discount.code } : null,
    discountAmount: cart.discountAmount,
    shipping: { method: 'shopify', label: 'Calculated at checkout', amount: 0 },
    shippingOptions: [],
    tax: { name: 'Estimated tax', rate: 0, amount: cart.taxAmount },
    total,
    costSubtotal: cart.costSubtotal,
    freeShipping: freeShippingFor(subtotal, cart.discountAmount),
    giftNote: notes.giftNote,
    note: notes.note,
    email: cart.buyerEmail,
    checkoutUrl: cart.checkoutUrl,
    currency: s.currency || 'USD'
  };
}

/**
 * The cart shown to the current visitor (or an empty display cart).
 *
 * `res` is optional: when it is supplied and Shopify no longer knows the cart
 * in the cookie (checked out, expired, abandoned), the stale cookie is expired
 * so the next add starts a clean cart instead of forever 404-ing Shopify.
 */
async function getDisplayCartFor(req, res = null) {
  const id = getCartId(req);
  if (!id) return displayCart(null);
  try {
    const cart = await cartApi.getCart(id);
    if (!cart) {
      clearCartIdCookie(res, req);
      return displayCart(null);
    }
    return displayCart(cart);
  } catch (err) {
    console.error('[cart] failed to load Shopify cart', err.message);
    return displayCart(null);
  }
}

/* -------------------------------- mutations ------------------------------- */

/**
 * Resolve (or forget) the Shopify cart for this request.
 *
 * Order of trust: the HttpOnly cookie → the short-lived session memory (so two
 * parallel first-time adds share one cart instead of each creating one) → null.
 */
async function ensureCart(req, res) {
  const key = locks.sessionKey(req);
  const id = getCartId(req);
  if (id) {
    const existing = await cartApi.getCart(id).catch(() => null);
    if (existing) {
      if (key) locks.rememberCart(key, id);
      return id;
    }
    clearCartIdCookie(res, req);
    if (key) locks.forgetCart(key);
    return null;
  }
  const remembered = key ? locks.cartFor(key) : null;
  if (remembered) {
    const existing = await cartApi.getCart(remembered).catch(() => null);
    if (existing) return remembered;
    locks.forgetCart(key);
  }
  return null;
}

/**
 * Build the Shopify line inputs for an add-to-cart request, including the
 * monogram service line when personalization was requested.
 */
async function buildLines(variantId, quantity, options = {}) {
  const found = await catalog.findVariant(variantId);
  if (!found) return { error: 'That product is no longer available.' };
  const { product, variant } = found;
  if (!variant || variant.stock <= 0) {
    return { error: `${product.title} in ${variant ? `${variant.color} / ${variant.size}` : 'that option'} is sold out.` };
  }

  const lines = [{ merchandiseId: variant.id, quantity }];

  const wantsMonogram = options.personalization &&
    (options.personalization.text || typeof options.personalization === 'string');
  if (wantsMonogram) {
    const serviceProduct = await catalog.getServiceProduct(settings.get().personalization.serviceProductHandle)
      .catch(() => null);
    const check = personalize.validate(product, options.personalization, { serviceProduct });
    if (!check.ok) return { error: check.error, field: 'personalization' };
    const serviceVariant = serviceProduct && serviceProduct.variants[0];
    if (serviceVariant && serviceVariant.stock > 0) {
      lines.push({
        merchandiseId: serviceVariant.id,
        quantity,
        attributes: [
          { key: 'Monogram', value: check.text },
          { key: 'Monogram for', value: variant.id },
          { key: 'Monogram placement', value: check.placement || '' }
        ]
      });
    } else {
      // no service product in the store → honest free-note mode
      lines[0].attributes = [{ key: 'Monogram', value: check.text }];
    }
  }
  return { lines, product, variant, monogrammed: !!wantsMonogram };
}

/**
 * Add one piece (plus its monogram service line, if personalised).
 *
 * The add is serialised per cart (locks.withLock): reading the cart, merging
 * lines and writing them back is a read-modify-write, and parallel requests
 * must not interleave inside it.
 */
async function addItem(req, res, variantId, quantity = 1, options = {}) {
  const qty = Math.max(1, Math.min(MAX_QTY_PER_LINE, Number(quantity) || 1));
  const built = await buildLines(variantId, qty, options);
  if (built.error) return { ok: false, error: built.error, field: built.field };

  const lockKey = getCartId(req) || locks.sessionKey(req) || 'anon';
  return locks.withLock(lockKey, async () => {
    const cartId = await ensureCart(req, res);
    if (!cartId) {
      const result = await cartApi.createCart(built.lines);
      if (!result.ok) return { ...result, error: friendlyCartError(result.error) };
      setCartIdCookie(res, result.cart.id, req);
      locks.rememberCart(locks.sessionKey(req), result.cart.id, req);
      return { ok: true, monogrammed: built.monogrammed, cart: displayCart(result.cart) };
    }

    const result = await mergeLinesIntoCart(cartId, built.lines);
    if (!result.ok) return { ...result, error: friendlyCartError(result.error) };
    return { ok: true, monogrammed: built.monogrammed, cart: displayCart(result.cart) };
  });
}

/**
 * Shopify keeps every cartLinesAdd call as its own line; merge identical
 * lines (same variant + same attributes) into a quantity update instead, so
 * adding the same monogrammed piece twice yields one line.
 */
async function mergeLinesIntoCart(cartId, newLines) {
  const existing = await cartApi.getCart(cartId);
  // normalized cart lines carry attributes as an object map ({key: value})
  const keyOf = line => {
    const attrs = line.attributes || {};
    const pairs = Array.isArray(attrs) ? attrs.map(a => [a.key, a.value]) : Object.entries(attrs);
    return `${line.merchandiseId}::${JSON.stringify(pairs.sort())}`;
  };
  const updates = [];
  const additions = [];
  for (const line of newLines) {
    const found = (existing ? existing.lines : []).find(l => keyOf(l) === keyOf(line));
    if (found) updates.push({ id: found.id, quantity: Math.min(20, found.quantity + line.quantity) });
    else additions.push(line);
  }
  let result = { ok: true, cart: existing };
  if (updates.length) result = await cartApi.updateLines(cartId, updates);
  if (result.ok && additions.length) result = await cartApi.addLines(cartId, additions);
  if (!result.ok) return result;
  const fresh = await cartApi.getCart(cartId);
  return { ok: true, cart: fresh || result.cart };
}

/**
 * Add several pieces at once ("add the whole look"). Independent failures.
 *
 * The cart id is resolved once and threaded through every item: the cookie we
 * set on the first create only lands on the *response*, so re-reading the
 * request cookie per item would spawn a fresh cart per piece.
 */
async function addItems(req, res, items = []) {
  const list = Array.isArray(items) ? items.slice(0, 12) : [];
  const added = [];
  const failed = [];
  const builtLines = [];
  for (const item of list) {
    if (!item || !item.variantId) { failed.push({ variantId: item && item.variantId, error: 'Missing variant.' }); continue; }
    const qty = Math.max(1, Math.min(MAX_QTY_PER_LINE, Number(item.quantity) || 1));
    const built = await buildLines(item.variantId, qty, { personalization: item.personalization });
    if (built.error) { failed.push({ variantId: item.variantId, error: built.error }); continue; }
    builtLines.push(...built.lines);
    added.push(item.variantId);
  }
  if (!builtLines.length) {
    return { ok: false, added: 0, failed, cart: await getDisplayCartFor(req, res) };
  }

  const lockKey = getCartId(req) || locks.sessionKey(req) || 'anon';
  return locks.withLock(lockKey, async () => {
    const cartId = await ensureCart(req, res);
    let result;
    if (!cartId) {
      result = await cartApi.createCart(builtLines);
      if (result.ok) {
        setCartIdCookie(res, result.cart.id, req);
        locks.rememberCart(locks.sessionKey(req), result.cart.id, req);
      }
    } else {
      result = await mergeLinesIntoCart(cartId, builtLines);
    }
    if (!result.ok) {
      return { ok: false, added: 0, failed: failed.concat([{ error: friendlyCartError(result.error) }]), cart: await getDisplayCartFor(req, res) };
    }
    return { ok: true, added: added.length, failed, cart: displayCart(result.cart) };
  });
}

async function updateItem(req, res, lineId, quantity) {
  const cartId = getCartId(req);
  if (!cartId) return { ok: false, error: 'Item not in cart.' };
  return locks.withLock(cartId, async () => {
    const cart = await cartApi.getCart(cartId);
    if (!cart) return { ok: false, error: 'Item not in cart.' };
    const display = displayCart(cart);
    const line = display.lines.find(l => l.id === lineId);
    if (!line) return { ok: false, error: 'Item not in cart.' };

    const qty = Number(quantity) || 0;
    if (qty <= 0) return removeItem(req, res, lineId);
    const clamped = Math.min(MAX_QTY_PER_LINE, qty);

    const updates = [{ id: line.id, quantity: clamped }];
    if (line.serviceLineId) updates.push({ id: line.serviceLineId, quantity: clamped });
    const result = await cartApi.updateLines(cartId, updates);
    if (!result.ok) return { ...result, error: friendlyCartError(result.error) };
    return { ok: true, cart: displayCart(result.cart) };
  });
}

async function removeItem(req, res, lineId) {
  const cartId = getCartId(req);
  if (!cartId) return { ok: false, error: 'Item not in cart.' };
  return locks.withLock(cartId, async () => {
    const cart = await cartApi.getCart(cartId);
    if (!cart) return { ok: false, error: 'Item not in cart.' };
    const display = displayCart(cart);
    const line = display.lines.find(l => l.id === lineId);
    if (!line) return { ok: false, error: 'Item not in cart.' };

    const ids = [line.id];
    if (line.serviceLineId) ids.push(line.serviceLineId);
    const result = await cartApi.removeLines(cartId, ids);
    if (!result.ok) return { ...result, error: friendlyCartError(result.error) };
    return { ok: true, cart: displayCart(result.cart) };
  });
}

async function applyDiscount(req, res, code) {
  const cartId = getCartId(req);
  if (!cartId) return { ok: false, error: 'Your cart is empty.' };
  return locks.withLock(cartId, async () => {
    if (!code) {
      const result = await cartApi.setDiscountCode(cartId, '');
      if (!result.ok) return { ...result, error: friendlyCartError(result.error) };
      return { ok: true, cleared: true, cart: displayCart(result.cart) };
    }
    const result = await cartApi.setDiscountCode(cartId, code);
    if (!result.ok) return { ...result, error: friendlyCartError(result.error) };
    return { ok: true, cart: displayCart(result.cart), code: String(code).trim().toUpperCase() };
  });
}

async function setNotes(req, res, { giftNote, note }) {
  const cartId = getCartId(req);
  if (!cartId) return { ok: false, error: 'Your cart is empty.' };
  return locks.withLock(cartId, async () => {
    const cart = await cartApi.getCart(cartId);
    if (!cart) return { ok: false, error: 'Your cart is empty.' };
    const current = parseNotes(cart.note);
    const nextGift = giftNote !== undefined ? String(giftNote).slice(0, 400) : current.giftNote;
    const nextNote = note !== undefined ? String(note).slice(0, 400) : current.note;
    const result = await cartApi.setNote(cartId, composeNotes(nextGift, nextNote));
    if (!result.ok) return { ...result, error: friendlyCartError(result.error) };
    return { ok: true, cart: displayCart(result.cart) };
  });
}

/**
 * Checkout handoff: the Shopify-hosted checkout URL for this cart.
 *
 * cartIdHint covers buy-now flows where the cart cookie was only just set on
 * the response and cannot be read back from the same request.
 *
 * The URL is allowlisted before it is ever used for a redirect: checkout must
 * go to Shopify, so a tampered or unexpected cart payload can never turn this
 * route into an open redirect.
 */
async function checkoutUrlFor(req, cartIdHint = null) {
  const cartId = cartIdHint || getCartId(req);
  if (!cartId) return null;
  const url = await cartApi.checkoutUrl(cartId);
  if (!url) return null;
  const cfg = getConfigSafe();
  if (!security.isAllowedCheckoutUrl(url, cfg)) {
    console.error('[checkout] refusing to redirect to a non-Shopify checkout URL:', url);
    return null;
  }
  return url;
}

function getConfigSafe() {
  try { return require('./shopify/config').getConfig(); } catch { return {}; }
}

module.exports = {
  CART_COOKIE, MAX_QTY_PER_LINE,
  getCartId, setCartIdCookie, clearCartIdCookie,
  getDisplayCartFor, displayCart, displayCartFor: getDisplayCartFor,
  addItem, addItems, updateItem, removeItem, applyDiscount, setNotes,
  checkoutUrlFor, buildLines, friendlyCartError
};
