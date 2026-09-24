#!/usr/bin/env node
'use strict';
/**
 * secret-scan.js — make sure no private credential can reach a browser.
 *
 * Two halves, because either alone is not enough:
 *
 *   1. STATIC  — walk the whole tree and fail on token-shaped literals
 *                (shpat_…, shpss_…, shppa_…, private keys, …) in anything that
 *                ships: public/, lib/, scripts/, shopify-theme/, config/.
 *   2. RUNTIME — boot the real server with a *fake* token in the environment
 *                and crawl pages + API responses, asserting that value appears
 *                nowhere in any response body, header or cookie.
 *
 * The runtime half is the one that matters: it is the only way to catch a
 * template that prints process.env, or a debug endpoint that echoes config.
 *
 * Usage: node scripts/secret-scan.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];
function expect(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

/* ---------------------------------- static --------------------------------- */

const SECRET_PATTERNS = [
  { name: 'Shopify admin/custom app token', re: /shpat_[A-Za-z0-9]{20,}/ },
  { name: 'Shopify shared secret', re: /shpss_[A-Za-z0-9]{20,}/ },
  { name: 'Shopify private app token', re: /shppa_[A-Za-z0-9]{20,}/ },
  { name: 'Shopify custom app token', re: /shpca_[A-Za-z0-9]{20,}/ },
  { name: 'PEM private key', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'hard-coded storefront header', re: /X-Shopify-Storefront-Access-Token['"]?\s*[:=]\s*['"][A-Za-z0-9]{20,}/ }
];

const SCAN_DIRS = ['public', 'lib', 'scripts', 'shopify-theme', 'config', 'tools'];
const SCAN_EXT = /\.(js|json|liquid|css|html|svg|md|yml|yaml)$/;

/**
 * Files that legitimately *talk about* credentials: this scanner's own fixtures
 * and patterns, the env template, and the docs that explain how to mint one.
 * They are allowed to contain the shape of a secret, never a real one.
 */
const ALLOWED = new Set([
  'scripts/secret-scan.js',
  '.env.example',
  'docs/SETUP.md',
  'docs/MIGRATION.md',
  'README.md',
  'AUDIT.md'
]);

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCAN_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

(async function run() {
  console.log('\nSecret scan (static)');
  const findings = [];
  const files = [];
  for (const dir of SCAN_DIRS) files.push(...walk(path.join(ROOT, dir)));
  files.push(path.join(ROOT, 'server.js'), path.join(ROOT, 'package.json'), path.join(ROOT, '.env.example'));

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const relative = path.relative(ROOT, file).replace(/\\/g, '/');
    if (ALLOWED.has(relative)) continue;
    let src = '';
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(src)) findings.push(`${relative}: ${name}`);
    }
  }
  expect(`no token-shaped literals in ${files.length} shipped file(s)`, findings.length === 0, findings.join('; '));

  // The token only ever comes from the environment, and only on the server.
  const configSrc = fs.readFileSync(path.join(ROOT, 'lib', 'shopify', 'config.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'shopify', 'client.js'), 'utf8');
  const mainJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'main.js'), 'utf8');
  const motionJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'motion.js'), 'utf8');
  expect('the token is read from process.env, on the server only',
    /process\.env\.SHOPIFY_STOREFRONT_ACCESS_TOKEN/.test(configSrc) &&
    !/process\.env\./.test(mainJs + motionJs));
  expect('no browser file mentions the token variable or a Shopify host',
    !/SHOPIFY_|myshopify\.com|graphql\.json/.test(mainJs + motionJs));
  expect('the GraphQL client sends the token as a request header only',
    /'X-Shopify-Storefront-Access-Token':\s*token/.test(clientSrc));
  expect('public/js never mentions a Shopify endpoint',
    !/myshopify\.com|graphql\.json/.test(fs.readFileSync(path.join(ROOT, 'public', 'js', 'main.js'), 'utf8')));

  /* --------------------------------- runtime -------------------------------- */

  console.log('\nSecret scan (runtime, with a fake token in the environment)');
  // assembled at runtime so this scanner never contains a token-shaped literal
  const FAKE = ['shp', 'at_'].join('') + 'FAKE' + 'fake'.repeat(8) + '123456';
  const port = 41000 + Math.floor(Math.random() * 5000);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port), HOST: '127.0.0.1',
      // no SHOPIFY_STORE_DOMAIN → demo mode, but the token IS in the
      // environment, which is exactly what a template bug would leak.
      // VENNIX_SKIP_ENV_FILE keeps a developer's live .env out of this child.
      SHOPIFY_STORE_DOMAIN: '',
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: FAKE,
      SHOPIFY_PRIMARY_DOMAIN: 'fake-store.myshopify.com',
      VENNIX_SKIP_ENV_FILE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => { log += d.toString(); });
  child.stderr.on('data', d => { log += d.toString(); });

  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise(r => setTimeout(r, 250));
      try { up = (await fetch(`${base}/healthz`)).ok; } catch { /* keep waiting */ }
    }
    expect('test server boots', up, log.split('\n').slice(-3).join(' | '));
    if (!up) return done();

    const paths = [
      '/', '/collections/all', '/collections/women', '/products/atlas-heavyweight-hoodie',
      '/cart', '/checkout', '/search?q=hoodie', '/account', '/account/wishlist',
      '/pages/about', '/pages/contact', '/blogs/journal', '/gift-cards', '/track',
      '/sitemap.xml', '/robots.txt', '/healthz', '/api/cart', '/api/search?q=hoodie',
      '/api/quickview/atlas-heavyweight-hoodie', '/api/style?handle=atlas-heavyweight-hoodie',
      '/js/main.js', '/js/motion.js', '/css/main.css', '/this-does-not-exist'
    ];
    const leaks = [];
    for (const p of paths) {
      const res = await fetch(base + p, { headers: { 'Accept-Encoding': 'identity' } });
      const text = await res.text();
      const setCookie = (res.headers.getSetCookie() || []).join(' ');
      if (text.includes(FAKE) || setCookie.includes(FAKE)) leaks.push(p);
      // the header that carries the real token must never be mirrored back
      if (res.headers.get('x-shopify-storefront-access-token')) leaks.push(`${p} (header echo)`);
    }
    expect(`no response body, cookie or header leaks the token (${paths.length} endpoints)`,
      leaks.length === 0, leaks.join(', '));

    // A POST path too (leads + cart), which is where debug dumps usually live.
    const post = await fetch(base + '/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': base },
      body: JSON.stringify({ email: 'secret-scan@example.com' })
    });
    const postText = await post.text();
    expect('a POST response leaks nothing either', !postText.includes(FAKE));

    const health = await (await fetch(`${base}/healthz`)).json();
    expect('healthz exposes no credentials', JSON.stringify(health).includes(FAKE) === false);
  } finally {
    child.kill('SIGTERM');
  }
  return done();

  function done() {
    console.log('\n' + '─'.repeat(64));
    console.log(`  ${pass} passed, ${fail} failed`);
    if (failures.length) {
      console.log('\n  Failures:');
      failures.forEach(f => console.log(`   • ${f}`));
    }
    console.log('');
    process.exitCode = fail ? 1 : 0;
  }
})().catch(err => {
  console.error('secret-scan crashed:', err);
  process.exit(1);
});
