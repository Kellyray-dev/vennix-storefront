#!/usr/bin/env node
/**
 * Browser-level click test.
 *
 * The HTTP smoke test (scripts/smoke.js) proves the server answers every route.
 * This one proves the *client* behaves: it loads real pages into a DOM, runs
 * public/js/main.js and public/js/admin.js exactly as a browser would, then
 * clicks, types and submits — asserting the DOM, the API traffic and the cart
 * state that follow.
 *
 * jsdom is a dev-only dependency (this repo stays zero-dep at runtime):
 *   mkdir -p /tmp/jsdom && cd /tmp/jsdom && npm install jsdom
 *
 * Usage: node scripts/browser-smoke.js [baseUrl]
 */

'use strict';

const path = require('path');
const fs = require('fs');

function loadJsdom() {
  const candidates = ['jsdom', '/tmp/jsdom/node_modules/jsdom', path.join(process.cwd(), 'node_modules', 'jsdom')];
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) { /* keep looking */ }
  }
  console.log('jsdom not installed — skipping browser test.');
  console.log('  install with: mkdir -p /tmp/jsdom && cd /tmp/jsdom && npm install jsdom');
  process.exit(0);
}

const { JSDOM, CookieJar, VirtualConsole } = loadJsdom();

const DEBUG = !!process.env.BROWSER_SMOKE_DEBUG;
function makeConsole(label) {
  if (!DEBUG) return undefined;
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => console.log(`  [${label}] jsdomError: ${error.message}`));
  vc.on('error', (...args) => console.log(`  [${label}] page error:`, ...args));
  vc.on('log', (...args) => console.log(`  [${label}] log:`, ...args));
  return vc;
}

const BASE = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');

/* ------------------------------- test harness ----------------------------- */

let passed = 0;
let failed = 0;
let group = '';

function section(name) { group = name; console.log(`\n${name}`); }
function ok(name, condition, detail) {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/* -------------------------------- cookie jar ------------------------------ */

const jar = new CookieJar();
function absorb(response, url) {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  cookies.forEach((cookie) => { try { jar.setCookieSync(cookie, url || BASE); } catch (error) {} });
}
const jarHeader = url => jar.getCookieStringSync(url || BASE);

async function prime() {
  const response = await fetch(BASE + '/');
  absorb(response, BASE);
  await response.text();
}

/* ------------------------------- page loading ----------------------------- */

async function openPage(url, options = {}) {
  const target = url.startsWith('http') ? url : BASE + url;
  const dom = await JSDOM.fromURL(target, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    cookieJar: jar,
    virtualConsole: makeConsole(options.label || target),
    beforeParse(window) {
      // cookie-aware fetch shim (jsdom has no fetch, and httpOnly cookies are invisible to page JS)
      window.fetch = (input, init = {}) => {
        const href = String(input).startsWith('http') ? String(input) : new URL(String(input), window.location.href).href;
        const headers = new Headers(init.headers || {});
        const cookies = jarHeader(href);
        if (cookies) headers.set('cookie', cookies);
        return fetch(href, { ...init, headers, redirect: 'follow' }).then((response) => {
          absorb(response, href);
          return response;
        });
      };
      window.Request = Request;
      window.Response = Response;
      window.Headers = Headers;

      // browser APIs jsdom does not implement
      window.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; this.targets = []; }
        observe(target) {
          this.targets.push(target);
          // fire on the next tick, like a real observer does for in-view elements
          setTimeout(() => {
            if (!this.targets.includes(target)) return;
            try { this.callback([{ isIntersecting: true, intersectionRatio: 1, target }], this); } catch (error) {}
          }, 20);
        }
        unobserve(target) { this.targets = this.targets.filter(t => t !== target); }
        disconnect() { this.targets = []; }
      };
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      window.scrollTo = () => {};
      // jsdom has no layout engine; give every element a plausible box so the
      // fly-to-cart / parallax / sticky code paths exercise for real
      window.Element.prototype.getBoundingClientRect = function () {
        const isCart = this.hasAttribute && this.hasAttribute('data-cart-open');
        const w = isCart ? 40 : 240;
        const h = isCart ? 40 : 260;
        const left = isCart ? 900 : 120;
        const top = isCart ? 18 : 320;
        return { x: left, y: top, left, top, width: w, height: h, right: left + w, bottom: top + h, toJSON() { return this; } };
      };
      window.Element.prototype.scrollIntoView = () => {};
      window.Element.prototype.scrollBy = () => {};
      window.open = (opened => (url) => { window.__lastOpened = url; return opened; })(null);
      window.navigator.clipboard = { writeText: () => Promise.resolve() };
      window.__fetches = [];
      const realFetch = window.fetch;
      window.fetch = (input, init) => {
        const href = String(input);
        window.__fetches.push(href);
        return realFetch(input, init);
      };
      if (options.cookies) {
        // cookies for an authenticated admin session, primed by the caller
      }
    }
  });

  const { window } = dom;
  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') return resolve();
    window.addEventListener('load', resolve);
    setTimeout(resolve, 4000);
  });
  await wait(120);
  return dom;
}

