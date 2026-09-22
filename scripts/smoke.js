'use strict';
/**
 * smoke.js — end-to-end route + flow test against a running storefront.
 *
 * Exercises the real production code path: storefront pages, the Shopify cart
 * API (create / add / update / remove / discount / note), the checkout handoff,
 * lead capture endpoints and SEO payloads. Works against demo mode (mock
 * Shopify gateway + fixture) or a live store alike.
 *
 * Usage: node scripts/smoke.js [baseUrl]
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');

let pass = 0, fail = 0;
const failures = [];

async function req(path, { method = 'GET', body, cookie, form, redirect = 'manual' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (method !== 'GET') headers.Origin = BASE;
  let payload;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload, redirect });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, location: res.headers.get('location'), text, json, setCookie };
}

function expect(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

(async function run() {
  console.log(`\nVennix smoke test → ${BASE}\n${'─'.repeat(48)}`);

  /* ------------------------------------------------------ storefront pages */
  console.log('\nStorefront pages');
  const pages = [
    ['/', 'Modern essentials'], ['/collections/all', 'All Products'], ['/collections/women', "Women"],
    ['/collections/men', "Men"], ['/collections/active', 'Active'], ['/collections/essentials', 'Essentials'],
    ['/collections/new-in', 'New In'], ['/collections/bestsellers', 'Bestsellers'], ['/collections/sale', 'Sale'],
    ['/products/atlas-heavyweight-hoodie', 'Atlas Heavyweight Hoodie'], ['/products/gift-card', 'Gift Card'],
    ['/search?q=hoodie', 'hoodie'], ['/cart', 'cart'], ['/checkout', 'checkout'],
    ['/track', 'Track your order'], ['/gift-cards', 'Gift cards'], ['/blogs/journal', 'Journal'],
    ['/blogs/journal/why-we-chose-480-gsm', '480'], ['/pages/about', 'About'], ['/pages/faq', 'FAQ'],
    ['/pages/size-guide', 'Size Guide'], ['/pages/contact', 'Contact'], ['/pages/shipping-returns', 'Shipping'],
    ['/pages/privacy', 'Privacy'], ['/pages/terms', 'Terms'], ['/pages/accessibility', 'Accessibility'],
    ['/account', 'account'], ['/account/wishlist', 'Saved items'],
    ['/robots.txt', 'Sitemap:'], ['/sitemap.xml', '<urlset'], ['/css/main.css', '--ink'], ['/js/main.js', 'addToCart'],
    ['/favicon.svg', '<svg']
  ];
  for (const [path, needle] of pages) {
    const res = await req(path);
    expect(`${path} ${res.status}`, res.status === 200 && res.text.includes(needle), `expected 200 + "${needle}", got ${res.status}`);
  }
  expect('404 for unknown product', (await req('/products/does-not-exist')).status === 404);
  expect('404 for unknown page', (await req('/pages/does-not-exist')).status === 404);
  expect('404 for unknown collection', (await req('/collections/does-not-exist')).status === 404);
  expect('hidden service product is not published', (await req('/products/monogramming')).status === 404);
  const admin = await req('/admin');
  expect('custom admin is retired (404 with pointer)', admin.status === 404 && admin.text.includes('Shopify'));

  /* ----------------------------------------------------------- cart + api */
  console.log('\nCart API (Shopify-backed)');
  const home = await req('/');
  let cookie = '';

  const search = await req('/api/search?q=legging', { cookie });
  expect('GET /api/search returns products', search.json && search.json.ok && search.json.products.length > 0);

  const quick = await req('/api/quickview/flow-high-rise-legging-28', { cookie });
  expect('GET /api/quickview returns variant picker html', quick.json && quick.json.ok && quick.json.html.includes('data-add-form'));

  const pdp = await req('/products/atlas-heavyweight-hoodie', { cookie });
  const match = pdp.text.match(/data-product-json="atlas-heavyweight-hoodie">([\s\S]*?)<\/script>/);
  const data = JSON.parse(match[1]);
  const variant = data.variants.find(v => v.stock > 5);
  expect('in-stock variant discovered from PDP', !!variant);

  const bogus = await req('/api/cart/add', { method: 'POST', cookie, body: { variantId: 'gid://shopify/ProductVariant/var_not_real', quantity: 1 } });
  expect('unknown variant is rejected', bogus.json && !bogus.json.ok && !!bogus.json.error);
  const soldOut = data.variants.find(v => v.stock <= 0);
  const out = await req('/api/cart/add', { method: 'POST', cookie, body: { variantId: soldOut.id, quantity: 1 } });
  expect('sold-out variant is rejected', out.json && !out.json.ok && /sold out/i.test(out.json.error));

  const add = await req('/api/cart/add', { method: 'POST', cookie, body: { variantId: variant.id, quantity: 1 } });
  expect('POST /api/cart/add adds a line', add.json && add.json.ok && add.json.cart.count === 1, JSON.stringify(add.json || {}).slice(0, 160));
  cookie = (add.setCookie.find(c => c.startsWith('vnx_cart=')) || '').split(';')[0];
  expect('cart id stored in HttpOnly cookie on first add', !!cookie && /httponly/i.test(add.setCookie.find(c => c.startsWith('vnx_cart=')) || ''), add.setCookie.join(' '));
  expect('cart html fragments returned', !!(add.json.html && add.json.html.drawer && add.json.html.count));
  expect('monogrammed flag false for plain add', add.json.monogrammed === false);

  const mono = await req('/api/cart/add', { method: 'POST', cookie, body: { variantId: variant.id, quantity: 1, personalization: { text: 'AB' } } });
  // identical garment lines merge; the monogram service line is folded into
  // the garment line for display — one merged line at quantity 2
  expect('monogram merges identical garment + service lines for display', mono.json.ok && mono.json.monogrammed === true && mono.json.cart.lines.length === 1 && mono.json.cart.lines[0].quantity === 2, JSON.stringify(mono.json.cart.lines));
  const monoLine = mono.json.cart.lines.find(l => l.personalization);
  expect('monogram line carries the fee', monoLine && monoLine.personalization.price === 2000);

  const lineId = mono.json.cart.lines.find(l => l.personalization).id;
  const upd = await req('/api/cart/update', { method: 'POST', cookie, body: { lineId, quantity: 3 } });
  expect('POST /api/cart/update syncs quantity to the service line too', upd.json.ok && upd.json.cart.count === 6, `count ${upd.json.cart && upd.json.cart.count}`);

  const disc = await req('/api/cart/discount', { method: 'POST', cookie, body: { code: 'WELCOME10' } });
  expect('POST /api/cart/discount applies WELCOME10', disc.json.ok && disc.json.cart.discountCode === 'WELCOME10');
  expect('discount amount is 10% of subtotal', disc.json.cart.discountAmount === Math.round(disc.json.cart.subtotal * 0.1), `${disc.json.cart.discountAmount} vs ${disc.json.cart.subtotal}`);
  const badDisc = await req('/api/cart/discount', { method: 'POST', cookie, body: { code: 'NOPE' } });
  expect('invalid discount is rejected with a reason', !badDisc.json.ok && !!badDisc.json.error);

  const noteRes = await req('/api/cart/note', { method: 'POST', cookie, body: { giftNote: 'Happy birthday from smoke test' } });
  expect('POST /api/cart/note accepts notes', noteRes.json.ok);
  const cartPage = await req('/cart', { cookie });
  expect('gift note renders on the cart page', cartPage.text.includes('Happy birthday from smoke test'));

  /* ------------------------------------------------------------ checkout */
  console.log('\nCheckout handoff (Shopify-hosted)');
  const handoff = await req('/checkout', { cookie, redirect: 'manual' });
  expect('GET /checkout with items redirects to Shopify checkout', handoff.status === 302 && /^https:\/\//.test(handoff.location || ''), `${handoff.status} ${handoff.location}`);
  const buyNow = await req('/api/buy-now', { method: 'POST', cookie, body: { variantId: variant.id, quantity: 1 } });
  expect('POST /api/buy-now returns a checkout URL', buyNow.json.ok && /^https:\/\//.test(buyNow.json.checkoutUrl));

  const rm = await req('/api/cart/remove', { method: 'POST', cookie, body: { lineId } });
  expect('removing the garment removes its monogram service line', rm.json.ok && !rm.json.cart.lines.some(l => l.personalization), `lines ${rm.json.cart.lines.length}`);

  const shipping = await req('/api/cart/shipping', { method: 'POST', cookie, body: {} });
  expect('legacy /api/cart/shipping still answers (no-op)', shipping.json.ok);

  /* --------------------------------------------------------------- leads */
  console.log('\nLead capture');
  const news = await req('/api/newsletter', { method: 'POST', cookie, body: { email: 'smoke.tester@example.com' } });
  expect('POST /api/newsletter subscribes', news.json.ok);
  const badNews = await req('/api/newsletter', { method: 'POST', cookie, body: { email: 'not-an-email' } });
  expect('newsletter rejects a bad email', !badNews.json.ok);
  const support = await req('/api/contact', { method: 'POST', cookie, body: { name: 'Smoke', email: 'smoke@example.com', topic: 'Sizing & fit', message: 'Automated smoke test message.' } });
  expect('POST /api/contact creates a message', support.json.ok);
  const review = await req('/api/reviews', { method: 'POST', cookie, body: { handle: 'atlas-heavyweight-hoodie', author: 'Smoke Bot', email: 'smoke@example.com', rating: 5, title: 'Automated check', body: 'Verifying the review pipeline end to end.' } });
  expect('review submits into moderation', review.json.ok && /moderation/i.test(review.json.message));
  const helpful = await req('/api/reviews/helpful/atlas-heavyweight-hoodie:0', { method: 'POST', cookie, body: {} });
  expect('helpful vote counts', helpful.json.ok && typeof helpful.json.helpful === 'number');
  const fit = await req('/api/fit', { method: 'POST', cookie, body: { handle: 'atlas-heavyweight-hoodie', height: 70, weight: 170 } });
  expect('POST /api/fit returns a recommendation', fit.json.ok && !!fit.json.fit.size);
  const monogram = await req('/api/monogram', { method: 'POST', cookie, body: { handle: 'atlas-heavyweight-hoodie', text: 'ab' } });
  expect('POST /api/monogram previews + prices', monogram.json.ok && monogram.json.text === 'AB' && monogram.json.price === 2000);
  const style = await req('/api/style?handle=atlas-heavyweight-hoodie&limit=3', { cookie });
  expect('GET /api/style returns partners', style.json.ok && style.json.look.length === 3);

  /* ------------------------------------------------------- security + seo */
  console.log('\nSecurity + SEO');
  const csrf = await fetch(BASE + '/api/newsletter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ email: 'csrf@example.com' })
  });
  expect('cross-origin POST is blocked (CSRF)', csrf.status === 403);
  const resp = await fetch(BASE + '/');
  expect('security headers set', resp.headers.get('x-content-type-options') === 'nosniff' && resp.headers.get('x-frame-options') === 'DENY');
  expect('catalog index embedded for wishlist', home.text.includes('data-catalog-index'));
  expect('structured data present', home.text.includes('"@type":"Organization"'));
  expect('PDP has Product schema', pdp.text.includes('"@type":"Product"'));
  const faq = await req('/pages/faq');
  expect('FAQ page has FAQPage schema', faq.text.includes('FAQPage'));
  const sitemap = await req('/sitemap.xml');
  expect('sitemap lists products and pages', sitemap.text.includes('/products/') && sitemap.text.includes('/pages/') && sitemap.text.includes('/collections/'));

  /* -------------------------------------------------------------- summary */
  console.log(`\n${'─'.repeat(48)}\n  ${pass} passed, ${fail} failed\n`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach(f => console.log('  • ' + f));
    process.exitCode = 1;
  }
})().catch(err => { console.error(err); process.exit(1); });
