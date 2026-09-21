#!/usr/bin/env node
/**
 * Shopify deployment export.
 *
 * Reads data/db.json (the same catalogue the Node storefront serves) and writes
 * everything a merchant needs to stand the store up on Shopify:
 *
 *   dist/shopify/catalog/products.csv      → Products → Import
 *   dist/shopify/catalog/collections.csv   → collections (manual + smart rules)
 *   dist/shopify/catalog/pages.csv         → Online Store → Pages → Import
 *   dist/shopify/catalog/articles.csv      → blog posts
 *   dist/shopify/catalog/customers.csv     → customers (no password material)
 *   dist/shopify/catalog/discounts.csv     → discount codes to recreate
 *   dist/shopify/catalog/menu.json         → navigation to paste into admin
 *   dist/shopify/catalog/catalog.json      → raw catalogue, for scripts/apps
 *   dist/shopify/theme.zip                 → the OS 2.0 theme, zipped for upload
 *
 * Zero dependencies: the theme zip is assembled with the stored-deflate format
 * from node:zlib.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'db.json');
const THEME = path.join(ROOT, 'shopify-theme');
const OUT = path.join(ROOT, 'dist', 'shopify');
const CATALOG = path.join(OUT, 'catalog');

const isPlainObject = v => v && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------- CSV helpers ------------------------------ */

function csvCell(value) {
  if (value === undefined || value === null) return '';
  let text;
  if (Array.isArray(value)) text = value.join(', ');
  else if (isPlainObject(value)) text = JSON.stringify(value);
  else text = String(value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function toCsv(rows, columns) {
  const header = columns.map(c => csvCell(c.label)).join(',');
  const body = rows.map(row => columns.map(c => csvCell(c.get(row))).join(','));
  return [header, ...body].join('\r\n') + '\r\n';
}

const money = cents => ((cents || 0) / 100).toFixed(2);

/* --------------------------------- zip ------------------------------------ */
/* Minimal ZIP writer: local headers + central directory + EOCD, deflate raw. */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/**
 * Files that belong to the local CLI project rather than to the uploaded theme.
 * `shopify.theme.toml` is written by `npm run brand:theme` and holds your store
 * handle — it must never travel inside theme.zip.
 */
const LOCAL_ONLY = new Set([
  'shopify.theme.toml', '.shopifyignore', 'shopify.extension.toml',
  'README.md', 'LICENSE', 'LICENSE.md'
]); // matched at the theme root only

function walk(dir, base = dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;              // editors, OS, git
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(path.join(dir, entry.name), base, acc);
    } else {
      const rel = path.relative(base, path.join(dir, entry.name)).split(path.sep).join('/');
      // store handles, repo docs and other local files stay out of the upload
      if (!(LOCAL_ONLY.has(entry.name) && !rel.includes('/'))) acc.push(rel);
    }
  }
  return acc;
}

function zipDirectory(dir, outFile) {
  const files = walk(dir);
  const chunks = [];
  const central = [];
  let offset = 0;

  const dosTime = (() => {
    const d = new Date();
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff;
  })();
  const dosDate = (() => {
    const d = new Date();
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  })();

  files.forEach((name) => {
    const raw = fs.readFileSync(path.join(dir, name));
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);           // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, deflated);

    const dirEntry = Buffer.alloc(46);
    dirEntry.writeUInt32LE(0x02014b50, 0);
    dirEntry.writeUInt16LE(20, 4);
    dirEntry.writeUInt16LE(20, 6);
    dirEntry.writeUInt16LE(0, 8);
    dirEntry.writeUInt16LE(8, 10);
    dirEntry.writeUInt16LE(dosTime, 12);
    dirEntry.writeUInt16LE(dosDate, 14);
    dirEntry.writeUInt32LE(crc, 16);
    dirEntry.writeUInt32LE(deflated.length, 20);
    dirEntry.writeUInt32LE(raw.length, 24);
    dirEntry.writeUInt16LE(nameBuf.length, 28);
    dirEntry.writeUInt32LE(0, 38);
    dirEntry.writeUInt32LE(offset, 42);
    central.push(dirEntry, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  });

  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);

  fs.writeFileSync(outFile, Buffer.concat([...chunks, centralBuf, eocd]));
  return { files: files.length, bytes: fs.statSync(outFile).size };
}

/* ------------------------------ catalogue --------------------------------- */