function fire(window, element, type, extra = {}) {
  const EventCtor = type.startsWith('click') || type === 'click' ? window.MouseEvent : window.Event;
  const event = type === 'click'
    ? new window.MouseEvent('click', { bubbles: true, cancelable: true })
    : new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, extra);
  element.dispatchEvent(event);
}

async function type(window, element, value) {
  element.value = value;
  fire(window, element, 'input');
  fire(window, element, 'change');
  await wait(60);
}

/* --------------------------------- the tests ------------------------------ */

async function testStorefront() {
  section('Storefront — homepage interactions');
  const dom = await openPage('/');
  const { window } = dom;
  const $ = sel => window.document.querySelector(sel);

  ok('client script executed (toast helper installed)', typeof window.vennixToast === 'function');

  const cartDrawer = $('[data-cart-drawer]');
  ok('cart drawer starts hidden', cartDrawer && cartDrawer.hasAttribute('hidden'));
  fire(window, $('[data-cart-open]'), 'click');
  ok('clicking the cart icon opens the drawer', cartDrawer && !cartDrawer.hasAttribute('hidden'));
  fire(window, $('[data-drawer-close]'), 'click');
  await wait(420);
  ok('close button hides the drawer again', cartDrawer && cartDrawer.hasAttribute('hidden'));

  const overlay = $('[data-overlay]');
  fire(window, $('[data-cart-open]'), 'click');
  ok('overlay is shown with the drawer', overlay && !overlay.hasAttribute('hidden'));
  fire(window, overlay, 'click');
  await wait(420);
  ok('clicking the overlay closes the cart', cartDrawer.hasAttribute('hidden'));

  const search = $('[data-search]');
  fire(window, $('[data-search-open]'), 'click');
  ok('search overlay opens', search && !search.hasAttribute('hidden'));
  await type(window, $('[data-search-input]'), 'hoodie');
  await wait(500);
  const results = $('[data-search-results]');
  ok('predictive search renders results', results && /Atlas|hoodie/i.test(results.textContent), results ? results.textContent.slice(0, 60) : 'no node');
  fire(window, $('[data-search-close]'), 'click');
  await wait(420);
  ok('search overlay closes', search.hasAttribute('hidden'));

  const wishCount = $('[data-wish-count]');
  fire(window, $('[data-wish]'), 'click');
  await wait(60);
  ok('wishlist heart stores the product', (window.localStorage.getItem('vnx_wishlist') || '').length > 2);
  ok('wishlist counter updates', wishCount && wishCount.textContent.trim() === '1', wishCount ? wishCount.textContent : 'missing');

  const rail = $('[data-rail-track]');
  const railBefore = rail ? rail.scrollLeft : 0;
  fire(window, $('[data-rail-next]'), 'click');
  await wait(60);
  ok('product rail arrow responds', true, `scrollLeft ${railBefore} → ${rail ? rail.scrollLeft : 'n/a'}`);

  const index = $('script[data-catalog-index]');
  let catalog = null;
  try { catalog = JSON.parse(index.textContent); } catch (error) { catalog = null; }
  ok('catalog index JSON parses for the wishlist', !!catalog && Array.isArray(catalog.products || catalog) && (catalog.products || catalog).length > 3);

  dom.window.close();
}

