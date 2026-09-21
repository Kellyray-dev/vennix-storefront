'use strict';
/**
 * api.js — JSON endpoints used by the storefront's client-side layer.
 * Every response carries the freshly recomputed cart so the UI never guesses.
 */
const store = require('./store');

// Per-IP sliding window for /api/notify to blunt enumeration and spam.
// Uses socket address by default; only trusts X-Forwarded-For when TRUST_PROXY=1.
const notifyBuckets = new Map();
function getClientIp(req) {
  const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return xff.toString().split(',')[0].trim();
  }
  return (req.socket.remoteAddress || 'unknown').toString();
}
function pruneNotifyBuckets() {
  if (notifyBuckets.size <= 5000) return;
  const now = Date.now();
  for (const [k, v] of notifyBuckets) {
    const filtered = v.filter(t => now - t < 60_000);
    if (filtered.length === 0) notifyBuckets.delete(k);
    else if (filtered.length !== v.length) notifyBuckets.set(k, filtered);
    if (notifyBuckets.size <= 4000) break;
  }
}
const cartLib = require('./cart');
const personalize = require('./personalize');
const style = require('./style');
const fit = require('./fit');
const auth = require('./auth');
const commerce = require('./commerce');
const layout = require('./layout');
const ui = require('./ui');

function payload(ctx) {
  const cart = ctx.cart;
  return {
    ok: true,
    cart: serializeCart(cart),
    html: {
      count: String(cart.count),
      drawer: layout.cartBody(cart),
      subtotal: ui.money(cart.subtotal),
      total: ui.money(cart.total),
      discountLine: cart.discount ? `<span>Discount · ${ui.esc(cart.discount.code)}</span><strong>−${ui.money(cart.discountAmount)}</strong>` : '',
      shipMsg: cart.freeShipping.qualified
        ? `${ui.icon('check', { size: 15 })} You have earned free standard shipping.`
        : cart.freeShipping.threshold ? `You are ${ui.money(cart.freeShipping.remaining)} away from free standard shipping.` : '',
      shipPct: cart.freeShipping.threshold ? Math.min(100, Math.round(((cart.freeShipping.threshold - cart.freeShipping.remaining) / cart.freeShipping.threshold) * 100)) : 0
    }
  };
}

function serializeCart(cart) {
  return {
    id: cart.id, count: cart.count, subtotal: cart.subtotal, discountAmount: cart.discountAmount,
    discountCode: cart.discount ? cart.discount.code : null, shipping: cart.shipping.amount, tax: cart.tax.amount,
    total: cart.total, currency: cart.currency,
    lines: cart.lines.map(l => ({ id: l.id, title: l.title, variantId: l.variantId, quantity: l.quantity, price: l.price, color: l.color, size: l.size, stock: l.stock, personalization: l.personalization ? { text: l.personalization.text, price: l.personalization.price, label: l.personalization.label } : null }))
  };
}

function fail(res, error, status = 400, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error, ...extra }));
}