function loadDb() {
  if (!fs.existsSync(DATA)) {
    console.error('No data/db.json found. Run `npm run seed` first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DATA, 'utf8'));
}

function collectionHandles(db, product) {
  const ids = new Set(product.collections || []);
  return db.collections
    .filter(c => ids.has(c.id) || (c.rules || []).some(r => (product.tags || []).includes(r.value)))
    .map(c => c.handle);
}

function buildProducts(db) {
  const rows = [];
  db.products.forEach((product, pIndex) => {
    const productCollections = collectionHandles(db, product);
    const tags = [...(product.tags || []), ...(product.collections || [])];
    const imageAlts = (product.images || []).map(i => i.alt || product.title);

    // Shopify's product CSV is one row per *variant*: option values must be a
    // single value, and the product-level fields are only carried on the first
    // row. Collapsing sizes into one cell would import as a variant literally
    // called "S, M, L" and sum the stock, so every variant gets its own row.
    const variants = product.variants || [];
    const hasColor = variants.some(v => v.color);
    const hasSize = variants.some(v => v.size);

    variants.forEach((variant, vi) => {
      const row = {
        Handle: product.handle,
        'Option1 Name': hasColor ? 'Colour' : (hasSize ? 'Size' : 'Title'),
        'Option1 Value': hasColor ? variant.color : (variant.size || 'One size'),
        'Option2 Name': hasColor && hasSize ? 'Size' : '',
        'Option2 Value': hasColor && hasSize ? variant.size : '',
        'Option3 Name': '',
        'Option3 Value': '',
        'Variant SKU': variant.sku || `${product.handle}-${String(vi + 1).padStart(3, '0')}`,
        'Variant Grams': product.shippingWeight || 400,
        'Variant Inventory Tracker': 'shopify',
        'Variant Inventory Qty': variant.stock == null ? 0 : variant.stock,
        'Variant Inventory Policy': 'deny',
        'Variant Fulfillment Service': 'manual',
        'Variant Price': money(variant.price),
        'Variant Compare At Price': variant.compareAtPrice ? money(variant.compareAtPrice) : '',
        'Variant Requires Shipping': product.digital ? 'FALSE' : 'TRUE',
        'Variant Taxable': 'TRUE',
        'Variant Barcode': ''
      };

      // first row of the product carries everything that describes the product
      if (vi === 0) {
        Object.assign(row, {
          Title: product.title,
          'Body (HTML)': product.descriptionHtml || `<p>${product.description || ''}</p>`,
          Vendor: db.settings.brandName || 'Vennix',
          Type: product.type,
          Tags: [...new Set(tags)].join(', '),
          Published: product.status === 'active' ? 'TRUE' : 'FALSE',
          'Image Src': (product.images || [])[0] ? `https://${db.settings.domain}${product.images[0].src}` : '',
          'Image Position': 1,
          'Image Alt Text': imageAlts[0] || product.title,
          'Gift Card': product.gifCard || product.digital ? 'TRUE' : 'FALSE',
          'SEO Title': (product.seo && product.seo.title) || product.title,
          'SEO Description': (product.seo && product.seo.description) || product.tagline || '',
          'Google Shopping / Google Product Category': '',
          Status: product.status === 'active' ? 'active' : 'draft',
          'Published At': product.publishedAt || '',
          Collections: productCollections.join(', ')
        });
      }
      rows.push(row);
    });

    // extra images ride along on follow-up rows, Shopify import convention
    (product.images || []).slice(1).forEach((image, i) => {
      rows.push({
        Handle: product.handle,
        'Image Src': `https://${db.settings.domain}${image.src}`,
        'Image Position': i + 2,
        'Image Alt Text': image.alt || product.title
      });
    });
  });

  const columns = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
    'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
    'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty',
    'Variant Inventory Policy', 'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price',
    'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode',
    'Image Src', 'Image Position', 'Image Alt Text', 'Gift Card', 'SEO Title', 'SEO Description',
    'Google Shopping / Google Product Category', 'Status', 'Published At', 'Collections'
  ].map(label => ({ label, get: row => row[label] }));

  return toCsv(rows, columns);
}

function buildCollections(db) {
  const rows = db.collections.map((collection, index) => ({
    Handle: collection.handle,
    Title: collection.title,
    'Body (HTML)': collection.descriptionHtml || `<p>${collection.description || ''}</p>`,
    'Sort Order': collection.sortOrder || (collection.handle === 'bestsellers' ? 'best-selling' : 'manual'),
    'Published': collection.status === 'hidden' ? 'FALSE' : 'TRUE',
    'Products': db.products
      .filter(p => (p.collections || []).includes(collection.id))
      .map(p => p.handle)
      .join(', '),
    'Smart Rules': (collection.rules || []).map(r => `${r.field} ${r.relation} "${r.value}"`).join(' AND '),
    'SEO Title': collection.seo && collection.seo.title ? collection.seo.title : collection.title,
    'SEO Description': collection.seo && collection.seo.description ? collection.seo.description : '',
    'Position': index + 1,
    'Image Alt': collection.imageAlt || collection.title
  }));

  const columns = ['Handle', 'Title', 'Body (HTML)', 'Sort Order', 'Published', 'Products', 'Smart Rules', 'SEO Title', 'SEO Description', 'Position', 'Image Alt']
    .map(label => ({ label, get: row => row[label] }));

  return toCsv(rows, columns);
}

function buildPages(db) {
  const rows = db.pages.map(page => ({
    Handle: page.handle,
    Title: page.title,
    'Body (HTML)': page.bodyHtml || '',
    Published: page.status === 'draft' ? 'FALSE' : 'TRUE',
    'SEO Title': page.seo && page.seo.title ? page.seo.title : page.title,
    'SEO Description': page.seo && page.seo.description ? page.seo.description : page.description || '',
    Template: page.template || 'page'
  }));

  const columns = ['Handle', 'Title', 'Body (HTML)', 'Published', 'SEO Title', 'SEO Description', 'Template']
    .map(label => ({ label, get: row => row[label] }));

  return toCsv(rows, columns);
}

function buildArticles(db) {
  const rows = [];
  db.posts.forEach(post => {
    rows.push({
      Handle: post.handle,
      Title: post.title,
      'Body (HTML)': post.bodyHtml || '',
      Blog: post.blog || 'journal',
      Tags: (post.tags || []).join(', '),
      Published: post.status === 'draft' ? 'FALSE' : 'TRUE',
      'Published At': post.publishedAt || '',
      Author: post.author || `${db.settings.brandName || 'Vennix'} Studio`,
      'Image Src': post.image ? `https://${db.settings.domain}${post.image}` : '',
      'Image Alt Text': post.imageAlt || post.title,
      'SEO Title': post.seo && post.seo.title ? post.seo.title : post.title,
      'SEO Description': post.seo && post.seo.description ? post.seo.description : post.excerpt || ''
    });
  });

  const columns = ['Handle', 'Title', 'Body (HTML)', 'Blog', 'Tags', 'Published', 'Published At', 'Author', 'Image Src', 'Image Alt Text', 'SEO Title', 'SEO Description']
    .map(label => ({ label, get: row => row[label] }));

  return toCsv(rows, columns);
}

function buildCustomers(db) {
  const rows = db.customers.map(customer => {
    const address = (customer.addresses || []).find(a => a.isDefault) || (customer.addresses || [])[0] || {};
    return {
      'First Name': customer.firstName,
      'Last Name': customer.lastName,
      Email: customer.email,
      Phone: customer.phone || address.phone || '',
      'Accepts Marketing': customer.marketing ? 'yes' : 'no',
      'Total Spent': money(db.orders.filter(o => o.customerId === customer.id && o.status !== 'cancelled').reduce((sum, o) => sum + o.total, 0)),
      'Orders': db.orders.filter(o => o.customerId === customer.id).length,
      Address1: address.address1 || '',
      Address2: address.address2 || '',
      City: address.city || '',
      Province: address.province || '',
      'Province Code': address.provinceCode || '',
      Country: address.country || 'United States',
      'Country Code': address.countryCode || 'US',
      Zip: address.zip || '',
      Tags: (customer.tags || []).join(', '),
      Note: customer.note || ''
    };
  });

  const columns = ['First Name', 'Last Name', 'Email', 'Phone', 'Accepts Marketing', 'Total Spent', 'Orders',
    'Address1', 'Address2', 'City', 'Province', 'Province Code', 'Country', 'Country Code', 'Zip', 'Tags', 'Note']
    .map(label => ({ label, get: row => row[label] }));

  return toCsv(rows, columns);
}

function buildDiscounts(db) {
  const rows = db.discounts.map(discount => ({
    Code: discount.code,
    Title: discount.title,
    Type: discount.type,
    Value: discount.type === 'percentage' ? `${discount.value}%` : money(discount.value),
    'Minimum Requirement': discount.minSubtotal ? `Subtotal ≥ ${money(discount.minSubtotal)}` : 'None',
    'Applies To': discount.appliesTo || 'All products',
    'Usage Limit': discount.usageLimit || 'Unlimited',
    Used: discount.used || 0,
    Status: discount.status,
    Starts: discount.startsAt || '',
    Ends: discount.endsAt || ''
  }));

  const columns = ['Code', 'Title', 'Type', 'Value', 'Minimum Requirement', 'Applies To', 'Usage Limit', 'Used', 'Status', 'Starts', 'Ends']
    .map(label => ({ label, get: row => row[label] }));

  return toCsv(rows, columns);
}

function buildMenus(db) {
  const collectionMenu = db.collections
    .filter(c => ['women', 'men', 'active', 'essentials', 'new-in', 'bestsellers', 'sale'].includes(c.handle))
    .map(c => ({ title: c.title, url: `/collections/${c.handle}` }));

  return {
    main_menu: [
      { title: 'New in', url: '/collections/new-in' },
      { title: 'Women', url: '/collections/women', children: collectionMenu.slice(0, 4) },
      { title: 'Men', url: '/collections/men', children: collectionMenu.slice(0, 4) },
      { title: 'Active', url: '/collections/active' },
      { title: 'Journal', url: '/blogs/journal' },
      { title: 'About', url: '/pages/about' }
    ],
    footer_menus: {
      shop: collectionMenu,
      help: [
        { title: 'FAQ', url: '/pages/faq' },
        { title: 'Shipping & returns', url: '/pages/shipping-returns' },
        { title: 'Size guide', url: '/pages/size-guide' },
        { title: 'Contact', url: '/pages/contact' }
      ],
      company: [
        { title: 'Our story', url: '/pages/about' },
        { title: 'Sustainability', url: '/pages/sustainability' },
        { title: 'Terms', url: '/pages/terms' },
        { title: 'Privacy', url: '/pages/privacy' }
      ]
    }
  };
}

/* --------------------------------- main ----------------------------------- */

function main() {
  const db = loadDb();
  fs.mkdirSync(CATALOG, { recursive: true });

  const outputs = {
    'products.csv': buildProducts(db),
    'collections.csv': buildCollections(db),
    'pages.csv': buildPages(db),
    'articles.csv': buildArticles(db),
    'customers.csv': buildCustomers(db),
    'discounts.csv': buildDiscounts(db),
    'menu.json': JSON.stringify(buildMenus(db), null, 2) + '\n',
    'catalog.json': JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        shop: {
          name: db.settings.brandName,
          domain: db.settings.domain,
          email: db.settings.supportEmail,
          currency: db.settings.currency,
          country: db.settings.countryCode
        },
        counts: {
          products: db.products.length,
          variants: db.products.reduce((sum, p) => sum + (p.variants || []).length, 0),
          collections: db.collections.length,
          pages: db.pages.length,
          articles: db.posts.length,
          customers: db.customers.length
        },
        products: db.products,
        collections: db.collections,
        pages: db.pages.map(p => ({ handle: p.handle, title: p.title, status: p.status })),
        posts: db.posts.map(p => ({ handle: p.handle, title: p.title, status: p.status })),
        discounts: db.discounts.map(d => ({ code: d.code, type: d.type, value: d.value, status: d.status }))
      },
      null,
      2
    ) + '\n'
  };

  Object.entries(outputs).forEach(([name, contents]) => {
    fs.writeFileSync(path.join(CATALOG, name), contents);
    const size = Buffer.byteLength(contents);
    console.log(`  ✓ catalog/${name}  (${(size / 1024).toFixed(1)} KB)`);
  });

  if (fs.existsSync(THEME)) {
    const zipPath = path.join(OUT, 'theme.zip');
    const result = zipDirectory(THEME, zipPath);
    console.log(`  ✓ theme.zip  (${result.files} files, ${(result.bytes / 1024).toFixed(1)} KB)`);
  } else {
    console.log('  ! shopify-theme/ not found — skipped theme.zip');
  }

  console.log('\nShopify deployment bundle ready in dist/shopify/');
  console.log('  1. Products → Import:  catalog/products.csv');
  console.log('  2. Content → Import:   catalog/pages.csv, catalog/articles.csv');
  console.log('  3. Customers → Import: catalog/customers.csv');
  console.log('  4. Discounts:          recreate from catalog/discounts.csv');
  console.log('  5. Navigation:         paste catalog/menu.json into Online Store → Navigation');
  console.log('  6. Theme:              Online Store → Themes → Upload theme.zip\n');
}

if (require.main === module) main();

module.exports = { buildProducts, buildCollections, buildPages, buildArticles, buildCustomers, buildDiscounts, buildMenus, zipDirectory, toCsv };
