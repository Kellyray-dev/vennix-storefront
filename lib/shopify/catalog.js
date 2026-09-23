'use strict';
/**
 * catalog.js — cached read-side data access for the storefront.
 *
 * Every product, collection, page, article, search result and recommendation
 * the storefront renders comes through here, from the Shopify Storefront API
 * (or the demo gateway in dev). Results are cached briefly (TTL) for latency;
 * Shopify remains the source of truth and nothing here is ever written back.
 */
const { gql } = require('./client');
const ops = require('./operations');
const { getConfig } = require('./config');
const N = require('./normalize');

const MAX_ENTRIES = 400;
/** How long stale data may still be served after a failed refresh. */
const MAX_STALE_MS = 5 * 60 * 1000;

let cache = new Map();
const inflight = new Map();
const stats = { hits: 0, misses: 0, staleServes: 0, errors: 0, lastError: null };

function ttl() {
  try { return getConfig().checkoutCacheTtlMs; } catch { return 15000; }
}

/** Bound the map: evict the oldest entries when it grows past the cap. */
function evictIfNeeded() {
  if (cache.size <= MAX_ENTRIES) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, Math.ceil(MAX_ENTRIES / 4));
  for (const [key] of oldest) cache.delete(key);
}

function cached(key, loader) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl()) {
    stats.hits++;
    return Promise.resolve(hit.data);
  }
  if (inflight.has(key)) return inflight.get(key);
  stats.misses++;
  const p = loader().then(data => {
    cache.set(key, { at: Date.now(), data });
    evictIfNeeded();
    inflight.delete(key);
    return data;
  }).catch(err => {
    inflight.delete(key);
    stats.errors++;
    stats.lastError = { at: new Date().toISOString(), message: String(err && err.message || err).slice(0, 240) };
    // Serve stale data on transient failures rather than a dead storefront —
    // a five-minute-old catalogue beats an error page, and Shopify is still
    // authoritative for price/stock at cart and checkout time.
    if (hit && Date.now() - hit.at < MAX_STALE_MS) {
      stats.staleServes++;
      return hit.data;
    }
    throw err;
  });
  inflight.set(key, p);
  return p;
}

function invalidate() { cache = new Map(); }

/** Cache health for /healthz — sizes only, never cached payloads. */
function cacheStats() {
  return {
    entries: cache.size,
    maxEntries: MAX_ENTRIES,
    inflight: inflight.size,
    hits: stats.hits,
    misses: stats.misses,
    staleServes: stats.staleServes,
    errors: stats.errors,
    lastError: stats.lastError
  };
}

/* ---------------------------------- shop ---------------------------------- */

function getShop() {
  return cached('shop', async () => {
    const data = await gql(ops.SHOP);
    return data.shop || null;
  });
}

/* -------------------------------- products -------------------------------- */

async function fetchAllProducts() {
  const nodes = [];
  let after = null;
  let hasNext = true;
  while (hasNext) {
    const data = await gql(ops.PRODUCTS, { first: 250, after });
    const conn = data.products;
    nodes.push(...(conn.nodes || []));
    hasNext = conn.pageInfo.hasNextPage;
    after = conn.pageInfo.endCursor;
    if (nodes.length > 5000) break; // hard safety cap
  }
  return nodes;
}

async function getRawProducts() {
  return cached('products:all', fetchAllProducts);
}

/** All published storefront products (service add-ons excluded). */
async function getAllProducts() {
  const [raw, collections] = await Promise.all([getRawProducts(), getCollections()]);
  const products = raw.map(N.normalizeProduct).filter(Boolean);
  const byHandle = new Map(products.map(p => [p.handle, p]));
  for (const c of collections) {
    for (const handle of c.productHandles) {
      const p = byHandle.get(handle);
      if (p) p.collections.push(c.handle);
    }
  }
  return products.filter(p => !p.hidden);
}

async function getProductByHandle(handle) {
  const products = await getAllProducts();
  return products.find(p => p.handle === handle) || null;
}

