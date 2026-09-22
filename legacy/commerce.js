'use strict';
/**
 * commerce.js — pricing, discounts, shipping, tax, mock payment gateway
 * and transactional email rendering. All money is handled in integer cents.
 */
const store = require('./store');

const TAX_RATES = {
  NJ: 0.06625, NY: 0.08875, PA: 0.06, CA: 0.0725, TX: 0.0625, FL: 0.06,
  IL: 0.0625, MA: 0.0625, WA: 0.065, CO: 0.029, GA: 0.04, NC: 0.0475,
  OH: 0.0575, MI: 0.06, VA: 0.043, AZ: 0.056, OR: 0, MT: 0, NH: 0, DE: 0
};

const TAX_NAMES = {
  NJ: 'New Jersey Sales Tax', NY: 'New York Sales Tax', PA: 'Pennsylvania Sales Tax',
  CA: 'California Sales Tax', TX: 'Texas Sales Tax', FL: 'Florida Sales Tax',
  IL: 'Illinois Sales Tax', MA: 'Massachusetts Sales Tax', WA: 'Washington Sales Tax',
  CO: 'Colorado Sales Tax', GA: 'Georgia Sales Tax', NC: 'North Carolina Sales Tax',
  OH: 'Ohio Sales Tax', MI: 'Michigan Sales Tax', VA: 'Virginia Sales Tax',
  AZ: 'Arizona Sales Tax', OR: 'No sales tax (OR)', MT: 'No sales tax (MT)',
  NH: 'No sales tax (NH)', DE: 'No sales tax (DE)'
};

const STATES = Object.keys(TAX_RATES).sort();

const SHIPPING_METHODS = [
  // freeOver is filled from settings.freeShippingThreshold at quote time, so the
  // shipping charge can never contradict the free-shipping promise in the cart
  { id: 'standard', label: 'Standard', detail: '4–6 business days', price: 695, freeOver: 'settings' },
  { id: 'express', label: 'Express', detail: '2–3 business days', price: 1495, freeOver: null },
  { id: 'overnight', label: 'Overnight', detail: 'Next business day if ordered by 2pm', price: 2495, freeOver: null },
  { id: 'pickup', label: 'Studio pickup', detail: 'Ready in 2 hours · Brooklyn, NY', price: 0, freeOver: null }
];

const DIGITAL_METHOD = { id: 'digital', label: 'Digital delivery', detail: 'Emailed within minutes — no shipping needed', price: 0, freeOver: null };

