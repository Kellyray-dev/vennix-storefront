'use strict';
/**
 * server.js — the Vennix storefront, presentation layer only.
 *
 * Architecture after the Shopify migration:
 *   - Products, variants, pricing, inventory, collections, pages, articles,
 *     carts, discounts, checkout and orders all live in Shopify and are read
 *     through lib/shopify (Storefront API via lib/shopify/catalog + cart-api).
 *   - This server renders the editorial storefront UI and hands checkout off
 *     to Shopify's hosted checkout (GET/POST /checkout → 302/303).
 *   - Local persistence is limited to non-commerce leads (newsletter, contact
 *     messages, back-in-stock alerts, review submissions) in lib/leads.
 *
 * Demo mode: when SHOPIFY_STORE_DOMAIN is not configured, an in-process mock
 * Shopify gateway (tools/mock-shopify) serves the committed fixture through
 * the exact same GraphQL code path, clearly labelled in the UI.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const settings = require('./lib/settings');
const leads = require('./lib/leads');
const cartLib = require('./lib/cart');
const layout = require('./lib/layout');
const api = require('./lib/api');
const catalog = require('./lib/shopify/catalog');
const client = require('./lib/shopify/client');
const shopifyConfig = require('./lib/shopify/config');
const { makeLimiter } = require('./lib/ratelimit');

const home = require('./lib/pages/home');
const collectionPage = require('./lib/pages/catalog');
const productPage = require('./lib/pages/product');
const cartPage = require('./lib/pages/cart');
const checkoutPage = require('./lib/pages/checkout');
const accountPage = require('./lib/pages/account');
const content = require('./lib/pages/content');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const limiter = makeLimiter();
let DEMO_MODE = false;
let gateway = null;

/* ------------------------------ small helpers ----------------------------- */

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
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY'
  });
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

function parseBody(req, limit = 128 * 1024) {
  return new Promise(resolve => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { resolve(null); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      const type = (req.headers['content-type'] || '');
      if (type.includes('application/json')) {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      } else if (type.includes('application/x-www-form-urlencoded')) {
        const out = {};
        for (const pair of data.split('&')) {
          const idx = pair.indexOf('=');
          if (idx === -1) continue;
          out[decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '))] = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
        }
        resolve(out);
      } else resolve({});
    });
    req.on('error', () => resolve(null));
  });
}

/**
 * CSRF defense for state-changing requests: Origin/Referer must match the
 * request's Host. SameSite=Lax cookies already blunt form-submit CSRF in
 * modern browsers; this adds defense-in-depth.
 */
function sameOrigin(req) {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  if (!host) return false;
  const origin = req.headers.origin;
  if (origin) {
    try { return new URL(origin).hostname.toLowerCase() === host; } catch { return false; }
  }
  const ref = req.headers.referer;
  if (ref) {
    try { return new URL(ref).hostname.toLowerCase() === host; } catch { return false; }
  }
  return true; // curl / non-browser clients without these headers
}

/* -------------------------------- context --------------------------------- */

async function makeCtx(req, res, url, query) {
  const [chrome, cart] = await Promise.all([
    layout.prepareChrome(),
    cartLib.getDisplayCartFor(req)
  ]);
  return {
    req, res, url, query,
    settings: settings.get(),
    chrome,
    cart,
    flash: null,
    body: () => parseBody(req),
    demo: DEMO_MODE
  };
}

function navActiveFor(pathname) {
  if (pathname.startsWith('/collections') || pathname.startsWith('/products') || pathname === '/gift-cards') return 'shop';
  if (pathname.startsWith('/blogs')) return 'journal';
  if (pathname.startsWith('/pages/about')) return 'about';
  if (pathname.startsWith('/pages/faq')) return 'help';
  return '';
}

async function renderPage(ctx, page) {
  const inCart = new Set(ctx.cart.lines.map(l => l.handle));
  const upsellProducts = ctx.chrome.products.filter(p => !inCart.has(p.handle) && !p.hidden).slice(0, 3);
  const html = await layout.shell({
    title: page.title,
    description: page.description,
    canonical: page.canonical,
    jsonLd: page.jsonLd || [],
    bodyClass: page.bodyClass || '',
    content: page.content,
    settings: ctx.settings,
    cart: ctx.cart,
    chrome: ctx.chrome,
    navActive: navActiveFor(ctx.url.pathname),
    upsellProducts,
    demo: DEMO_MODE
  });
  sendHtml(ctx.res, html, page.status || 200);
}

async function notFound(ctx) {
  const page = content.render404(ctx);
  const html = await layout.shell({
    title: page.title, description: page.description, canonical: page.canonical,
    jsonLd: [], bodyClass: page.bodyClass, content: page.content,
    settings: ctx.settings, cart: ctx.cart, chrome: ctx.chrome, navActive: '', upsellProducts: [],
    demo: DEMO_MODE
  });
  sendHtml(ctx.res, html, 404);
}