async function handle(ctx) {
  const { req, res, url, query } = ctx;
  const pathname = url.pathname.replace(/^\/api/, '') || '/';
  const method = req.method.toUpperCase();

  /* ------------------------------- cart ------------------------------- */
  if (pathname === '/cart' && method === 'GET') {
    return json(res, payload(ctx));
  }
  if (pathname === '/cart/add' && method === 'POST') {
    const body = await ctx.body();
    // one line or a whole look: { variantId } or { items: [{ variantId, quantity, personalization }] }
    if (Array.isArray(body.items) && body.items.length) {
      const batch = cartLib.addItems(ctx.rawCart, body.items.slice(0, 12));
      if (!batch.ok && batch.failed.length) return fail(res, batch.failed[0].error, 400, { failed: batch.failed });
      store.logActivity('storefront', 'cart.addBatch', `${batch.added} of ${body.items.length} pieces`);
      // recompute before serialising, or the response describes the cart as it
      // was before the batch went in
      ctx.recompute();
      const payloadOut = payload(ctx);
      payloadOut.added = batch.added;
      if (batch.failed.length) payloadOut.failed = batch.failed;
      return json(res, payloadOut);
    }
    const variantId = body.variantId;
    const quantity = Number(body.quantity) || 1;
    const result = cartLib.addItem(ctx.rawCart, variantId, quantity, { personalization: body.personalization });
    if (!result.ok) return fail(res, result.error);
    store.logActivity('storefront', 'cart.add', `${variantId} ×${quantity}`);
    ctx.recompute();
    return json(res, payload(ctx));
  }
  if (pathname === '/cart/update' && method === 'POST') {
    const body = await ctx.body();
    const result = cartLib.updateItem(ctx.rawCart, body.lineId, Number(body.quantity));
    if (!result.ok) return fail(res, result.error, 400, { max: result.max });
    ctx.recompute();
    return json(res, payload(ctx));
  }
  if (pathname === '/cart/remove' && method === 'POST') {
    const body = await ctx.body();
    const result = cartLib.removeItem(ctx.rawCart, body.lineId);
    if (!result.ok) return fail(res, result.error);
    ctx.recompute();
    return json(res, payload(ctx));
  }
  if (pathname === '/cart/discount' && method === 'POST') {
    const body = await ctx.body();
    const result = cartLib.applyDiscount(ctx.rawCart, body.remove ? '' : body.code);
    if (!result.ok) return fail(res, result.error);
    ctx.recompute();
    return json(res, payload(ctx));
  }
  if (pathname === '/cart/note' && method === 'POST') {
    const body = await ctx.body();
    if (body.giftNote !== undefined) ctx.rawCart.giftNote = String(body.giftNote).slice(0, 400);
    if (body.note !== undefined) ctx.rawCart.note = String(body.note).slice(0, 400);
    store.save();
    ctx.recompute();
    return json(res, payload(ctx));
  }
  if (pathname === '/cart/shipping' && method === 'POST') {
    const body = await ctx.body();
    if (body.method) ctx.rawCart.shippingMethod = body.method;
    if (body.country) ctx.rawCart.country = body.country;
    if (body.province) ctx.rawCart.province = body.province;
    store.save();
    ctx.recompute();
    return json(res, payload(ctx));
  }
  if (pathname === '/quote' && method === 'POST') {
    const body = await ctx.body();
    const cart = ctx.computedCart({
      shippingMethod: body.shippingMethod || ctx.cart.shippingMethod,
      country: body.country || ctx.cart.country,
      province: body.province || ctx.cart.province
    });
    return json(res, { ok: true, quote: { subtotal: cart.subtotal, discount: cart.discountAmount, shipping: cart.shipping.amount, shippingLabel: cart.shipping.label, tax: cart.tax.amount, taxName: cart.tax.name, total: cart.total } });
  }

  /* ------------------------------ search ------------------------------ */
  if (pathname === '/search' && method === 'GET') {
    const q = (query.q || '').trim().toLowerCase();
    if (!q) return json(res, { ok: true, products: [], collections: [], articles: [] });
    const products = store.all('products')
      .filter(p => `${p.title} ${p.tagline} ${p.type} ${p.vendor} ${p.tags.join(' ')}`.toLowerCase().includes(q))
      .slice(0, 6)
      .map(p => ({ handle: p.handle, title: p.title, type: p.type, price: ui.money(p.price), compareAt: p.compareAtPrice ? ui.money(p.compareAtPrice) : null, image: p.images[0].src, url: `/products/${p.handle}`, available: p.inventoryQuantity > 0 }));
    const collections = store.all('collections').filter(c => `${c.title} ${c.description}`.toLowerCase().includes(q)).slice(0, 4)
      .map(c => ({ handle: c.handle, title: c.title, url: `/collections/${c.handle}`, count: c.productHandles.length }));
    const articles = store.all('posts').filter(p => `${p.title} ${p.excerpt}`.toLowerCase().includes(q)).slice(0, 3)
      .map(p => ({ handle: p.handle, title: p.title, url: `/blogs/journal/${p.handle}`, excerpt: p.excerpt }));
    return json(res, { ok: true, products, collections, articles });
  }

  /* ------------------------- back in stock alerts ---------------------- */
  if (pathname === '/notify' && method === 'POST') {
    // In-memory rate limit (per-IP) to blunt enumeration and spam.
    const ip = getClientIp(ctx.req);
    const now = Date.now();
    let BUCKET = notifyBuckets.get(ip);
    BUCKET = (BUCKET || []).filter(t => now - t < 60_000);
    if (BUCKET.length >= 6) {
      if (BUCKET.length === 0) notifyBuckets.delete(ip);
      else notifyBuckets.set(ip, BUCKET);
      pruneNotifyBuckets();
      return fail(res, 'Too many requests — try again in a minute.', 429);
    }
    BUCKET.push(now);
    notifyBuckets.set(ip, BUCKET);
    pruneNotifyBuckets();

    const body = await ctx.body();
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(email)) return fail(res, 'That email address does not look right.');
    const found = cartLib.productFor(body.variantId);
    if (!found) return fail(res, 'That product is no longer available.', 404);
    const { product, variant } = found;
    if (variant.stock > 0) return fail(res, 'That size is back in stock — you can order it now.');
    // Uniform response regardless of prior signup so callers cannot enumerate
    // which emails are on the waitlist for a variant.
    const existing = store.all('backInStock').find(n => n.email === email && n.variantId === variant.id && n.status === 'waiting');
    if (!existing) {
      store.insert('backInStock', {
        id: store.nextId('backInStock'),
        email,
        variantId: variant.id,
        sku: variant.sku,
        productId: product.id,
        handle: product.handle,
        title: product.title,
        color: variant.color,
        size: variant.size,
        status: 'waiting',
        source: 'product page',
        createdAt: new Date().toISOString()
      });
      store.logActivity('storefront', 'stock.notify', `${email} → ${product.handle} ${variant.size}`);
    }
    return json(res, { ok: true, message: `We will email ${email} the moment ${product.title} in ${variant.size} lands.` });
  }

  /* ----------------------------- fit finder ---------------------------- */
  if (pathname === '/fit' && method === 'POST') {
    const body = await ctx.body();
    const product = store.find('products', p => p.handle === body.handle);
    if (!product) return fail(res, 'Product not found', 404);
    const result = fit.recommend(product, {
      height: body.height, weight: body.weight, units: body.units,
      usualSize: body.usualSize, preference: body.preference
    });
    if (!result.ok) return fail(res, result.error);
    return json(res, { ok: true, fit: result });
  }

  /* -------------------------- monogram preview ------------------------- */
  if (pathname === '/monogram' && method === 'POST') {
    const body = await ctx.body();
    const product = store.find('products', p => p.handle === body.handle);
    if (!product) return fail(res, 'Product not found', 404);
    const config = personalize.configFor(product);
    if (!config) return fail(res, 'This piece cannot be monogrammed.', 422);
    // report what was actually typed (cleaned) so the counter and any error
    // agree with each other, rather than a silently shortened value
    const text = personalize.clean(body.text, config);
    const valid = personalize.validate(product, { text: body.text });
    return json(res, {
      ok: true,
      text,
      valid: valid.ok,
      error: valid.ok ? null : valid.error,
      price: config.price,
      priceLabel: ui.money(config.price),
      placement: config.placement,
      maxChars: config.maxChars,
      remaining: Math.max(0, config.maxChars - text.length),
      note: config.note
    });
  }

  /* ---------------------------- style it with -------------------------- */
  if (pathname === '/style' && method === 'GET') {
    const product = store.find('products', p => p.handle === (query.handle || ''));
    if (!product) return fail(res, 'Product not found', 404);
    const look = style.lookFor(product, Number(query.limit) || 3);
    return json(res, {
      ok: true,
      look: look.map(p => ({ handle: p.handle, title: p.title, type: p.type, price: ui.money(p.price), image: p.images[0].src, url: `/products/${p.handle}`, available: p.inventoryQuantity > 0, variant: (p.variants.find(v => v.stock > 0) || p.variants[0]).id }))
    });
  }

  /* ----------------------------- quick view ---------------------------- */
  if (pathname.startsWith('/quickview/') && method === 'GET') {
    const handle = pathname.replace('/quickview/', '');
    const product = store.find('products', p => p.handle === handle);
    if (!product) return fail(res, 'Product not found', 404);
    return json(res, { ok: true, html: quickViewHtml(product, ctx) });
  }

  /* --------------------------- newsletter --------------------------- */
  if (pathname === '/newsletter' && method === 'POST') {
    const body = await ctx.body();
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(res, 'Enter a valid email address.');
    const existing = store.find('subscribers', s => s.email === email);
    if (existing) { existing.status = 'subscribed'; store.save(); }
    else store.insert('subscribers', { email, source: body.source || 'footer', status: 'subscribed', createdAt: new Date().toISOString() });
    const emails = require('./emails');
    const settings = store.getDb().settings;
    store.writeEmail(`newsletter-${Date.now()}`, emails.newsletterEmail(email, settings));
    if (ctx.customer) { ctx.customer.acceptsMarketing = true; store.save(); }
    store.logActivity('storefront', 'subscriber.created', email);
    return json(res, { ok: true, message: 'You are on the list. Check your inbox for the 10% code — try WELCOME10 at checkout.' });
  }

  /* ------------------------------ contact ------------------------------ */
  if (pathname === '/contact' && method === 'POST') {
    const body = await ctx.body();
    const required = ['name', 'email', 'message'];
    for (const field of required) if (!String(body[field] || '').trim()) return fail(res, `Please complete the ${field} field.`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) return fail(res, 'Enter a valid email address.');
    const message = store.insert('messages', {
      name: String(body.name).slice(0, 120), email: String(body.email).slice(0, 160),
      topic: String(body.topic || 'Something else').slice(0, 60), orderNumber: String(body.orderNumber || '').slice(0, 20),
      message: String(body.message).slice(0, 4000), status: 'open', createdAt: new Date().toISOString(), source: 'contact form'
    });
    store.logActivity('storefront', 'message.created', `${message.email} — ${message.topic}`);
    return json(res, { ok: true, message: 'Message received. A human replies within one business day — usually much sooner.' });
  }

  /* ------------------------- reviews & helpful ------------------------- */
  if (pathname === '/reviews' && method === 'POST') {
    const body = await ctx.body();
    const product = store.find('products', p => p.handle === body.handle);
    if (!product) return fail(res, 'Unknown product.', 404);
    if (!body.author || !body.email || !body.body) return fail(res, 'Name, email and review text are required.');
    const bought = ctx.customer && store.all('orders').some(o => o.customerId === ctx.customer.id && o.items.some(i => i.productId === product.id));
    store.insert('reviews', {
      productId: product.id, productHandle: product.handle, productTitle: product.title,
      rating: Math.max(1, Math.min(5, Number(body.rating) || 5)),
      title: String(body.title || 'Verified purchase').slice(0, 140), body: String(body.body).slice(0, 2000),
      author: String(body.author).slice(0, 80), email: String(body.email).slice(0, 160),
      verified: !!bought, status: 'pending', helpful: 0, createdAt: new Date().toISOString(), reply: null
    });
    store.logActivity('storefront', 'review.submitted', `${product.title} — pending moderation`);
    return json(res, { ok: true, message: 'Thanks — your review is with the studio for moderation and usually appears within a day.' });
  }
  if (pathname.startsWith('/reviews/helpful/') && method === 'POST') {
    const id = pathname.replace('/reviews/helpful/', '');
    const review = store.find('reviews', r => r.id === id);
    if (!review) return fail(res, 'Review not found', 404);
    review.helpful = (review.helpful || 0) + 1;
    store.save();
    return json(res, { ok: true, helpful: review.helpful });
  }

  /* ------------------------------ reorder ------------------------------ */
  // Reorder is account-only and must belong to the signed-in customer. Order
  // ids are sequential so an anonymous caller must not be able to probe them.
  if (pathname === '/reorder' && method === 'POST') {
    if (!ctx.customer) return fail(res, 'Sign in to reorder past purchases.', 401);
    const body = await ctx.body();
    const order = store.find('orders', o => o.id === body.orderId);
    if (!order || order.customerId !== ctx.customer.id) return fail(res, 'Order not found', 404);
    const added = [];
    const skipped = [];
    for (const item of order.items) {
      const result = cartLib.addItem(ctx.rawCart, item.variantId, item.quantity);
      if (result.ok) added.push(item.title); else skipped.push(item.title);
    }
    ctx.recompute();
    const out = payload(ctx);
    out.message = added.length
      ? `${added.length} ${added.length === 1 ? 'item' : 'items'} added to your cart${skipped.length ? ` · ${skipped.length} sold out` : ''}.`
      : 'Nothing could be added — those items are sold out.';
    return json(res, out);
  }

  /* ------------------------------- account ------------------------------- */
  if (pathname === '/account' && method === 'GET') {
    return json(res, { ok: true, customer: ctx.customer ? { id: ctx.customer.id, email: ctx.customer.email, firstName: ctx.customer.firstName, lastName: ctx.customer.lastName, orders: store.all('orders').filter(o => o.customerId === ctx.customer.id).length } : null });
  }

  return fail(res, `No API route for ${method} ${pathname}`, 404);
}

