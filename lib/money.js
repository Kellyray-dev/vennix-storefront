'use strict';
/**
 * money.js — money formatting. All storefront math stays in integer cents;
 * Shopify MoneyV2 decimals ({ amount: "128.00", currencyCode }) are converted
 * to cents once at the data-access edge (lib/shopify/normalize.js).
 */

function money(cents, currency = 'USD') {
  const n = (Math.round(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${n} ${currency}`;
}

/** Convert a Shopify MoneyV2 object to integer cents. */
function fromMoneyV2(moneyV2) {
  if (!moneyV2 || moneyV2.amount === undefined || moneyV2.amount === null) return null;
  return Math.round(parseFloat(moneyV2.amount) * 100);
}

function round(n) { return Math.round(n); }
function clip(n, min, max) { return Math.max(min, Math.min(max, n)); }

module.exports = { money, fromMoneyV2, round, clip };
