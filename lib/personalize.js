'use strict';
/**
 * personalize.js — monogramming / engraving add-ons.
 *
 * Borrowed from the way NAADAM sells monogrammed cashmere: a paid, optional
 * personalisation that is attached to a single line item rather than to a whole
 * product. The rules live here so the storefront, the API, the cart and the
 * order pipeline all read the same configuration, and so a client can never
 * invent its own price or exceed the character limit.
 *
 * A product opts in with `product.personalization = { enabled: true, ... }`.
 * Store-wide defaults live in `settings.personalization`. Later wins, so a
 * product can override price, placement or character limit.
 */

const store = require('./store');

const DEFAULTS = {
  enabled: false,
  type: 'monogram',
  label: 'Monogramming',
  price: 2000,           // cents, added per unit
  maxChars: 3,
  minChars: 1,
  placement: 'Left cuff',
  caseMode: 'upper',      // 'upper' | 'as-entered'
  allowSpaces: false,
  note: 'Monogrammed pieces are personalised for you and cannot be returned.'
};

/** Longer store-wide copy, kept out of the defaults table so it stays editable. */
const COPY = {
  heading: 'Make it yours',
  subheading: 'Three characters, stitched in our Brooklyn studio.',
  turnaround: 'Adds 2–3 days to dispatch',
  preview: 'Preview'
};

function settingsDefaults() {
  const db = store.getDb();
  return (db && db.settings && db.settings.personalization) || {};
}

/**
 * Resolve the effective personalisation config for a product, or null when the
 * product does not offer it. Never throws — callers treat null as "not offered".
 */
function configFor(product) {
  if (!product || !product.personalization) return null;
  const merged = { ...DEFAULTS, ...settingsDefaults(), ...product.personalization };
  if (!merged.enabled) return null;
  const price = Number(merged.price);
  const maxChars = Number(merged.maxChars);
  return {
    ...merged,
    price: Number.isFinite(price) && price >= 0 ? Math.round(price) : DEFAULTS.price,
    maxChars: Number.isFinite(maxChars) && maxChars > 0 ? Math.min(12, Math.round(maxChars)) : DEFAULTS.maxChars,
    copy: COPY
  };
}

/**
 * Strip anything that will not stitch cleanly and normalise case. Punctuation
 * is dropped rather than rejected so typing stays forgiving; over-long input is
 * NOT truncated here — the caller decides whether to flag it or preview it.
 */
function clean(text, config) {
  let out = String(text == null ? '' : text);
  out = out.replace(/[^\p{L}\p{N}.&'\- ]/gu, '');
  if (!(config && config.allowSpaces)) out = out.replace(/\s+/g, ' ');
  out = out.replace(/\s{2,}/g, ' ').trim();
  if (!config || config.caseMode !== 'as-entered') out = out.toUpperCase();
  return out;
}

/**
 * Display/preview form: cleaned and hard-capped, for as-you-type feedback where
 * a visible character counter makes the limit obvious.
 */
function sanitize(text, config) {
  const limit = (config && config.maxChars) || DEFAULTS.maxChars;
  return clean(text, config).slice(0, limit);
}

/**
 * Validate a requested monogram against a product.
 * Returns { ok, text, price, error } — never throws.
 */
function validate(product, requested) {
  const config = configFor(product);
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
  // never quietly shorten what someone asked to have stitched
  if (trimmed.length > config.maxChars) {
    return { ok: false, error: `Monograms are limited to ${config.maxChars} characters — “${trimmed}” is ${trimmed.length}.` };
  }
  if (trimmed.length < config.minChars) {
    return { ok: false, error: `Monograms need at least ${config.minChars} characters.` };
  }
  const text = trimmed;
  return {
    ok: true,
    text,
    price: config.price,
    label: config.label,
    placement: config.placement,
    note: config.note,
    turnaround: config.copy.turnaround
  };
}

/** Attach a validated monogram to a cart line (mutates the line). */
function applyToLine(line, product, requested) {
  const result = validate(product, requested);
  if (!result.ok) {
    line.personalization = null;
    return result;
  }
  line.personalization = {
    text: result.text,
    price: result.price,
    label: result.label,
    placement: result.placement,
    note: result.note
  };
  return result;
}

/** Price of a line's monogram, re-read from the live config so it can never go stale. */
function priceForLine(line, product) {
  if (!line || !line.personalization || !line.personalization.text) return 0;
  const config = configFor(product);
  if (!config) { line.personalization = null; return 0; }
  line.personalization.price = config.price;
  line.personalization.label = config.label;
  line.personalization.placement = config.placement;
  return config.price;
}

/** Human label used in carts, orders, emails and packing slips. */
function describe(line) {
  if (!line || !line.personalization || !line.personalization.text) return '';
  return `${line.personalization.label || DEFAULTS.label}: ${line.personalization.text}`;
}

module.exports = { DEFAULTS, COPY, configFor, clean, sanitize, validate, applyToLine, priceForLine, describe };
