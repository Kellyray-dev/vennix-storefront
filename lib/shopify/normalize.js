'use strict';
/**
 * normalize.js — Shopify Storefront API shapes → internal storefront shapes.
 *
 * This is the single mapping point between Shopify (source of truth) and the
 * presentation layer. Pages, templates and client JS keep consuming the
 * internal product/variant/cart shapes they always did; everything Shopify
 * returns is translated here. Money becomes integer cents at this edge.
 */
const { fromMoneyV2 } = require('../money');
const settings = require('../settings');

const SERVICE_TAG = 'vennix-service';
const NEW_WINDOW_DAYS = 45;

/* ------------------------------- metafields ------------------------------- */

function metafieldMap(metafields) {
  const out = {};
  for (const m of metafields || []) {
    if (!m || !m.key) continue;
    out[m.key] = m.value;
  }
  return out;
}

function parseJsonMeta(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

/* -------------------------------- variants -------------------------------- */

const COLOUR_OPTION = /^(colour|color|coloris)$/i;
const SIZE_OPTION = /^(size|denomination|title|style|option)$/i;

function splitVariantOptions(variant) {
  const opts = variant.selectedOptions || [];
  let color = null;
  const others = [];
  for (const o of opts) {
    if (color === null && COLOUR_OPTION.test(o.name)) color = o.value;
    else others.push(o.value);
  }
  if (color === null && opts.length) {
    // single-option products (gift cards, services): no colour dimension
    color = opts.length === 1 ? defaultColorFor(variant) : opts[0].value;
    const rest = opts.length === 1 ? [] : opts.slice(1).map(o => o.value);
    return { color, size: rest.join(' / ') || defaultSizeFor(variant) };
  }
  return { color: color || 'Default', size: others.join(' / ') || 'One size' };
}

function defaultColorFor(variant) {
  const product = variant.__product || {};
  return product.isGiftCard ? 'Digital' : 'Default';
}
function defaultSizeFor(variant) {
  const product = variant.__product || {};
  return product.isGiftCard ? (variant.title || 'Gift card') : 'One size';
}

function normalizeVariant(raw, productRaw) {
  const { color, size } = splitVariantOptions({ ...raw, __product: productRaw });
  const price = fromMoneyV2(raw.price);
  const compareAt = fromMoneyV2(raw.compareAtPrice);
  const stock = typeof raw.quantityAvailable === 'number'
    ? raw.quantityAvailable
    : (raw.availableForSale ? 9999 : 0);
  return {
    id: raw.id,
    legacyId: raw.legacyId || null,
    sku: raw.sku || '',
    color,
    colorHex: settings.swatchHex(color),
    size,
    price,
    compareAtPrice: compareAt && compareAt > price ? compareAt : null,
    stock,
    availableForSale: !!raw.availableForSale,
    image: raw.image ? raw.image.url : null,
    title: raw.title || `${color} / ${size}`
  };
}

/* -------------------------------- products -------------------------------- */

function badgesFromTags(tags = [], publishedAt) {
  const badges = [];
  if (tags.includes('badge:bestseller') || tags.includes('bestseller')) badges.push('Bestseller');
  const age = publishedAt ? (Date.now() - Date.parse(publishedAt)) / 864e5 : Infinity;
  if (tags.includes('badge:new') || age <= NEW_WINDOW_DAYS) badges.push('New');
  return badges;
}

function normalizeProduct(raw) {
  if (!raw) return null;
  const meta = metafieldMap(raw.metafields);
  const variants = (raw.variants && raw.variants.nodes ? raw.variants.nodes : raw.variants || [])
    .map(v => normalizeVariant(v, raw));

  const prices = variants.map(v => v.price).filter(n => Number.isFinite(n));
  const price = prices.length ? Math.min(...prices) : 0;
  const compares = variants.map(v => v.compareAtPrice).filter(Boolean);
  const compareAtPrice = compares.length ? Math.max(...compares) : null;
  const inventoryQuantity = variants.reduce((s, v) => s + Math.max(0, v.stock), 0);

  // gallery: media first, fall back to featured image
  const images = [];
  const media = (raw.media && raw.media.nodes) || [];
  for (const node of media) {
    const img = node.image || node.preview && node.preview.image;
    if (img && img.url) images.push({ src: img.url, alt: img.altText || raw.title });
  }
  if (!images.length && raw.featuredImage && raw.featuredImage.url) {
    images.push({ src: raw.featuredImage.url, alt: raw.featuredImage.altText || raw.title });
  }

  // options derived from variant selectedOptions (Colour + Size UI model)
  const colorValues = [];
  const sizeValues = [];
  for (const v of variants) {
    if (!colorValues.some(c => c.name === v.color)) colorValues.push({ name: v.color, hex: v.colorHex });
    if (!sizeValues.some(s => s.name === v.size)) sizeValues.push({ name: v.size });
  }
  const options = [
    { name: 'Colour', position: 1, values: colorValues },
    { name: 'Size', position: 2, values: sizeValues }
  ];

  const reviews = parseJsonMeta(meta.reviews, null);
  const monogram = parseJsonMeta(meta.monogram, null);
  const features = parseJsonMeta(meta.features, null);
  const tags = raw.tags || [];

  return {
    // Shopify identifiers
    id: raw.id,
    handle: raw.handle,
    // display model (unchanged from the original storefront)
    title: raw.title,
    tagline: meta.tagline || '',
    vendor: raw.vendor || settings.get().brandName,
    type: raw.productType || 'Piece',
    status: 'active',
    publishedAt: raw.publishedAt || raw.createdAt || new Date().toISOString(),
    createdAt: raw.createdAt || raw.publishedAt,
    price,
    compareAtPrice,
    priceMin: prices.length ? Math.min(...prices) : price,
    priceMax: prices.length ? Math.max(...prices) : price,
    currency: (variants[0] && 'USD') || 'USD',
    tags,
    badges: badgesFromTags(tags, raw.publishedAt),
    hidden: tags.includes(SERVICE_TAG),
    digital: !!raw.isGiftCard,
    giftCard: !!raw.isGiftCard,
    descriptionHtml: raw.descriptionHtml || '',
    features: Array.isArray(features) ? features : [],
    materials: meta.materials || '',
    care: meta.care || '',
    fit: meta.fit || '',
    fitNotes: meta.fit_notes || '',
    shippingWeight: Number(meta.weight_grams) || 0,
    images,
    options,
    variants,
    inventoryQuantity,
    inventoryPolicy: 'deny',
    trackInventory: true,
    rating: reviews && typeof reviews.avg === 'number'
      ? { avg: reviews.avg, count: reviews.count || 0 }
      : { avg: 0, count: 0 },
    reviews: reviews && Array.isArray(reviews.list) ? reviews.list : [],
    seo: {
      title: (raw.seo && raw.seo.title) || raw.title,
      description: (raw.seo && raw.seo.description) || meta.tagline || ''
    },
    personalization: monogram && monogram.enabled ? {
      enabled: true,
      placement: monogram.placement || settings.get().personalization.placement
    } : null,
    collections: [] // filled by catalog.js collection index
  };
}

/* ------------------------------ collections ------------------------------- */

function normalizeCollection(raw, handles = []) {
  if (!raw) return null;
  return {
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    description: raw.description || '',
    image: raw.image ? raw.image.url : '',
    imageAlt: raw.image ? raw.image.altText || raw.title : '',
    productHandles: handles,
    seo: {
      title: (raw.seo && raw.seo.title) || raw.title,
      description: (raw.seo && raw.seo.description) || raw.description || ''
    }
  };
}

/* --------------------------------- content -------------------------------- */

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePage(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    body: raw.body || '',
    seo: {
      title: (raw.seo && raw.seo.title) || raw.title,
      description: (raw.seo && raw.seo.description) || stripHtml(raw.body).slice(0, 155)
    },
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt || raw.createdAt
  };
}

