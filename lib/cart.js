'use strict';
/**
 * cart.js — server-authoritative cart. Prices, stock and totals are always
 * recomputed on the server; the browser only ever sends variant ids + qty.
 */
const crypto = require('crypto');
const store = require('./store');
const commerce = require('./commerce');
const auth = require('./auth');
const personalize = require('./personalize');

const CART_COOKIE = 'vnx_cart';

function newCartId() { return `crt_${crypto.randomBytes(10).toString('hex')}`; }

function getOrCreateCart(req, res, { create = true } = {}) {
  const cookies = auth.parseCookies(req);
  let id = cookies[CART_COOKIE];
  let cart = id ? store.find('carts', c => c.id === id) : null;
  if (!cart && create) {
    id = newCartId();
    cart = store.insert('carts', {
      id, items: [], email: null, status: 'active', giftNote: '', note: '',
      discountCode: null, shippingMethod: 'standard', country: 'United States',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    if (res) auth.appendCookie(res, auth.serializeCookie(CART_COOKIE, id, { maxAge: 60 * 60 * 24 * 60, httpOnly: true, sameSite: 'Lax' }));
  }
  return cart;
}

function getCart(req) {
  const cookies = auth.parseCookies(req);
  const id = cookies[CART_COOKIE];
  return id ? store.find('carts', c => c.id === id) : null;
}

function productFor(variantId) {
  const products = store.all('products');
  for (const p of products) {
    const v = p.variants.find(x => x.id === variantId);
    if (v) return { product: p, variant: v };
  }
  return null;
}

function lineTotal(line, product, variant) {
  return variant.price * line.quantity;
}

/**
 * Merge key for a cart line. Two hoodies in Navy / M are one line, but a
 * monogrammed one is never merged into the blank one — the personalisation is
 * part of what the line *is*.
 */
function lineKey(variantId, personalization) {
  const text = personalization && personalization.text ? personalize.sanitize(personalization.text, { maxChars: 12 }) : '';
  return `${variantId}::${text}`;
}

function addItem(cart, variantId, quantity = 1, options = {}) {
  const found = productFor(variantId);
  if (!found) return { ok: false, error: 'That product is no longer available.' };
  const { product, variant } = found;
  if (variant.stock <= 0) return { ok: false, error: `${product.title} in ${variant.color} / ${variant.size} is sold out.` };

  // personalisation is validated against the product's own rules — the client
  // can send a string, an object, or nothing at all
  let personalization = null;
  const wantsMonogram = options && options.personalization && (options.personalization.text || typeof options.personalization === 'string');
  if (wantsMonogram) {
    const check = personalize.validate(product, options.personalization);
    if (!check.ok) return { ok: false, error: check.error, field: 'personalization' };
    personalization = {
      text: check.text, price: check.price, label: check.label,
      placement: check.placement, note: check.note
    };
  }

  const key = lineKey(variantId, personalization);
  const existing = cart.items.find(i => lineKey(i.variantId, i.personalization) === key);
  const qty = Math.max(1, Math.min(20, Number(quantity) || 1));
  if (existing) {
    const next = Math.min(existing.quantity + qty, variant.stock, 20);
    if (next === existing.quantity) return { ok: false, error: `Only ${variant.stock} left in that size.` };
    existing.quantity = next;
    existing.updatedAt = new Date().toISOString();
  } else {
    cart.items.push({
      id: `li_${crypto.randomBytes(6).toString('hex')}`,
      productId: product.id, handle: product.handle, title: product.title,
      variantId, sku: variant.sku, color: variant.color, size: variant.size,
      quantity: Math.min(qty, variant.stock),
      personalization,
      addedAt: new Date().toISOString()
    });
  }
  cart.updatedAt = new Date().toISOString();
  store.save();
  return { ok: true, monogrammed: !!personalization };
}

/**
 * Add several lines in one request — used by "add the whole look" and by the
 * quick-add bundles. Each item is independent: one sold-out piece does not
 * discard the rest of the basket.
 */
function addItems(cart, items = []) {
  const added = [];
  const failed = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.variantId) { failed.push({ variantId: item && item.variantId, error: 'Missing variant.' }); continue; }
    const result = addItem(cart, item.variantId, item.quantity || 1, { personalization: item.personalization });
    if (result.ok) added.push(item.variantId);
    else failed.push({ variantId: item.variantId, error: result.error });
  }
  return { ok: added.length > 0, added: added.length, failed };
}

function updateItem(cart, lineId, quantity) {
  const line = cart.items.find(i => i.id === lineId);
  if (!line) return { ok: false, error: 'Item not in cart.' };
  const qty = Number(quantity) || 0;
  if (qty <= 0) return removeItem(cart, lineId);
  const found = productFor(line.variantId);
  const max = found ? found.variant.stock : 0;
  if (qty > max) return { ok: false, error: max ? `Only ${max} left in stock.` : 'That size just sold out.', max };
  line.quantity = Math.min(qty, 20);
  cart.updatedAt = new Date().toISOString();
  store.save();
  return { ok: true };
}

