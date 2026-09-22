'use strict';
/**
 * build-fixtures.js — one-shot generator for the DEMO Shopify fixture.
 *
 * Takes the VENNIX catalogue/content definitions (formerly seeded into the
 * custom JSON database) and emits them in Shopify Storefront API shape to
 * `data/fixtures/shopify-store.json`. The bundled demo gateway
 * (`tools/mock-shopify`) serves that fixture through the same GraphQL
 * operations the production storefront sends to a real store, so local
 * development and CI exercise the real Shopify data-access code path.
 *
 * This file is a development tool. It never talks to a real Shopify store and
 * never writes into one — the merchant's live store stays untouched.
 *
 * Usage: node scripts/build-fixtures.js
 */
const fs = require('fs');
const path = require('path');
// The demo fixture content is generated from the retired seed definitions —
// the fixture itself (data/fixtures/shopify-store.json) is the committed
// source of truth for demo mode; the legacy seed is only the copy source.
const seed = require('../legacy/seed');

const OUT = path.join(__dirname, '..', 'data', 'fixtures', 'shopify-store.json');
const IMG = '/images';

function money(cents) { return (Math.round(cents) / 100).toFixed(2); }
function iso(daysAgo) { return new Date(Date.now() - daysAgo * 864e5).toISOString(); }

