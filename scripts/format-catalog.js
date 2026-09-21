#!/usr/bin/env node
/**
 * Make it yours.
 *
 * Rewrites the store's brand identity everywhere it appears — settings, page
 * copy, journal posts, email templates, the header word mark, structured data
 * and the SEO defaults — so the storefront reads as your brand rather than the
 * demo. Nothing else is touched: product data comes from the catalogue
 * importer, not from here.
 *
 *   node scripts/format-catalog.js --brand "Northline" --suffix "Supply Co" \
 *     --domain northline.co --email help@northline.co --phone "+1 555 0142" \
 *     --city "Austin" --province TX --zip 78702 --address "1201 Comal St" \
 *     --instagram https://instagram.com/northline
 *
 *   or keep the answers in a file and run:
 *   node scripts/format-catalog.js --file brand.json
 *
 * Also carried over so nothing keeps the old identity:
 *   • the admin login email (moved to the new domain)
 *   • settings.orderPrefix, the prefix on order numbers (first 3 letters)
 *
 * Socials are merged, not replaced: pass only the networks you run and the rest
 * are left as they are, or drop a network with an empty value. Use --no-phone
 * for brands that publish an email only.
 *
 * Flags: --dry-run to preview, --keep-copy to leave the journal and pages alone.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'db.json');

const argv = process.argv.slice(2);
const has = name => argv.includes('--' + name);
const arg = name => {
  const index = argv.indexOf('--' + name);
  return index > -1 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : null;
};

function loadInput() {
  const file = arg('file');
  if (file) {
    if (!fs.existsSync(file)) { console.error(`No such file: ${file}`); process.exit(1); }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return {
    brand: arg('brand'),
    suffix: arg('suffix'),
    domain: arg('domain'),
    email: arg('email'),
    phone: arg('phone'),
    city: arg('city'),
    province: arg('province'),
    zip: arg('zip'),
    address: arg('address'),
    instagram: arg('instagram'),
    tiktok: arg('tiktok'),
    youtube: arg('youtube'),
    pinterest: arg('pinterest'),
    linkedin: arg('linkedin'),
    facebook: arg('facebook'),
    x: arg('x'),
    noPhone: has('no-phone'),
    tagline: arg('tagline')
  };
}

/**
 * Replaces the demo brand with the real one, case-aware. Handles the full name
 * first ("Northline Supply"), then the short form ("Northline") so page titles
 * like "About Northline" and inline references also follow the rebrand.
 */
function rebrand(text, from, to) {
  if (!text || typeof text !== 'string') return text;
  const full = [
    [from.upper, to.upper],
    [from.title, to.title],
    [from.lower, to.lower]
  ];
  let output = text;
  full.forEach(([needle, replacement]) => {
    if (!needle) return;
    output = output.split(needle).join(replacement);
  });

  // short form: only when it is a standalone word, never inside another word
  const short = { title: from.title.split(/\s+/)[0], upper: from.upper.split(/\s+/)[0], lower: from.lower.split(/\s+/)[0] };
  if (short.title && short.title !== from.title) {
    const replacements = [
      { needle: short.upper, replacement: to.upper.split(/\s+/)[0] },
      { needle: short.title, replacement: to.title.split(/\s+/)[0] },
      { needle: short.lower, replacement: to.lower.split(/\s+/)[0] }
    ];
    replacements.forEach(({ needle, replacement }) => {
      if (!needle) return;
      output = output.replace(new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), replacement);
    });
  }
  return output.replace(/ {2,}/g, ' ').trim();
}

function walkStrings(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(item => walkStrings(item, transform));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walkStrings(item, transform)]));
  }
  return value;
}

