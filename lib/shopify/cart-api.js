'use strict';
/**
 * cart-api.js — Shopify cart operations used by the storefront.
 *
 * The browser never talks to Shopify directly: the Node server holds the cart
 * id in an HttpOnly cookie and proxies every mutation through here, so the
 * storefront stays server-authoritative while Shopify owns the actual cart,
 * pricing, discounts and checkout.
 */
const { gql, mutationResult } = require('./client');
const ops = require('./operations');
const N = require('./normalize');

async function getCart(cartId) {
  if (!cartId) return null;
  const data = await gql(ops.GET_CART, { id: cartId });
  return N.normalizeCart(data.cart);
}

async function createCart(lines = [], note = '') {
  const input = { lines };
  if (note) input.note = note;
  const data = await gql(ops.CART_CREATE, { input });
  const result = mutationResult(data, 'cartCreate');
  if (!result.ok) return result;
  return { ok: true, cart: N.normalizeCart(result.cart) };
}

async function addLines(cartId, lines) {
  const data = await gql(ops.CART_LINES_ADD, { cartId, lines });
  const result = mutationResult(data, 'cartLinesAdd');
  if (!result.ok) return result;
  return { ok: true, cart: N.normalizeCart(result.cart) };
}

/**
 * Address a cart line for a mutation.
 *
 * 2026-07 lets `cartLinesUpdate`/`cartLinesRemove` take a `viewKey` instead of
 * the line `id`, and the two are mutually exclusive — so send the `id` when we
 * have it and fall back to the `viewKey` (a cart fetched from a cache or a
 * stale page can carry a viewKey whose id Shopify no longer recognises).
 */
function lineRef(line) {
  if (!line) return {};
  if (line.id) return { id: line.id };
  if (line.viewKey) return { viewKey: line.viewKey };
  return {};
}

async function updateLines(cartId, lines) {
  const data = await gql(ops.CART_LINES_UPDATE, {
    cartId,
    lines: (lines || []).map(l => ({ ...lineRef(l), quantity: l.quantity, attributes: l.attributes }))
  });
  const result = mutationResult(data, 'cartLinesUpdate');
  if (!result.ok) return result;
  return { ok: true, cart: N.normalizeCart(result.cart) };
}

/**
 * Remove lines. Accepts either line ids or view keys (never both for the same
 * line) and routes each reference to the matching input field.
 */
async function removeLines(cartId, refs) {
  const list = Array.isArray(refs) ? refs : [refs];
  const lineIds = [];
  const viewKeys = [];
  for (const ref of list) {
    if (ref == null) continue;
    if (typeof ref === 'string') { lineIds.push(ref); continue; }
    if (ref.viewKey && !ref.id) viewKeys.push(ref.viewKey);
    else if (ref.id) lineIds.push(ref.id);
    else if (ref.viewKey) viewKeys.push(ref.viewKey);
  }
  const data = await gql(ops.CART_LINES_REMOVE, { cartId, lineIds, viewKeys });
  const result = mutationResult(data, 'cartLinesRemove');
  if (!result.ok) return result;
  return { ok: true, cart: N.normalizeCart(result.cart) };
}

/**
 * Apply or clear a discount code. Shopify validates the code; an inapplicable
 * code comes back as a userError which we surface verbatim.
 */
async function setDiscountCode(cartId, code) {
  const codes = code ? [String(code).trim().toUpperCase()] : [];
  const data = await gql(ops.CART_DISCOUNT_CODES_UPDATE, { cartId, discountCodes: codes });
  const result = mutationResult(data, 'cartDiscountCodesUpdate');
  if (!result.ok) return result;
  const cart = N.normalizeCart(result.cart);
  if (code && !cart.discountCodes.some(d => d.code === codes[0])) {
    return { ok: false, error: `“${codes[0]}” can’t be applied to this cart.`, cart };
  }
  return { ok: true, cart };
}

async function setNote(cartId, note) {
  const data = await gql(ops.CART_NOTE_UPDATE, { cartId, note });
  const result = mutationResult(data, 'cartNoteUpdate');
  if (!result.ok) return result;
  return { ok: true, cart: N.normalizeCart(result.cart) };
}

/** The Shopify-hosted checkout URL for the current cart. */
async function checkoutUrl(cartId) {
  const cart = await getCart(cartId);
  return cart && cart.checkoutUrl ? cart.checkoutUrl : null;
}

module.exports = {
  getCart, createCart, addLines, updateLines, removeLines,
  setDiscountCode, setNote, checkoutUrl
};
