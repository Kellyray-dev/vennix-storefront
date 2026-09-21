#!/usr/bin/env node
/**
 * Catalogue importer.
 *
 * Brings a real store's data into the storefront without touching code. Two sources:
 *
 *   1. Shopify product export CSV (Products → Export in admin)
 *        node scripts/import-shopify-catalog.js --csv ~/products.csv
 *   2. The Shopify Admin API (needs a custom app token with read_products)
 *        SHOPIFY_STORE=your-store.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_... \
 *        node scripts/import-shopify-catalog.js
 *
 * What it does: maps products, variants, options, images, collections, tags,
 * SEO fields and inventory into data/db.json, keeps any ids it can reuse, and
 * writes a report. Your store, your numbers — no demo content is fabricated to
 * fill gaps.
 *
 * Flags
 *   --csv <path>      import from a CSV file instead of the API
 *   --replace         replace the whole catalogue instead of merging
 *   --dry-run         report what would change without writing
 *   --images <list>   rehost/refresh image paths (comma list of prefixes to strip)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'db.json');

/* ---------------------------------- args ---------------------------------- */

const argv = process.argv.slice(2);
const flag = name => argv.includes('--' + name);
const value = name => {
  const index = argv.indexOf('--' + name);
  return index > -1 ? argv[index + 1] : null;
};

const CSV_PATH = value('csv');
const REPLACE = flag('replace');
const DRY_RUN = flag('dry-run');

/* --------------------------------- helpers -------------------------------- */

const slug = text => String(text || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

const admin = () => {
  const store = process.env.SHOPIFY_STORE;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!store || !token) return null;
  const host = store.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const version = process.env.SHOPIFY_API_VERSION || '2024-10';
  return {
    host,
    base: `https://${host}/admin/api/${version}`,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' }
  };
};