function money(cents, currency = 'USD') {
  const n = (Math.round(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${n} ${currency}`;
}

function round(n) { return Math.round(n); }

function clip(n, min, max) { return Math.max(min, Math.min(max, n)); }

/* ------------------------------- discounts ------------------------------- */
function evaluateDiscount(discount, subtotal) {
  if (!discount || discount.active === false) return { valid: false, reason: 'This discount code is not valid.' };
  const now = Date.now();
  if (discount.startsAt && Date.parse(discount.startsAt) > now) return { valid: false, reason: 'This discount is not active yet.' };
  if (discount.endsAt && Date.parse(discount.endsAt) < now) return { valid: false, reason: 'This discount has expired.' };
  if (discount.usageLimit && (discount.used || 0) >= discount.usageLimit) return { valid: false, reason: 'This discount has reached its usage limit.' };
  if (discount.minSubtotal && subtotal < discount.minSubtotal) {
    return { valid: false, reason: `Add ${money(discount.minSubtotal - subtotal)} more to use ${discount.code}.` };
  }
  let amount = 0;
  if (discount.type === 'percent') amount = round(subtotal * (discount.value / 100));
  else if (discount.type === 'fixed') amount = Math.min(discount.value, subtotal);
  else if (discount.type === 'shipping') amount = 0;
  return {
    valid: true, code: discount.code, type: discount.type, value: discount.value,
    amount: discount.type === 'shipping' ? 0 : amount,
    freeshipping: discount.type === 'shipping',
    label: discount.type === 'percent' ? `${discount.value}% off` : discount.type === 'fixed' ? `${money(discount.value)} off` : 'Free shipping'
  };
}

/* -------------------------------- shipping -------------------------------- */
function shippingOptions(subtotal, country = 'US', { digital = false } = {}) {
  if (digital) return [{ ...DIGITAL_METHOD, originalPrice: 0, isFree: true }];
  const threshold = (store.getDb().settings || {}).freeShippingThreshold || 0;
  return SHIPPING_METHODS.map(m => {
    if (country !== 'US' && m.id === 'pickup') return null;
    const freeOver = m.freeOver === 'settings' ? threshold : m.freeOver;
    const free = freeOver && freeOver > 0 && subtotal >= freeOver;
    return { ...m, freeOver, price: free ? 0 : m.price, originalPrice: m.price, isFree: !!free };
  }).filter(Boolean);
}

function shippingCost(method, subtotal, country = 'US', opts = {}) {
  const options = shippingOptions(subtotal, country, opts);
  const opt = options.find(o => o.id === method) || options[0];
  return opt ? opt.price : SHIPPING_METHODS[0].price;
}

/* ---------------------------------- tax ---------------------------------- */
function taxFor(address, taxableAmount) {
  const state = (address && address.province) || 'NJ';
  const country = (address && address.country) || 'United States';
  if (country !== 'United States' && country !== 'US') return { rate: 0, amount: 0, name: 'Export — duties calculated at delivery' };
  if (TAX_RATES[state] === undefined) {
    // Unknown US state/territory: do not silently charge 6% — default to 0 so
    // we never over-collect tax, and surface the state code in the label so
    // the merchant can add it.
    return { rate: 0, amount: 0, name: `Tax (${state}) — not configured`, state };
  }
  return { rate: TAX_RATES[state], amount: round(taxableAmount * TAX_RATES[state]), name: TAX_NAMES[state], state };
}

/* -------------------------------- payments -------------------------------- */
const TEST_CARDS = {
  '4242424242424242': { outcome: 'approved', brand: 'visa' },
  '5555555555554444': { outcome: 'approved', brand: 'mastercard' },
  '378282246310005': { outcome: 'approved', brand: 'amex' },
  '6011111111111117': { outcome: 'approved', brand: 'discover' },
  '4000000000000002': { outcome: 'declined', brand: 'visa', reason: 'Your card was declined.' },
  '4000000000009995': { outcome: 'declined', brand: 'visa', reason: 'Insufficient funds.' },
  '4000000000000069': { outcome: 'declined', brand: 'visa', reason: 'Expired card.' }
};

function luhn(number) {
  const digits = String(number).replace(/\D/g, '');
  if (digits.length < 12) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

function detectBrand(digits) {
  if (/^4/.test(digits)) return 'visa';
  if (/^5[1-5]/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^6(?:011|5)/.test(digits)) return 'discover';
  if (/^62/.test(digits)) return 'unionpay';
  return 'card';
}

function expiryValid(exp) {
  const m = String(exp || '').match(/^(\d{2})\s*\/?\s*(\d{2,4})$/);
  if (!m) return false;
  const month = Number(m[1]);
  const year = Number(m[2].length === 2 ? `20${m[2]}` : m[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

function authorize({ number, exp, cvv, name }) {
  const settings = (require('./store').getDb().settings || {}).payments || {};
  // Refuse real card numbers in sandbox mode except for the documented test
  // cards. This prevents operators from leaving the app in testMode and
  // accidentally "approving" real PANs without a real processor attached.
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return { ok: false, error: 'Enter a card number.' };
  if (settings.testMode && !TEST_CARDS[digits]) {
    return { ok: false, error: 'Sandbox mode — use test card 4242 4242 4242 4242 (or one of the documented decline cards).' };
  }
  if (!luhn(digits)) return { ok: false, error: 'That card number is not valid. Try 4242 4242 4242 4242.' };
  if (!expiryValid(exp)) return { ok: false, error: 'Check the expiry date (MM / YY).' };
  const brand = detectBrand(digits);
  const need = brand === 'amex' ? 4 : 3;
  if (String(cvv || '').replace(/\D/g, '').length !== need) return { ok: false, error: `Security code must be ${need} digits.` };
  if (!String(name || '').trim()) return { ok: false, error: 'Enter the name printed on the card.' };
  const test = TEST_CARDS[digits];
  if (test && test.outcome === 'declined') return { ok: false, error: test.reason, code: 'card_declined' };
  return {
    ok: true,
    brand,
    last4: digits.slice(-4),
    authCode: `${brand.slice(0, 3).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    network: TEST_CARDS[digits] ? 'test' : 'live-sandbox'
  };
}

/* --------------------------------- emails --------------------------------- */
function emailShell(title, body, settings = {}) {
  const brand = settings.brandName || 'Vennix';
  const addr = settings.address || {};
  const addressLine = [addr.line1, `${addr.city || ''}${addr.city && addr.province ? ', ' : ''}${addr.province || ''} ${addr.zip || ''}`.trim()].filter(Boolean).join(' · ');
  const supportEmail = settings.supportEmail || `support@${settings.domain || 'example.com'}`;
  const supportPhone = settings.supportPhone ? ` · ${settings.supportPhone}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
 body{margin:0;background:#F4F1EC;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#191614}
 .wrap{max-width:620px;margin:0 auto;padding:40px 24px}
 .card{background:#fff;border:1px solid #E4DFD6;border-radius:4px;overflow:hidden}
 .hd{padding:28px 32px;border-bottom:1px solid #E4DFD6;letter-spacing:.28em;font-size:13px;text-transform:uppercase}
 .bd{padding:32px}
 h1{font-family:Georgia,serif;font-size:26px;margin:0 0 16px;font-weight:400}
 table{width:100%;border-collapse:collapse;font-size:14px}
 td{padding:10px 0;border-bottom:1px solid #F0ECE4;vertical-align:top}
 .tot{font-weight:600}
 .ft{padding:24px 32px;color:#6E675E;font-size:12px;line-height:1.7}
 .btn{display:inline-block;background:#191614;color:#fff;text-decoration:none;padding:14px 22px;font-size:13px;letter-spacing:.16em;text-transform:uppercase}
</style></head><body><div class="wrap"><div class="card">
<div class="hd">${brand}</div><div class="bd">${body}</div>
<div class="ft">${brand}${addressLine ? ' · ' + addressLine : ''} · You are receiving this because you placed an order or have an account with us.<br>Questions? Reply to this email or write <a href="mailto:${supportEmail}" style="color:#191614">${supportEmail}</a>${supportPhone}</div>
</div></div></body></html>`;
}

module.exports = {
  TAX_RATES, TAX_NAMES, STATES, SHIPPING_METHODS, DIGITAL_METHOD,
  money, round, clip,
  evaluateDiscount, shippingOptions, shippingCost, taxFor,
  luhn, detectBrand, expiryValid, authorize, emailShell, TEST_CARDS
};