/* ------------------------------------------------------------------ products */
function buildProducts() {
  const seeded = seed.seedProducts(); // full variant/stock generation
  const products = seeded.map((p, i) => {
    const reviews = seed.REVIEW_DEFS.filter(r => r.handle === p.handle);
    const metafields = {
      tagline: p.tagline,
      features: p.features,
      materials: p.materials,
      care: p.care,
      fit: p.fit,
      fit_notes: p.fitNotes,
      weight_grams: p.shippingWeight,
      monogram: p.personalization || null,
      // Reviews live on the product as a metafield the way reviews apps
      // (Judge.me, Loox, Okendo) expose them. The demo fixture ships the
      // seeded reviews here; a real store ships whatever the app writes.
      reviews: reviews.length ? {
        avg: Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10,
        count: reviews.length,
        list: reviews.map(r => ({
          rating: r.rating, title: r.title, body: r.body, author: r.author,
          verified: true, helpful: Math.min(r.helpful, 4), date: iso(10 + i)
        }))
      } : null
    };
    return {
      id: `gid://shopify/Product/${1000 + i}`,
      handle: p.handle,
      title: p.title,
      vendor: p.vendor,
      productType: p.type,
      tags: [...p.tags, ...p.badges.map(b => `badge:${b.toLowerCase()}`)],
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      descriptionHtml: p.descriptionHtml,
      isGiftCard: false,
      seo: { title: p.seo.title, description: p.seo.description },
      metafields,
      options: p.options.map(o => ({ name: o.name, values: o.values.map(v => v.name) })),
      images: p.images.map(img => ({ url: img.src, altText: img.alt, width: 1000, height: 1250 })),
      variants: p.variants.map(v => ({
        id: `gid://shopify/ProductVariant/${v.id}`,
        legacyId: v.id,
        title: `${v.color} / ${v.size}`,
        sku: v.sku,
        availableForSale: v.stock > 0,
        quantityAvailable: v.stock,
        price: { amount: money(v.price), currencyCode: 'USD' },
        compareAtPrice: v.compareAtPrice ? { amount: money(v.compareAtPrice), currencyCode: 'USD' } : null,
        selectedOptions: [
          { name: 'Colour', value: v.color },
          { name: 'Size', value: v.size }
        ],
        image: v.image ? { url: v.image, altText: `${p.title} — ${v.color}`, width: 1000, height: 1250 } : null
      }))
    };
  });

  /* Monogramming service — a real Shopify product carrying the fee. The
     storefront adds it as a second line when a monogram is requested, so the
     charge always goes through Shopify like any other product. */
  products.push({
    id: 'gid://shopify/Product/1900',
    handle: 'monogramming',
    title: 'Monogramming',
    vendor: 'Vennix',
    productType: 'Service',
    tags: ['vennix-service', 'personalization'],
    publishedAt: iso(60), createdAt: iso(60), updatedAt: iso(5),
    descriptionHtml: '<p>Three characters, stitched in the Brooklyn studio. Added to your order alongside the piece you are personalising.</p>',
    isGiftCard: false,
    seo: { title: 'Monogramming | Vennix', description: 'Three stitched characters, added in the Brooklyn studio.' },
    metafields: { tagline: 'Three stitched characters', features: ['Stitched in-house', '2–3 days added to dispatch'], materials: '', care: '', fit: '', fit_notes: '', weight_grams: 0, monogram: null, reviews: null },
    options: [{ name: 'Style', values: ['Studio stitch'] }],
    images: [{ url: `${IMG}/p-atlas-hoodie.jpg`, altText: 'Monogram stitching detail', width: 1000, height: 1250 }],
    variants: [{
      id: 'gid://shopify/ProductVariant/var_monogram_fee', legacyId: 'var_monogram_fee',
      title: 'Studio stitch', sku: 'VEN-MONO-01', availableForSale: true, quantityAvailable: 9999,
      price: { amount: '20.00', currencyCode: 'USD' }, compareAtPrice: null,
      selectedOptions: [{ name: 'Style', value: 'Studio stitch' }], image: null
    }]
  });

  /* Gift card product — Shopify-native gift card with three denominations. */
  products.push({
    id: 'gid://shopify/Product/1901',
    handle: 'gift-card',
    title: 'Vennix Gift Card',
    vendor: 'Vennix',
    productType: 'Gift Card',
    tags: ['gift', 'digital'],
    publishedAt: iso(58), createdAt: iso(58), updatedAt: iso(5),
    descriptionHtml: '<p>A Vennix gift card, delivered by email within minutes of checkout. No expiry, no fees, and it works on everything in the range — including sale pieces.</p>',
    isGiftCard: true,
    seo: { title: 'Vennix Gift Card — Digital Delivery | Vennix', description: 'A digital Vennix gift card delivered by email within minutes. No expiry, valid on everything including sale.' },
    metafields: { tagline: 'Delivered by email within minutes', features: ['Delivered by email within minutes', 'No expiry date and no fees', 'Valid on everything, including sale'], materials: '', care: '', fit: '', fit_notes: '', weight_grams: 0, monogram: null, reviews: null },
    options: [{ name: 'Denomination', values: ['$50', '$100', '$200'] }],
    images: [{ url: `${IMG}/gift-card.svg`, altText: 'Vennix digital gift card', width: 1000, height: 625 }],
    variants: [
      { id: 'gid://shopify/ProductVariant/var_gift_5000', legacyId: 'var_gift_5000', title: '$50', sku: 'VEN-GIFT-50', availableForSale: true, quantityAvailable: 9999, price: { amount: '50.00', currencyCode: 'USD' }, compareAtPrice: null, selectedOptions: [{ name: 'Denomination', value: '$50' }], image: null },
      { id: 'gid://shopify/ProductVariant/var_gift_10000', legacyId: 'var_gift_10000', title: '$100', sku: 'VEN-GIFT-100', availableForSale: true, quantityAvailable: 9999, price: { amount: '100.00', currencyCode: 'USD' }, compareAtPrice: null, selectedOptions: [{ name: 'Denomination', value: '$100' }], image: null },
      { id: 'gid://shopify/ProductVariant/var_gift_20000', legacyId: 'var_gift_20000', title: '$200', sku: 'VEN-GIFT-200', availableForSale: true, quantityAvailable: 9999, price: { amount: '200.00', currencyCode: 'USD' }, compareAtPrice: null, selectedOptions: [{ name: 'Denomination', value: '$200' }], image: null }
    ]
  });

  return products;
}

