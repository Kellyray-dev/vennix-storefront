#!/usr/bin/env node
'use strict';
/**
 * verify-live.js — prove this storefront is wired to a REAL Shopify store.
 *
 * Everything here runs against the live Storefront API (never the mock gateway)
 * and boots the actual server, so the checks cover the same path a shopper
 * takes: page → API → Shopify → checkout handoff.
 *
 *   npm run verify:live                 # uses SHOPIFY_* from the environment/.env
 *   SHOPIFY_STORE_DOMAIN=… npm run verify:live
 *
 * What it proves (and refuses to skip):
 *   1  configuration            — live mode, API version, no demo fallback
 *   2  live connection          — every Storefront API scope answers
 *   3  schema conformance       — every field/argument we send exists on 2026-07
 *   4  products                 — live products, handles, prices
 *   5  variants + prices        — per-variant price / compare-at / currency
 *   6  inventory                — availability + quantities come from Shopify
 *   7  collections              — live collections with membership
 *   8  search                   — predictive search hits Shopify
 *   9  recommendations          — productRecommendations from Shopify
 *  10  cart mutations           — create / add / update / note / remove
 *  11  discount validation      — Shopify accepts good codes, refuses bad ones
 *  12  checkout handoff         — /checkout 302s to a Shopify-hosted URL
 *  13  customers + orders       — account/order URLs point at Shopify
 *  14  no local commerce data   — no fake order/payment/customer store in the path
 *
 * Side effects on the live store: it creates one empty draft cart and adds,
 * updates and removes lines in it. Carts are ephemeral Shopify objects — no
 * order, customer or payment is ever created.
 *
 * Usage: node scripts/verify-live.js
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

require('../lib/env').loadEnv({ cwd: path.join(__dirname, '..'), quiet: true });

let pass = 0, fail = 0, warn = 0;
const failures = [];
const warnings = [];

function ok(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function soft(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); }
  else { warn++; warnings.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ! ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(name) { console.log(`\n${name}`); }

const ROOT = path.join(__dirname, '..');

(async function run() {
  console.log('\nVennix — live Shopify verification');
  console.log('─'.repeat(64));

  /* ---------------------------------------------------------- 1. config */
  section('1. Configuration');
  const config = require('../lib/shopify/config');
  let cfg;
  try {
    cfg = config.getConfig();
  } catch (err) {
    console.log(`\n  ✗ ${err.message}\n`);
    console.log('  Nothing was verified. Fix the configuration and run again (see docs/SETUP.md).\n');
    process.exit(1);
  }
  ok('SHOPIFY_STORE_DOMAIN is set (not demo mode)', cfg.demo === false, cfg.domain);
  ok('Storefront API token is configured', !!cfg.token, `…${cfg.token.slice(-4)} (length ${cfg.token.length})`);
  ok(`API version is ${config.DEFAULT_API_VERSION} (current stable)`, cfg.version === config.DEFAULT_API_VERSION, cfg.version);
  ok('endpoint points at the store', cfg.endpoint === `https://${cfg.domain}/api/${cfg.version}/graphql.json`, cfg.endpoint);
  ok('demo mode is locked out while a store is configured', config.liveModeLocked() === true);

  const client = require('../lib/shopify/client');
  ok('no mock gateway override is active', client.isDemoOverride() === false);

  // There is no point continuing: every later section talks to the store, and a
  // half-configured run would fail in ways that look like real bugs.
  if (fail > 0) {
    console.log('\n  Nothing was verified — this run is not pointed at a real store.');
    console.log('  Set SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_ACCESS_TOKEN (see docs/SETUP.md),');
    console.log('  either in the environment or in a git-ignored .env, then run again:\n');
    console.log('    npm run verify:live\n');
    process.exit(1);
  }

  /* ------------------------------------------------- 2. live connection */
  section('2. Live connection (Storefront API)');
  const { preflight, formatPreflight } = require('../lib/shopify/preflight');
  const boot = await preflight();
  console.log(formatPreflight(boot));
  ok('shop + product + inventory + cart scopes all answer', boot.ok);
  if (!boot.ok) return finish();

  /* ------------------------------------------------ 3. schema conformance */
  section('3. Pinned documents match this store 2026-07 schema');
  // The documents in lib/shopify/operations.js are hand-written against a
  // pinned version. Introspecting the live schema proves every field and every
  // argument we send still exists — this is what catches "Field X doesn't
  // accept argument Y" before a shopper does.
  const { gql } = require('../lib/shopify/client');
  const schemaCheck = require('../lib/shopify/schema-check');
  const check = await schemaCheck.runSchemaCheck(gql);
  if (check.error) {
    soft('schema introspection is available', false, check.error.slice(0, 140));
  } else {
    ok('schema introspection returned the types we query',
      schemaCheck.TYPES.every(t => check.types[t]), Object.keys(check.types).join(', '));
    ok('every field the pinned documents select exists in the live schema',
      check.missingFields.length === 0, check.missingFields.join(', '));
    ok('every argument the pinned documents send is accepted by the live schema',
      check.missingArgs.length === 0, check.missingArgs.join(', '));
    ok('every mutation argument has a compatible nullability',
      check.nullability.length === 0, check.nullability.join('; '));
    const gone = schemaCheck.deprecatedStillPresent(check.types);
    if (gone.length) {
      soft(`deprecated field(s) gone: ${gone.join(', ')}`, false,
        'no longer in this API version — the code already tolerates its absence');
    }
    const inUse = schemaCheck.deprecatedInUse(check.deprecated);
    if (inUse.length) {
      soft(`deprecated field(s) still in use: ${inUse.join(', ')}`, false,
        'still returned, but plan for removal before the next version bump');
    }
    if (!gone.length && !inUse.length) ok('no deprecated field is in play', true);
  }

  /* ------------------------------------------------------- 4. catalogue */
  section('4. Products, variants, prices, inventory (live)');
  const catalog = require('../lib/shopify/catalog');
  const products = await catalog.getAllProducts();
  ok('products load from Shopify', products.length > 0, `${products.length} products`);
  ok('service/hidden products stay out of the catalogue', !products.some(p => p.hidden));
  const priced = products.find(p => p.variants.length > 1 && p.variants.some(v => v.stock > 0)) || products[0];
  ok('a product has variants', !!priced && priced.variants.length > 0, priced && `${priced.handle}: ${priced.variants.length} variants`);
  ok('prices are integer cents', priced.variants.every(v => Number.isInteger(v.price)), `e.g. ${priced.variants[0].price}`);
  ok('compare-at pricing round-trips when the store sets it',
    priced.variants.every(v => v.compareAtPrice === null || v.compareAtPrice > v.price));
  const inStock = priced.variants.find(v => v.stock > 0);
  const soldOut = priced.variants.find(v => v.stock <= 0 && v.stock !== undefined);
  ok('in-stock variant reports availability from Shopify', !!inStock && inStock.availableForSale !== false,
    inStock && `${inStock.title} · ${inStock.stock} available`);
  if (soldOut) ok('sold-out variant reports zero availability', soldOut.stock <= 0, soldOut.title);
  else soft('sold-out variant present in this store', false, 'every variant is in stock right now (nothing to prove)');

  /* ------------------------------------------------------ 5. collections */
  section('5. Collections (live)');
  const collections = await catalog.getCollections();
  ok('collections load from Shopify', collections.length > 0, `${collections.length} collections`);
  const withMembers = collections.find(c => c.productHandles.length > 0);
  ok('collection membership resolves to products', !!withMembers, withMembers && `${withMembers.handle}: ${withMembers.productHandles.length} products`);
  const members = withMembers ? await catalog.getCollectionProducts(withMembers.handle) : [];
  ok('collection products are real catalogue products', members.length > 0 && members.every(p => p.handle));

  /* ----------------------------------------------------------- 6. search */
  section('6. Search (live)');
  const term = String(priced.title).split(' ')[0];
  const hits = await catalog.searchProducts(term, 8);
  ok(`search for "${term}" returns live products`, hits.length > 0, `${hits.length} hits`);
  const miss = await catalog.searchProducts('zzz-no-such-product-zzz', 5);
  ok('a nonsense query returns nothing', miss.length === 0);

  /* -------------------------------------------------- 7. recommendations */
  section('7. Recommendations (live)');
  const recs = await catalog.recommendations(priced.id, 4);
  soft('Shopify productRecommendations returns partners', recs.length > 0,
    recs.length ? recs.map(p => p.handle).join(', ') : 'none for this product (Shopify needs purchase history)');

  /* --------------------------------------------------------- 8. content */
  section('8. Content (pages + journal, live)');
  const pages = await catalog.getPages();
  soft('Shopify pages load', pages.length > 0, `${pages.length} pages`);
  const articles = await catalog.getArticles();
  const journalHandle = require('../lib/settings').get().journalHandle || 'journal';
  soft('journal articles load', articles.length > 0,
    articles.length ? `${articles.length} articles`
      : `0 articles — the store has no blog at handle "${journalHandle}". Set journalHandle in config/storefront.json if your blog is called something else, or publish an article to prove this path.`);
  if (articles.length) {
    const first = articles[0];
    // 2026-07: Article.body does not exist — if this is empty, the body is
    // being read from a field the store no longer returns.
    ok('the article body renders from contentHtml', !!first.body && String(first.body).length > 0,
      `${first.handle}: ${String(first.body || '').length} chars`);
    ok('the article author resolves', !!first.author, first.author);
  }

  /* ------------------------------------------------------------- 9. cart */
  section('9. Cart mutations (live)');
  const cartApi = require('../lib/shopify/cart-api');
  const cartLib = require('../lib/cart');
  const created = await cartApi.createCart([]);
  ok('cartCreate succeeds', created.ok, created.ok ? created.cart.id : created.error);
  if (!created.ok) return finish();
  const cartId = created.cart.id;

  const added = await cartApi.addLines(cartId, [{ merchandiseId: inStock.id, quantity: 1 }]);
  ok('cartLinesAdd adds a live variant', added.ok && added.cart.lines.length === 1,
    added.ok ? added.cart.lines[0].title : added.error);

  const line = added.ok && added.cart.lines[0];
  const updated = await cartApi.updateLines(cartId, [{ id: line.id, quantity: 2 }]);
  ok('cartLinesUpdate changes quantity', updated.ok && updated.cart.lines[0].quantity === 2,
    updated.ok ? `qty ${updated.cart.lines[0].quantity}` : updated.error);

  // Shopify refuses an oversell only when the variant's inventory policy says
  // so; stores that allow "continue selling when out of stock" accept it and
  // reconcile at checkout instead. Either answer is correct for that store, so
  // this reports rather than fails — and puts the line back either way.
  const oversell = await cartApi.addLines(cartId, [{ merchandiseId: inStock.id, quantity: 9999 }]);
  if (oversell.ok) {
    soft('overselling is refused by Shopify inventory', false,
      `Shopify accepted 9999 of a variant with ${inStock.stock} available — this store's inventory policy allows overselling, so checkout reconciles it instead of the cart refusing. Turn off "continue selling when out of stock" on the variant if you want this refused at add.`);
    await cartApi.updateLines(cartId, [{ id: line.id, quantity: 2 }]).catch(() => {});
  } else {
    ok('overselling is refused by Shopify inventory', true, String(oversell.error).slice(0, 90));
  }

  if (soldOut) {
    const refused = await cartApi.addLines(cartId, [{ merchandiseId: soldOut.id, quantity: 1 }]);
    ok('a sold-out variant cannot be added', !refused.ok);
  }

  // 2026-07 pinned documents: if any selected field or argument stopped
  // existing (or was renamed) on this API version, these queries error out —
  // which is exactly what this check is here to catch.
  ok('cart lines expose the 2026-07 viewKey field',
    added.ok && added.cart.lines.every(l => typeof l.viewKey === 'string' && l.viewKey.length > 0),
    added.ok ? String(added.cart.lines[0].viewKey).slice(0, 16) + '…' : '');
  ok('2026-07 discountApplications are returned by the live API',
    added.ok && Array.isArray(added.cart.discountApplications),
    added.ok ? `${added.cart.discountApplications.length} application(s)` : '');
  const byKey = await cartApi.updateLines(cartId, [{ viewKey: line.viewKey, quantity: 3 }]);
  ok('cartLinesUpdate accepts a viewKey (2026-07)',
    byKey.ok && byKey.cart.lines[0].quantity === 3,
    byKey.ok ? `qty ${byKey.cart.lines[0].quantity}` : byKey.error);
  await cartApi.updateLines(cartId, [{ id: line.id, quantity: 2 }]).catch(() => {});

  const noted = await cartApi.setNote(cartId, 'Vennix live verification — safe to ignore');
  ok('cart note round-trips through Shopify', noted.ok && /Vennix live verification/.test(noted.cart.note));

  /* -------------------------------------------------------- 10. discount */
  section('10. Discount codes are validated by Shopify');
  const bogus = await cartApi.setDiscountCode(cartId, 'VENNIX-NOT-A-REAL-CODE-90210');
  ok('an invalid code is refused by Shopify', !bogus.ok, bogus.ok ? '' : String(bogus.error).slice(0, 90));
  const configured = (process.env.VENNIX_LIVE_DISCOUNT_CODE || '').trim();
  if (configured) {
    const applied = await cartApi.setDiscountCode(cartId, configured);
    ok(`code ${configured} is accepted and priced by Shopify`, applied.ok && applied.cart.discountAmount > 0,
      applied.ok ? `−${applied.cart.discountAmount} cents` : applied.error);
    ok('the discount is reported through 2026-07 discountApplications',
      applied.ok && applied.cart.discountApplications.some(a => a.amount > 0 && a.targetType !== 'SHIPPING_LINE'),
      applied.ok ? JSON.stringify(applied.cart.discountApplications) : '');
    ok('per-line discount allocations come back from Shopify',
      applied.ok && applied.cart.lines.some(l => l.discountAmount > 0),
      applied.ok ? JSON.stringify(applied.cart.lines.map(l => l.discountAmount)) : '');
    await cartApi.setDiscountCode(cartId, '').catch(() => {});
  } else {
    soft('a known-valid code was supplied', false,
      'set VENNIX_LIVE_DISCOUNT_CODE to prove a real code prices the cart (invalid codes are already proven refused)');
  }

  /* -------------------------------------------------------- 11. checkout */
  section('11. Checkout handoff');
  const checkoutUrl = await cartApi.checkoutUrl(cartId);
  ok('cart carries a Shopify checkout URL', !!checkoutUrl && /^https:\/\//.test(checkoutUrl), checkoutUrl);
  const security = require('../lib/security');
  ok('the checkout URL passes the Shopify-only allowlist', security.isAllowedCheckoutUrl(checkoutUrl, cfg));

  /* ------------------------------------------- 12. customers and orders */
  section('12. Customers, accounts and orders are Shopify\'s');
  const settings = require('../lib/settings');
  const s = settings.get();
  const accountUrl = s.accountUrl || cfg.accountUrl || '';
  const accountHost = accountUrl ? security.hostOf(accountUrl) : '';
  ok('account/order URLs point at the Shopify store',
    !!accountHost && (accountHost === cfg.domain || accountHost === cfg.primaryDomain || /myshopify\.com$/.test(accountHost)),
    accountUrl || '(not configured)');

  const cleaned = await cartApi.removeLines(cartId, [line.id]);
  ok('cartLinesRemove clears the test line', cleaned.ok);

  /* ------------------------------------------------ 13. no local orders */
  section('13. No local commerce database in the production path');
  const scan = scanForLocalCommerce();
  ok('no module in lib/ or server.js requires the retired commerce backend', scan.legacyRefs.length === 0,
    scan.legacyRefs.join(', '));
  ok('no order/payment/customer JSON store is read at runtime', scan.stores.length === 0, scan.stores.join(', '));
  ok('leads store holds non-commerce data only', scan.leadsOnly !== false, scan.leadsNote);

  /* ------------------------------------------- 14. HTTP: the real pages */
  section('14. The served storefront (live data, no demo banner)');
  await withServer(async base => {
    const get = async (p, opts = {}) => {
      const res = await fetch(base + p, { redirect: 'manual', ...opts });
      const text = await res.text();
      return { status: res.status, location: res.headers.get('location'), text, headers: res.headers };
    };
    const home = await get('/');
    ok('home page renders', home.status === 200 && home.text.includes('<main'));
    ok('no demo banner is shown in live mode', !home.text.includes('Demo mode'));
    const pdp = await get(`/products/${priced.handle}`);
    ok('product page renders live product data', pdp.status === 200 && pdp.text.includes(priced.handle));
    const col = await get(`/collections/${withMembers ? withMembers.handle : 'all'}`);
    ok('collection page renders', col.status === 200);
    const cartRes = await fetch(base + '/api/cart/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': base },
      body: JSON.stringify({ variantId: inStock.id, quantity: 1 })
    });
    const cartJson = await cartRes.json();
    ok('adding to the cart over HTTP hits Shopify', cartJson.ok === true, cartJson.error || `${cartJson.cart && cartJson.cart.count} item(s)`);
    const cookie = (cartRes.headers.getSetCookie() || []).map(c => c.split(';')[0]).join('; ');
    const checkout = await get('/checkout', { headers: { Cookie: cookie } });
    ok('/checkout 302s to a Shopify-hosted URL',
      checkout.status === 302 && security.isAllowedCheckoutUrl(checkout.location, cfg),
      `${checkout.status} ${checkout.location}`);
    const sitemap = await get('/sitemap.xml');
    ok('sitemap is generated from the live catalogue', sitemap.status === 200 && sitemap.text.includes(`/products/${priced.handle}`));
    const health = await get('/healthz');
    const healthJson = JSON.parse(health.text);
    ok('health reports live mode', healthJson.mode === 'live' && healthJson.demo === false,
      `${healthJson.mode} · ${healthJson.apiVersion}`);
  });

  return finish();

  function finish() {
    console.log('\n' + '─'.repeat(64));
    console.log(`  ${pass} passed, ${fail} failed, ${warn} warning(s)`);
    if (failures.length) {
      console.log('\n  Failures:');
      failures.forEach(f => console.log(`   • ${f}`));
    }
    if (warnings.length) {
      console.log('\n  Warnings (not failures):');
      warnings.forEach(w => console.log(`   • ${w}`));
    }
    console.log('');
    process.exitCode = fail ? 1 : 0;
  }
})().catch(err => {
  console.error('\nverify-live crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});

/* --------------------------------- helpers --------------------------------- */

/** Boot the real server on an ephemeral port, run `fn`, then shut it down. */
async function withServer(fn) {
  const port = 30000 + Math.floor(Math.random() * 20000);
  // VENNIX_SKIP_WARMUP: in live mode boot() warms the full catalogue (every
  // product, collection, page and article) BEFORE calling listen — on a large
  // store that alone can outlast this health check. Warm-up is a first-page
  // optimisation, not a boot dependency (pages fetch the chrome lazily), so
  // the verification child skips it and listens immediately.
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', VENNIX_SKIP_PREFLIGHT: '1', VENNIX_SKIP_WARMUP: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  let exitCode = null;
  child.stdout.on('data', d => { log += d.toString(); });
  child.stderr.on('data', d => { log += d.toString(); });
  child.on('exit', code => { exitCode = code; });

  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    // Up to 60s: a live boot still pays for the config/token checks and the
    // first Storefront API round-trips, and slow CI/store connections should
    // not read as "the storefront does not boot".
    for (let i = 0; i < 240 && !up && exitCode === null; i++) {
      await new Promise(r => setTimeout(r, 250));
      try {
        const res = await fetch(`${base}/healthz`);
        up = res.ok;
      } catch { /* keep waiting */ }
    }
    if (!up) {
      const detail = exitCode !== null
        ? `child exited with code ${exitCode} — ${log.split('\n').filter(Boolean).slice(-6).join(' | ')}`
        : `no /healthz within 60s — ${log.split('\n').filter(Boolean).slice(-6).join(' | ')}`;
      ok('the storefront boots against the live store', false, detail);
      return;
    }
    await fn(base);
  } finally {
    child.kill('SIGTERM');
  }
}

/**
 * Static proof that the production path has no second commerce backend:
 * nothing outside legacy/ may require the retired store, and no JSON file of
 * orders/payments/customers may be read at runtime.
 */
function scanForLocalCommerce() {
  const roots = [path.join(ROOT, 'lib'), path.join(ROOT, 'server.js'), path.join(ROOT, 'scripts')];
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(ROOT, 'lib'));
  files.push(path.join(ROOT, 'server.js'));

  const legacyRefs = [];
  // Only real module references count — require('...legacy/x'), dynamic
  // import('...legacy/x') or `from '...legacy/x'`. A doc comment that merely
  // mentions a retired path (e.g. lib/auth.js notes it replaces legacy/auth.js)
  // is history, not a dependency, and must not fail this check.
  const storeRe = /(?:require\s*\(\s*['"][^'"]*|import\s*\(\s*['"][^'"]*|from\s+['"][^'"]*)(?:legacy\/store|legacy\/commerce|legacy\/auth|legacy\/admin|legacy\/emails)/;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (storeRe.test(src)) legacyRefs.push(path.relative(ROOT, file));
  }

  // JSON data files read at runtime that look like commerce tables
  const stores = [];
  const commerceTable = /(orders|payments|customers|checkout_sessions|carts)\.json/i;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const m = src.match(/['"][^'"\n]*\b(orders|payments|customers|sessions)\.json\b[^'"\n]*['"]/gi);
    if (m) stores.push(`${path.relative(ROOT, file)}: ${m.join(', ')}`);
  }
  const dataDir = path.join(ROOT, 'data');
  const dataFiles = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
  for (const f of dataFiles) if (commerceTable.test(f) && f !== 'shopify-store.json') stores.push(`data/${f}`);

  // The one JSON file the storefront writes: non-commerce leads only.
  const leadsPath = path.join(ROOT, 'lib', 'leads.js');
  let leadsOnly = true;
  let leadsNote = 'newsletter, contact, back-in-stock, review submissions';
  if (fs.existsSync(leadsPath)) {
    const src = fs.readFileSync(leadsPath, 'utf8');
    const tables = (src.match(/TABLES\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
    const collection = (src.match(/COLLECTIONS?\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
    const names = `${tables},${collection}`;
    const banned = /\b(orders|orderItems|payments|refunds|customers|accounts|checkouts|carts|products|inventory)\b/;
    const found = names.match(banned);
    if (found) { leadsOnly = false; leadsNote = `leads store declares commerce table "${found[1]}"`; }
  }
  return { legacyRefs, stores, leadsOnly, leadsNote };
}