async function getProductById(id) {
  const products = await getAllProducts();
  return products.find(p => p.id === id) || null;
}

/** Find the monogramming service product (or any hidden service add-on). */
async function getServiceProduct(handle) {
  const raw = await getRawProducts();
  const found = raw.find(p => p.handle === handle);
  return found ? N.normalizeProduct(found) : null;
}

/** A variant anywhere in the catalog (cart adds, back-in-stock checks). */
async function findVariant(variantId) {
  const raw = await getRawProducts();
  for (const r of raw) {
    const match = (r.variants.nodes || []).find(x => x.id === variantId);
    if (match) {
      const product = N.normalizeProduct(r);
      const variant = product.variants.find(v => v.id === match.id);
      return { product, variant };
    }
  }
  return null;
}

/* ------------------------------- collections ------------------------------ */

async function getCollections() {
  return cached('collections:list', async () => {
    const data = await gql(ops.COLLECTIONS, { first: 100 });
    const nodes = (data.collections && data.collections.nodes) || [];
    const collections = [];
    for (const node of nodes) {
      const detail = await gql(ops.COLLECTION_PRODUCT_HANDLES, { handle: node.handle, first: 250 });
      const col = detail.collection;
      if (!col) continue;
      collections.push(N.normalizeCollection(col, (col.products.nodes || []).map(p => p.handle)));
    }
    return collections;
  });
}

async function getCollection(handle) {
  const collections = await getCollections();
  return collections.find(c => c.handle === handle) || null;
}

/** Ordered, full product objects for a collection ('all' = whole catalog). */
async function getCollectionProducts(handle) {
  const products = await getAllProducts();
  if (!handle || handle === 'all') return products;
  const collection = await getCollection(handle);
  if (!collection) return null;
  const byHandle = new Map(products.map(p => [p.handle, p]));
  return collection.productHandles.map(h => byHandle.get(h)).filter(Boolean);
}

/* --------------------------------- content -------------------------------- */

async function getPages() {
  return cached('pages', async () => {
    const data = await gql(ops.PAGES, { first: 100 });
    return ((data.pages && data.pages.nodes) || []).map(N.normalizePage);
  });
}

async function getPage(handle) {
  const pages = await getPages();
  return pages.find(p => p.handle === handle) || null;
}

async function getArticles() {
  return cached('blog', async () => {
    const handle = require('../settings').get().journalHandle || 'journal';
    const data = await gql(ops.BLOG, { handle, first: 50 });
    if (!data.blog) return [];
    return (data.blog.articles.nodes || []).map(N.normalizeArticle)
      .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
  });
}

async function getArticle(handle) {
  const articles = await getArticles();
  return articles.find(a => a.handle === handle) || null;
}

/* ---------------------------------- search -------------------------------- */

async function searchProducts(query, first = 24) {
  const q = String(query || '').trim();
  if (!q) return [];
  return cached(`search:${q}:${first}`, async () => {
    const data = await gql(ops.SEARCH, { query: q, first });
    return (data.search.nodes || [])
      .filter(n => n && n.__typename === 'Product')
      .map(N.normalizeProduct)
      .filter(p => p && !p.hidden);
  });
}

/* ----------------------------- recommendations ---------------------------- */

async function recommendations(productId, first = 4) {
  if (!productId) return [];
  return cached(`recs:${productId}`, async () => {
    try {
      const data = await gql(ops.RECOMMENDATIONS, { productId });
      const recs = (data.productRecommendations || []).map(N.normalizeProduct).filter(p => p && !p.hidden);
      return recs.slice(0, first);
    } catch {
      return []; // recommendations are non-critical
    }
  });
}

module.exports = {
  getShop, getAllProducts, getProductByHandle, getProductById, getServiceProduct,
  findVariant, getCollections, getCollection, getCollectionProducts,
  getPages, getPage, getArticles, getArticle,
  searchProducts, recommendations, invalidate, cacheStats
};