async function serverError(ctx, err) {
  console.error('[server] render error', ctx.url.pathname, err);
  try {
    sendHtml(ctx.res, `<!doctype html><html lang="en"><head><title>Server error</title></head>
      <body style="font-family:system-ui;max-width:640px;margin:10vh auto;padding:0 20px">
      <h1>Something went wrong</h1>
      <p>The storefront could not render this page. Our team can see the issue —
      try again in a moment, or <a href="/">go back home</a>.</p></body></html>`, 500);
  } catch { /* response already gone */ }
}

/* ------------------------------ sitemap + robots --------------------------- */

async function sitemapXml() {
  const cfg = settings.get();
  const [collections, products, pages, articles] = await Promise.all([
    catalog.getCollections(), catalog.getAllProducts(), catalog.getPages(), catalog.getArticles()
  ]);
  const base = `https://${cfg.domain}`;
  const url = (loc, lastmod, priority = 0.5) =>
    `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}<priority>${priority}</priority></url>`;
  const rows = [
    url(base + '/', undefined, 1.0),
    ...collections.map(c => url(`${base}/collections/${c.handle}`, c.updatedAt, 0.8)),
    url(`${base}/collections/sale`, undefined, 0.6),
    ...products.filter(p => !p.hidden).map(p => url(`${base}/products/${p.handle}`, p.updatedAt, 0.9)),
    url(`${base}/gift-cards`, undefined, 0.7),
    ...pages.map(p => url(`${base}/pages/${p.handle}`, p.updatedAt, 0.4)),
    url(`${base}/blogs/journal`, undefined, 0.6),
    ...articles.map(a => url(`${base}/blogs/journal/${a.handle}`, a.publishedAt, 0.5)),
    url(`${base}/track`, undefined, 0.3)
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

function robotsTxt() {
  const cfg = settings.get();
  return `User-agent: *\nAllow: /\nDisallow: /checkout\nDisallow: /api/\nSitemap: https://${cfg.domain}/sitemap.xml\n`;
}

/* --------------------------------- routing --------------------------------- */

async function handle(req, res, url, query) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  // static assets
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/images/') || pathname === '/favicon.svg' || pathname === '/apple-touch-icon.png') {
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    return sendFile(res, path.join(PUBLIC_DIR, safe), { cache: pathname.startsWith('/images/') || pathname.startsWith('/css/') || pathname.startsWith('/js/') });
  }
  if (pathname === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(robotsTxt()); }
  if (pathname === '/healthz') return sendJson(res, { ok: true, demo: DEMO_MODE });

  const ctx = await makeCtx(req, res, url, query);

  // CSRF defense for all state-changing requests
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (!sameOrigin(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Cross-origin request blocked.');
    }
    if (!limiter.allow(req, 'writes', { windowMs: 10_000, max: 60 })) {
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Too many requests — slow down a moment.');
    }
  }

  // JSON API
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return api.handle(ctx);
  }

  // legacy admin surface is retired — Shopify admin is the only one
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return sendHtml(res, `<!doctype html><html lang="en"><head><title>Admin</title></head>
      <body style="font-family:system-ui;max-width:640px;margin:10vh auto;padding:0 20px">
      <h1>Products and orders live in Shopify</h1>
      <p>The custom Vennix admin was retired in the Shopify migration. Manage the
      catalog, orders, customers and discounts in the Shopify admin.</p>
      <p><a href="/">Back to the storefront</a></p></body></html>`, 404);
  }

  // checkout handoff — the one route that exists only to redirect
  if (pathname === '/checkout') {
    if (ctx.cart.count) {
      try {
        const checkoutUrl = await cartLib.checkoutUrlFor(req);
        if (checkoutUrl) {
          leads.logActivity('storefront', 'checkout.begin', `${ctx.cart.count} items`);
          return redirect(res, checkoutUrl, method === 'POST' ? 303 : 302);
        }
      } catch (err) { console.error('[checkout] handoff failed', err); }
      return renderPage(ctx, checkoutPage.render(ctx));
    }
    return renderPage(ctx, checkoutPage.render(ctx));
  }

  // lead capture: contact form (the only page POST)
  if (pathname === '/pages/contact' && method === 'POST') {
    const body = await parseBody(req);
    const values = body || {};
    const required = ['name', 'email', 'message'];
    let error = '';
    for (const f of required) if (!String(values[f] || '').trim()) error = 'Please complete all required fields.';
    if (!error && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) error = 'Enter a valid email address.';
    if (!error) {
      leads.insert('messages', {
        name: String(values.name).slice(0, 120), email: String(values.email).slice(0, 160),
        topic: String(values.topic || 'Something else').slice(0, 60),
        orderNumber: String(values.orderNumber || '').slice(0, 40),
        message: String(values.message).slice(0, 4000), status: 'open', source: 'contact form'
      });
      leads.logActivity('storefront', 'message.created', `${values.email} — ${values.topic || 'message'}`);
      return redirect(res, '/pages/contact?sent=1', 303);
    }
    const page = await catalog.getPage('contact');
    if (page) {
      ctx.page = page;
      ctx.flash = { error, values };
      return renderPage(ctx, content.renderPage(ctx, 'contact'));
    }
    return redirect(res, '/pages/contact', 303);
  }

  const seg = pathname.split('/').filter(Boolean);

  try {
    if (pathname === '/') return renderPage(ctx, await home.render(ctx));

    if (seg[0] === 'collections' && seg.length === 1) return renderPage(ctx, await collectionPage.renderCollection(ctx, 'all'));
    if (seg[0] === 'collections' && seg.length === 2) {
      const page = await collectionPage.renderCollection(ctx, seg[1]);
      if (!page) return notFound(ctx);
      return renderPage(ctx, page);
    }

    if (seg[0] === 'products' && seg.length === 2) {
      const page = await productPage.render(ctx, seg[1]);
      if (!page) return notFound(ctx);
      return renderPage(ctx, page);
    }

    if (seg[0] === 'search') return renderPage(ctx, await collectionPage.renderSearch(ctx));

    if (seg[0] === 'cart') return renderPage(ctx, cartPage.render(ctx));

    if (seg[0] === 'track') return renderPage(ctx, checkoutPage.renderTrack(ctx));

    if (seg[0] === 'orders' && seg.length === 2) return renderPage(ctx, checkoutPage.renderLegacyOrder(ctx, seg[1]));

    if (seg[0] === 'account') {
      if (seg.length === 1) return renderPage(ctx, accountPage.overview(ctx));
      if (seg[1] === 'wishlist') return renderPage(ctx, accountPage.wishlist(ctx));
      // orders/addresses live in the Shopify-hosted account; legacy content
      // may still link the old routes, so send them somewhere real
      if (seg[1] === 'orders' || seg[1] === 'addresses' || seg[1] === 'details') {
        return redirect(res, ctx.settings.accountUrl || '/account');
      }
      if (['login', 'register', 'recover', 'reset', 'logout'].includes(seg[1])) {
        const accountUrl = ctx.settings.accountUrl;
        if (accountUrl) return redirect(res, accountUrl);
        return redirect(res, '/account');
      }
      return notFound(ctx);
    }

    if (seg[0] === 'blogs' && seg[1] === 'journal') {
      ctx.articles = await catalog.getArticles();
      if (seg.length === 2) return renderPage(ctx, content.renderJournal(ctx));
      ctx.article = await catalog.getArticle(seg[2]);
      if (!ctx.article) return notFound(ctx);
      return renderPage(ctx, content.renderPost(ctx, seg[2]));
    }

    if (seg[0] === 'gift-cards') return renderPage(ctx, content.renderGiftCards(ctx));

    if (seg[0] === 'pages' && seg.length === 2) {
      const page = await catalog.getPage(seg[1]);
      if (!page) return notFound(ctx);
      ctx.page = page;
      if (seg[1] === 'contact' && query.sent === '1') ctx.flash = { notice: 'Your message is with the studio. A human replies within one business day.' };
      return renderPage(ctx, content.renderPage(ctx, seg[1]));
    }

    if (seg[0] === 'sitemap.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(await sitemapXml());
    }

    return notFound(ctx);
  } catch (err) {
    return serverError(ctx, err);
  }
}

