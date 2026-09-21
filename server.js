'use strict';
/**
 * server.js — the storefront + admin HTTP application. Brand-neutral by
 * design: every name, policy figure and order prefix comes from db.settings.
 * Zero runtime dependencies: node's http module, a small router, and files.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./lib/store');
const seed = require('./lib/seed');
const auth = require('./lib/auth');
const cartLib = require('./lib/cart');
const commerce = require('./lib/commerce');
const emails = require('./lib/emails');
const layout = require('./lib/layout');
const ui = require('./lib/ui');
const api = require('./lib/api');
const adminRouter = require('./lib/admin/router');

const PAGES = {
  home: require('./lib/pages/home'),
  catalog: require('./lib/pages/catalog'),
  product: require('./lib/pages/product'),
  cart: require('./lib/pages/cart'),
  checkout: require('./lib/pages/checkout'),
  account: require('./lib/pages/account'),
  content: require('./lib/pages/content')
};

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

seed.ensureSeeded();

/* ---------------------------- CSRF / origin check -------------------------- */
/**
 * Simple CSRF defense for state-changing requests: require the Origin (or
 * Referer when Origin is omitted by the browser) to match the request's
 * Host. SameSite=Lax cookies already blunt form-submit CSRF in modern
 * browsers; this adds defense-in-depth against top-level navigations and
 * older user agents.
 */
function sameOrigin(req) {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  if (!host) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      return o.hostname.toLowerCase() === host;
    } catch { return false; }
  }
  const ref = req.headers.referer;
  if (ref) {
    try {
      const r = new URL(ref);
      return r.hostname.toLowerCase() === host;
    } catch { return false; }
  }
  // Accept if neither header is present (curl / same-origin users); browsers
  // send at least Referer on same-origin POSTs.
  return true;
}

/* ------------------------- idempotency for checkout ------------------------ */
// Simple per-session checkout token stored on the cart to block double-submits.
function checkoutToken(cart) {
  if (!cart._checkoutToken) cart._checkoutToken = crypto.randomBytes(12).toString('base64url');
  return cart._checkoutToken;
}

/* --------------------------- in-memory rate limit -------------------------- */
// Tiny sliding-window rate limiter keyed on IP + route. Single-process only,
// good enough to blunt credential stuffing and form spam behind a real proxy.
const RATE_BUCKETS = new Map();
function rateLimit(req, key, { windowMs = 60_000, max = 10 } = {}) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  const bucketKey = `${ip}:${key}`;
  const now = Date.now();
  const bucket = (RATE_BUCKETS.get(bucketKey) || []).filter(t => now - t < windowMs);
  if (bucket.length >= max) return false;
  bucket.push(now);
  RATE_BUCKETS.set(bucketKey, bucket);
  return true;
}

/* ------------------------------- primitives ------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.map': 'application/json'
};

function sendHtml(res, html, status = 200, extraHeaders = {}) {
  const body = Buffer.from(html);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    ...extraHeaders
  });
  res.end(body);
}

function sendJson(res, obj, status = 200) {
  const body = Buffer.from(JSON.stringify(obj));
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY'
  };
  res.writeHead(status, headers);
  res.end(body);
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location });
  res.end();
}

function sendFile(res, filePath, { cache = false } = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cache ? 'public, max-age=86400' : 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function parseBody(req, limit = 512 * 1024) {
  return new Promise(resolve => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { req.destroy(); resolve({}); return; }
      data += chunk;
    });
    req.on('end', () => {
      const out = {};
      const type = req.headers['content-type'] || '';
      if (type.includes('application/json')) {
        try { Object.assign(out, JSON.parse(data || '{}')); } catch { /* ignore */ }
      } else {
        for (const pair of data.split('&')) {
          if (!pair) continue;
          const idx = pair.indexOf('=');
          const key = decodeURIComponent((idx === -1 ? pair : pair.slice(0, idx)).replace(/\+/g, ' '));
          const val = idx === -1 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
          out[key] = val;
        }
      }
      resolve(out);
    });
    req.on('error', () => resolve({}));
  });
}

function flashFrom(query) {
  if (query.error) return { error: query.error, values: {} };
  if (query.ok) return { notice: query.ok };
  return null;
}