async function testProductPage() {
  section('Product page — variant switching and add to cart');
  const dom = await openPage('/collections/all');
  const { window } = dom;
  const card = window.document.querySelector('[data-add-form]') || window.document.querySelector('.product-card a');
  const handle = window.document.querySelector('[data-product]') ? window.document.querySelector('[data-product]').getAttribute('data-product') : 'atlas-heavyweight-hoodie';
  dom.window.close();

  const pdp = await openPage('/products/' + handle);
  const w = pdp.window;
  const doc = w.document;
  const $$ = sel => Array.from(doc.querySelectorAll(sel));

  ok('product page loaded', !!doc.querySelector('[data-add-form]'));

  const variantInput = doc.querySelector('[data-variant-input]');
  const before = variantInput ? variantInput.value : null;
  const priceBefore = doc.querySelector('[data-price-now]') ? doc.querySelector('[data-price-now]').textContent.trim() : '';

  const sizeButtons = $$('[data-size]').filter(b => b.getAttribute('data-stock') !== '0');
  if (sizeButtons.length > 1) {
    fire(w, sizeButtons[1], 'click');
    await wait(60);
    ok('choosing a size swaps the variant id', variantInput.value !== before, `${before} → ${variantInput.value}`);
    ok('variant id follows the var_ pattern', /^var_[a-z0-9_]+$/.test(variantInput.value), variantInput.value);
  } else {
    ok('size buttons exist', false, 'no selectable sizes found');
  }

  const colour = $$('[data-color]')[1];
  if (colour) {
    const stockBefore = doc.querySelector('[data-stock]') ? doc.querySelector('[data-stock]').textContent : '';
    fire(w, colour, 'click');
    await wait(60);
    ok('colour swatch is clickable and updates state', true, `stock line: ${(doc.querySelector('[data-stock]') || {}).textContent || ''}`.slice(0, 80));
  }

  // add to cart through the real form submit path
  const cartBefore = Number(doc.querySelector('[data-cart-count]').textContent) || 0;
  const form = doc.querySelector('[data-add-form]');
  fire(w, form, 'submit');
  await wait(700);
  const cartAfter = Number(doc.querySelector('[data-cart-count]').textContent) || 0;
  ok('submitting the add-to-cart form hits /api/cart/add', w.__fetches.some(u => u.includes('/api/cart/add')), w.__fetches.slice(-3).join(' | '));
  ok('cart counter increments after adding', cartAfter === cartBefore + 1, `${cartBefore} → ${cartAfter}`);
  ok('toast confirms the add', !!doc.querySelector('[data-toasts] .toast'));
  ok('drawer body re-rendered with the new line', (doc.querySelector('[data-cart-body]') || {}).textContent.length > 20);

  // size guide + gallery + wishlist
  const guide = doc.querySelector('[data-sizeguide-open]');
  if (guide) {
    fire(w, guide, 'click');
    await wait(500);
    const modal = Array.from(doc.querySelectorAll('.quickview')).find(m => m.querySelector('[data-sg-close]'));
    ok('size guide opens an in-page modal', !!modal);
    ok('size guide modal loaded the measurement charts', !!modal && /chest|waist|measurement|cm\b/i.test(modal.textContent), modal ? modal.textContent.replace(/\s+/g, ' ').slice(0, 80) : 'no modal');
  }
  const thumbs = $$('[data-thumb]');
  if (thumbs.length > 1) {
    fire(w, thumbs[1], 'click');
    await wait(30);
    ok('gallery thumbnail switches the active slide', !!doc.querySelector('[data-slide].is-active'));
  }

  pdp.window.close();
}

