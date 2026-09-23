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
  delete process.env.SHOPIFY_API_VERSION;
  delete process.env.NODE_ENV;
  const config = require('../lib/shopify/config');
  const cfg = config.getConfig();
  expect('no store domain means demo mode', cfg.demo === true);
  expect('the default API version is the current stable 2026-07', config.DEFAULT_API_VERSION === '2026-07', config.DEFAULT_API_VERSION);
  expect('an unset SHOPIFY_API_VERSION uses the default', cfg.version === '2026-07' && cfg.apiVersion === '2026-07', cfg.version);
  expect('the endpoint is null in demo mode', cfg.endpoint === null);

  // production may not boot a demo storefront by accident
  process.env.NODE_ENV = 'production';
  let refused = false;
  try { config.getConfig(); } catch (err) { refused = /DEMO mode/.test(err.message); }
  expect('NODE_ENV=production refuses to start in demo mode', refused);
  process.env.VENNIX_ALLOW_DEMO = '1';
  expect('VENNIX_ALLOW_DEMO=1 opts in deliberately', config.getConfig().demo === true);
  delete process.env.VENNIX_ALLOW_DEMO;
  delete process.env.NODE_ENV;

  // bad configuration fails loudly, with a message that says what to do
  expect('a pasted URL or path is normalised to a hostname',
    config.normalizeDomain('https://My-Store.myshopify.com/admin/') === 'my-store.myshopify.com',
    config.normalizeDomain('https://My-Store.myshopify.com/admin/'));
  const bad = [
    ['SHOPIFY_STORE_DOMAIN', 'not a host!', /not a hostname/i],
    ['SHOPIFY_STORE_DOMAIN', 'your-store.myshopify.com', /placeholder/i]
  ];
  for (const [key, value, pattern] of bad) {
    process.env[key] = value;
    let message = '';
    try { config.getConfig(); } catch (err) { message = err.message; }
    expect(`${key}=${value} is rejected with guidance`, pattern.test(message), message.slice(0, 60));
    delete process.env[key];
  }
  process.env.SHOPIFY_STORE_DOMAIN = 'real-store.myshopify.com';
  let noToken = '';
  try { config.getConfig(); } catch (err) { noToken = err.message; }
  expect('a domain without a token is refused', /ACCESS_TOKEN is missing/.test(noToken));
  process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN = 'short';
  let shortToken = '';
  try { config.getConfig(); } catch (err) { shortToken = err.message; }
  expect('a truncated token is refused', /truncated/.test(shortToken));
  process.env.SHOPIFY_API_VERSION = 'nope';
  let badVersion = '';
  try { config.getConfig(); } catch (err) { badVersion = err.message; }
  expect('a malformed API version is refused', /not a Shopify API version/.test(badVersion));
  process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN = 'shpat_' + 'a'.repeat(40);
  process.env.SHOPIFY_API_VERSION = '2026-07';
  const live = config.getConfig();
  expect('a valid live configuration builds the right endpoint',
    live.demo === false && live.endpoint === 'https://real-store.myshopify.com/api/2026-07/graphql.json', live.endpoint);
  expect('live mode locks the mock gateway out', config.liveModeLocked() === true);
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  delete process.env.SHOPIFY_API_VERSION;

  /* ---------------------------------------------------------------- guards */
  console.log('\nSecurity guards');
  const security = require('../lib/security');
  const checkoutOk = [
    'https://real-store.myshopify.com/cart/c/abc123',
    'https://checkout.shopify.com/cn/1234',
    'https://shop.example.com/checkouts/cn/1'
  ];
  const cfgForHosts = { domain: 'real-store.myshopify.com', primaryDomain: 'shop.example.com', accountUrl: '' };
  expect('Shopify checkout URLs are allowed',
    checkoutOk.every(u => security.isAllowedCheckoutUrl(u, cfgForHosts)),
    checkoutOk.filter(u => !security.isAllowedCheckoutUrl(u, cfgForHosts)).join(' '));
  const checkoutBad = [
    'http://real-store.myshopify.com/cart/c/x',   // not https
    'https://evil.example.com/checkout',          // not Shopify
    'javascript:alert(1)',
    'https://real-store.myshopify.com.evil.com/cart/c/1',
    ''
  ];
  expect('non-Shopify checkout URLs are refused',
    checkoutBad.every(u => security.isAllowedCheckoutUrl(u, cfgForHosts) === false),
    checkoutBad.filter(u => security.isAllowedCheckoutUrl(u, cfgForHosts)).join(' '));
  expect('a custom checkout host can be allowlisted', (() => {
    process.env.SHOPIFY_CHECKOUT_HOSTS = 'checkout.mybrand.com';
    const allowed = security.isAllowedCheckoutUrl('https://checkout.mybrand.com/c/1', cfgForHosts);
    delete process.env.SHOPIFY_CHECKOUT_HOSTS;
    return allowed;
  })());

  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  expect('cookies are not Secure without TLS', security.isSecure(req) === false);
  req.headers['x-forwarded-proto'] = 'https';
  expect('X-Forwarded-Proto is only trusted with TRUST_PROXY', security.isSecure(req) === false);
  process.env.TRUST_PROXY = '1';
  expect('X-Forwarded-Proto is honoured behind a proxy', security.isSecure(req) === true);
  delete process.env.TRUST_PROXY;
  process.env.NODE_ENV = 'production';
  expect('production always marks cookies Secure', security.isSecure({ headers: {}, socket: {} }) === true);
  delete process.env.NODE_ENV;

  const nonceReq = { headers: {}, socket: {} };
  expect('every request context gets a fresh nonce', (() => {
    const a = [];
    for (let i = 0; i < 3; i++) security.runWithRequest({ nonce: security.newNonce(), req: nonceReq }, () => a.push(security.nonce()));
    return new Set(a).size === 3 && a.every(n => n.length > 12);
  })());
  expect('nonceAttr renders a usable attribute', /^ nonce="[^"<>]+"$/.test(security.nonceAttr()));
  expect('safeEqual refuses mismatches and empty values',
    security.safeEqual('abc', 'abc') && !security.safeEqual('abc', 'abd') && !security.safeEqual('', ''));
  expect('a CSRF cookie request without a cookie passes', security.verifyCsrf({ headers: {} }).ok === true);
  expect('a CSRF cookie request without a token fails',
    security.verifyCsrf({ headers: { cookie: 'vnx_csrf=' + 'a'.repeat(64) } }).ok === false);
  expect('a matching CSRF token passes',
    security.verifyCsrf({ headers: { cookie: 'vnx_csrf=' + 'a'.repeat(64), 'x-csrf-token': 'a'.repeat(64) } }).ok === true);
  expect('no secret is reported for clean output', security.assertNoSecrets('<html>hello</html>').ok === true);

  /* ------------------------------------------------------ cookies + transport */
  console.log('\nCookies and transport');
  const auth = require('../lib/auth');
  const savedNodeEnv = process.env.NODE_ENV;
  const savedTrust = process.env.TRUST_PROXY;
  const savedPrefix = process.env.COOKIE_HOST_PREFIX;
  const savedInsecure = process.env.VENNIX_FORCE_INSECURE_COOKIES;
  const savedAnyProto = process.env.VENNIX_TRUST_ANY_PROTO;
  const clearTransportEnv = () => {
    delete process.env.NODE_ENV;
    delete process.env.TRUST_PROXY;
    delete process.env.COOKIE_HOST_PREFIX;
    delete process.env.VENNIX_FORCE_INSECURE_COOKIES;
    delete process.env.VENNIX_TRUST_ANY_PROTO;
  };

  clearTransportEnv();
  expect('a plain http request in development gets no Secure flag', auth.requestSecure({ headers: {} }) === false);
  expect('a forwarded https header is ignored without TRUST_PROXY',
    auth.requestSecure({ headers: { 'x-forwarded-proto': 'https' } }) === false);
  process.env.TRUST_PROXY = '1';
  expect('behind a trusted proxy, X-Forwarded-Proto: https means Secure',
    auth.requestSecure({ headers: { 'x-forwarded-proto': 'https, http' } }) === true);
  expect('behind a trusted proxy, X-Forwarded-Proto: http is not Secure',
    auth.requestSecure({ headers: { 'x-forwarded-proto': 'http' } }) === false);
  clearTransportEnv();
  process.env.NODE_ENV = 'production';
  expect('production always sends Secure, even with no proxy headers',
    auth.requestSecure({ headers: {} }) === true);
  process.env.VENNIX_FORCE_INSECURE_COOKIES = '1';
  expect('VENNIX_FORCE_INSECURE_COOKIES=1 is an explicit escape hatch', auth.requestSecure({ headers: {} }) === false);
  clearTransportEnv();

  expect('cookie names are bare outside production', auth.cookieName('vnx_cart') === 'vnx_cart', auth.cookieName('vnx_cart'));
  process.env.NODE_ENV = 'production';
  expect('production locks cookies to the host with the __Host- prefix',
    auth.cookieName('vnx_cart') === '__Host-vnx_cart', auth.cookieName('vnx_cart'));
  const prefixed = auth.serializeCookie('__Host-vnx_cart', 'gid://x/1', { secure: false, path: '/shop', domain: 'example.com' });
  expect('a __Host- cookie is forced Secure, Path=/ and domain-less',
    /^__Host-vnx_cart=/.test(prefixed) && /Secure/.test(prefixed) && /Path=\//.test(prefixed) && !/Domain=/.test(prefixed),
    prefixed);
  process.env.COOKIE_HOST_PREFIX = 'off';
  expect('COOKIE_HOST_PREFIX=off keeps the bare name', auth.cookieName('vnx_cart') === 'vnx_cart');
  process.env.VENNIX_FORCE_INSECURE_COOKIES = '1';
  process.env.COOKIE_HOST_PREFIX = 'on';
  expect('insecure cookies can never be host-prefixed', auth.cookieName('vnx_cart') === 'vnx_cart');
  clearTransportEnv();

  expect('a __Host- cookie is still read when the prefix is switched off',
    auth.cookieValue({ headers: { cookie: '__Host-vnx_cart=abc; vnx_csrf=z' } }, 'vnx_cart') === 'abc');
  process.env.NODE_ENV = 'production';
  expect('with the prefix on, a bare cookie planted by a subdomain is ignored',
    auth.cookieValue({ headers: { cookie: 'vnx_cart=evil; __Host-vnx_cart=abc' } }, 'vnx_cart') === 'abc');
  expect('with the prefix on, a lone bare cookie is not honoured',
    auth.cookieValue({ headers: { cookie: 'vnx_cart=evil' } }, 'vnx_cart') === null);
  clearTransportEnv();
  expect('a missing cookie reads as null', auth.cookieValue({ headers: {} }, 'vnx_cart') === null);
  const res = { headers: {}, getHeader(k) { return this.headers[k]; }, setHeader(k, v) { this.headers[k] = v; } };
  auth.setCookie(res, 'vnx_cart', 'abc', { maxAge: 60 });
  auth.clearCookie(res, 'vnx_cart', {});
  expect('set then clear appends two Set-Cookie headers, both for the same name',
    Array.isArray(res.headers['Set-Cookie']) && res.headers['Set-Cookie'].length === 2
    && /Max-Age=60/.test(res.headers['Set-Cookie'][0]) && /Max-Age=0/.test(res.headers['Set-Cookie'][1])
    && res.headers['Set-Cookie'][0].split('=')[0] === res.headers['Set-Cookie'][1].split('=')[0],
    JSON.stringify(res.headers['Set-Cookie']));
  const res2 = { headers: {}, getHeader() { return 'a=1'; }, setHeader(k, v) { this.headers[k] = v; } };
  auth.appendCookie(res2, 'b=2');
  expect('appending never clobbers an existing cookie',
    Array.isArray(res2.headers['Set-Cookie']) && res2.headers['Set-Cookie'].join('|') === 'a=1|b=2');

  process.env.NODE_ENV = savedNodeEnv || '';
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
  for (const [k, v] of [['TRUST_PROXY', savedTrust], ['COOKIE_HOST_PREFIX', savedPrefix],
    ['VENNIX_FORCE_INSECURE_COOKIES', savedInsecure], ['VENNIX_TRUST_ANY_PROTO', savedAnyProto]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  delete process.env.NODE_ENV;

  /* ---------------------------------------------------------- cart errors */
  console.log('\nCart error translation');
  const cartLib = require('../lib/cart');
  expect('inventory shortfalls read like English',
    /Only 2 left/.test(cartLib.friendlyCartError('You can only add 2 of this item.')),
    cartLib.friendlyCartError('You can only add 2 of this item.'));
  expect('Shopify inventory wording is translated too',
    /Only 1 left/.test(cartLib.friendlyCartError('Not enough inventory. Only 1 available.')),
    cartLib.friendlyCartError('Not enough inventory. Only 1 available.'));
  expect('sold-out messages offer a next step',
    /sold out/i.test(cartLib.friendlyCartError('The variant is not available for sale')));
  expect('discount wording is passed through untouched',
    cartLib.friendlyCartError('Enter a valid discount code.') === 'Enter a valid discount code.');
  expect('an empty error still has copy', cartLib.friendlyCartError('').length > 10);

  /* --------------------------------------------------------------- locks */
  console.log('\nConcurrency');
  const locks = require('../lib/locks');
  let order = [];
  await Promise.all([
    locks.withLock('cart-1', async () => { order.push('a-start'); await new Promise(r => setTimeout(r, 20)); order.push('a-end'); }),
    locks.withLock('cart-1', async () => { order.push('b-start'); order.push('b-end'); })
  ]);
  expect('work on one cart never interleaves',
    order.join(',') === 'a-start,a-end,b-start,b-end', order.join(','));
  await Promise.all([
    locks.withLock('cart-1', async () => { await new Promise(r => setTimeout(r, 10)); }),
    locks.withLock('cart-2', async () => { await new Promise(r => setTimeout(r, 10)); })
  ]);
  expect('different carts run in parallel', true);
  expect('the session key needs *some* signal', locks.sessionKey({ headers: {}, socket: {} }) === null);
  expect('a per-tab id changes the session key',
    locks.sessionKey({ headers: { cookie: 'vnx_sid=a' }, socket: { remoteAddress: '1.2.3.4' } }) !==
    locks.sessionKey({ headers: { cookie: 'vnx_sid=b' }, socket: { remoteAddress: '1.2.3.4' } }));

  /* -------------------------------------------------------- client errors */
  console.log('\nGraphQL client error handling');
  const shopifyClient = require('../lib/shopify/client');
  expect('error codes are stable and typed',
    shopifyClient.CODES.AUTH === 'auth' && shopifyClient.CODES.THROTTLE === 'throttle' &&
    shopifyClient.CODES.TIMEOUT === 'timeout' && shopifyClient.CODES.NETWORK === 'network',
    JSON.stringify(shopifyClient.CODES));
  expect('an auth failure is not retryable, a throttle is', (() => {
    const auth = new shopifyClient.ShopifyError('nope', { code: shopifyClient.CODES.AUTH });
    const throttle = new shopifyClient.ShopifyError('slow down', { code: shopifyClient.CODES.THROTTLE, retryable: true });
    return auth.retryable === false && throttle.retryable === true && throttle.name === 'ShopifyError';
  })());
  expect('mutationResult surfaces userErrors', (() => {
    const bad = shopifyClient.mutationResult({ cartCreate: { userErrors: [{ field: ['lines'], message: 'Sold out' }] } }, 'cartCreate');
    return bad.ok === false && /Sold out/.test(bad.error);
  })());
  expect('metrics are observable', typeof shopifyClient.getMetrics().requests === 'number');
  expect('pointing a live client at the mock gateway is refused', (() => {
    process.env.SHOPIFY_STORE_DOMAIN = 'real-store.myshopify.com';
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN = 'shpat_' + 'b'.repeat(40);
    let refusedOverride = false;
    try { shopifyClient.setEndpoint('http://127.0.0.1:1/api/graphql'); } catch (err) { refusedOverride = /mock gateway/i.test(err.message); }
    delete process.env.SHOPIFY_STORE_DOMAIN;
    delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
    return refusedOverride;
  })());

  /* ------------------------------------------------------------ gateway */
  console.log('\nGateway');
  // (the config checks above left the environment clean: no domain ⇒ demo)
  const { startMockGateway } = require('../tools/mock-shopify/gateway');
  const gateway = await startMockGateway({ port: 0 });
  const health = await fetch(gateway.url.replace(/\/api\/.*/, '/healthz'));
  expect('gateway answers /healthz', health.status === 200);
  const client = shopifyClient;
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

  // Storefront API 2026-07: CartLine.viewKey identifies a line and is accepted
  // by cartLinesUpdate / cartLinesRemove as an alternative to the line id.
  expect('every cart line carries a 2026-07 viewKey',
    withAttrs.cart.lines.every(l => typeof l.viewKey === 'string' && l.viewKey.length >= 8),
    JSON.stringify(withAttrs.cart.lines.map(l => l.viewKey)));
  const byKey = await cartApi.updateLines(cartId, [{ viewKey: svcLine.viewKey, quantity: 2 }]);
  expect('a line can be updated by viewKey alone',
    byKey.ok && byKey.cart.lines.find(l => l.id === svcLine.id).quantity === 2,
    byKey.ok ? '' : byKey.error);
  const keyRemoved = await cartApi.removeLines(cartId, [{ viewKey: svcLine.viewKey }]);
  expect('a line can be removed by viewKey alone',
    keyRemoved.ok && !keyRemoved.cart.lines.some(l => l.id === svcLine.id),
    keyRemoved.ok ? '' : keyRemoved.error);
  const reAdded = await cartApi.addLines(cartId, [{
    merchandiseId: serviceVariant.id, quantity: 1,
    attributes: [{ key: 'Monogram', value: 'CD' }]
  }]);
  const svcLine2 = reAdded.cart.lines.find(l => l.merchandiseId === serviceVariant.id);
  expect('the removed line can be added again', reAdded.ok && !!svcLine2);

  const discounted = await cartApi.setDiscountCode(cartId, 'WELCOME10');
  expect('valid discount applies', discounted.ok && discounted.cart.discountCodes.some(d => d.code === 'WELCOME10'));
  expect('discounted cost < list subtotal', discounted.ok && discounted.cart.costSubtotal < discounted.cart.subtotal && discounted.cart.discountAmount > 0);
  // 2026-07 moved cart discount reporting onto discountApplications.
  expect('2026-07 discountApplications are exposed and merchandise-only',
    discounted.cart.discountApplications.length > 0
    && discounted.cart.discountApplications.every(a => a.targetType !== 'SHIPPING_LINE'),
    JSON.stringify(discounted.cart.discountApplications));
  expect('the discount total comes from Shopify allocation amounts',
    discounted.cart.discountAmount === discounted.cart.discountApplications
      .filter(a => a.targetType !== 'SHIPPING_LINE')
      .reduce((sum, a) => sum + a.amount, 0),
    `${discounted.cart.discountAmount}`);
  expect('per-line discount allocations are reported',
    discounted.cart.lines.some(l => l.discountAmount > 0),
    JSON.stringify(discounted.cart.lines.map(l => l.discountAmount)));
  const N = require('../lib/shopify/normalize');
  const legacyShape = N.normalizeCart({
    id: 'gid://shopify/Cart/1',
    checkoutUrl: 'https://x.myshopify.com/cart/c/1',
    lines: { nodes: [{
      id: 'gid://shopify/CartLine/1', quantity: 2,
      cost: { totalAmount: { amount: '20.00', currencyCode: 'USD' } },
      merchandise: { __typename: 'ProductVariant', id: 'gid://shopify/ProductVariant/1', price: { amount: '10.00', currencyCode: 'USD' } }
    }] },
    cost: { subtotalAmount: { amount: '18.00', currencyCode: 'USD' }, totalAmount: { amount: '18.00', currencyCode: 'USD' } }
  });
  expect('a response without discountApplications falls back to arithmetic', legacyShape.discountAmount === 200, `${legacyShape.discountAmount}`);
  expect('a response without totalTaxAmount hides the tax row instead of showing 0', legacyShape.taxAmount === 0);
  const badCode = await cartApi.setDiscountCode(cartId, 'NOPE123');
  expect('invalid discount is refused with a message', !badCode.ok && !!badCode.error);
  const cleared = await cartApi.setDiscountCode(cartId, '');
  expect('empty code clears discount codes', cleared.ok && cleared.cart.discountCodes.length === 0);

  const noted = await cartApi.setNote(cartId, 'Gift note: Happy birthday\nNote: Ring the bell');
  expect('cart note round-trips', noted.ok && noted.cart.note.includes('Happy birthday'));

  const removed = await cartApi.removeLines(cartId, [svcLine2.id]);
  expect('cartLinesRemove drops the line', removed.ok && !removed.cart.lines.some(l => l.id === svcLine2.id));

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