/* --------------------------------- context -------------------------------- */
function makeCtx(req, res, url, query) {
  const db = store.getDb();
  const session = auth.currentSession(req);
  const customer = session && session.customerId ? store.find('customers', c => c.id === session.customerId) : null;
  const rawCart = cartLib.getOrCreateCart(req, res);
  if (customer && !rawCart.province && customer.addresses[0]) rawCart.province = customer.addresses[0].province;
  const computedCart = cartLib.computeCart(rawCart);
  const ctx = {
    req, res, url, query, db,
    settings: db.settings,
    session, customer, rawCart,
    cart: computedCart,
    computedCart: opts => cartLib.computeCart(rawCart, opts),
    recompute: opts => { ctx.cart = cartLib.computeCart(rawCart, opts); return ctx.cart; },
    body: () => parseBody(req),
    adminSession: auth.requireAdmin(req),
    flash: flashFrom(query)
  };
  return ctx;
}

/* --------------------------------- helpers -------------------------------- */
function renderPage(ctx, view) {
  if (!view) return sendHtml(ctx.res, res404(ctx), 404);
  const html = layout.shell({
    title: view.title, description: view.description, canonical: view.canonical,
    jsonLd: view.jsonLd || [], bodyClass: view.bodyClass || '', content: view.content,
    settings: ctx.settings, cart: ctx.cart, customer: ctx.customer, navActive: view.navActive || '',
    noHeader: view.noHeader || false
  });
  return sendHtml(ctx.res, html, view.status || 200);
}

function res404(ctx) {
  const view = PAGES.content.render404(ctx);
  return layout.shell({
    title: view.title, description: view.description, canonical: view.canonical, jsonLd: [],
    bodyClass: view.bodyClass, content: view.content, settings: ctx.settings, cart: ctx.cart, customer: ctx.customer
  });
}