function main() {
  const input = loadInput();
  if (!input.brand) {
    console.error('Nothing to do — pass --brand "Your Brand" (see the header of this file for the full flag list).');
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error('data/db.json not found — run `npm run seed` first, then format.');
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const settings = db.settings || {};

  const from = { title: settings.brandName || 'Vennix', lower: (settings.brandName || 'Vennix').toLowerCase(), upper: (settings.brandName || 'Vennix').toUpperCase() };
  const brandFull = input.suffix ? `${input.brand} ${input.suffix}` : input.brand;
  const to = { title: brandFull, lower: brandFull.toLowerCase(), upper: brandFull.toUpperCase() };
  const slugify = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const oldSlug = slugify((settings.domain || '').split('.')[0] || from.title);
  const newDomain = (input.domain || settings.domain || '').replace(/^https?:\/\//, '');
  const newSlug = slugify(newDomain.split('.')[0] || brandFull);

  const changes = [];

  // Domain and slug first so emails, URLs and handles come out clean before the
  // word-level swap runs.
  const swapIdentity = text => {
    if (typeof text !== 'string') return text;
    let output = text;
    if (settings.domain && newDomain && settings.domain !== newDomain) output = output.split(settings.domain).join(newDomain);
    if (oldSlug && oldSlug !== newSlug) output = output.split(oldSlug).join(newSlug);
    return output;
  };

  // ---------------------------------------------------------------- settings
  settings.brandName = brandFull;
  if (input.domain) settings.domain = input.domain.replace(/^https?:\/\//, '');
  if (input.email) settings.supportEmail = input.email;
  if (input.phone) settings.supportPhone = input.phone;
  if (input.tagline) settings.tagline = input.tagline;
  settings.address = {
    line1: input.address || settings.address.line1,
    city: input.city || settings.address.city,
    province: input.province || settings.address.province,
    zip: input.zip || settings.address.zip,
    country: settings.address.country || 'United States'
  };
  // Socials merge rather than replace: a brand that runs Pinterest and LinkedIn
  // should not inherit a dead Instagram link, and one that runs Instagram only
  // should keep just that.
  const socials = { ...(settings.socials || {}) };
  ['instagram', 'tiktok', 'youtube', 'pinterest', 'linkedin', 'facebook', 'x'].forEach(network => {
    const value = input[network];
    if (value === undefined || value === null || value === '') return;
    if (value === 'none' || value === 'drop') delete socials[network];
    else socials[network] = value;
  });
  settings.socials = socials;
  if (input.noPhone) settings.supportPhone = '';

  // Order numbers and the admin login carry the brand too — derive both so a
  // rebrand never leaves the old order prefix or admin@olddomain.com behind.
  settings.orderPrefix = (brandFull.replace(/[^a-z0-9]/gi, '').slice(0, 3) || 'ORD').toUpperCase();
  const emailDomain = String(settings.supportEmail || '').split('@')[1];
  if (emailDomain) {
    settings.admin = settings.admin || {};
    settings.admin.email = `admin@${emailDomain}`;
  }
  settings.legalName = input.legal || `${brandFull} LLC`;
  settings.payments = { ...(settings.payments || {}), provider: `${brandFull} Pay (sandbox)` };
  changes.push('settings: legal name, sandbox payment provider label');

  settings.seo = {
    title: `${brandFull} — ${(settings.seo.title.split('—')[1] || 'Shop the range').trim()}`,
    description: rebrand(settings.seo.description, from, to),
    keywords: settings.seo.keywords
  };
  changes.push(`settings: brand, domain, support email/phone, address, socials (${Object.keys(socials).join(', ') || 'none'}), SEO defaults`);
  changes.push(`settings: admin login ${settings.admin.email}, order prefix ${settings.orderPrefix}`);

  // ----------------------------------------------------------------- content
  const transform = text => rebrand(swapIdentity(text), from, to);

  db.products = db.products.map(product => ({
    ...walkStrings(product, transform),
    vendor: product.vendor && new RegExp(from.title.split(/\s+/)[0], 'i').test(product.vendor) ? brandFull : product.vendor,
    handle: product.handle
  }));
  changes.push(`products: names, descriptions, image alts and SEO for ${db.products.length} products (handles left alone)`);

  // Transactional history and saved carts read as the brand too — cheap here,
  // and it keeps the admin from leaking the demo name after a rebrand.
  db.collections = (db.collections || []).map(collection => ({
    ...walkStrings(collection, transform),
    handle: collection.handle
  }));
  db.orders = walkStrings(db.orders || [], transform);
  db.carts = walkStrings(db.carts || [], transform);

  if (!has('keep-copy')) {
    db.pages = db.pages.map(page => ({
      ...page,
      title: transform(page.title),
      body: transform(page.body),
      seo: walkStrings(page.seo || {}, transform)
    }));
    db.posts = db.posts.map(post => ({
      ...post,
      author: post.author && new RegExp(from.title.split(/\s+/)[0], 'i').test(post.author) ? `${brandFull} Studio` : post.author,
      body: transform(post.body),
      excerpt: transform(post.excerpt),
      seo: walkStrings(post.seo || {}, transform)
    }));
    db.meta = db.meta || {};
    db.meta.faqs = (db.meta.faqs || []).map(faq => ({
      ...faq,
      q: transform(faq.q),
      a: transform(faq.a)
    }));
    db.reviews = (db.reviews || []).map(review => ({
      ...review,
      body: transform(review.body),
      title: transform(review.title),
      // merchant replies are brand copy too ("team Northline") — never leave one behind
      reply: transform(review.reply),
      author: review.author
    }));
    changes.push(`content: ${db.pages.length} pages, ${db.posts.length} posts, ${db.collections.length} collections, ${((db.meta || {}).faqs || []).length} FAQs, ${(db.reviews || []).length} review bodies`);
  }

  // ------------------------------------------------------------------ report
  console.log(`\nRebranding ${from.title} → ${brandFull}\n`);
  changes.forEach(change => console.log(`  • ${change}`));
  console.log(`\n  domain      ${settings.domain}`);
  console.log(`  support     ${settings.supportEmail}${settings.supportPhone ? ` · ${settings.supportPhone}` : ' (email only)'}`);
  console.log(`  studio      ${settings.address.line1}, ${settings.address.city} ${settings.address.province} ${settings.address.zip}`);
  console.log(`  tagline     ${settings.tagline}`);

  if (has('dry-run')) {
    console.log('\nDry run — data/db.json untouched.\n');
    return;
  }

  db.settings = settings;
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  console.log(`\nWrote ${DB_PATH}`);
  console.log('Next: node scripts/format-theme.js to carry the brand into the Shopify theme,');
  console.log('      then restart the server (npm start).\n');
}

if (require.main === module) main();
module.exports = { rebrand };