function removeItem(cart, lineId) {
  const idx = cart.items.findIndex(i => i.id === lineId);
  if (idx === -1) return { ok: false, error: 'Item not in cart.' };
  cart.items.splice(idx, 1);
  cart.updatedAt = new Date().toISOString();
  store.save();
  return { ok: true };
}

function applyDiscount(cart, code) {
  if (!code) { cart.discountCode = null; store.save(); return { ok: true, cleared: true }; }
  const normalized = String(code).trim().toUpperCase();
  const discount = store.find('discounts', d => d.code === normalized);
  const subtotal = subtotalOf(cart).subtotal;
  const result = commerce.evaluateDiscount(discount, subtotal);
  if (!result.valid) return { ok: false, error: result.reason };
  cart.discountCode = normalized;
  store.save();
  return { ok: true, discount: result };
}

function subtotalOf(cart) {
  let subtotal = 0, count = 0, compareTotal = 0;
  for (const line of cart.items) {
    const found = productFor(line.variantId);
    if (!found) continue;
    const { product, variant } = found;
    // monogram pricing is re-read from the live product config on every pass,
    // so a catalogue edit can never leave a stale add-on price in a cart
    const persPrice = personalize.priceForLine(line, product);
    line.unitPrice = variant.price + persPrice;
    line.price = line.unitPrice;
    line.compareAtPrice = variant.compareAtPrice || null;
    line.title = product.title;
    line.image = product.images[0] ? product.images[0].src : variant.image;
    line.url = `/products/${product.handle}`;
    line.stock = variant.stock;
    line.vendor = product.vendor;
    subtotal += (variant.price + persPrice) * line.quantity;
    compareTotal += (variant.compareAtPrice || variant.price) * line.quantity;
    if (persPrice) line.personalized = true;
    count += line.quantity;
  }
  return { subtotal, count, savings: Math.max(0, compareTotal - subtotal) };
}

/** The single source of truth for a cart's money. */
function computeCart(cart, { shippingMethod, country, province } = {}) {
  const settings = store.getDb().settings;
  const { subtotal, count, savings } = subtotalOf(cart);
  let discount = null;
  if (cart.discountCode) {
    const d = store.find('discounts', x => x.code === cart.discountCode);
    const evaluated = commerce.evaluateDiscount(d, subtotal);
    if (evaluated.valid) discount = evaluated; else cart.discountCode = null;
  }
  const allDigital = cart.items.length > 0 && cart.items.every(line => {
    const found = productFor(line.variantId);
    return found && found.product.digital;
  });
  const discountAmount = discount ? discount.amount : 0;
  let method = shippingMethod || cart.shippingMethod || 'standard';
  if (allDigital) method = 'digital';
  const shipCountry = country || cart.country || 'United States';
  const shipProvince = province || cart.province || settings.address.province;
  const shippingOptions = commerce.shippingOptions(subtotal - discountAmount, shipCountry, { digital: allDigital });
  let shippingAmount = commerce.shippingCost(method, subtotal - discountAmount, shipCountry, { digital: allDigital });
  if (discount && discount.freeshipping) shippingAmount = 0;
  const taxable = Math.max(0, subtotal - discountAmount) + shippingAmount;
  let tax = { name: 'Estimated tax', rate: 0, amount: 0 };
  if (subtotal > 0 && !allDigital) tax = commerce.taxFor({ province: shipProvince, country: shipCountry }, taxable);
  else if (subtotal > 0) tax = commerce.taxFor({ province: shipProvince, country: shipCountry }, taxable);
  const total = Math.max(0, subtotal - discountAmount) + shippingAmount + tax.amount;
  const threshold = settings.freeShippingThreshold;
  const lines = cart.items.map(line => {
    const found = productFor(line.variantId);
    return { ...line, productHandle: found ? found.product.handle : null, productImage: found && found.product.images[0] ? found.product.images[0].src : null, digital: !!(found && found.product.digital) };
  });
  return {
    id: cart.id,
    lines,
    count,
    subtotal,
    savings,
    discount,
    discountAmount,
    digital: allDigital,
    shipping: { method, amount: shippingAmount, label: (shippingOptions.find(o => o.id === method) || {}).label || 'Standard' },
    shippingOptions,
    tax,
    total,
    freeShipping: { threshold, remaining: Math.max(0, threshold - (subtotal - discountAmount)), qualified: subtotal - discountAmount >= threshold && threshold > 0 },
    giftNote: cart.giftNote || '',
    note: cart.note || '',
    email: cart.email || null,
    currency: settings.currency
  };
}

function markRecovered(cart, orderId) {
  cart.status = 'converted';
  cart.orderId = orderId;
  store.save();
}

module.exports = {
  CART_COOKIE, getOrCreateCart, getCart, addItem, addItems, lineKey, updateItem, removeItem,
  applyDiscount, computeCart, subtotalOf, productFor, newCartId, markRecovered
};