/* ------------------------------ order creation ---------------------------- */
function createOrder(ctx, values) {
  const cart = ctx.cart;
  const errors = {};
  const required = { email: 'Enter your email', firstName: 'Enter a first name', lastName: 'Enter a last name', line1: 'Enter your address', city: 'Enter a city', zip: 'Enter a ZIP code' };
  for (const [field, message] of Object.entries(required)) if (!String(values[field] || '').trim()) errors[field] = message;
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) errors.email = 'That email does not look right.';
  if (values.zip && !/^[A-Za-z0-9][A-Za-z0-9\- ]{2,9}$/.test(values.zip)) errors.zip = 'Check the ZIP code.';
  if (!cart.count) errors.cart = 'Your cart is empty.';

  // stock re-check at the moment of purchase
  for (const line of cart.lines) {
    const found = cartLib.productFor(line.variantId);
    if (!found) { errors.cart = `${line.title} is no longer available.`; break; }
    if (found.variant.stock < line.quantity) {
      errors.cart = `Only ${found.variant.stock} left of ${found.product.title} in ${line.color} / ${line.size}. Please update your cart.`;
      break;
    }
  }

  // Bail early on validation errors BEFORE marking the cart as converting — a
  // failed decline/validation attempt must leave the cart reusable for the next
  // submission in the same session.
  if (Object.keys(errors).length) return { errors };

  // Mark the cart as converting so a concurrent double-submit can't slip past
  // the early guard above.
  ctx.rawCart._converting = true;
  store.save();

  const payment = commerce.authorize({
    number: values.cardNumber, exp: values.cardExpiry, cvv: values.cardCvc, name: values.cardName || `${values.firstName} ${values.lastName}`
  });
  if (!payment.ok) {
    errors.cardNumber = payment.error;
    ctx.rawCart._converting = false;
    store.save();
    return { errors };
  }

  // reserve stock
  for (const line of cart.lines) {
    const found = cartLib.productFor(line.variantId);
    if (!found) continue;
    found.variant.stock = Math.max(0, found.variant.stock - line.quantity);
    found.product.inventoryQuantity = found.product.variants.reduce((s, v) => s + v.stock, 0);
    store.insert('inventoryLog', { sku: found.variant.sku, delta: -line.quantity, reason: `Web order`, at: new Date().toISOString() });
  }

  const shippingAddress = {
    firstName: values.firstName, lastName: values.lastName, line1: values.line1, line2: values.line2 || '',
    city: values.city, province: values.province, zip: values.zip, country: values.country || 'United States', phone: values.phone || ''
  };
  const subtotal = cart.subtotal;
  const discountAmount = cart.discountAmount;
  const shippingAmount = cart.shipping.amount;
  const tax = commerce.taxFor(shippingAddress, subtotal - discountAmount + shippingAmount);
  const total = Math.max(0, subtotal - discountAmount) + shippingAmount + tax.amount;

  const sequence = store.all('orders').length + 1;
  const order = {
    id: store.nextId('ord'),
    number: `${store.getDb().settings.orderPrefix || 'ORD'}-${1000 + sequence}`,
    sequence,
    email: String(values.email).toLowerCase(),
    customerId: ctx.customer ? ctx.customer.id : null,
    customerName: `${values.firstName} ${values.lastName}`,
    items: cart.lines.map(l => {
      const found = cartLib.productFor(l.variantId);
      const product = found ? found.product : null;
      return {
        id: store.uid('oi'), productId: product ? product.id : null, handle: product ? product.handle : null,
        title: l.title, variantId: l.variantId, color: l.color, size: l.size, sku: l.sku || (found ? found.variant.sku : ''),
        price: l.price, compareAtPrice: l.compareAtPrice || null, quantity: l.quantity,
        // the monogram travels with the order so the studio, the packing slip
        // and the confirmation email all see what was actually stitched
        personalization: l.personalization ? { ...l.personalization } : null,
        image: product ? product.images[0].src : '', weight: found ? found.variant.weight : 0
      };
    }),
    subtotal,
    discount: cart.discount ? { code: cart.discount.code, amount: discountAmount, label: cart.discount.label, freeShipping: !!cart.discount.freeshipping } : null,
    discountAmount,
    shipping: { method: cart.shipping.method, label: cart.shipping.label, amount: shippingAmount },
    tax: { name: tax.name, rate: tax.rate, amount: tax.amount },
    total,
    currency: 'USD',
    status: 'paid',
    financialStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    fulfillment: null,
    shippingAddress,
    billingAddress: values.billingSame === 'off' || values.billingSame === false ? { firstName: values.firstName, lastName: values.lastName, line1: values.billingLine1 || values.line1, city: values.billingCity || values.city, province: values.billingProvince || values.province, zip: values.billingZip || values.zip, country: 'United States' } : shippingAddress,
    payment: { brand: payment.brand, last4: payment.last4, authCode: payment.authCode, mode: payment.network },
    timeline: [
      { at: new Date().toISOString(), label: 'Order placed', note: 'Confirmation email sent' },
      { at: new Date().toISOString(), label: 'Payment captured', note: `Authorised via ${ctx.settings.payments.provider} · ${payment.authCode}` }
    ],
    giftNote: values.giftNote || cart.giftNote || '',
    note: values.note || '',
    tags: [],
    source: 'Online Store',
    channel: 'web',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  store.insert('orders', order);

  // customer record (create or update)
  let customer = ctx.customer || store.find('customers', c => c.email === order.email);
  if (!customer) {
    const pw = auth.hashPassword(crypto.randomBytes(12).toString('base64url'));
    customer = store.insert('customers', {
      email: order.email, firstName: values.firstName, lastName: values.lastName,
      phone: values.phone || '', passwordHash: pw.hash, salt: pw.salt,
      acceptsMarketing: values.acceptsMarketing !== 'off' && values.acceptsMarketing !== false,
      tags: ['created-at-checkout'], note: '', addresses: [{ id: store.uid('adr'), label: 'Home', ...shippingAddress, isDefault: true }],
      createdAt: new Date().toISOString(), marketingSource: 'checkout', ordersCount: 0, totalSpent: 0
    });
    order.customerId = customer.id;
    store.update('orders', order.id, { customerId: customer.id });
  } else {
    if (values.saveAddress !== 'off' && values.saveAddress !== false) {
      const exists = customer.addresses.some(a => a.line1 === shippingAddress.line1 && a.zip === shippingAddress.zip);
      if (!exists) customer.addresses.push({ id: store.uid('adr'), label: 'Home', ...shippingAddress, isDefault: customer.addresses.length === 0 });
    }
    customer.phone = values.phone || customer.phone;
    if (values.acceptsMarketing === 'on' || values.acceptsMarketing === true) customer.acceptsMarketing = true;
    store.save();
  }
  const owned = store.all('orders').filter(o => o.customerId === customer.id && o.status !== 'refunded');
  store.update('customers', customer.id, { ordersCount: owned.length, totalSpent: owned.reduce((s, o) => s + o.total, 0) });

  // discount usage
  if (cart.discount) {
    const d = store.find('discounts', x => x.code === cart.discount.code);
    if (d) { d.used = (d.used || 0) + 1; store.save(); }
  }

  // emails
  const confirmation = emails.record('confirmation', order, ctx.settings);
  order.confirmationEmail = confirmation.file;
  store.update('orders', order.id, { confirmationEmail: confirmation.file });

  // gift card delivery note
  if (order.items.some(i => i.variantId.startsWith('var_gift_'))) {
    store.writeEmail(`giftcard-${order.number}-${Date.now()}`, commerce.emailShell(`Your ${ctx.settings.brandName} gift card`, `<h1>Gift card delivered</h1><p>Gift card codes are generated the moment the order is paid. In this sandbox build the code is <strong>GC-${order.number}</strong> for ${commerce.money(order.subtotal)}.</p>`, ctx.settings));
  }

  if (values.emailCopy !== 'off') store.writeEmail(`copy-${order.number}-${Date.now()}`, emails.orderConfirmation(order, ctx.settings));

  store.logActivity(order.email, 'order.created', `${order.number} · ${commerce.money(order.total)} · ${order.items.length} items`);
  // Shopifiable behaviour: the cart is emptied and archived as converted.
  // _lastOrderId is set BEFORE clearing items so concurrent requests see the
  // prior order via the early guard above.
  ctx.rawCart._lastOrderId = order.id;
  ctx.rawCart._converting = false;
  ctx.rawCart.items = [];
  ctx.rawCart.discountCode = null;
  ctx.rawCart.giftNote = '';
  ctx.rawCart._checkoutToken = null;
  cartLib.markRecovered(ctx.rawCart, order.id);
  return { order };
}