function json(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}



function quickViewHtml(product, ctx) {
  const colors = product.options.find(o => o.name === 'Colour').values;
  const sizes = product.options.find(o => o.name === 'Size').values;
  const first = product.variants.find(v => v.stock > 0) || product.variants[0];
  return `<div class="quickview__body">
    <div class="quickview__media">
      <img src="${ui.attr(product.images[0].src)}" alt="${ui.attr(product.title)}" width="700" height="800">
      <div class="quickview__thumbs">
        ${product.images.map(i => `<img src="${ui.attr(i.src)}" alt="" width="90" height="110" loading="lazy">`).join('')}
      </div>
    </div>
    <div class="quickview__info">
      <p class="eyebrow">${ui.esc(product.vendor)} · ${ui.esc(product.type)}</p>
      <h2 id="qv-title">${ui.esc(product.title)}</h2>
      <div class="quickview__rating">${ui.stars(product.rating.avg, { count: product.rating.count, size: 14 })}</div>
      <p class="quickview__price">${ui.priceBlock(product, { size: 'lg' })}</p>
      <p class="quickview__copy">${ui.esc(product.tagline)} — ${ui.esc((product.features || [])[0] || '')}</p>
      <form class="product-form product-form--qv" data-add-form data-product="${ui.attr(product.handle)}">
        <fieldset class="picker">
          <legend>Colour: <strong data-color-label>${ui.esc(first.color)}</strong></legend>
          <div class="swatch-row">
            ${colors.map(c => `<button type="button" class="swatch swatch--lg ${c.name === first.color ? 'is-active' : ''}" style="--sw:${ui.attr(c.hex)}" data-color="${ui.attr(c.name)}" aria-label="${ui.attr(c.name)}" aria-pressed="${c.name === first.color}"></button>`).join('')}
          </div>
        </fieldset>
        <fieldset class="picker">
          <legend>Size: <strong data-size-label>${ui.esc(first.size)}</strong></legend>
          <div class="size-row">
            ${sizes.map(s => {
              const variant = product.variants.find(v => v.color === first.color && v.size === s.name);
              const out = !variant || variant.stock <= 0;
              return `<button type="button" class="size ${out ? 'is-out' : ''} ${variant && variant.id === first.id ? 'is-active' : ''}" data-size="${ui.attr(s.name)}" data-variant="${variant ? ui.attr(variant.id) : ''}" data-stock="${variant ? variant.stock : 0}" ${out ? 'disabled' : ''} aria-pressed="false">${ui.esc(s.name)}</button>`;
            }).join('')}
          </div>
        </fieldset>
        <div class="product-form__stock"><span class="stock-pill" data-stock-pill>${first.stock > 5 ? 'In stock' : first.stock > 0 ? `Only ${first.stock} left` : 'Sold out'}</span></div>
        <input type="hidden" name="variantId" value="${ui.attr(first.id)}" data-variant-input>
        <div class="product-form__buy">
          <div class="qty qty--lg" data-qty>
            <button type="button" data-qty-dec aria-label="Decrease quantity">−</button>
            <input type="number" name="quantity" value="1" min="1" max="20" data-qty-input aria-label="Quantity">
            <button type="button" data-qty-inc aria-label="Increase quantity">+</button>
          </div>
          <button class="btn btn--primary btn--lg" type="submit" data-add-submit>Add to cart</button>
        </div>
        <p class="form-msg" data-form-msg role="status"></p>
      </form>
      <a class="link-arrow" href="/products/${ui.attr(product.handle)}">Full product details ${ui.icon('arrow', { size: 15 })}</a>
      <script type="application/json" data-product-json="${ui.attr(product.handle)}">${JSON.stringify({ handle: product.handle, title: product.title, variants: product.variants.map(v => ({ id: v.id, color: v.color, size: v.size, price: v.price, compareAtPrice: v.compareAtPrice, stock: v.stock, sku: v.sku, image: v.image })), images: product.images.map(i => i.src) })}</script>
    </div>
  </div>`;
}

module.exports = { handle, serializeCart, quickViewHtml };