/* --------------------------------------------------------------- collections */
function buildCollections(products) {
  const defs = [
    { handle: 'women', title: "Women's", description: 'Leggings, bras and layers cut for training days and everything after.', image: `${IMG}/lookbook-2.jpg`, handles: ['flow-high-rise-legging-28', 'ribbed-seamless-sports-bra', 'summit-packable-windbreaker'] },
    { handle: 'men', title: "Men's", description: 'Heavyweight fleece, technical layers and bottoms built to be lived in.', image: `${IMG}/p-atlas-hoodie.jpg`, handles: ['atlas-heavyweight-hoodie', 'everyday-pima-crew-tee', 'velocity-long-sleeve-base-layer', 'kinetic-7-inch-training-short', 'everyday-brushed-fleece-jogger', 'summit-packable-windbreaker'] },
    { handle: 'active', title: 'Active', description: 'Technical pieces tested at pace — wicking knits, packable shells, compression.', image: `${IMG}/lookbook-2.jpg`, handles: ['velocity-long-sleeve-base-layer', 'kinetic-7-inch-training-short', 'summit-packable-windbreaker', 'flow-high-rise-legging-28', 'ribbed-seamless-sports-bra'] },
    { handle: 'essentials', title: 'Everyday Essentials', description: 'The pieces you reach for without thinking. Heavyweights, in a fixed palette.', image: `${IMG}/p-everyday-tee.jpg`, handles: ['atlas-heavyweight-hoodie', 'everyday-pima-crew-tee', 'everyday-brushed-fleece-jogger'] },
    { handle: 'new-in', title: 'New In', description: 'The newest additions to Capsule 01, straight off the loom.', image: `${IMG}/p-summit-windbreaker.jpg`, handles: ['atlas-heavyweight-hoodie', 'everyday-pima-crew-tee', 'kinetic-7-inch-training-short', 'summit-packable-windbreaker', 'ribbed-seamless-sports-bra'] },
    { handle: 'bestsellers', title: 'Bestsellers', description: 'What our customers keep coming back for.', image: `${IMG}/p-atlas-hoodie.jpg`, handles: ['atlas-heavyweight-hoodie', 'flow-high-rise-legging-28', 'everyday-brushed-fleece-jogger', 'velocity-long-sleeve-base-layer'] }
  ];
  return defs.map((d, i) => ({
    id: `gid://shopify/Collection/${2000 + i}`,
    handle: d.handle,
    title: d.title,
    description: d.description,
    image: { url: d.image, altText: d.title, width: 1600, height: 600 },
    seo: { title: `${d.title} | Vennix`, description: d.description },
    productHandles: d.handles.filter(h => products.some(p => p.handle === h))
  }));
}

/* --------------------------------------------------------------------- main */
const products = buildProducts();
const fixture = {
  $schema: 'shopify-storefront-fixture/1',
  $note: 'Demo commerce data in Storefront API shape. Served by tools/mock-shopify.js when SHOPIFY_STORE_DOMAIN is not configured. A real deployment never reads this file — Shopify is the source of truth.',
  shop: {
    name: 'Vennix',
    description: 'Modern clothing & active essentials.',
    primaryDomain: { url: 'https://vennix-demo.myshopify.com' },
    paymentSettings: { currencyCode: 'USD', acceptedCardBrands: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'] }
  },
  products,
  collections: buildCollections(products),
  pages: seed.PAGE_DEFS.map((p, i) => ({
    id: `gid://shopify/Page/${3000 + i}`,
    handle: p.handle,
    title: p.title,
    body: p.body,
    seo: p.seo,
    createdAt: iso(120),
    updatedAt: iso(30)
  })),
  blog: {
    handle: 'journal',
    title: 'The Journal',
    articles: seed.POST_DEFS.map((p, i) => ({
      id: `gid://shopify/Article/${4000 + i}`,
      handle: p.handle,
      title: p.title,
      excerpt: p.excerpt,
      body: p.body,
      image: { url: p.image, altText: p.title, width: 1200, height: 800 },
      author: { name: p.author },
      tags: p.tags,
      readMinutes: p.readMinutes,
      publishedAt: p.publishedAt
    }))
  },
  // Discount codes the demo store accepts. A real store validates codes
  // itself through cartDiscountCodesUpdate — this map only exists so the
  // mock gateway can emulate that validation.
  discountCodes: {
    WELCOME10: { type: 'percent', value: 10, minSubtotalCents: 0 },
    FREESHIP: { type: 'shipping', value: 0, minSubtotalCents: 5000 },
    CAPSULE20: { type: 'percent', value: 20, minSubtotalCents: 15000 }
  },
  faqs: seed.FAQ_DEFS,
  sizeCharts: seed.SIZE_CHARTS
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(fixture, null, 2));
const variantCount = products.reduce((s, p) => s + p.variants.length, 0);
console.log(`[fixtures] wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`[fixtures] ${products.length} products · ${variantCount} variants · ${fixture.collections.length} collections · ${fixture.pages.length} pages · ${fixture.blog.articles.length} articles`);