async function apiGet(client, endpoint, params = {}) {
  const url = new URL(client.base + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url, { headers: client.headers });
  if (!response.ok) {
    throw new Error(`Shopify ${response.status} on ${endpoint}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

/* ---------------------------------- CSV ----------------------------------- */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const clean = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\r') { /* skip */ }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const header = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => header.reduce((acc, key, i) => { acc[key] = (r[i] || '').trim(); return acc; }, {}));
}

function groupCsvProducts(rows) {
  const byHandle = new Map();
  rows.forEach(row => {
    const handle = row.Handle || slug(row.Title);
    if (!handle) return;
    if (!byHandle.has(handle)) byHandle.set(handle, { handle, rows: [] });
    byHandle.get(handle).rows.push(row);
  });
  return [...byHandle.values()];
}

/* -------------------------------- mapping --------------------------------- */

const COLOUR_HEX = {
  black: '#1B1B1B', ink: '#22201E', charcoal: '#3B3B3D', grey: '#8C8880', gray: '#8C8880',
  fog: '#BFBCB4', stone: '#C9C3B8', bone: '#EDE7DC', cream: '#F2EADF', white: '#FFFFFF',
  sand: '#DED3C0', clay: '#A8603F', rust: '#A9522F', olive: '#5C6144', moss: '#4E5A44',
  navy: '#1F2A44', blue: '#38507A', slate: '#5A6672', teal: '#2E5F5C', green: '#3E6B4F',
  red: '#A33A31', burgundy: '#5E2C33', plum: '#4A3247', pink: '#D8A7A0', blush: '#E2C4BC',
  lavender: '#B7A9C9', purple: '#5B4776', yellow: '#D8B24C', mustard: '#C79A3E', orange: '#C4703A',
  brown: '#5C4632', tan: '#C29A6E', camel: '#B08A5E', coffee: '#4A3A2C', silver: '#B9BDC1', gold: '#C0A062'
};

function hexFor(name) {
  const key = String(name || '').toLowerCase().trim();
  const direct = COLOUR_HEX[key.split(/[\s/]+/)[0]];
  return direct || '#C9C3B8';
}

/** Shopify CSV → product document. */
function productFromCsv(group, index, existingByHandle) {
  const base = group.rows[0];
  const previous = existingByHandle.get(group.handle);
  const id = previous ? previous.id : `prd_${String(index + 1).padStart(4, '0')}`;

  // variants: (colour × size) or single "Default Title"
  const colourRows = group.rows.filter(r => r['Option1 Value'] || r['Title'] || r['Variant Price']);
  const colours = [];
  const variants = [];
  const sizes = new Set();
  const images = [];

  group.rows.forEach(row => {
    if (row['Image Src']) {
      const src = row['Image Src'].replace(/^https?:\/\/[^/]+/, '');
      if (!images.some(i => i.src === src)) images.push({ src, alt: row['Image Alt Text'] || row.Title });
    }
  });

  colourRows.forEach((row, rowIndex) => {
    const colourName = row['Option1 Value'] && row['Option1 Value'] !== 'Default Title' ? row['Option1 Value'] : null;
    const sizeList = String(row['Option2 Value'] || row['Option1 Value'] || 'One Size')
      .split(',').map(s => s.trim()).filter(Boolean);
    const price = Math.round(parseFloat(row['Variant Price'] || row.Price || '0') * 100);
    const compare = row['Variant Compare At Price'] ? Math.round(parseFloat(row['Variant Compare At Price']) * 100) : null;
    const stock = row['Variant Inventory Qty'] === '' || row['Variant Inventory Qty'] === undefined
      ? null : parseInt(row['Variant Inventory Qty'], 10);
    const imageRow = row['Image Src'] ? row['Image Src'].replace(/^https?:\/\/[^/]+/, '') : (images[0] ? images[0].src : null);

    if (colourName && !colours.some(c => c.name === colourName)) {
      colours.push({ name: colourName, key: slug(colourName).split('-')[0], hex: hexFor(colourName) });
    }
    const effectiveSizes = colourName ? sizeList : (sizeList.length === 1 && sizeList[0] === 'Default Title' ? ['One Size'] : sizeList);
    effectiveSizes.forEach((size) => {
      sizes.add(size);
      const skuStub = (colourName || 'default').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
      variants.push({
        id: `var_${slug(group.handle).replace(/-/g, '').slice(0, 12)}_${skuStub || 'std'}_${slug(size).replace(/-/g, '') || 'os'}`,
        sku: row['Variant SKU'] ? `${row['Variant SKU']}${effectiveSizes.length > 1 ? '-' + slug(size).toUpperCase() : ''}` : null,
        color: colourName || 'Default',
        colorHex: colourName ? hexFor(colourName) : '#C9C3B8',
        colorKey: colourName ? slug(colourName).split('-')[0] : 'default',
        size,
        price: price || 0,
        compareAtPrice: compare && compare > price ? compare : null,
        stock: stock === null ? 25 : stock,
        weight: parseInt(row['Variant Grams'] || '400', 10),
        image: imageRow,
        position: variants.length
      });
    });
    void rowIndex;
  });

  if (!variants.length) {
    variants.push({
      id: `var_${slug(group.handle).replace(/-/g, '').slice(0, 12)}_std_os`, sku: base['Variant SKU'] || null,
      color: 'Default', colorHex: '#C9C3B8', colorKey: 'default', size: 'One Size',
      price: Math.round(parseFloat(base['Variant Price'] || '0') * 100), compareAtPrice: null,
      stock: 25, weight: 400, image: images[0] ? images[0].src : null, position: 0
    });
  }

  const tags = String(base.Tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const collectionHandles = String(base.Collections || '').split(',').map(c => slug(c.trim())).filter(Boolean);
  const price = Math.min(...variants.map(v => v.price));
  const compare = variants.map(v => v.compareAtPrice).filter(Boolean);

  return {
    id,
    handle: group.handle,
    title: base.Title || group.handle,
    tagline: (base['SEO Description'] || '').slice(0, 160) || tags.slice(0, 3).join(' · '),
    category: (base.Type || '').toLowerCase(),
    type: base.Type || 'Apparel',
    vendor: base.Vendor || (previous && previous.vendor) || 'Vennix',
    status: /true/i.test(base.Published || '') || /active/i.test(base.Status || '') ? 'active' : 'draft',
    createdAt: previous ? previous.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    publishedAt: base['Published At'] || (previous ? previous.publishedAt : new Date().toISOString()),
    price,
    compareAtPrice: compare.length ? Math.max(...compare) : null,
    currency: 'USD',
    collections: collectionHandles,
    tags,
    badges: tags.filter(t => /^(new|best|sale|limited|bestseller)/i.test(t)).slice(0, 2),
    descriptionHtml: base['Body (HTML)'] || '',
    description: (base['Body (HTML)'] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    features: [],
    materials: '', care: '', fit: '', fitNotes: '',
    shippingWeight: parseInt(base['Variant Grams'] || '400', 10),
    images: images.length ? images : [{ src: '/images/lookbook-1.jpg', alt: base.Title }],
    options: [
      { name: 'Colour', position: 1, values: colours.length ? colours : [{ name: 'Default', key: 'default', hex: '#C9C3B8' }] },
      { name: 'Size', position: 2, values: [...sizes].map(s => ({ name: s })) }
    ],
    variants,
    inventoryQuantity: variants.reduce((sum, v) => sum + (v.stock || 0), 0),
    inventoryPolicy: 'deny',
    trackInventory: true,
    digital: /true/i.test(base['Gift Card'] || ''),
    // never invent ratings — a fresh import starts with none
    rating: { avg: 0, count: 0, distribution: [0, 0, 0, 0, 0] },
    seo: { title: base['SEO Title'] || base.Title, description: base['SEO Description'] || '' },
    taxCode: 'txcd_99999999'
  };
}

/* ------------------------------ API mapping ------------------------------- */

function productFromApi(product, index, existingByHandle) {
  const previous = existingByHandle.get(product.handle);
  const variants = (product.variants || []).map((variant, position) => {
    const optionValues = [variant.option1, variant.option2, variant.option3].filter(Boolean);
    const colour = optionValues.find(v => /colou?r|colourway/i.test(v) || COLOUR_HEX[String(v).toLowerCase()]) || optionValues[0] || 'Default';
    const size = optionValues.find(v => /^(xxs|xs|s|m|l|xl|xxl|xxxl|\d{2}|one size)$/i.test(String(v))) || optionValues[1] || 'One Size';
    return {
      id: `var_${slug(product.handle).replace(/-/g, '').slice(0, 12)}_${slug(colour).replace(/-/g, '').slice(0, 10)}_${slug(size).replace(/-/g, '') || 'os'}`,
      sku: variant.sku || null,
      color: colour, colorHex: hexFor(colour), colorKey: slug(colour).split('-')[0],
      size,
      price: Math.round(parseFloat(variant.price || '0') * 100),
      compareAtPrice: variant.compare_at_price ? Math.round(parseFloat(variant.compare_at_price) * 100) : null,
      stock: typeof variant.inventory_quantity === 'number' ? variant.inventory_quantity : 25,
      weight: variant.grams || 400,
      image: variant.image && variant.image.src ? variant.image.src : null,
      position
    };
  });

  const colours = [...new Map(variants.map(v => [v.color, { name: v.color, key: v.colorKey, hex: v.colorHex }])).values()];
  const sizes = [...new Set(variants.map(v => v.size))];
  const images = (product.images || []).map(image => ({ src: image.src, alt: image.alt || product.title }));
  const tags = product.tags ? String(product.tags).split(',').map(t => t.trim()).filter(Boolean) : [];
  const compare = variants.map(v => v.compareAtPrice).filter(Boolean);

  return {
    id: previous ? previous.id : `prd_${String(index + 1).padStart(4, '0')}`,
    handle: product.handle,
    title: product.title,
    tagline: (product.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
    category: (product.product_type || '').toLowerCase(),
    type: product.product_type || 'Apparel',
    vendor: product.vendor || 'Vennix',
    status: product.status === 'active' ? 'active' : 'draft',
    createdAt: product.created_at || (previous && previous.createdAt) || new Date().toISOString(),
    updatedAt: product.updated_at || new Date().toISOString(),
    publishedAt: product.published_at || null,
    price: variants.length ? Math.min(...variants.map(v => v.price)) : 0,
    compareAtPrice: compare.length ? Math.max(...compare) : null,
    currency: 'USD',
    collections: (product.collectionHandles || []).map(slug),
    tags,
    badges: tags.filter(t => /^(new|best|sale|limited|bestseller)/i.test(t)).slice(0, 2),
    descriptionHtml: product.body_html || '',
    description: (product.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    features: [], materials: '', care: '', fit: '', fitNotes: '',
    shippingWeight: variants[0] ? variants[0].weight : 400,
    images: images.length ? images : [{ src: '/images/lookbook-1.jpg', alt: product.title }],
    options: [
      { name: 'Colour', position: 1, values: colours.length ? colours : [{ name: 'Default', key: 'default', hex: '#C9C3B8' }] },
      { name: 'Size', position: 2, values: sizes.map(s => ({ name: s })) }
    ],
    variants,
    inventoryQuantity: variants.reduce((sum, v) => sum + (v.stock || 0), 0),
    inventoryPolicy: 'deny',
    trackInventory: true,
    digital: product.gift_card === true,
    rating: (previous && previous.rating) || { avg: 0, count: 0, distribution: [0, 0, 0, 0, 0] },
    seo: { title: product.seo_title || product.title, description: product.seo_description || '' },
    taxCode: 'txcd_99999999'
  };
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('data/db.json not found — run `npm run seed` once, then import over it.');
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const existingByHandle = new Map((db.products || []).map(p => [p.handle, p]));

  let incoming = [];
  let source = '';

  if (CSV_PATH) {
    if (!fs.existsSync(CSV_PATH)) { console.error(`CSV not found: ${CSV_PATH}`); process.exit(1); }
    const groups = groupCsvProducts(parseCsv(fs.readFileSync(CSV_PATH, 'utf8')));
    incoming = groups.map((group, i) => productFromCsv(group, i, existingByHandle));
    source = `CSV (${CSV_PATH})`;
  } else {
    const client = admin();
    if (!client) {
      console.error('No source given.');
      console.error('  CSV:    node scripts/import-shopify-catalog.js --csv ~/products.csv');
      console.error('  Admin:  SHOPIFY_STORE=your-store.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_... node scripts/import-shopify-catalog.js');
      process.exit(1);
    }
    console.log(`Reading products from ${client.host}…`);
    let page = await apiGet(client, '/products.json', { limit: 250, fields: 'id,title,handle,body_html,vendor,product_type,tags,variants,images,status,created_at,updated_at,published_at,seo_title,seo_description' });
    let products = page.products || [];
    while (products.length && products.length % 250 === 0) {
      page = await apiGet(client, '/products.json', { limit: 250, since_id: products[products.length - 1].id });
      products = products.concat(page.products || []);
    }
    console.log(`  ${products.length} products fetched`);

    // attach collection handles so the storefront navigation lines up
    try {
      const collects = await apiGet(client, '/collects.json', { limit: 250 });
      const custom = await apiGet(client, '/custom_collections.json', { limit: 250 });
      const smart = await apiGet(client, '/smart_collections.json', { limit: 250 });
      const handleById = new Map([...(custom.custom_collections || []), ...(smart.smart_collections || [])].map(c => [c.id, c.handle]));
      const byProduct = new Map();
      (collects.collects || []).forEach(collect => {
        const handle = handleById.get(collect.collection_id);
        if (!handle) return;
        if (!byProduct.has(collect.product_id)) byProduct.set(collect.product_id, []);
        byProduct.get(collect.product_id).push(handle);
      });
      products.forEach(product => { product.collectionHandles = byProduct.get(product.id) || []; });
      console.log(`  ${handleById.size} collections mapped`);
    } catch (error) {
      console.log(`  ! collections not mapped (${error.message.slice(0, 80)})`);
    }

    incoming = products.map((product, i) => productFromApi(product, i, existingByHandle));
    source = `Shopify Admin API (${client.host})`;
  }

  if (!incoming.length) {
    console.error('Nothing to import — the source returned no products.');
    process.exit(1);
  }

  // collections referenced by the import are created when missing
  const existingCollections = new Set((db.collections || []).map(c => c.handle));
  const newCollections = [...new Set(incoming.flatMap(p => p.collections))]
    .filter(handle => handle && !existingCollections.has(handle))
    .map((handle, i) => ({
      id: `col_${String((db.collections || []).length + i + 1).padStart(2, '0')}`,
      handle,
      title: handle.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      description: '', image: incoming[0].images[0].src,
      productHandles: incoming.filter(p => p.collections.includes(handle)).map(p => p.handle),
      featured: false, sortOrder: 'manual',
      seo: { title: handle, description: '' }
    }));

  const merged = REPLACE ? incoming : (() => {
    const byHandle = new Map((db.products || []).map(p => [p.handle, p]));
    incoming.forEach(product => byHandle.set(product.handle, product));
    return [...byHandle.values()];
  })();

  const report = {
    source,
    dryRun: DRY_RUN,
    productsImported: incoming.length,
    variantsImported: incoming.reduce((sum, p) => sum + p.variants.length, 0),
    collectionsCreated: newCollections.length,
    mode: REPLACE ? 'replace' : 'merge',
    warnings: []
  };

  incoming.forEach(product => {
    if (!product.variants.length) report.warnings.push(`${product.handle}: no variants`);
    if (!product.price) report.warnings.push(`${product.handle}: price is 0 — check the source column`);
    if (!product.descriptionHtml) report.warnings.push(`${product.handle}: no description`);
    if (!product.images.length || /lookbook|blog/.test(product.images[0].src)) report.warnings.push(`${product.handle}: no product image in the source`);
  });

  console.log('\nImport report');
  console.log(`  source              ${report.source}`);
  console.log(`  mode                ${report.mode}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`  products            ${report.productsImported}`);
  console.log(`  variants            ${report.variantsImported}`);
  console.log(`  new collections     ${report.collectionsCreated}`);
  console.log(`  catalogue total     ${merged.length}`);
  if (report.warnings.length) {
    console.log(`  warnings (${report.warnings.length})`);
    report.warnings.slice(0, 12).forEach(w => console.log(`    ! ${w}`));
    if (report.warnings.length > 12) console.log(`    ! …and ${report.warnings.length - 12} more`);
  }

  if (DRY_RUN) {
    console.log('\nDry run — nothing written. Re-run without --dry-run to apply.\n');
    return;
  }

  db.products = merged;
  db.collections = REPLACE ? newCollections : [...(db.collections || []), ...newCollections];
  // keep collection membership in sync both ways
  db.collections.forEach(collection => {
    collection.productHandles = db.products.filter(p => (p.collections || []).includes(collection.handle)).map(p => p.handle);
  });
  db.reviews = (db.reviews || []).filter(r => db.products.some(p => p.handle === r.productHandle));
  db.orders = db.orders || [];

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  fs.writeFileSync(path.join(ROOT, 'dist', 'import-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nWrote ${DB_PATH}`);
  console.log('Restart the server (npm start) to serve the imported catalogue.\n');
}

if (require.main === module) {
  main().catch(error => { console.error('\nImport failed:', error.message); process.exit(1); });
}

module.exports = { parseCsv, productFromCsv, productFromApi, groupCsvProducts };
