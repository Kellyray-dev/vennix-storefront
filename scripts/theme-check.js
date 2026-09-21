#!/usr/bin/env node
/**
 * Offline theme validator — catches the mistakes `shopify theme check` catches,
 * without needing the CLI or network:
 *
 *   • every JSON template/config/locale parses
 *   • every section type referenced by a template exists in sections/
 *   • every {% render 'snippet' %} target exists
 *   • every {% schema %} block is valid JSON with sane keys
 *   • every translation key used with `| t` exists in locales/en.default.json
 *   • required OS 2.0 files are present
 *
 * Usage: node scripts/theme-check.js [themeDir]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const THEME = path.resolve(process.argv[2] || path.join(ROOT, 'shopify-theme'));

let failures = 0;
let checks = 0;
const fail = message => { failures += 1; console.log('  ✗ ' + message); };
const pass = message => { checks += 1; console.log('  ✓ ' + message); };

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${path.relative(THEME, file)} — ${error.message}`);
    return null;
  }
}

function walk(dir, filter = () => true) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const rel = file => path.relative(THEME, file).split(path.sep).join('/');

console.log(`\nVennix theme check — ${rel(THEME) || THEME}\n`);

/* 1. required files -------------------------------------------------------- */
console.log('Required files');
['layout/theme.liquid', 'config/settings_schema.json', 'config/settings_data.json', 'locales/en.default.json', 'assets/theme.css', 'assets/theme.js']
  .forEach(file => {
    if (fs.existsSync(path.join(THEME, file))) pass(file);
    else fail(`missing ${file}`);
  });

/* 2. JSON parses ----------------------------------------------------------- */
console.log('\nJSON validity');
const jsonFiles = walk(THEME, f => f.endsWith('.json'));
let badJson = 0;
jsonFiles.forEach(file => { const parsed = readJson(file); if (!parsed) badJson += 1; });
if (!badJson) pass(`${jsonFiles.length} JSON files parse`);

/* 3. templates reference real sections ------------------------------------ */
console.log('\nTemplates → sections');
const sectionTypes = new Set(walk(path.join(THEME, 'sections'), f => f.endsWith('.liquid')).map(f => path.basename(f, '.liquid')));
const templateFiles = walk(path.join(THEME, 'templates'), f => f.endsWith('.json'));
let wiredSections = 0;
templateFiles.forEach(file => {
  const json = readJson(file);
  if (!json || !json.sections) return;
  Object.entries(json.sections).forEach(([key, section]) => {
    wiredSections += 1;
    if (!sectionTypes.has(section.type)) fail(`${rel(file)} → section "${section.type}" (${key}) does not exist`);
  });
});
pass(`${templateFiles.length} templates wire up ${wiredSections} section instances`);

/* 4. render targets exist -------------------------------------------------- */
console.log('\nSnippet references');
const snippetNames = new Set(walk(path.join(THEME, 'snippets'), f => f.endsWith('.liquid')).map(f => path.basename(f, '.liquid')));
const liquidFiles = walk(THEME, f => f.endsWith('.liquid'));
let renderCount = 0;
liquidFiles.forEach(file => {
  const source = fs.readFileSync(file, 'utf8');
  const matches = source.matchAll(/{%-?\s*render\s+'([^']+)'/g);
  for (const match of matches) {
    renderCount += 1;
    if (!snippetNames.has(match[1])) fail(`${rel(file)} renders missing snippet "${match[1]}"`);
  }
});
pass(`${renderCount} render tags resolve to ${snippetNames.size} snippets`);

/* 5. schema blocks valid --------------------------------------------------- */
console.log('\nSection schemas');
let schemaCount = 0;
walk(path.join(THEME, 'sections'), f => f.endsWith('.liquid')).forEach(file => {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);
  if (!match) return;                                    // header/footer-ish partial sections may omit
  schemaCount += 1;
  try {
    const schema = JSON.parse(match[1]);
    if (!schema.name) fail(`${rel(file)} schema has no name`);
    (schema.blocks || []).forEach((block, i) => {
      if (!block.type) fail(`${rel(file)} schema block #${i} has no type`);
      if (!block.name) fail(`${rel(file)} schema block "${block.type}" has no name`);
    });
  } catch (error) {
    fail(`${rel(file)} schema is not valid JSON — ${error.message}`);
  }
});
pass(`${schemaCount} section schemas valid`);

/* 6. translation keys ------------------------------------------------------ */
console.log('\nTranslation keys');
const locale = readJson(path.join(THEME, 'locales', 'en.default.json')) || {};
const flat = (obj, prefix = '') => Object.entries(obj).reduce((acc, [key, value]) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(acc, flat(value, `${prefix}${key}.`));
  else acc[`${prefix}${key}`] = value;
  return acc;
}, {});
const localeKeys = new Set(Object.keys(flat(locale)));

const usedKeys = new Map();
liquidFiles.forEach(file => {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/['"]([a-z0-9_.]+)['"]\s*\|\s*t\b/g)) {
    if (!usedKeys.has(match[1])) usedKeys.set(match[1], rel(file));
  }
});
const missing = [...usedKeys.entries()].filter(([key]) => !localeKeys.has(key));
if (missing.length) missing.slice(0, 15).forEach(([key, file]) => fail(`missing translation key "${key}" (used in ${file})`));
else pass(`${usedKeys.size} translation keys all present in en.default.json`);

/* 7. asset references ------------------------------------------------------ */
console.log('\nAsset references');
const assetNames = new Set(walk(path.join(THEME, 'assets')).map(f => path.basename(f)));
let assetRefs = 0;
liquidFiles.forEach(file => {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/'([^']+)'\s*\|\s*asset_url/g)) {
    assetRefs += 1;
    if (!assetNames.has(match[1])) fail(`${rel(file)} references missing asset "${match[1]}"`);
  }
});
pass(`${assetRefs} asset_url references resolve`);

/* 8. style / settings sanity ---------------------------------------------- */
console.log('\nSettings parity');
const schema = readJson(path.join(THEME, 'config', 'settings_schema.json')) || [];
const schemaIds = schema.flatMap(group => (group.settings || []).map(s => s.id));
const settingsData = readJson(path.join(THEME, 'config', 'settings_data.json')) || { current: {} };
const unknownSettings = Object.keys(settingsData.current || {}).filter(id => !schemaIds.includes(id));
if (unknownSettings.length) fail(`settings_data.json has ids not in the schema: ${unknownSettings.join(', ')}`);
else pass(`${Object.keys(settingsData.current || {}).length} settings align with the schema`);

console.log(`\n${failures === 0 ? '✓ theme check passed' : '✗ ' + failures + ' problem(s)'} — ${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
