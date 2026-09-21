'use strict';
/**
 * smoke.js — end-to-end route + flow test against a running server.
 * Usage: node scripts/smoke.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3000';

let pass = 0, fail = 0;
const failures = [];

async function req(path, { method = 'GET', body, cookie, form, redirect = 'manual' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
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
  return { status: res.status, location: res.headers.get('location'), text, setCookie };
}

function expect(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

(async function run() {
  console.log(`\nVennix smoke test → ${BASE}\n${'─'.repeat(48)}`);
  let cookie = '';

  /* ------------------------------------------------ storefront pages (GET) */
  console.log('\nStorefront pages');
  const pages = [
    ['/', 'Modern essentials'], ['/collections/all', 'All Products'], ['/collections/women', "Women's"],
    ['/collections/men', "Men's"], ['/collections/active', 'Active'], ['/collections/essentials', 'Everyday Essentials'],
    ['/collections/new-in', 'New In'], ['/collections/bestsellers', 'Bestsellers'], ['/collections/sale', 'Sale'],
    ['/products/atlas-heavyweight-hoodie', 'Atlas Heavyweight Hoodie'], ['/products/gift-card', 'Vennix Gift Card'],
    ['/search?q=hoodie', 'Results for'], ['/cart', 'Your cart'], ['/checkout', 'Checkout'],
    ['/track', 'Track your order'], ['/gift-cards', 'Gift cards'], ['/blogs/journal', 'The Journal'],
    ['/blogs/journal/why-we-chose-480-gsm', '480 gsm'], ['/pages/about', 'About Vennix'], ['/pages/faq', 'Help &amp; FAQ'],
    ['/pages/size-guide', 'Size Guide'], ['/pages/contact', 'Contact'], ['/pages/shipping-returns', 'Shipping'],
    ['/pages/privacy', 'Privacy Policy'], ['/pages/terms', 'Terms of Service'], ['/pages/accessibility', 'Accessibility'],
    ['/account/login', 'Log in'], ['/account/register', 'Create account'], ['/account/recover', 'Reset your password'],
    ['/robots.txt', 'Sitemap:'], ['/sitemap.xml', '<urlset'], ['/css/main.css', '--ink'], ['/js/main.js', 'addToCart'],
    ['/favicon.svg', '<svg']
  ];
  for (const [path, needle] of pages) {
    const res = await req(path);
    expect(`${path} ${res.status}`, res.status === 200 && res.text.includes(needle), `expected 200 + "${needle}", got ${res.status}`);
  }
  const notFound = await req('/products/does-not-exist');
  expect('404 for unknown product', notFound.status === 404);
  const notFound2 = await req('/pages/does-not-exist');
  expect('404 for unknown page', notFound2.status === 404);

  /* --------------------------------------------------------------- api: cart */
  console.log('\nCart API + session cookie');
  const home = await req('/');
  cookie = (home.setCookie.find(c => c.startsWith('vnx_cart=')) || '').split(';')[0];
  expect('cart cookie issued', !!cookie, home.setCookie.join(' '));

  const search = await req('/api/search?q=legging', { cookie });
  const searchJson = JSON.parse(search.text);
  expect('GET /api/search returns products', searchJson.ok && searchJson.products.length > 0);

  const quick = await req('/api/quickview/flow-high-rise-legging-28', { cookie });
  const quickJson = JSON.parse(quick.text);
  expect('GET /api/quickview returns variant picker html', quickJson.ok && quickJson.html.includes('data-add-form'));

  const quickJson2 = JSON.parse((await req('/api/quickview/atlas-heavyweight-hoodie', { cookie })).text);
  // take the best-stocked size, not simply the first: the suite buys three units
  // and must stay repeatable against a database that has already been shopped
  const sizes = [...quickJson2.html.matchAll(/data-variant="(var_[a-z0-9_]+)"\s+data-stock="(\d+)"/g)]
    .map(match => ({ variant: match[1], stock: Number(match[2]) }))
    .filter(option => option.stock > 0)
    .sort((a, b) => b.stock - a.stock);
  const realVariant = sizes.length ? sizes[0].variant : null;
  expect('variant id discovered from quickview', !!realVariant, realVariant ? `${realVariant} (${sizes[0].stock} in stock)` : 'none');
  const bogus = JSON.parse((await req('/api/cart/add', { method: 'POST', cookie, body: { variantId: 'var_not_real', quantity: 1 } })).text);
  expect('unknown variant is rejected', !bogus.ok && !!bogus.error);
  const add2 = await req('/api/cart/add', { method: 'POST', cookie, body: { variantId: realVariant, quantity: 1 } });
  const add2Json = JSON.parse(add2.text);
  expect('POST /api/cart/add adds a line', add2Json.ok && add2Json.cart.count === 1, JSON.stringify(add2Json).slice(0, 160));
  expect('cart html fragments returned', !!(add2Json.html && add2Json.html.drawer && add2Json.html.count));

  const lineId = add2Json.cart.lines[0].id;
  const upd = JSON.parse((await req('/api/cart/update', { method: 'POST', cookie, body: { lineId, quantity: 3 } })).text);
  expect('POST /api/cart/update changes quantity', upd.ok && upd.cart.lines[0].quantity === 3);

  const disc = JSON.parse((await req('/api/cart/discount', { method: 'POST', cookie, body: { code: 'WELCOME10' } })).text);
  expect('POST /api/cart/discount applies WELCOME10', disc.ok && disc.cart.discountCode === 'WELCOME10');
  const badDisc = JSON.parse((await req('/api/cart/discount', { method: 'POST', cookie, body: { code: 'NOPE' } })).text);
  expect('invalid discount is rejected with a reason', !badDisc.ok && !!badDisc.error);

  const quote = JSON.parse((await req('/api/quote', { method: 'POST', cookie, body: { province: 'NY', shippingMethod: 'express' } })).text);
  expect('POST /api/quote returns shipping + tax', quote.ok && quote.quote.shipping > 0 && quote.quote.tax > 0);

  const noteRes = JSON.parse((await req('/api/cart/note', { method: 'POST', cookie, body: { giftNote: 'Happy birthday from smoke test' } })).text);
  expect('POST /api/cart/note saves a gift note', noteRes.ok);

  const news = JSON.parse((await req('/api/newsletter', { method: 'POST', cookie, body: { email: 'smoke.tester@example.com' } })).text);
  expect('POST /api/newsletter subscribes', news.ok);
  const badNews = JSON.parse((await req('/api/newsletter', { method: 'POST', cookie, body: { email: 'not-an-email' } })).text);
  expect('newsletter rejects a bad email', !badNews.ok);

  const support = JSON.parse((await req('/api/contact', { method: 'POST', cookie, body: { name: 'Smoke', email: 'smoke@example.com', topic: 'Sizing & fit', message: 'Automated smoke test message.' } })).text);
  expect('POST /api/contact creates a message', support.ok);

  /* ------------------------------------------------------------- checkout */
  console.log('\nCheckout (decline → approve → order page)');
  const declined = await req('/checkout', {
    method: 'POST', cookie, redirect: 'manual',
    form: {
      email: 'smoke@example.com', firstName: 'Smoke', lastName: 'Tester', line1: '1 Test Way', city: 'Brooklyn',
      province: 'NY', zip: '11211', country: 'United States', shippingMethod: 'standard',
      cardNumber: '4000000000000002', cardExpiry: '04 / 29', cardCvc: '123', cardName: 'Smoke Tester'
    }
  });
  expect('declined card returns 422 with errors', declined.status === 422 && declined.text.includes('declined'));

  const missing = await req('/checkout', { method: 'POST', cookie, redirect: 'manual', form: { email: '', cardNumber: '4242424242424242', cardExpiry: '04/29', cardCvc: '123' } });
  expect('missing fields return 422', missing.status === 422);

  const placed = await req('/checkout', {
    method: 'POST', cookie, redirect: 'manual',
    form: {
      email: 'smoke@example.com', firstName: 'Smoke', lastName: 'Tester', line1: '1 Test Way', line2: 'Apt 2', city: 'Brooklyn',
      province: 'NY', zip: '11211', country: 'United States', phone: '+1 555 0100', shippingMethod: 'standard',
      cardNumber: '4242 4242 4242 4242', cardExpiry: '04 / 29', cardCvc: '123', cardName: 'Smoke Tester',
      acceptsMarketing: 'on', saveAddress: 'on', giftNote: 'Smoke test gift note'
    }
  });
  expect('approved order redirects (303)', placed.status === 303 && /\/orders\/VEN-\d+\?/.test(placed.location || ''), `${placed.status} ${placed.location}`);
  const orderPath = (placed.location || '').split('&new=1')[0];
  const orderPage = await req(orderPath);
  expect('order confirmation page renders', orderPage.status === 200 && orderPage.text.includes('Order VEN-'));
  expect('order page shows the captured payment', orderPage.text.includes('VISA') || orderPage.text.includes('visa'));
  expect('order page shows the gift note', orderPage.text.includes('Smoke test gift note'));
  const orderNumber = (orderPath.match(/VEN-\d+/) || [])[0];
  const track = await req('/track', { method: 'POST', cookie, form: { number: orderNumber, email: 'smoke@example.com' } });
  expect('track order finds the new order', track.status === 200 && track.text.includes('Tracking') || track.text.includes(orderNumber));
  const trackBad = await req('/track', { method: 'POST', cookie, form: { number: orderNumber, email: 'wrong@example.com' } });
  expect('track order rejects a wrong email', trackBad.text.includes('could not find an order'));
  const cartAfter = JSON.parse((await req('/api/cart', { cookie })).text);
  expect('cart is emptied after checkout', cartAfter.cart.count === 0);
  const orderEmail = await req('/admin/emails');
  expect('admin outbox requires auth', orderEmail.status === 302);

  /* -------------------------------------------------------------- account */
  console.log('\nAccounts');
  const login = await req('/account/login', { method: 'POST', cookie, redirect: 'manual', form: { email: 'hannah.b@example.com', password: 'password123' } });
  expect('customer login redirects to /account', login.status === 303 && login.location === '/account', `${login.status} ${login.location}`);
  const sessCookie = (login.setCookie.find(c => c.startsWith('vnx_sid=')) || '').split(';')[0];
  const accountCookie = [cookie, sessCookie].join('; ');
  const badLogin = await req('/account/login', { method: 'POST', cookie, redirect: 'manual', form: { email: 'hannah.b@example.com', password: 'wrong' } });
  expect('wrong password is rejected', badLogin.status === 200 && badLogin.text.includes('incorrect'));
  for (const path of ['/account', '/account/orders', '/account/addresses', '/account/wishlist', '/account/details']) {
    const res = await req(path, { cookie: accountCookie });
    expect(`${path} (signed in) 200`, res.status === 200, String(res.status));
  }
  const guestAccount = await req('/account', { cookie });
  expect('guests are redirected from /account', guestAccount.status === 302 && guestAccount.location.startsWith('/account/login'));
  const orderDetail = await req('/account/orders/ord_0001', { cookie: accountCookie });
  expect('account order detail renders', orderDetail.status === 200 && orderDetail.text.includes('VEN-1001'));
  const reorder = JSON.parse((await req('/api/reorder', { method: 'POST', cookie: accountCookie, body: { orderId: 'ord_0001' } })).text);
  expect('POST /api/reorder refills the cart', reorder.ok && reorder.cart.count > 0);
  const addr = await req('/account/addresses', { method: 'POST', cookie: accountCookie, redirect: 'manual', form: { line1: '9 Smoke St', city: 'Brooklyn', province: 'NY', zip: '11215', label: 'Smoke' } });
  expect('adding an address redirects with a notice', addr.status === 303 && /ok=/.test(addr.location || ''));
  const register = await req('/account/register', { method: 'POST', redirect: 'manual', form: { firstName: 'New', lastName: 'Shopper', email: `smoke.${Date.now()}@example.com`, password: 'password123', passwordConfirm: 'password123', acceptsMarketing: 'on' } });
  expect('registration creates an account (303)', register.status === 303 && register.location.startsWith('/account?ok='));
  const dupRegister = await req('/account/register', { method: 'POST', redirect: 'manual', form: { firstName: 'New', lastName: 'Shopper', email: 'hannah.b@example.com', password: 'password123', passwordConfirm: 'password123' } });
  expect('duplicate email is refused', dupRegister.status === 200 && dupRegister.text.includes('already exists'));

  /* ------------------------------------------------------------ product api */
  console.log('\nReviews + product forms');
  const review = JSON.parse((await req('/api/reviews', { method: 'POST', cookie, body: { handle: 'atlas-heavyweight-hoodie', author: 'Smoke Bot', email: 'smoke@example.com', rating: 5, title: 'Automated check', body: 'Verifying the review pipeline end to end.' } })).text);
  expect('review submits into moderation', review.ok && /moderation/i.test(review.message));
  const helpful = JSON.parse((await req('/api/reviews/helpful/rev_0001', { method: 'POST', cookie, body: {} })).text);
  expect('helpful vote increments', helpful.ok && typeof helpful.helpful === 'number');

  /* ---------------------------------------------------------------- admin */
  console.log('\nAdmin back office');
  const adminLogin = await req('/admin/login', { method: 'POST', redirect: 'manual', form: { email: 'admin@vennixstore.com', password: 'vennix123' } });
  expect('admin login redirects to /admin', adminLogin.status === 302 && adminLogin.location === '/admin');
  const adminCookie = (adminLogin.setCookie.find(c => c.startsWith('vnx_sid=')) || '').split(';')[0];
  const adminPages = ['/admin', '/admin/orders', `/admin/orders/${(orderPath.match(/VEN-\d+/) || ['VEN-1001'])[0] !== '' ? 'ord_0001' : 'ord_0001'}`, '/admin/products', '/admin/products/new', '/admin/products/prd_0001', '/admin/collections', '/admin/customers', '/admin/customers/cus_0001', '/admin/discounts', '/admin/reviews', '/admin/pages', '/admin/messages', '/admin/pos', '/admin/settings', '/admin/emails', '/admin/orders/ord_0001/packing-slip'];
  for (const path of adminPages) {
    const res = await req(path, { cookie: adminCookie });
    expect(`${path} 200`, res.status === 200, String(res.status));
  }
  const dashboard = await req('/admin', { cookie: adminCookie });
  expect('dashboard shows KPI cards', dashboard.text.includes('Revenue (30d)') && dashboard.text.includes('Conversion rate'));
  const adminGuard = await req('/admin/products', { cookie });
  expect('admin pages redirect anonymous users', adminGuard.status === 302 && adminGuard.location === '/admin/login');

  const fulfill = await req('/admin/orders/ord_0003/fulfill', { method: 'POST', cookie: adminCookie, form: { carrier: 'UPS', tracking: '1ZSMOKETEST' } });
  expect('fulfil action redirects back to the order', fulfill.status === 302 && fulfill.location === '/admin/orders/ord_0003', `${fulfill.status} ${fulfill.location}`);
  const updatedOrder = await req('/admin/orders/ord_0003', { cookie: adminCookie });
  expect('fulfilment recorded on the order', updatedOrder.text.includes('1ZSMOKETEST') && updatedOrder.text.includes('fulfilled'));

  const refund = await req('/admin/orders/ord_0006/refund', { method: 'POST', cookie: adminCookie, form: { amount: '39.99', restock: 'on' } });
  expect('refund action redirects', refund.status === 302);
  const refundedOrder = await req('/admin/orders/ord_0006', { cookie: adminCookie });
  expect('refund recorded on the order', refundedOrder.text.includes('refunded'));
  const cancel = await req('/admin/orders/ord_0007/cancel', { method: 'POST', cookie: adminCookie, form: {} });
  expect('cancel action redirects', cancel.status === 302);
  const cancelledOrder = await req('/admin/orders/ord_0007', { cookie: adminCookie });
  expect('cancellation recorded with restocked inventory', cancelledOrder.text.includes('cancelled') && cancelledOrder.text.includes('inventory restored'));

  const newProduct = await req('/admin/products/new', { method: 'POST', cookie: adminCookie, redirect: 'manual', form: { title: 'Smoke Test Tee', handle: 'smoke-test-tee', type: 'T-Shirt', price: '39.00', status: 'active', tagline: 'Created by the smoke test', collections: 'men, essentials', tags: 'test' } });
  expect('creating a product redirects to its edit page', newProduct.status === 302 && /\/admin\/products\/prd_\d+/.test(newProduct.location || ''), newProduct.location);

  const editProduct = await req('/admin/products/prd_0001', { method: 'POST', cookie: adminCookie, form: { title: 'Atlas Heavyweight Hoodie', handle: 'atlas-heavyweight-hoodie', type: 'Hoodie', price: '128.00', compareAtPrice: '148.00', status: 'active', tags: 'hoodie, fleece', collections: 'men, essentials, bestsellers', descriptionHtml: '<p>Updated by smoke test.</p>', features: 'One\nTwo', materials: 'Cotton', fit: 'Relaxed', seoTitle: 'Atlas', seoDescription: 'desc', image1: '/images/p-atlas-hoodie.jpg' } });
  expect('editing a product re-renders the form with a notice', editProduct.status === 200 && editProduct.text.includes('Product saved'));

  const newDiscount = await req('/admin/discounts', { method: 'POST', cookie: adminCookie, form: { code: 'SMOKE5', type: 'percent', value: '5', minSubtotal: '10', description: 'smoke test' } });
  expect('discount creation responds', newDiscount.status === 200 && newDiscount.text.includes('SMOKE5'));
  const toggleDiscount = await req('/admin/discounts/dsc_01/toggle', { method: 'POST', cookie: adminCookie, form: {} });
  expect('discount toggle responds', toggleDiscount.status === 200);
  await req('/admin/discounts/dsc_01/toggle', { method: 'POST', cookie: adminCookie, form: {} }); // restore

  const reviewsPage = await req('/admin/reviews', { cookie: adminCookie });
  const pendingReviewId = (reviewsPage.text.match(/\/admin\/reviews\/(rev_[A-Za-z0-9_]+)\/publish/) || [])[1];
  if (pendingReviewId) {
    const publish = await req(`/admin/reviews/${pendingReviewId}/publish`, { method: 'POST', cookie: adminCookie, form: {} });
    expect('publishing a review responds', publish.status === 200);
  } else { expect('publishing a review responds', false, 'no pending review found'); }
  const replies = await req('/admin/reviews/rev_0001/reply', { method: 'POST', cookie: adminCookie, form: { reply: 'Thanks for the review — team Vennix.' } });
  expect('review reply saves', replies.status === 200 && replies.text.includes('Thanks for the review'));

  const resolveMsg = await req('/admin/messages/msg_0001/reply', { method: 'POST', cookie: adminCookie, form: { reply: 'On its way — tracking follows within the hour.' } });
  expect('support reply resolves the thread', resolveMsg.status === 200 && resolveMsg.text.includes('Reply sent'));
  const settings = await req('/admin/settings', { method: 'POST', cookie: adminCookie, form: { section: 'announcements', announcements: 'Free shipping over $50\nCapsule 01 in stock' } });
  expect('settings save responds', settings.status === 200 && settings.text.includes('Settings saved'));
  const settingsGeneral = await req('/admin/settings', { method: 'POST', cookie: adminCookie, form: { section: 'general', brandName: 'Vennix', tagline: 'Modern clothing & active essentials.', supportEmail: 'support@vennixstore.com', supportPhone: '', line1: '44 Wythe Avenue', city: 'Brooklyn', province: 'NY', zip: '11249', domain: 'vennixstore.com', freeShippingThreshold: '50', seoTitle: 'Vennix', seoDescription: 'Modern clothing and active essentials.' } });
  expect('general settings save responds', settingsGeneral.status === 200);

  const pos = await req('/admin/pos/charge', { method: 'POST', cookie: adminCookie, form: { lines: 'var_gift_5000:1', method: 'Cash', email: 'walkin@studio.local' } });
  expect('POS sale creates an in-store order', pos.status === 200 && pos.text.includes('Sale VEN-'));

  /* --------------------------------------------------------------- assets */
  console.log('\nAssets + SEO');
  const indexHtml = await req('/');
  expect('catalog index embedded for wishlist', indexHtml.text.includes('data-catalog-index'));
  expect('product JSON embedded for variant switching', indexHtml.text.includes('data-product-json="atlas-heavyweight-hoodie"'));
  expect('structured data present', indexHtml.text.includes('"@type":"Organization"'));
  const pdp = await req('/products/flow-high-rise-legging-28');
  expect('PDP has Product schema with ratings', pdp.text.includes('"@type":"Product"') && pdp.text.includes('aggregateRating'));
  const faqPage = await req('/pages/faq');
  expect('FAQ page has FAQPage schema', faqPage.text.includes('FAQPage'));
  const sitemap = await req('/sitemap.xml');
  expect('sitemap lists products and pages', sitemap.text.includes('/products/') && sitemap.text.includes('/pages/'));
  const giftImg = await req('/images/gift-card.svg');
  expect('gift card artwork served', giftImg.status === 200 && giftImg.text.includes('GIFT CARD'));

  /* ------------------------------------------------------------- summary */
  console.log(`\n${'─'.repeat(48)}\n  ${pass} passed, ${fail} failed\n`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach(f => console.log('  • ' + f));
    process.exitCode = 1;
  }
})();