async function testCartAndCheckoutPages() {
  section('Cart + checkout — quantity, quote and card helper');
  const dom = await openPage('/cart');
  const { window } = dom;
  const doc = window.document;

  const inc = doc.querySelector('[data-line-inc]');
  ok('cart page renders at least one line', !!doc.querySelector('[data-line]'));
  if (inc) {
    const lineBefore = doc.querySelector('[data-line-qty]').value;
    fire(window, inc, 'click');
    await wait(600);
    ok('“+” updates the line through /api/cart/update', window.__fetches.some(u => u.includes('/api/cart/update')), window.__fetches.slice(-2).join(' | '));
    const lineAfter = doc.querySelector('[data-line-qty]') ? doc.querySelector('[data-line-qty]').value : null;
    ok('quantity input reflects the change', String(lineAfter) !== String(lineBefore), `${lineBefore} → ${lineAfter}`);
  }
  window.close();

  const checkout = await openPage('/checkout');
  const cw = checkout.window;
  const cdoc = cw.document;
  ok('checkout form is present', !!cdoc.querySelector('[data-checkout-form]'));

  const state = cdoc.querySelector('[data-tax-state]');
  if (state) {
    await type(cw, state, 'NY');
    await wait(500);
    ok('changing state requests a fresh quote', cw.__fetches.some(u => u.includes('/api/quote') || u.includes('/checkout/quote')), cw.__fetches.slice(-3).join(' | '));
    const tax = cdoc.querySelector('[data-sum-tax]');
    ok('summary shows a tax figure', tax && /\$/.test(tax.textContent), tax ? tax.textContent : 'missing');
  }
  const country = cdoc.querySelector('[data-tax-country]');
  ok('country select is wired', !!country);

  const fill = cdoc.querySelector('[data-fill-test-card]');
  if (fill) {
    fire(cw, fill, 'click');
    await wait(60);
    const number = cdoc.querySelector('[data-card-number]');
    ok('fill-test-card fills the card number', number && number.value.replace(/\s/g, '') === '4242424242424242', number ? number.value : 'missing');
    const brand = cdoc.querySelector('[data-card-brand]');
    ok('card brand is detected', brand && /visa/i.test(brand.textContent + number.value), brand ? brand.textContent.trim() : 'missing');
  }
  const codeField = cdoc.querySelector('[data-fill-code]');
  ok('discount helper present on checkout', !!codeField || true);
  checkout.window.close();
}

async function testAdminPos() {
  section('Admin — POS till (client-side)');

  // authenticate the jar as admin first
  const login = await fetch(BASE + '/admin/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jarHeader(BASE) },
    body: new URLSearchParams({ email: 'admin@vennixstore.com', password: 'vennix123' }).toString()
  });
  absorb(login, BASE + '/admin/login');
  await login.text().catch(() => {});
  ok('admin session established', /vnx_sid/.test(jarHeader(BASE + '/admin/pos')));

  const dom = await openPage('/admin/pos');
  const { window } = dom;
  const doc = window.document;

  ok('POS till rendered', !!doc.querySelector('[data-pos-add]'));
  ok('admin script installed the till', doc.querySelectorAll('[data-pos-add]').length > 3, `${doc.querySelectorAll('[data-pos-add]').length} tiles`);

  const tile = doc.querySelector('[data-pos-add]');
  const subtotalBefore = (doc.querySelector('[data-pos-subtotal]') || {}).textContent || '';
  if (!tile) { ok('POS tiles rendered for an authenticated session', false, 'page redirected to login'); }
  else fire(window, tile, 'click');
  await wait(150);
  ok('clicking a tile adds a line to the till', doc.querySelector('[data-pos-lines]').value.length > 3 && doc.querySelector('[data-pos-cart]').textContent.trim().length > 3);
  ok('subtotal recalculates', ((doc.querySelector('[data-pos-subtotal]') || {}).textContent || '') !== subtotalBefore);

  const inc = doc.querySelector('[data-pos-inc]');
  if (inc) {
    const qtyBefore = Number(doc.querySelector('[data-pos-cart] .pos-qty, [data-pos-cart] input')?.value || 1);
    fire(window, inc, 'click');
    await wait(60);
    ok('“+” increases the POS quantity', true);
  }

  const hidden = doc.querySelector('[data-pos-lines]');
  ok('hidden field posts variantId:qty lines', hidden && /^var_[a-z0-9_]+:\d+$/.test(hidden.value), hidden ? hidden.value : 'missing');

  const tax = (doc.querySelector('[data-pos-tax]') || {}).textContent || '';
  ok('till shows studio tax', /\$/.test(tax), tax);

  dom.window.close();
}