/* ---------------------------------- boot ----------------------------------- */

async function boot() {
  const cfg = shopifyConfig.getConfig();

  if (cfg.demo) {
    DEMO_MODE = true;
    const { startMockGateway } = require('./tools/mock-shopify/gateway');
    gateway = await startMockGateway({ port: 0 });
    client.setEndpoint(gateway.url);
    console.log('[vennix] DEMO MODE — no SHOPIFY_STORE_DOMAIN configured.');
    console.log('[vennix] Mock Shopify gateway on ephemeral port; using fixture catalog.');
    console.log('[vennix] Set SHOPIFY_STORE_DOMAIN + SHOPIFY_STOREFRONT_ACCESS_TOKEN to go live.');
  } else {
    console.log(`[vennix] Live mode — reading catalog and carts from ${cfg.domain} (${cfg.apiVersion}).`);
  }

  // Warm the catalog cache so the first page does not pay for it.
  try { await layout.prepareChrome(); } catch (err) { console.error('[vennix] catalog warm-up failed:', err.message); }

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { res.writeHead(400); return res.end('Bad request'); }
    const query = Object.fromEntries(url.searchParams.entries());
    handle(req, res, url, query).catch(err => serverError({ url, res, cart: { lines: [] }, chrome: { products: [], collections: [] }, settings: settings.get() }, err));
  });

  server.listen(PORT, HOST, () => {
    console.log(`[vennix] Storefront listening on http://${HOST}:${PORT}`);
    if (process.env.RENDER_EXTERNAL_URL) console.log(`[vennix] Preview: ${process.env.RENDER_EXTERNAL_URL}`);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`[vennix] ${sig} received, shutting down`);
      server.close(() => {
        if (gateway) gateway.close().finally(() => process.exit(0));
        else process.exit(0);
      });
      setTimeout(() => process.exit(1), 4000).unref();
    });
  }
}

boot().catch(err => {
  console.error('[vennix] failed to boot:', err);
  process.exit(1);
});

module.exports = { boot, handle, DEMO_MODE: () => DEMO_MODE };