/* ---------------------------------- router -------------------------------- */
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const url = parsed;
  const query = Object.fromEntries(parsed.searchParams.entries());
  const pathname = decodeURIComponent(parsed.pathname);
  const method = req.method.toUpperCase();

  // --- static assets ---
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/images/') || pathname === '/favicon.svg' || pathname === '/apple-touch-icon.png') {
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    return sendFile(res, path.join(PUBLIC_DIR, safe), { cache: pathname.startsWith('/images/') || pathname.startsWith('/css/') || pathname.startsWith('/js/') });
  }
  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /checkout\nDisallow: /account\nSitemap: https://${store.getDb().settings.domain}/sitemap.xml\n`);
  }

  let ctx;
  try {
    ctx = makeCtx(req, res, url, query);
  } catch (err) {
    console.error('[server] context error', err);
    res.writeHead(500); return res.end('Server error');
  }

  try {
    // CSRF defense for all state-changing requests. The check is here so it
    // covers both POST routes below and POSTs to /api/* and /admin/*.
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      if (!sameOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Cross-origin request blocked.');
      }
    }

    // --- logout (must accept POST only; GET is a soft redirect) ---
    if (pathname === '/account/logout') {
      if (method === 'POST') {
        auth.destroySession(ctx.session && ctx.session.id);
        return redirect(res, '/', 303);
      }
      return redirect(res, '/', 302);
    }

    // --- API ---
    if (pathname.startsWith('/api/')) return await api.handle(ctx);

    // --- admin ---
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return await adminRouter.handle(ctx);

    // --- sitemap ---
    if (pathname === '/sitemap.xml') {
      const db = store.getDb();
      const urls = [
        '/', '/collections/all', ...db.collections.map(c => `/collections/${c.handle}`),
        ...db.products.map(p => `/products/${p.handle}`),
        '/blogs/journal', ...db.posts.map(p => `/blogs/journal/${p.handle}`),
        ...db.pages.map(p => `/pages/${p.handle}`), '/gift-cards', '/track', '/search'
      ];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>https://${db.settings.domain}${u}</loc><changefreq>weekly</changefreq></url>`).join('\n')}\n</urlset>`;
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(xml);
    }

    /* ------------------------------ GET routes ------------------------------ */
    if (method === 'GET') {
      if (pathname === '/') return renderPage(ctx, PAGES.home.render(ctx));

      if (pathname === '/collections' || pathname === '/collections/') return redirect(res, '/collections/all');
      let m = pathname.match(/^\/collections\/([a-z0-9\-]+)$/);
      if (m) return renderPage(ctx, PAGES.catalog.renderCollection(ctx, m[1]));

      m = pathname.match(/^\/products\/([a-z0-9\-]+)$/);
      if (m) return renderPage(ctx, PAGES.product.render(ctx, m[1]));

      if (pathname === '/search') return renderPage(ctx, PAGES.catalog.renderSearch(ctx));
      if (pathname === '/cart') return renderPage(ctx, PAGES.cart.render(ctx));
      if (pathname === '/checkout') return renderPage(ctx, PAGES.checkout.render(ctx));

      m = pathname.match(/^\/orders\/([A-Za-z0-9\-]+)$/);
      if (m) {
        const order = store.find('orders', o => o.number.toUpperCase() === m[1].toUpperCase());
        const emailOk = !order || !order.email || (query.email || '').toLowerCase() === order.email;
        const ownsIt = ctx.customer && order && order.customerId === ctx.customer.id;
        if (!order || (!emailOk && !ownsIt)) return sendHtml(res, res404(ctx), 404);
        return renderPage(ctx, PAGES.checkout.renderOrder(ctx, order, { justPlaced: query.new === '1' }));
      }

      if (pathname === '/track') return renderPage(ctx, PAGES.checkout.renderTrack(ctx, { lookup: { number: query.number || '', email: query.email || '' } }));

      if (pathname === '/blogs/journal' || pathname === '/blogs/journal/') return renderPage(ctx, PAGES.content.renderJournal(ctx));
      m = pathname.match(/^\/blogs\/journal\/([a-z0-9\-]+)$/);
      if (m) return renderPage(ctx, PAGES.content.renderPost(ctx, m[1]));
      if (pathname.startsWith('/blogs')) return redirect(res, '/blogs/journal');

      if (pathname === '/gift-cards') return renderPage(ctx, PAGES.content.renderGiftCards(ctx));

      m = pathname.match(/^\/pages\/([a-z0-9\-]+)$/);
      if (m) return renderPage(ctx, PAGES.content.renderPage(ctx, m[1]));

      /* --------------------------- account (GET) --------------------------- */
      if (pathname === '/account/login') return renderPage(ctx, PAGES.account.loginPage(ctx, { mode: 'login', notice: query.ok || '', values: {} }));
      if (pathname === '/account/register') return renderPage(ctx, PAGES.account.loginPage(ctx, { mode: 'register', values: {} }));
      if (pathname === '/account/recover') return renderPage(ctx, PAGES.account.recoverPage(ctx, { notice: query.ok || '', link: query.link || '' }));
      if (pathname === '/account/reset') {
        const token = query.token || '';
        let customer = token ? store.find('customers', c => c.resetToken === token) : null;
        let error = '';
        if (token) {
          if (!customer) {
            error = 'That reset link has expired or already been used.';
          } else if (customer.resetExpires && Date.parse(customer.resetExpires) < Date.now()) {
            store.update('customers', customer.id, { resetToken: null, resetExpires: null });
            customer = null;
            error = 'That reset link has expired. Request a new one.';
          }
        }
        return renderPage(ctx, PAGES.account.resetPage(ctx, { token, customer, error }));
      }
      if (pathname.startsWith('/account')) {
        if (!ctx.customer) return redirect(res, `/account/login?return=${encodeURIComponent(pathname)}`);
        if (pathname === '/account' || pathname === '/account/') return renderPage(ctx, PAGES.account.overview(ctx, ctx.customer));
        if (pathname === '/account/orders') return renderPage(ctx, PAGES.account.orderList(ctx, ctx.customer));
        m = pathname.match(/^\/account\/orders\/([A-Za-z0-9_\-]+)$/);
        if (m) {
          const order = store.find('orders', o => o.id === m[1] && o.customerId === ctx.customer.id);
          if (!order) return sendHtml(res, res404(ctx), 404);
          return renderPage(ctx, PAGES.account.orderDetail(ctx, ctx.customer, order));
        }
        if (pathname === '/account/addresses') return renderPage(ctx, PAGES.account.addresses(ctx, ctx.customer, { notice: query.ok || '' }));
        if (pathname === '/account/wishlist') return renderPage(ctx, PAGES.account.wishlist(ctx, ctx.customer));
        if (pathname === '/account/details') return renderPage(ctx, PAGES.account.details(ctx, ctx.customer, { notice: query.ok || '' }));
        return redirect(res, '/account');
      }
      return sendHtml(res, res404(ctx), 404);
    }

    /* ------------------------------ POST routes ----------------------------- */
    if (method === 'POST') {
      const body = await parseBody(req);

      if (pathname === '/checkout') {
        // Idempotency: if this cart has already produced an order, redirect
        // there rather than charging again. The early guard runs before any
        // async work so overlapping POSTs hit the same state.
        const priorOrder = ctx.rawCart._lastOrderId
          && store.find('orders', o => o.id === ctx.rawCart._lastOrderId);
        if (priorOrder) {
          return redirect(res, `/orders/${priorOrder.number}?email=${encodeURIComponent(priorOrder.email)}&new=1`, 303);
        }
        // If an earlier submission is currently converting this cart (e.g.
        // double-click) short-circuit to prevent a second charge.
        if (ctx.rawCart._converting) {
          return redirect(res, '/cart?error=' + encodeURIComponent('Your order is already being processed.'), 303);
        }
        const result = createOrder(ctx, body);
        if (result.errors) {
          const view = PAGES.checkout.render(ctx, { errors: result.errors, values: body, stage: 2 });
          return sendHtml(res, layout.shell({
            title: view.title, description: view.description, canonical: view.canonical,
            jsonLd: [], bodyClass: view.bodyClass, content: view.content,
            settings: ctx.settings, cart: ctx.cart, customer: ctx.customer, noHeader: true
          }), 422);
        }
        return redirect(res, `/orders/${result.order.number}?email=${encodeURIComponent(result.order.email)}&new=1`, 303);
      }

      if (pathname === '/track') {
        if (!rateLimit(req, 'track', { windowMs: 60_000, max: 10 })) {
          res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' });
          return res.end('Too many tracking attempts. Try again in a minute.');
        }
        const number = String(body.number || '').trim().toUpperCase();
        const email = String(body.email || '').trim().toLowerCase();
        const order = store.find('orders', o => o.number.toUpperCase() === number);
        if (!order || order.email.toLowerCase() !== email) {
          return renderPage(ctx, PAGES.checkout.renderTrack(ctx, { error: 'We could not find an order with that number and email. Check both and try again.', lookup: { number, email } }));
        }
        return renderPage(ctx, PAGES.checkout.renderTrack(ctx, { order, lookup: { number, email } }));
      }

      if (pathname === '/pages/contact') {
        const view = PAGES.content.renderPage(ctx, 'contact');
        ctx.flash = { notice: 'We have emailed a copy to ' + String(body.email || '') + '. A support agent replies within one business day.' };
        const updated = PAGES.content.renderPage({ ...ctx, flash: ctx.flash }, 'contact');
        const m = String(body.message || '').trim();
        if (!body.name || !body.email || !m || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) {
          const failed = PAGES.content.renderPage({ ...ctx, flash: { error: 'Please complete every required field with a valid email address.', values: body } }, 'contact');
          return renderPage(ctx, failed);
        }
        store.insert('messages', {
          name: String(body.name).slice(0, 120), email: String(body.email).slice(0, 160),
          topic: String(body.topic || 'Something else').slice(0, 60), orderNumber: String(body.orderNumber || '').slice(0, 20),
          message: m.slice(0, 4000), status: 'open', createdAt: new Date().toISOString(), source: 'contact form'
        });
        store.logActivity(String(body.email), 'message.created', String(body.topic || 'contact form'));
        return renderPage(ctx, updated);
      }

      /* ------------------------------ account ------------------------------ */
      if (pathname === '/account/login') {
        if (!rateLimit(req, 'login', { windowMs: 60_000, max: 10 })) {
          return renderPage(ctx, PAGES.account.loginPage(ctx, { mode: 'login', errors: { password: 'Too many login attempts. Try again in a minute.' }, values: { email: body.email || '' } }));
        }
        const email = String(body.email || '').trim().toLowerCase();
        const customer = store.find('customers', c => c.email === email);
        if (!customer || !auth.verifyPassword(body.password, customer.salt, customer.passwordHash)) {
          return renderPage(ctx, PAGES.account.loginPage(ctx, { mode: 'login', errors: { password: 'Email or password is incorrect.' }, values: { email } }));
        }
        const session = auth.createSession({ type: 'customer', customerId: customer.id, email: customer.email, name: `${customer.firstName} ${customer.lastName}`, userAgent: req.headers['user-agent'] || '' });
        auth.setSessionCookie(res, session.id);
        store.logActivity(customer.email, 'customer.login', 'Storefront login');
        return redirect(res, String(body.return || '/account'), 303);
      }

      if (pathname === '/account/register') {
        const errors = {};
        const email = String(body.email || '').trim().toLowerCase();
        if (!String(body.firstName || '').trim()) errors.firstName = 'First name is required.';
        if (!String(body.lastName || '').trim()) errors.lastName = 'Last name is required.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address.';
        if (store.find('customers', c => c.email === email)) errors.email = 'An account with that email already exists. Try logging in.';
        if (String(body.password || '').length < 8) errors.password = 'Use at least 8 characters.';
        if (body.password !== body.passwordConfirm) errors.passwordConfirm = 'Passwords do not match.';
        if (Object.keys(errors).length) return renderPage(ctx, PAGES.account.loginPage(ctx, { mode: 'register', errors, values: body }));

        const pw = auth.hashPassword(body.password);
        const customer = store.insert('customers', {
          email, firstName: String(body.firstName).trim(), lastName: String(body.lastName).trim(),
          phone: '', passwordHash: pw.hash, salt: pw.salt,
          acceptsMarketing: body.acceptsMarketing !== 'off', tags: ['new-account'], note: '', addresses: [],
          createdAt: new Date().toISOString(), marketingSource: 'account', ordersCount: 0, totalSpent: 0
        });
        // link any guest orders with the same email
        store.all('orders').filter(o => o.email === email && !o.customerId).forEach(o => store.update('orders', o.id, { customerId: customer.id }));
        const welcome = emails.welcomeEmail(customer, ctx.settings);
        store.writeEmail(`welcome-${customer.id}-${Date.now()}`, welcome);
        const session = auth.createSession({ type: 'customer', customerId: customer.id, email, name: `${customer.firstName} ${customer.lastName}` });
        auth.setSessionCookie(res, session.id);
        store.logActivity(email, 'customer.created', 'Account created on storefront');
        return redirect(res, '/account?ok=' + encodeURIComponent('Welcome — your 10% code is WELCOME10.'), 303);
      }

      if (pathname === '/account/recover') {
        const email = String(body.email || '').trim().toLowerCase();
        const customer = store.find('customers', c => c.email === email);
        if (!customer) return renderPage(ctx, PAGES.account.recoverPage(ctx, { error: 'No account found with that email address.' }));
        const token = auth.randomToken(20);
        store.update('customers', customer.id, { resetToken: token, resetExpires: new Date(Date.now() + 36e5).toISOString() });
        const html = emails.passwordResetEmail(customer, token, ctx.settings);
        store.writeEmail(`password-reset-${customer.id}-${Date.now()}`, html);
        store.logActivity(email, 'customer.password_reset', 'Reset link generated');
        return renderPage(ctx, PAGES.account.recoverPage(ctx, { notice: 'We sent a reset link. It expires in one hour.', link: `/account/reset?token=${token}` }));
      }

      if (pathname === '/account/reset') {
        const customer = store.find('customers', c => c.resetToken === body.token);
        if (!customer) return renderPage(ctx, PAGES.account.resetPage(ctx, { token: body.token, error: 'That link is no longer valid. Request a new one.' }));
        // One-hour expiry (set at token creation) is enforced here.
        if (customer.resetExpires && Date.parse(customer.resetExpires) < Date.now()) {
          store.update('customers', customer.id, { resetToken: null, resetExpires: null });
          return renderPage(ctx, PAGES.account.resetPage(ctx, { token: '', error: 'That reset link has expired. Request a new one.' }));
        }
        if (String(body.password || '').length < 8) return renderPage(ctx, PAGES.account.resetPage(ctx, { token: body.token, customer, error: 'Use at least 8 characters.' }));
        if (body.password !== body.passwordConfirm) return renderPage(ctx, PAGES.account.resetPage(ctx, { token: body.token, customer, error: 'Passwords do not match.' }));
        const pw = auth.hashPassword(body.password);
        store.update('customers', customer.id, { passwordHash: pw.hash, salt: pw.salt, resetToken: null, resetExpires: null });
        // Invalidate all existing sessions for this customer after a password reset.
        store.all('sessions').filter(s => s.customerId === customer.id).forEach(s => store.remove('sessions', s.id));
        store.logActivity(customer.email, 'customer.password_changed', 'Password reset completed');
        return redirect(res, '/account/login?ok=' + encodeURIComponent('Password updated — log in with your new password.'), 303);
      }

      if (pathname.startsWith('/account/') && !ctx.customer) return redirect(res, '/account/login');

      if (pathname === '/account/details') {
        const errors = {};
        const email = String(body.email || '').trim().toLowerCase();
        if (!String(body.firstName || '').trim()) errors.firstName = 'First name is required.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address.';
        const clash = store.find('customers', c => c.email === email && c.id !== ctx.customer.id);
        if (clash) errors.email = 'That email is already used by another account.';
        if (Object.keys(errors).length) return renderPage(ctx, PAGES.account.details(ctx, ctx.customer, { errors }));
        store.update('customers', ctx.customer.id, {
          firstName: String(body.firstName).trim(), lastName: String(body.lastName).trim(), email,
          phone: String(body.phone || ''), acceptsMarketing: body.acceptsMarketing === 'on'
        });
        store.logActivity(email, 'customer.updated', 'Details updated');
        return redirect(res, '/account/details?ok=' + encodeURIComponent('Your details are saved.'), 303);
      }

      if (pathname === '/account/password') {
        const errors = {};
        if (!auth.verifyPassword(body.currentPassword, ctx.customer.salt, ctx.customer.passwordHash)) errors.currentPassword = 'Current password is incorrect.';
        if (String(body.newPassword || '').length < 8) errors.newPassword = 'Use at least 8 characters.';
        if (body.newPassword !== body.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
        if (Object.keys(errors).length) return renderPage(ctx, PAGES.account.details(ctx, ctx.customer, { errors }));
        const pw = auth.hashPassword(body.newPassword);
        store.update('customers', ctx.customer.id, { passwordHash: pw.hash, salt: pw.salt });
        store.logActivity(ctx.customer.email, 'customer.password_changed', 'Password updated from account');
        return redirect(res, '/account/details?ok=' + encodeURIComponent('Password updated.'), 303);
      }

      if (pathname === '/account/marketing') {
        store.update('customers', ctx.customer.id, { acceptsMarketing: body.subscribe === 'on' });
        const email = ctx.customer.email;
        const sub = store.find('subscribers', s => s.email === email);
        if (body.subscribe === 'on') { if (sub) { sub.status = 'subscribed'; store.save(); } else store.insert('subscribers', { email, source: 'account', status: 'subscribed' }); }
        else if (sub) { sub.status = 'unsubscribed'; store.save(); }
        return redirect(res, '/account/details?ok=' + encodeURIComponent(body.subscribe === 'on' ? 'You are subscribed to the studio letter.' : 'You have been unsubscribed.'), 303);
      }

      if (pathname === '/account/addresses') {
        const addresses = ctx.customer.addresses;
        if (!String(body.line1 || '').trim() || !String(body.city || '').trim() || !String(body.zip || '').trim()) {
          return renderPage(ctx, PAGES.account.addresses(ctx, ctx.customer, { errors: { line1: 'Address, city and ZIP are required.' } }));
        }
        const isDefault = body.isDefault === 'on' || addresses.length === 0;
        if (isDefault) addresses.forEach(a => { a.isDefault = false; });
        addresses.push({
          id: store.uid('adr'), label: String(body.label || 'Address'), firstName: body.firstName || ctx.customer.firstName,
          lastName: body.lastName || ctx.customer.lastName, line1: String(body.line1), line2: String(body.line2 || ''),
          city: String(body.city), province: body.province || 'NJ', zip: String(body.zip), country: 'United States', isDefault
        });
        store.save();
        store.logActivity(ctx.customer.email, 'customer.address_added', String(body.city));
        return redirect(res, '/account/addresses?ok=' + encodeURIComponent('Address saved.'), 303);
      }

      if (pathname === '/account/addresses/default') {
        (ctx.customer.addresses || []).forEach(a => { a.isDefault = a.id === body.addressId; });
        store.save();
        return redirect(res, '/account/addresses?ok=' + encodeURIComponent('Default address updated.'), 303);
      }

      if (pathname === '/account/addresses/delete') {
        ctx.customer.addresses = ctx.customer.addresses.filter(a => a.id !== body.addressId);
        if (ctx.customer.addresses.length && !ctx.customer.addresses.some(a => a.isDefault)) ctx.customer.addresses[0].isDefault = true;
        store.save();
        return redirect(res, '/account/addresses?ok=' + encodeURIComponent('Address removed.'), 303);
      }

      return sendHtml(res, res404(ctx), 404);
    }

    res.writeHead(405, { Allow: 'GET, POST' });
    return res.end('Method not allowed');
  } catch (err) {
    console.error('[server]', req.method, pathname, err);
    if (pathname.startsWith('/api/')) return sendJson(res, { ok: false, error: 'Unexpected server error' }, 500);
    sendHtml(res, layout.shell({
      title: 'Something went wrong',
      description: 'An unexpected error occurred.',
      content: `<div class="wrap page-head"><h1>Something went wrong</h1><p class="page-head__meta">${ui.esc(err.message)}</p><div class="cta-row"><a class="btn btn--primary" href="/">Back to the store</a><a class="btn btn--ghost" href="/admin">Store admin</a></div></div>`,
      settings: store.getDb().settings, cart: { count: 0, subtotal: 0, total: 0, discount: null, discountAmount: 0, freeShipping: { threshold: 0, remaining: 0, qualified: false }, tax: { amount: 0 }, lines: [] }, customer: null
    }), 500);
  }
});

server.listen(PORT, HOST, () => {
  const db = store.getDb();
  console.log('');
  console.log('  VENNIX — full-stack storefront + admin');
  console.log('  ───────────────────────────────────────────────────');
  console.log(`  Storefront   http://localhost:${PORT}/`);
  console.log(`  Admin        http://localhost:${PORT}/admin  (${db.settings.admin.email})`);
  console.log(`  Catalog      ${db.products.length} products · ${db.collections.length} collections · ${db.orders.length} orders`);
  const payMode = db.settings.payments.testMode ? 'sandbox' : 'LIVE';
  console.log(`  Payments     ${db.settings.payments.provider} (${payMode}) — test card 4242 4242 4242 4242`);
  if (process.env.NODE_ENV !== 'production') {
    console.log('  Demo admin   password "vennix123" — set ADMIN_PASSWORD / NODE_ENV=production for live deploys.');
  }
  console.log('');
});

process.on('SIGTERM', () => { try { store.saveNow(); } catch { /* noop */ } process.exit(0); });
process.on('SIGINT', () => { try { store.saveNow(); } catch { /* noop */ } process.exit(0); });