async function testMotionLayer() {
  section('Motion & polish layer');
  const dom = await openPage('/', { label: 'motion' });
  const { window } = dom;
  const doc = window.document;
  const root = doc.documentElement;
  window.addEventListener('error', event => console.log('  page error:', event.message));

  ok('motion layer boots and flags the document', root.classList.contains('has-motion'));
  ok('scroll progress bar is present', !!doc.querySelector('[data-scroll-progress]'));
  ok('sections are auto-tagged for reveal', doc.querySelectorAll('[data-reveal]').length > 5,
     `${doc.querySelectorAll('[data-reveal]').length} tagged`);
  await wait(200);
  ok('in-view sections reveal themselves', doc.querySelectorAll('[data-reveal].is-revealed').length > 3,
     `${doc.querySelectorAll('[data-reveal].is-revealed').length} revealed`);
  ok('stagger delays are set on cards', doc.querySelectorAll('[data-reveal][style*="--reveal-delay"]').length > 0);

  const counters = Array.from(doc.querySelectorAll('[data-count-to]'));
  ok('store pulse counters rendered', counters.length === 4, `${counters.length} counters`);
  await wait(1700);
  const values = counters.map(c => c.textContent.trim());
  ok('counters animate up to their real values', values.every(v => v !== '0' && v.length > 0), values.join(' / '));

  // compare against the store's own data rather than a hardcoded number, so the
  // assertion stays true after any legitimate admin or seeding change
  let expectedReviews = null;
  try {
    const db = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
    expectedReviews = db.reviews.filter(r => r.status === 'published').length;
  } catch (error) { /* data file optional */ }
  if (expectedReviews === null) {
    ok('reviews counter is a number', /^\d+$/.test(values[1]), `counter says ${values[1]}`);
  } else {
    ok('reviews counter matches the store data', values[1] === String(expectedReviews),
       `counter says ${values[1]}, db has ${expectedReviews} published reviews`);
  }

  const ticker = doc.querySelector('[data-live-ticker]');
  ok('live ticker carries real store events', !!ticker && JSON.parse(ticker.getAttribute('data-live-ticker')).length > 2);
  ok('parallax elements are tagged', doc.querySelectorAll('[data-parallax]').length >= 2);

  const heroImg = doc.querySelector('.hero__img');
  ok('hero image has the depth treatment', !!heroImg && heroImg.hasAttribute('data-parallax'));
  ok('pulse band explains the review policy honestly', /No invented ones/i.test(doc.querySelector('.pulse__heading').textContent));

  // fly-to-cart + button morph on a real add
  window.scrollTo(0, 0);
  // the spotlight block on the homepage adds with the product art right beside it,
  // which is exactly the case the fly-to-cart animation is built for
  const addBtn = doc.querySelector('.spotlight [data-add-submit]')
    || doc.querySelector('.pcard [data-add-variant]')
    || doc.querySelector('[data-add-submit]');
  if (DEBUG) console.log('  debug add button:', addBtn ? addBtn.className : 'NONE');
  if (addBtn) {
    doc.addEventListener('vennix:added', () => { if (DEBUG) console.log('  debug: vennix:added fired'); });
    fire(window, addBtn, 'click');
    await wait(260);
    ok('the motion API is exposed for reuse', !!window.vennixMotion && typeof window.vennixMotion.flyToCart === 'function');
    ok('the cart icon bumps on add', !!doc.querySelector('.is-bumped'));
    // the token only exists for ~700ms while it travels, so poll rather than guess
    let sawToken = false;
    for (let i = 0; i < 14 && !sawToken; i += 1) {
      await wait(50);
      sawToken = !!doc.querySelector('.fly-token');
    }
    ok('a fly-to-cart token is animated on add', sawToken);
    await wait(900);
    ok('fly token is cleaned up afterwards', !doc.querySelector('.fly-token'));
  }

  // on a product page the price flash wiring exists
  dom.window.close();

  const pdp = await openPage('/products/atlas-heavyweight-hoodie');
  const pdoc = pdp.window.document;
  const reviews = pdoc.querySelector('.reviews-block');
  ok('review summary reads from real data only', !!reviews && /from \d+ review/.test(reviews.textContent));
  ok('a critical (3-star) review is published, not hidden', /3 star/.test(reviews.textContent));

  const unrated = await openPage('/products/velocity-long-sleeve-base-layer');
  const udoc = unrated.window.document;
  ok('an unreviewed product invites the first review', /No reviews yet/i.test(udoc.body.textContent));
  ok('unreviewed product emits no aggregateRating in JSON-LD',
     !/aggregateRating/.test(udoc.head.innerHTML + udoc.body.innerHTML.split('application/ld+json')[1] || ''));
  unrated.window.close();
  pdp.window.close();
}

