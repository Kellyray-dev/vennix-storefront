'use strict';
/**
 * personalize.js — monogramming rules for the storefront.
 *
 * Charging model (aligned with the OS 2.0 theme, Shopify-honest):
 *   - the fee lives on a real Shopify product (the "monogramming service"
 *     product, configured by settings.personalization.serviceProductHandle).
 *     When it exists in the store, the storefront adds it as its own priced
 *     line, so the customer is charged exactly what the button quoted;
 *   - when the store has no service product, monograms are recorded as a
 *     free line-item note and the UI drops the fee claim — we never
 *     advertise a charge Shopify cannot collect.
 *
 * The rules live here so the PDP, the API and the cart read one source.
 */

const settings = require('./settings');

const DEFAULTS = {
  enabled: false,
  label: 'Monogramming',
  price: 2000,           // cents — used only when no service product exists
  maxChars: 3,
  minChars: 1,
  placement: 'Left cuff',
  caseMode: 'upper',
  allowSpaces: false,
  note: 'Monogrammed pieces are personalised for you and cannot be returned.'
};

const COPY = {
  heading: 'Make it yours',
  subheading: 'Three characters, stitched in our Brooklyn studio.',
  turnaround: 'Adds 2–3 days to dispatch',
  preview: 'Preview'
};

function storeDefaults() {
  return settings.get().personalization || {};
}

/**
 * Resolve the effective personalization config for a product, or null when
 * the product does not offer it. Pass the live service product (when known)
 * so the quoted price always matches what Shopify will charge.
 */
function configFor(product, { serviceProduct = null } = {}) {
  if (!product || !product.personalization) return null;
  const merged = { ...DEFAULTS, ...storeDefaults(), ...product.personalization };
  if (!merged.enabled) return null;

  const serviceVariant = serviceProduct && serviceProduct.variants && serviceProduct.variants[0];
  const servicePrice = serviceVariant && Number.isFinite(serviceVariant.price) ? serviceVariant.price : null;
  const price = servicePrice !== null ? servicePrice : DEFAULTS.price;

  const maxChars = Number(merged.maxChars);
  return {
    ...merged,
    price,
    chargedVia: serviceVariant ? 'service-product' : 'note',
    maxChars: Number.isFinite(maxChars) && maxChars > 0 ? Math.min(12, Math.round(maxChars)) : DEFAULTS.maxChars,
    copy: COPY
  };
}

/** Strip anything that will not stitch cleanly and normalise case. */
function clean(text, config) {
  let out = String(text == null ? '' : text);
  out = out.replace(/[^\p{L}\p{N}.&'\- ]/gu, '');
  if (!(config && config.allowSpaces)) out = out.replace(/\s+/g, ' ');
  out = out.replace(/\s{2,}/g, ' ').trim();
  if (!config || config.caseMode !== 'as-entered') out = out.toUpperCase();
  return out;
}

/** Display/preview form: cleaned and hard-capped. */
function sanitize(text, config) {
  const limit = (config && config.maxChars) || DEFAULTS.maxChars;
  return clean(text, config).slice(0, limit);
}

/**
 * Validate a requested monogram against a product.
 * Returns { ok, text, price, error } — never throws.
 */
function validate(product, requested, { serviceProduct = null } = {}) {
  const config = configFor(product, { serviceProduct });
  if (!config) {
    if (requested && (requested.text || requested.remove)) {
      return { ok: false, error: 'This piece cannot be monogrammed.' };
    }
    return { ok: false, error: 'Personalisation is not available for this product.' };
  }
  const raw = requested && typeof requested === 'object' ? requested.text : requested;
  const trimmed = clean(raw, config);
  if (!trimmed) {
    return { ok: false, error: `Enter ${config.minChars === 1 ? 'a character' : `at least ${config.minChars} characters`} to monogram.` };
  }
  if (trimmed.length > config.maxChars) {
    return { ok: false, error: `Monograms are limited to ${config.maxChars} characters — “${trimmed}” is ${trimmed.length}.` };
  }
  if (trimmed.length < config.minChars) {
    return { ok: false, error: `Monograms need at least ${config.minChars} characters.` };
  }
  return {
    ok: true,
    text: trimmed,
    price: config.price,
    chargedVia: config.chargedVia,
    label: config.label,
    placement: config.placement,
    note: config.note,
    turnaround: config.copy.turnaround
  };
}

module.exports = { DEFAULTS, COPY, configFor, clean, sanitize, validate };