function normalizeArticle(raw) {
  if (!raw) return null;
  const excerpt = raw.excerpt || stripHtml(raw.body).slice(0, 180);
  const words = stripHtml(raw.body).split(' ').length;
  return {
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    excerpt,
    body: raw.body || '',
    image: raw.image ? raw.image.url : '',
    imageAlt: raw.image ? raw.image.altText || raw.title : '',
    author: (raw.author && raw.author.name) || settings.get().brandName,
    tags: raw.tags || [],
    readMinutes: raw.readMinutes || Math.max(1, Math.round(words / 220)),
    publishedAt: raw.publishedAt
  };
}

/* ---------------------------------- cart ---------------------------------- */

function normalizeCart(raw) {
  if (!raw) return null;
  const lines = (raw.lines && raw.lines.nodes ? raw.lines.nodes : []).map(line => {
    const merch = line.merchandise || {};
    const product = merch.product || {};
    const opts = splitVariantOptions(merch);
    const price = fromMoneyV2(merch.price);
    const compareAt = fromMoneyV2(merch.compareAtPrice);
    const attrs = {};
    for (const a of line.attributes || []) attrs[a.key] = a.value;
    return {
      id: line.id,
      merchandiseId: merch.id,
      quantity: line.quantity,
      title: product.title || merch.title || 'Item',
      variantTitle: merch.title || '',
      handle: product.handle || '',
      url: product.handle ? `/products/${product.handle}` : '',
      color: opts.color,
      size: opts.size,
      sku: merch.sku || '',
      price,
      compareAtPrice: compareAt && compareAt > price ? compareAt : null,
      image: (merch.image && merch.image.url) || (product.featuredImage && product.featuredImage.url) || '',
      stock: typeof merch.quantityAvailable === 'number' ? merch.quantityAvailable : undefined,
      productId: product.id || null,
      vendor: product.vendor || '',
      giftCard: !!product.isGiftCard,
      service: (product.tags || []).includes ? false : false,
      attributes: attrs,
      personalization: attrs.Monogram ? {
        text: attrs.Monogram,
        label: attrs['Monogram type'] || 'Monogram',
        placement: attrs['Monogram placement'] || '',
        price: 0
      } : null,
      lineTotal: (fromMoneyV2(line.cost && line.cost.totalAmount)) || price * line.quantity
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const cost = raw.cost || {};
  const costSubtotal = fromMoneyV2(cost.subtotalAmount);
  const total = fromMoneyV2(cost.totalAmount);
  const tax = fromMoneyV2(cost.totalTaxAmount);
  const discountCodes = (raw.discountCodes || []).filter(d => d.applicable);
  const discountAmount = Math.max(0, subtotal - (costSubtotal !== null ? costSubtotal : subtotal));
  const noteParts = [];
  if (raw.note) noteParts.push(raw.note);
  for (const l of lines) for (const [k, v] of Object.entries(l.attributes)) {
    if (k === 'Gift note') noteParts.push(`Gift note: ${v}`);
  }

  return {
    id: raw.id,
    checkoutUrl: raw.checkoutUrl,
    count: lines.reduce((s, l) => s + l.quantity, 0),
    lines,
    subtotal,
    costSubtotal: costSubtotal !== null ? costSubtotal : subtotal,
    discountCodes,
    discountAmount,
    taxAmount: tax || 0,
    total: total !== null ? total : subtotal - discountAmount,
    note: raw.note || '',
    buyerEmail: (raw.buyerIdentity && raw.buyerIdentity.email) || null,
    attributes: raw.attributes || []
  };
}

module.exports = {
  normalizeProduct, normalizeCollection, normalizePage, normalizeArticle, normalizeCart,
  stripHtml, SERVICE_TAG
};