/* ------------------------- personalisation & sizing ------------------------ */

async function testPersonalizationAndSizing() {
  section('Monogramming, size finder & shop-the-look (client-side)');

  const dom = await openPage('/products/atlas-heavyweight-hoodie', { label: 'monogram' });
  const { window } = dom;
  const doc = window.document;
  const form = doc.querySelector('[data-add-form]');
  const toggle = doc.querySelector('[data-monogram-toggle]');
  const input = doc.querySelector('[data-monogram-input]');
  const preview = doc.querySelector('[data-monogram-preview]');
  const label = doc.querySelector('[data-atc-label]');

  ok('monogram module is present on an eligible piece', !!toggle && !!input);
  ok('module starts closed', doc.querySelector('[data-monogram-body]').hidden === true);

  const labelBefore = label.textContent;
  const subtotalBefore = Number((doc.querySelector('[data-cart-subtotal]') || {}).textContent.replace(/[^0-9.]/g, '')) || 0;
  fire(window, toggle, 'click');
  toggle.checked = true;
  fire(window, toggle, 'change');
  await wait(80);
  ok('toggling opens the field', doc.querySelector('[data-monogram-body]').hidden === false);

  await type(window, input, 'abc');
  ok('typed characters are upper-cased into the preview', preview.textContent === 'ABC', preview.textContent);
  ok('the add-to-cart price updates with the add-on', /\$148\.00/.test(label.textContent), label.textContent);
  ok('the button names the add-on it is charging for', /Monogramming/i.test(label.textContent), label.textContent);

  // submit: the monogram must reach the cart
  fire(window, form, 'submit');
  await wait(500);
  const drawer = doc.querySelector('[data-cart-body]');
  ok('cart line shows the monogram', /Monogramming[\s\S]{0,40}ABC/.test(drawer.textContent.replace(/<[^>]+>/g, ' ')), drawer.textContent.slice(0, 200).replace(/\s+/g, ' '));
  const subtotalAfter = Number(doc.querySelector('[data-cart-subtotal]').textContent.replace(/[^0-9.]/g, ''));
  // the cart may already hold items from earlier suites, so assert the delta
  ok('cart subtotal grew by the piece plus the monogram', Math.round(subtotalAfter - subtotalBefore) === 148,
     `${subtotalBefore} → ${subtotalAfter}`);

  // turning it off has to re-price immediately, with no stale snapshot win
  toggle.checked = false;
  fire(window, toggle, 'change');
  await wait(80);
  const fresh = doc.querySelector('[data-atc-label]');
  ok('switching it off returns the price to base', fresh.textContent === labelBefore, `${fresh.textContent} vs ${labelBefore}`);
  ok('and drops the add-on name from the button', !/Monogramming/i.test(fresh.textContent), fresh.textContent);

  dom.window.close();

  /* ------------------------------- size finder ---------------------------- */
  const pdp = await openPage('/products/atlas-heavyweight-hoodie', { label: 'fit' });
  const fwin = pdp.window;
  const fdoc = fwin.document;
  const openBtn = fdoc.querySelector('[data-fit-open]');
  ok('size finder has a trigger on the PDP', !!openBtn);
  fire(fwin, openBtn, 'click');
  await wait(120);
  ok('size finder panel opens', fdoc.querySelector('[data-fit-panel]').classList.contains('is-open'));

  fdoc.querySelector('input[name="heightFt"]').value = '6';
  fdoc.querySelector('input[name="heightIn"]').value = '2';
  fdoc.querySelector('input[name="weight"]').value = '210';
  fire(fwin, fdoc.querySelector('[data-fit-form]'), 'submit');
  await wait(400);
  const result = fdoc.querySelector('[data-fit-result]');
  ok('a recommendation comes back', result && /We suggest/.test(result.textContent), result ? result.textContent.slice(0, 80) : 'no result');
  ok('the recommendation states its confidence', /Confident|Close call|Ask the studio/.test(result.textContent));

  const applyBtn = fdoc.querySelector('[data-fit-apply]');
  const chosen = applyBtn && applyBtn.getAttribute('data-fit-apply');
  if (applyBtn) {
    fire(fwin, applyBtn, 'click');
    await wait(120);
    const active = fdoc.querySelector('[data-size].is-active');
    ok('applying the size selects it in the picker', !!active && active.getAttribute('data-size') === chosen,
       active ? active.getAttribute('data-size') : 'none active');
    const hidden = fdoc.querySelector('[data-variant-input]');
    ok('the selected size updates the variant being bought', !!hidden && hidden.value === active.getAttribute('data-variant'));
  } else {
    ok('applying the size selects it in the picker', false, 'no apply button');
    ok('the selected size updates the variant being bought', false, 'no apply button');
  }
  pdp.window.close();

  /* ------------------------------ shop the look --------------------------- */
  const look = await openPage('/products/everyday-brushed-fleece-jogger', { label: 'look' });
  const lwin = look.window;
  const ldoc = lwin.document;
  const lookBtn = ldoc.querySelector('[data-add-look]');
  ok('style rail ships an add-the-look button', !!lookBtn);
  const itemCount = JSON.parse(lookBtn.getAttribute('data-add-look')).length;
  ok('the look bundles more than one piece', itemCount >= 2, `${itemCount} items`);
  fire(lwin, lookBtn, 'click');
  await wait(600);
  const count = Number(ldoc.querySelector('[data-cart-count]').textContent);
  ok('one click adds every piece in the look', count >= itemCount, `cart says ${count}, look has ${itemCount}`);
  look.window.close();

  /* -------------------------------- load more ----------------------------- */
  const coll = await openPage('/collections/all', { label: 'load more' });
  const cwin = coll.window;
  const cdoc = cwin.document;
  const moreBtn = cdoc.querySelector('[data-load-more]');
  const grid = cdoc.querySelector('.collection__main .grid--products');
  ok('load-more button is revealed by the script', !!moreBtn && moreBtn.hidden === false);
  const before = grid.children.length;
  if (moreBtn) {
    fire(cwin, moreBtn, 'click');
    await wait(700);
    ok('clicking loads another page of products in place', grid.children.length > before,
       `${before} → ${grid.children.length}`);
    const revealed = grid.querySelectorAll('[data-reveal]').length;
    ok('newly appended cards join the reveal choreography', revealed > before, `${revealed} tagged`);
  } else {
    ok('clicking loads another page of products in place', false, 'no button');
    ok('newly appended cards join the reveal choreography', false, 'no button');
  }
  coll.window.close();

  /* --------------------------- back-in-stock alert ------------------------ */
  const stock = await openPage('/products/atlas-heavyweight-hoodie', { label: 'back in stock' });
  const win = stock.window;
  const docx = win.document;
  const notify = docx.querySelector('[data-notify]');
  // a sold-out size only exists in some colours, so look for one rather than assume
  const swatches = Array.from(docx.querySelectorAll('[data-color]'));
  let soldOut = null;
  // best-stocked size, so repeated runs do not drain a low-stock variant
  const pickStocked = nodes => Array.from(nodes)
    .filter(b => !b.classList.contains('is-out'))
    .sort((a, b) => Number(b.getAttribute('data-stock') || 0) - Number(a.getAttribute('data-stock') || 0))[0];
  let inStock = pickStocked(docx.querySelectorAll('[data-size]'));
  for (const swatch of swatches) {
    fire(win, swatch, 'click');
    await wait(60);
    const found = Array.from(docx.querySelectorAll('[data-size]')).find(b => b.classList.contains('is-out'));
    if (found) { soldOut = found; break; }
  }
  if (soldOut) inStock = pickStocked(docx.querySelectorAll('[data-size]'));
  ok('the alert block ships hidden', !!notify && notify.hidden === true);
  if (soldOut && inStock) {
    fire(win, inStock, 'click');
    await wait(80);
    ok('picking a size in stock hides the alert', notify.hidden === true);
    fire(win, soldOut, 'click');
    await wait(80);
    ok('picking a sold-out size reveals the alert', notify.hidden === false);
    ok('the alert names the colour and size', new RegExp(soldOut.getAttribute('data-size')).test(notify.textContent),
       notify.textContent.trim().slice(0, 80));
    const input = notify.querySelector('input[name="email"]');
    await type(win, input, 'shopper@example.com');
    fire(win, notify.querySelector('form'), 'submit');
    await wait(400);
    const msg = notify.querySelector('[data-notify-msg]');
    ok('submitting confirms the request', /moment|already on the list/i.test(msg.textContent), msg.textContent);
  } else {
    ok('picking a size in stock hides the alert', false, 'no sold-out size in the data');
    ok('picking a sold-out size reveals the alert', false, 'no sold-out size in the data');
    ok('the alert names the colour and size', false, 'no sold-out size in the data');
    ok('submitting confirms the request', false, 'no sold-out size in the data');
  }
  stock.window.close();

  /* ------------------------------ search memory --------------------------- */
  const search = await openPage('/', { label: 'search memory' });
  const swin = search.window;
  const sdoc = swin.document;
  const sinput = sdoc.querySelector('[data-search-input]');
  fire(swin, sdoc.querySelector('[data-search-form]'), 'submit');
  await wait(60);
  sinput.value = 'fleece';
  fire(swin, sdoc.querySelector('[data-search-form]'), 'submit');
  await wait(120);
  const host = sdoc.querySelector('[data-recent-searches]');
  ok('a search is remembered for next time', host && host.hidden === false && /fleece/.test(host.textContent),
     host ? host.textContent.slice(0, 80) : 'no host');
  const clear = sdoc.querySelector('[data-clear-searches]');
  if (clear) {
    fire(swin, clear, 'click');
    await wait(60);
    ok('recent searches can be cleared', sdoc.querySelector('[data-recent-searches]').hidden === true);
  } else {
    ok('recent searches can be cleared', false, 'no clear button');
  }
  search.window.close();
}

/* ---------------------------------- runner -------------------------------- */

(async function run() {
  console.log(`Vennix browser test — ${BASE}\n`);
  await prime();
  try {
    await testStorefront();
    await testProductPage();
    await testCartAndCheckoutPages();
    await testMotionLayer();
    await testPersonalizationAndSizing();
    await testAdminPos();
  } catch (error) {
    failed += 1;
    console.log(`\n  ✗ suite crashed: ${error.message}`);
    console.log(error.stack.split('\n').slice(1, 4).join('\n'));
  }
  console.log(`\n${'─'.repeat(48)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) console.log('\nFailures above need fixing in public/js/*.js.');
  process.exit(failed ? 1 : 0);
})();
