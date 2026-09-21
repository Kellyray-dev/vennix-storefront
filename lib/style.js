'use strict';
/**
 * style.js — "Style it with" / shop-the-look.
 *
 * NAADAM answers the "what do I wear this with?" question on the product page
 * with a styled rail you can buy from directly. This is the same idea: pair a
 * piece with the types it is actually worn with, prefer things in the same
 * collection, and never pad the rail with irrelevant stock.
 *
 * The rail is deliberately small (two or three pieces) and only ever shows
 * things that are in stock, because a styling rail full of sold-out items is
 * worse than no rail at all.
 */

const store = require('./store');
const commerce = require('./commerce');

/** Types that get worn together, ordered by how natural the pairing is. */
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

const FALLBACK = ['Hoodie', 'T-Shirt', 'Joggers', 'Leggings', 'Shorts'];

function inStock(product) {
  return (product.inventoryQuantity || 0) > 0;
}

/**
 * Rank the catalogue as styling partners for a product.
 * Score: complementary type first, then shared collection, then how well it
 * sells. Sold-out items and gift cards only appear as a last resort.
 */
function rank(product, products = store.all('products')) {
  const wanted = PAIRS[product.type] || FALLBACK;
  const scored = products
    .filter(p => p.handle !== product.handle && !p.digital)
    .map(p => {
      const typeRank = wanted.indexOf(p.type);
      const shared = (p.collections || []).filter(c => (product.collections || []).includes(c)).length;
      let score = 0;
      if (typeRank > -1) score += 60 - typeRank * 8;
      score += shared * 6;
      if (inStock(p)) score += 25; else score -= 40;
      score += Math.min(10, Math.round((p.rating.count || 0) / 2));
      if (p.compareAtPrice && p.compareAtPrice > p.price) score += 4;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.map(s => s.p);
}

function lookFor(product, limit = 3) {
  const ranked = rank(product);
  const picked = [];
  const usedTypes = new Set([product.type]);
  // first pass: one piece per complementary type, so the rail is not three tees
  for (const p of ranked) {
    if (picked.length >= limit) break;
    if (usedTypes.has(p.type)) continue;
    if (!inStock(p)) continue;
    picked.push(p);
    usedTypes.add(p.type);
  }
  // second pass: fill any remaining slots from the ranking, whatever the type
  for (const p of ranked) {
    if (picked.length >= limit) break;
    if (picked.includes(p)) continue;
    if (!inStock(p)) continue;
    picked.push(p);
  }
  return picked;
}

/**
 * Bundle maths for the rail. We only ever quote a saving the store genuinely
 * offers — every candidate code is run through the same discount engine the
 * cart uses — and we say plainly when there is nothing to save.
 */
function bundleFor(items, subtotal) {
  if (!items || items.length < 2) {
    return { discount: null, message: null };
  }
  const candidates = store.all('discounts')
    .filter(d => d.active !== false && (d.type === 'percent' || d.type === 'fixed'))
    .map(d => ({ d, evaluated: commerce.evaluateDiscount(d, subtotal) }))
    .filter(x => x.evaluated.valid && x.evaluated.amount > 0)
    .sort((a, b) => b.evaluated.amount - a.evaluated.amount);

  if (!candidates.length) {
    return { discount: null, message: 'No bundle code applies to this combination — you pay the sum of the pieces.' };
  }
  const best = candidates[0];
  return {
    code: best.d.code,
    label: best.evaluated.label,
    amount: best.evaluated.amount,
    message: `${best.d.code} applies to this look at checkout — ${best.evaluated.label}.`
  };
}

module.exports = { lookFor, rank, PAIRS, bundleFor };
