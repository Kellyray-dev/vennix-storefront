'use strict';
/**
 * style.js — "Style it with" / shop-the-look.
 *
 * Pairs a piece with the types it is actually worn with, prefers pieces in
 * the same collection, and only ever shows things that are in stock. When
 * Shopify's productRecommendations are available they take priority
 * (lib/shopify/catalog.recommendations); this ranking is the deterministic
 * fallback and the filter that keeps the rail honest.
 *
 * Discount codes now live entirely in Shopify and are validated there at
 * checkout, so the rail never invents a bundle saving — any code a customer
 * has applies at the Shopify checkout.
 */

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
 * Rank the catalog as styling partners for a product.
 * `products` is passed in explicitly (the catalog facade owns the data).
 */
function rank(product, products = []) {
  const wanted = PAIRS[product.type] || FALLBACK;
  const scored = products
    .filter(p => p.handle !== product.handle && !p.digital && !p.hidden)
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

function lookFor(product, limit = 3, products = [], recommended = []) {
  const picked = [];
  const usedTypes = new Set([product.type]);

  // Shopify recommendations first, when the store provides them
  for (const p of recommended) {
    if (picked.length >= limit) break;
    if (!p || p.handle === product.handle || usedTypes.has(p.type)) continue;
    if (!inStock(p)) continue;
    picked.push(p);
    usedTypes.add(p.type);
  }

  // deterministic ranking fills the rest — one piece per complementary type
  const ranked = rank(product, products);
  for (const p of ranked) {
    if (picked.length >= limit) break;
    if (usedTypes.has(p.type)) continue;
    if (!inStock(p)) continue;
    picked.push(p);
    usedTypes.add(p.type);
  }
  for (const p of ranked) {
    if (picked.length >= limit) break;
    if (picked.includes(p)) continue;
    if (!inStock(p)) continue;
    picked.push(p);
  }
  return picked;
}

/**
 * Bundle messaging for the rail. Discounts are validated by Shopify at
 * checkout, so the rail only ever states that — never an invented saving.
 */
function bundleFor(items, subtotal) {
  if (!items || items.length < 2) return { discount: null, message: null };
  return { discount: null, message: 'Have a code? It applies at checkout.' };
}

module.exports = { lookFor, rank, PAIRS, bundleFor };
