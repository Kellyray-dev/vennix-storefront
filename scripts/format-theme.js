#!/usr/bin/env node
/**
 * Carries your brand identity into the Shopify theme.
 *
 * Reads data/db.json (which `format-catalog.js` and the importer keep current)
 * and writes the store name, colours, social links and copy defaults into the
 * theme's settings, locale file and section defaults — so `npm run export`
 * produces a theme.zip that already says your brand on the storefront.
 *
 *   node scripts/format-theme.js                 # uses data/db.json
 *   node scripts/format-theme.js --brand "Northline Supply Co" --accent "#2F6E4F"
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'db.json');
const THEME = path.join(ROOT, 'shopify-theme');

const argv = process.argv.slice(2);
const arg = name => {
  const index = argv.indexOf('--' + name);
  return index > -1 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : null;
};

const db = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) : { settings: {} };
const settings = db.settings || {};

const brand = arg('brand') || settings.brandName || 'Vennix';
const accent = arg('accent') || null;
const tagline = arg('tagline') || settings.tagline || 'Modern essentials, engineered for movement.';
const domain = (arg('domain') || settings.domain || 'example.com').replace(/^https?:\/\//, '');

const write = (rel, contents) => {
  const file = path.join(THEME, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  console.log(`  ✓ ${rel}`);
};

console.log(`\nBranding the theme as ${brand}\n`);

/* ---------------------------------------------------------- settings_data */
const dataPath = path.join(THEME, 'config', 'settings_data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
if (accent) {
  data.current.colors_accent = accent;
  // Keep the Vennix preset in lockstep with current so applying the preset
  // doesn't revert to the previous palette (#A8603F → #8A6A4F, etc.).
  if (data.presets && data.presets[brand]) {
    data.presets[brand].colors_accent = accent;
  }
}
write('config/settings_data.json', JSON.stringify(data, null, 2) + '\n');

/* ------------------------------------------------------------ sections --- */
// logo-free word marks and footer copy read the shop name from Shopify itself,
// but the theme's default copy should still match the brand.
const footerPath = path.join(THEME, 'sections', 'footer.liquid');
let footer = fs.readFileSync(footerPath, 'utf8');
footer = footer.replace(/("id": "tagline", "label": "Tagline", "default": ")[^"]*(")/, `$1${tagline}$2`);
write('sections/footer.liquid', footer);

const heroPath = path.join(THEME, 'sections', 'hero.liquid');
let hero = fs.readFileSync(heroPath, 'utf8');
write('sections/hero.liquid', hero);

/* ---------------------------------------------------------------- locale -- */
const localePath = path.join(THEME, 'locales', 'en.default.json');
const locale = JSON.parse(fs.readFileSync(localePath, 'utf8'));
locale.customer.contact = locale.customer.contact || 'Contact us';
write('locales/en.default.json', JSON.stringify(locale, null, 2, ) + '\n');

/* ------------------------------------------------------------- shopify.to */
write('shopify.theme.toml', `# Used by the Shopify CLI: \`shopify theme dev\`, \`shopify theme push\`
# Set the store once and every command in this folder targets it.

[environments.default]
store = "${process.env.SHOPIFY_STORE || 'your-store.myshopify.com'}"
theme = ""

[environments.development]
store = "${process.env.SHOPIFY_STORE || 'your-store.myshopify.com'}"

[environments.production]
store = "${process.env.SHOPIFY_STORE || 'your-store.myshopify.com'}"
`);

/* ------------------------------------------------------------ README note - */
console.log(`\n  brand    ${brand}`);
console.log(`  domain   ${domain}`);
console.log(`  accent   ${accent || data.current.colors_accent}`);
console.log(`  tagline  ${tagline}`);
console.log('\nTheme branded. Run `npm run export` to rebuild dist/shopify/theme.zip.\n');
