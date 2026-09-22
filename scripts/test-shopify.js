'use strict';
/**
 * test-shopify.js — the Shopify data-access layer, tested against the mock
 * Storefront-API gateway (same wire format as production, no network).
 *
 * Covers: config/env, GraphQL client, normalization (cents, hidden service
 * products), catalog reads (products, collections, pages, articles, search,
 * recommendations), and the full cart mutation surface including inventory
 * rules and discount validation.
 *
 * Usage: node scripts/test-shopify.js
 */

let pass = 0, fail = 0;
const failures = [];
function expect(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

(async function run() {
  console.log('\nShopify data layer → mock gateway\n' + '─'.repeat(48));

  /* ------------------------------------------------------------- config */
  console.log('\nConfig');
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  const config = require('../lib/shopify/config');
  const cfg = config.getConfig();
  expect('no store domain means demo mode', cfg.demo === true);

  /* ------------------------------------------------------------ gateway */
  console.log('\nGateway');
  const { startMockGateway } = require('../tools/mock-shopify/gateway');
  const gateway = await startMockGateway({ port: 0 });
  const health = await fetch(gateway.url.replace(/\/api\/.*/, '/healthz'));
  expect('gateway answers /healthz', health.status === 200);
  const client = require('../lib/shopify/client');
  client.setEndpoint(gateway.url);

  /* -------------------------------------------------------- normalization */
  console.log('\nCatalog reads + normalization');
  const catalog = require('../lib/shopify/catalog');
  const products = await catalog.getAllProducts();
  expect('products load', products.length >= 9, String(products.length));
  expect('hidden service product is filtered from the catalog', !products.some(p => p.handle === 'monogramming'));
  const hoodie = await catalog.getProductByHandle('atlas-heavyweight-hoodie');
  expect('money is normalized to integer cents', Number.isInteger(hoodie.price) && hoodie.price === 12800, String(hoodie.price));
  expect('variants carry stock as numbers', hoodie.variants.every(v => Number.isInteger(v.stock)));
  expect('sold-out fixture variant exists (Fog Heather / XS)', hoodie.variants.some(v => v.size === 'XS' && v.color === 'Fog Heather' && v.stock <= 0));
  expect('images normalized to {src}', hoodie.images.length > 0 && typeof hoodie.images[0].src === 'string');
  expect('options exposed for pickers', hoodie.options.some(o => o.name === 'Size'));

  const service = await catalog.getServiceProduct('monogramming');
  expect('getServiceProduct finds the hidden service product', !!service && service.handle === 'monogramming');
  expect('service product variant is priced in cents', service.variants[0].price === 2000);

  const byId = await catalog.getProductById(hoodie.id);
  expect('getProductById resolves the same product', !!byId && byId.handle === hoodie.handle);
  const found = await catalog.findVariant(hoodie.variants[0].id);
  expect('findVariant returns product + variant', !!found && found.variant.id === hoodie.variants[0].id && found.product.handle === hoodie.handle);

  const collections = await catalog.getCollections();
  expect('collections load with membership', collections.length >= 5 && collections.every(c => Array.isArray(c.productHandles)));
  const women = await catalog.getCollectionProducts('women');
  expect('collection product list resolves to products', women.length > 0 && women.every(p => p.handle));
  const missingCollection = await catalog.getCollection('does-not-exist');
  expect('unknown collection returns null', missingCollection === null);

  const pages = await catalog.getPages();
  expect('pages load', pages.length >= 8);
  const about = await catalog.getPage('about');
  expect('page body is prose (html)', about && about.body.includes('<'));
  const articles = await catalog.getArticles();
  expect('journal articles load', articles.length >= 3);
  const article = await catalog.getArticle(articles[0].handle);
  expect('single article resolves with body', !!article && article.body.length > 0);

  /* ------------------------------------------------------------ search */
  console.log('\nSearch + recommendations');
  const hit = await catalog.searchProducts('hoodie', 6);
  expect('search finds the hoodie', hit.some(p => p.handle === 'atlas-heavyweight-hoodie'));
  const miss = await catalog.searchProducts('zzz-no-match-zzz', 6);
  expect('search for nonsense is empty', miss.length === 0);
  const recs = await catalog.recommendations(hoodie.id, 4);
  expect('recommendations return other products', recs.length > 0 && recs.every(p => p.handle !== hoodie.handle));

  /* -------------------------------------------------------------- carts */
  console.log('\nCart mutations');
  const cartApi = require('../lib/shopify/cart-api');
  const inStock = hoodie.variants.find(v => v.stock > 5);
  const created = await cartApi.createCart([{ merchandiseId: inStock.id, quantity: 1 }]);
  expect('cartCreate succeeds', created.ok && created.cart.lines.length === 1);
  const cartId = created.cart.id;

  const oversell = await cartApi.addLines(cartId, [{ merchandiseId: inStock.id, quantity: 9999 }]);
  expect('oversell is blocked by inventory', !oversell.ok && /available/i.test(oversell.error));

  const soldOut = hoodie.variants.find(v => v.stock <= 0);
  const noStock = await cartApi.addLines(cartId, [{ merchandiseId: soldOut.id, quantity: 1 }]);
  expect('sold-out variant cannot be added', !noStock.ok);

  const serviceVariant = service.variants[0];
  const withAttrs = await cartApi.addLines(cartId, [{
    merchandiseId: serviceVariant.id, quantity: 1,
    attributes: [{ key: 'Monogram', value: 'AB' }, { key: 'Monogram for', value: inStock.id }]
  }]);
  expect('service line with attributes adds', withAttrs.ok && withAttrs.cart.lines.length === 2);
  expect('line attributes survive the round trip', withAttrs.cart.lines.some(l => l.attributes && l.attributes.Monogram === 'AB'));

  const svcLine = withAttrs.cart.lines.find(l => l.merchandiseId === serviceVariant.id);
  const updated = await cartApi.updateLines(cartId, [{ id: svcLine.id, quantity: 3 }]);
  expect('cartLinesUpdate changes quantity', updated.ok && updated.cart.lines.find(l => l.id === svcLine.id).quantity === 3);

  const discounted = await cartApi.setDiscountCode(cartId, 'WELCOME10');
  expect('valid discount applies', discounted.ok && discounted.cart.discountCodes.some(d => d.code === 'WELCOME10'));
  expect('discounted cost < list subtotal', discounted.ok && discounted.cart.costSubtotal < discounted.cart.subtotal && discounted.cart.discountAmount > 0);
  const badCode = await cartApi.setDiscountCode(cartId, 'NOPE123');
  expect('invalid discount is refused with a message', !badCode.ok && !!badCode.error);
  const cleared = await cartApi.setDiscountCode(cartId, '');
  expect('empty code clears discount codes', cleared.ok && cleared.cart.discountCodes.length === 0);

  const noted = await cartApi.setNote(cartId, 'Gift note: Happy birthday\nNote: Ring the bell');
  expect('cart note round-trips', noted.ok && noted.cart.note.includes('Happy birthday'));

  const removed = await cartApi.removeLines(cartId, [svcLine.id]);
  expect('cartLinesRemove drops the line', removed.ok && !removed.cart.lines.some(l => l.id === svcLine.id));

  const withUrl = await cartApi.checkoutUrl(cartId);
  expect('checkoutUrl is an https Shopify-hosted URL', typeof withUrl === 'string' && /^https:\/\//.test(withUrl));

  const gone = await cartApi.getCart('gid://shopify/Cart/does-not-exist');
  expect('missing cart resolves to null', gone === null);

  /* ------------------------------------------------------------- cache */
  console.log('\nCaching');
  const again = await catalog.getAllProducts();
  expect('cached read returns the same catalog', again.length === products.length);
  catalog.invalidate();
  const afterInvalidate = await catalog.getAllProducts();
  expect('invalidate() re-reads cleanly', afterInvalidate.length === products.length);

  await gateway.close();
  console.log(`\n${'─'.repeat(48)}\n  ${pass} passed, ${fail} failed\n`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach(f => console.log('  • ' + f));
    process.exitCode = 1;
  }
})().catch(err => { console.error(err); process.exit(1); });
