'use strict';
/**
 * admin/router.js — the store back office: dashboard, orders, products,
 * collections, customers, discounts, reviews, content, messages, settings,
 * emails and a point-of-sale screen. Server-rendered, zero dependencies.
 */
const store = require('../store');
const auth = require('../auth');
const commerce = require('../commerce');
const emails = require('../emails');
const cartLib = require('../cart');
const ui = require('../ui');

const { esc, attr, icon } = ui;

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: 'chart' },
  { href: '/admin/orders', label: 'Orders', icon: 'box' },
  { href: '/admin/products', label: 'Products', icon: 'tag' },
  { href: '/admin/collections', label: 'Collections', icon: 'grid' },
  { href: '/admin/customers', label: 'Customers', icon: 'users' },
  { href: '/admin/discounts', label: 'Discounts', icon: 'spark' },
  { href: '/admin/reviews', label: 'Reviews', icon: 'star' },
  { href: '/admin/pages', label: 'Pages & content', icon: 'info' },
  { href: '/admin/messages', label: 'Support inbox', icon: 'mail' },
  { href: '/admin/pos', label: 'Point of sale', icon: 'card' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' }
];

const money = commerce.money;

/* --------------------- in-memory rate limit for admin login ----------------- */
const LOGIN_BUCKETS = new Map();
function getClientIp(req) {
  const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return xff.toString().split(',')[0].trim();
  }
  return (req.socket.remoteAddress || 'unknown').toString();
}
function pruneLoginBuckets() {
  if (LOGIN_BUCKETS.size <= 5000) return;
  const now = Date.now();
  for (const [k, v] of LOGIN_BUCKETS) {
    const filtered = v.filter(t => now - t < 60_000);
    if (filtered.length === 0) LOGIN_BUCKETS.delete(k);
    else if (filtered.length !== v.length) LOGIN_BUCKETS.set(k, filtered);
    if (LOGIN_BUCKETS.size <= 4000) break;
  }
}
function loginRateLimited(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  let bucket = LOGIN_BUCKETS.get(ip);
  bucket = (bucket || []).filter(t => now - t < 60_000);
  if (bucket.length >= 8) {
    if (bucket.length === 0) LOGIN_BUCKETS.delete(ip);
    else LOGIN_BUCKETS.set(ip, bucket);
    pruneLoginBuckets();
    return true;
  }
  bucket.push(now);
  LOGIN_BUCKETS.set(ip, bucket);
  pruneLoginBuckets();
  return false;
}

function adminShell(ctx, { title, subtitle = '', content, active = '/admin', actions = '' }) {
  const s = ctx.settings;
  const openOrders = store.all('orders').filter(o => o.fulfillmentStatus === 'unfulfilled' && o.status !== 'refunded' && o.status !== 'cancelled').length;
  const pendingReviews = store.all('reviews').filter(r => r.status === 'pending').length;
  const openMessages = store.all('messages').filter(m => m.status === 'open').length;
  const lowStock = store.all('products').filter(p => p.inventoryQuantity > 0 && p.inventoryQuantity <= 6).length;
  const badge = key => `${{ orders: openOrders, reviews: pendingReviews, messages: openMessages }[key] || 0}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(s.brandName)} admin</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/admin.css">
</head><body class="admin" data-admin>
<div class="admin__shell">
  <aside class="admin__nav">
    <a class="admin__brand" href="/admin"><span>VENNIX</span><em>BACK OFFICE</em></a>
    <nav aria-label="Admin sections">
      <ul>${NAV.map(item => {
        const count = item.href === '/admin/orders' ? openOrders : item.href === '/admin/reviews' ? pendingReviews : item.href === '/admin/messages' ? openMessages : 0;
        return `<li><a href="${attr(item.href)}" class="${active === item.href ? 'is-active' : ''}">${icon(item.icon, { size: 17 })}<span>${esc(item.label)}</span>${count ? `<em class="nav-badge">${count}</em>` : ''}</a></li>`;
      }).join('')}</ul>
    </nav>
    <div class="admin__nav-foot">
      <p><strong>Sandbox</strong>${esc(s.payments.provider)}</p>
      <a href="/" target="_blank" rel="noopener">${icon('external', { size: 14 })} View storefront</a>
      <form method="post" action="/admin/logout" style="display:inline"><button type="submit" class="admin__foot-btn">${icon('logout', { size: 14 })} Log out</button></form>
    </div>
  </aside>
  <div class="admin__main">
    <header class="admin__top">
      <div>
        <h1>${esc(title)}</h1>
        ${subtitle ? `<p>${subtitle}</p>` : ''}
      </div>
      <div class="admin__top-actions">
        ${actions}
        <form class="admin__search" role="search" action="/admin/orders" method="get">
          ${icon('search', { size: 16 })}<input type="search" name="q" placeholder="Search orders, customers…" aria-label="Search orders">
        </form>
      </div>
    </header>
    <div class="admin__content">${content}</div>
    <footer class="admin__foot">
      <span>Signed in as ${esc((ctx.adminSession && ctx.adminSession.email) || s.admin.email)} · ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
      <span>${store.all('products').length} products · ${lowStock} low stock · ${store.all('orders').length} orders</span>
    </footer>
  </div>
</div>
<script src="/js/admin.js" defer></script>
</body></html>`;
}

function kpi(label, value, delta, foot) {
  return `<div class="kpi">
    <span class="kpi__label">${esc(label)}</span>
    <strong class="kpi__value">${value}</strong>
    ${delta !== null && delta !== undefined ? `<em class="kpi__delta ${delta >= 0 ? 'is-up' : 'is-down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}%</em>` : ''}
    ${foot ? `<span class="kpi__foot">${foot}</span>` : ''}
  </div>`;
}

function revenueChart(days = 14) {
  const now = Date.now();
  const buckets = Array.from({ length: days }, (_, i) => {
    const day = new Date(now - (days - 1 - i) * 864e5);
    const key = day.toISOString().slice(0, 10);
    const total = store.all('orders')
      .filter(o => o.createdAt.slice(0, 10) === key && o.status !== 'refunded' && o.status !== 'cancelled')
      .reduce((s, o) => s + o.total, 0);
    return { day, total, key };
  });
  const max = Math.max(1, ...buckets.map(b => b.total));
  return { buckets, max };
}

function sparkline(days = 14) {
  const { buckets, max } = revenueChart(days);
  const w = 760, h = 180, pad = 26;
  const step = (w - pad * 2) / (buckets.length - 1);
  const points = buckets.map((b, i) => [pad + i * step, h - pad - (b.total / max) * (h - pad * 2)]);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${h - pad} L${points[0][0].toFixed(1)},${h - pad} Z`;
  return `<figure class="chart">
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Revenue for the last ${days} days">
      <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a6a4f" stop-opacity="0.35"/><stop offset="1" stop-color="#8a6a4f" stop-opacity="0"/></linearGradient></defs>
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#e6e1d8"/>
      <path d="${area}" fill="url(#area)"/>
      <path d="${line}" fill="none" stroke="#8a6a4f" stroke-width="2.5" stroke-linejoin="round"/>
      ${points.map((p, i) => i === points.length - 1 ? `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="#191614"/>` : '').join('')}
    </svg>
    <figcaption>${buckets.map(b => `<span>${b.day.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>`).join('')}</figcaption>
  </figure>`;
}

/* --------------------------------- dashboard -------------------------------- */
function dashboard(ctx) {
  const db = store.getDb();
  const orders = db.orders;
  const now = Date.now();
  const in30 = orders.filter(o => Date.parse(o.createdAt) > now - 30 * 864e5 && o.status !== 'cancelled');
  const prev30 = orders.filter(o => Date.parse(o.createdAt) <= now - 30 * 864e5 && Date.parse(o.createdAt) > now - 60 * 864e5 && o.status !== 'cancelled');
  const paid = o => o.status !== 'refunded' && o.status !== 'cancelled';
  const rev = arr => arr.filter(paid).reduce((s, o) => s + o.total, 0);
  const revenue = rev(in30), prevRevenue = rev(prev30);
  const delta = prevRevenue ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;
  const aov = in30.length ? revenue / in30.filter(paid).length : 0;
  const sessions = Math.max(1, Math.round(in30.length * 34));
  const conversion = (in30.length / sessions) * 100;
  const refunded = in30.filter(o => o.status === 'refunded').length;

  const lowStock = db.products
    .flatMap(p => p.variants.map(v => ({ product: p, variant: v })))
    .filter(x => x.variant.stock <= 6)
    .sort((a, b) => a.variant.stock - b.variant.stock)
    .slice(0, 8);

  const topProducts = db.products
    .map(p => ({ p, units: orders.filter(paid).flatMap(o => o.items).filter(i => i.productId === p.id).reduce((s, i) => s + i.quantity, 0) }))
    .sort((a, b) => b.units - a.units).slice(0, 5);

  const pending = db.reviews.filter(r => r.status === 'pending');
  const messages = db.messages.filter(m => m.status === 'open');
  const carts = db.carts.filter(c => c.items.length && c.status === 'active');
  const abandoned = carts.filter(c => Date.now() - Date.parse(c.updatedAt) > 36e5);

  const content = `
    <div class="kpis">
      ${kpi('Revenue (30d)', money(revenue), delta, `${in30.length} orders · ${money(aov)} AOV`)}
      ${kpi('Orders (30d)', String(in30.length), null, `${orders.filter(o => o.fulfillmentStatus === 'unfulfilled' && paid(o)).length} awaiting fulfilment`)}
      ${kpi('Conversion rate', conversion.toFixed(2) + '%', null, `${sessions.toLocaleString()} sessions · ${carts.length} active carts`)}
      ${kpi('Customers', String(db.customers.length), null, `${db.customers.filter(c => c.acceptsMarketing).length} subscribed to email`)}
      ${kpi('Refunds (30d)', String(refunded), null, `${money(in30.filter(o => o.status === 'refunded').reduce((s, o) => s + o.total, 0))} returned`)}
      ${kpi('Abandoned carts', String(abandoned.length), null, `${money(abandoned.reduce((s, c) => s + cartLib.computeCart(c).subtotal, 0))} recoverable`)}
    </div>
    <section class="card">
      <header class="card__head"><h2>Revenue, last 14 days</h2><span class="muted">Sandbox data</span></header>
      ${sparkline()}
    </section>
    <div class="cols cols--2">
      <section class="card">
        <header class="card__head"><h2>Action required</h2></header>
        <ul class="task-list">
          <li><a href="/admin/orders?status=unfulfilled"><strong>${orders.filter(o => o.fulfillmentStatus === 'unfulfilled' && paid(o)).length} orders</strong> to fulfil</a>${icon('chevron', { size: 16 })}</li>
          <li><a href="/admin/reviews"><strong>${pending.length} reviews</strong> awaiting moderation</a>${icon('chevron', { size: 16 })}</li>
          <li><a href="/admin/messages"><strong>${messages.length} support messages</strong> open</a>${icon('chevron', { size: 16 })}</li>
          <li><a href="/admin/products?filter=low"><strong>${lowStock.length} variants</strong> low or out of stock</a>${icon('chevron', { size: 16 })}</li>
        </ul>
      </section>
      <section class="card">
        <header class="card__head"><h2>Top sellers</h2><a class="link-arrow" href="/admin/products">Products ${icon('arrow', { size: 14 })}</a></header>
        <ul class="top-list">
          ${topProducts.map(t => `<li>
            <img src="${attr(t.p.images[0].src)}" alt="" width="44" height="52" loading="lazy">
            <div><strong>${esc(t.p.title)}</strong><span>${t.units} units sold · ${money(t.p.price)}</span></div>
            <a class="link-inline" href="/admin/products/${attr(t.p.id)}">Edit</a>
          </li>`).join('')}
        </ul>
      </section>
    </div>
    <div class="cols cols--2">
      <section class="card">
        <header class="card__head"><h2>Recent orders</h2><a class="link-arrow" href="/admin/orders">All orders ${icon('arrow', { size: 14 })}</a></header>
        <div class="table-wrap"><table class="table table--admin">
          <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th></th></tr></thead>
          <tbody>${orders.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 6).map(o => `<tr>
            <td><a href="/admin/orders/${attr(o.id)}"><strong>${esc(o.number)}</strong></a><br><span class="muted">${new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></td>
            <td>${esc(o.customerName)}<br><span class="muted">${esc(o.email)}</span></td>
            <td><span class="pill pill--${attr(o.status)}">${esc(o.status)}</span> <span class="pill pill--${attr(o.fulfillmentStatus)}">${esc(o.fulfillmentStatus)}</span></td>
            <td>${money(o.total)}</td>
            <td><a class="btn btn--mini btn--outline" href="/admin/orders/${attr(o.id)}">View</a></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="card">
        <header class="card__head"><h2>Inventory alerts</h2><a class="link-arrow" href="/admin/products">Manage ${icon('arrow', { size: 14 })}</a></header>
        <ul class="stock-list">
          ${lowStock.map(x => `<li class="${x.variant.stock === 0 ? 'is-out' : 'is-low'}">
            <span>${esc(x.product.title)}</span>
            <em>${esc(x.variant.color)} / ${esc(x.variant.size)}</em>
            <strong>${x.variant.stock === 0 ? 'Sold out' : `${x.variant.stock} left`}</strong>
          </li>`).join('')}
        </ul>
      </section>
    </div>
    <section class="card">
      <header class="card__head"><h2>Activity</h2><span class="muted">Audit log</span></header>
      <ul class="activity">
        ${db.activity.slice().reverse().slice(0, 10).map(a => `<li><strong>${esc(a.actor)}</strong> ${esc(a.action)}<span class="muted">${esc(a.detail || '')}</span><time>${new Date(a.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time></li>`).join('')}
      </ul>
    </section>`;
  return adminShell(ctx, { title: 'Dashboard', subtitle: 'Everything happening in the store right now.', content, active: '/admin', actions: `<a class="btn btn--outline btn--sm" href="/admin/orders">Orders</a><a class="btn btn--primary btn--sm" href="/admin/products/new">Add product</a>` });
}

/* ----------------------------------- orders --------------------------------- */
function ordersList(ctx) {
  const { q = '', status = '', page = '1' } = ctx.query;
  let orders = store.all('orders').slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (status) orders = orders.filter(o => o.status === status || o.fulfillmentStatus === status);
  if (q) {
    const term = q.toLowerCase();
    orders = orders.filter(o => `${o.number} ${o.email} ${o.customerName} ${o.items.map(i => i.title).join(' ')}`.toLowerCase().includes(term));
  }
  const perPage = 12;
  const current = Math.max(1, Number(page) || 1);
  const totalPages = Math.max(1, Math.ceil(orders.length / perPage));
  const slice = orders.slice((current - 1) * perPage, current * perPage);
  const revenue = orders.filter(o => o.status !== 'refunded').reduce((s, o) => s + o.total, 0);
  const content = `
    <div class="chip-bar">
      ${['', 'paid', 'fulfilled', 'unfulfilled', 'refunded', 'cancelled'].map(s => `<a class="chip ${status === s ? 'is-active' : ''}" href="/admin/orders${s ? `?status=${s}` : ''}">${s === '' ? 'All orders' : s.replace(/^\w/, c => c.toUpperCase())}</a>`).join('')}
      <span class="chip-bar__meta">${orders.length} orders · ${money(revenue)} ${q ? `· search “${esc(q)}”` : ''}</span>
    </div>
    <section class="card">
      <div class="table-wrap"><table class="table table--admin">
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Payment</th><th>Fulfilment</th><th>Total</th><th></th></tr></thead>
        <tbody>${slice.map(o => `<tr>
          <td><a href="/admin/orders/${attr(o.id)}"><strong>${esc(o.number)}</strong></a></td>
          <td>${new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
          <td>${esc(o.customerName)}<br><span class="muted">${esc(o.email)}</span></td>
          <td>${o.items.reduce((s, i) => s + i.quantity, 0)}</td>
          <td><span class="pill pill--${attr(o.status)}">${esc(o.status)}</span></td>
          <td><span class="pill pill--${attr(o.fulfillmentStatus)}">${esc(o.fulfillmentStatus)}</span></td>
          <td>${money(o.total)}</td>
          <td><a class="btn btn--mini btn--outline" href="/admin/orders/${attr(o.id)}">Manage</a></td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted">No orders match those filters.</td></tr>'}</tbody>
      </table></div>
      ${totalPages > 1 ? `<nav class="admin-pager">${Array.from({ length: totalPages }, (_, i) => i + 1).map(p => `<a class="${p === current ? 'is-current' : ''}" href="/admin/orders?page=${p}${status ? `&status=${attr(status)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}">${p}</a>`).join('')}</nav>` : ''}
    </section>`;
  return adminShell(ctx, { title: 'Orders', subtitle: `${money(revenue)} in the current view`, content, active: '/admin/orders' });
}

function orderDetail(ctx, order) {
  const content = `
    <div class="cols cols--order">
      <div>
        <section class="card">
          <header class="card__head"><h2>Items</h2><span><span class="pill pill--${attr(order.status)}">${esc(order.status)}</span> <span class="pill pill--${attr(order.fulfillmentStatus)}">${esc(order.fulfillmentStatus)}</span></span></header>
          <div class="table-wrap"><table class="table table--admin">
            <thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
            <tbody>${order.items.map(i => `<tr>
              <td><div class="cell-item"><img src="${attr(i.image)}" alt="" width="40" height="48" loading="lazy"><div><strong>${esc(i.title)}</strong><span class="muted">${esc(i.color)} · ${esc(i.size)}</span></div></div></td>
              <td class="muted">${esc(i.sku)}</td>
              <td>${i.quantity}</td>
              <td>${money(i.price)}</td>
              <td>${money(i.price * i.quantity)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          <dl class="totals totals--admin">
            <div><dt>Subtotal</dt><dd>${money(order.subtotal)}</dd></div>
            ${order.discount ? `<div><dt>Discount · ${esc(order.discount.code)}</dt><dd>−${money(order.discountAmount)}</dd></div>` : ''}
            <div><dt>Shipping · ${esc(order.shipping.label)}</dt><dd>${money(order.shipping.amount)}</dd></div>
            <div><dt>${esc(order.tax.name)}</dt><dd>${money(order.tax.amount)}</dd></div>
            <div class="totals__grand"><dt>Total</dt><dd>${money(order.total)}</dd></div>
          </dl>
        </section>
        <section class="card">
          <header class="card__head"><h2>Timeline</h2></header>
          <ol class="timeline">
            ${(order.timeline || []).map(t => `<li><span class="timeline__dot"></span><div><strong>${esc(t.label)}</strong><time>${new Date(t.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time><p>${esc(t.note || '')}</p></div></li>`).join('')}
            ${order.fulfillment ? `<li><span class="timeline__dot"></span><div><strong>Fulfilled</strong><time>${new Date(order.fulfillment.fulfilledAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time><p>${esc(order.fulfillment.carrier)} · ${esc(order.fulfillment.tracking)}</p></div></li>` : ''}
          </ol>
        </section>
        <section class="card">
          <header class="card__head"><h2>Notes</h2></header>
          <form method="post" action="/admin/orders/${attr(order.id)}/note" class="form-grid">
            <textarea name="note" rows="3" placeholder="Internal note — not visible to the customer.">${esc(order.note || '')}</textarea>
            <button class="btn btn--primary btn--sm" type="submit">Save note</button>
          </form>
          ${order.giftNote ? `<p class="muted"><strong>Gift note:</strong> ${esc(order.giftNote)}</p>` : ''}
        </section>
      </div>
      <aside>
        <section class="card">
          <header class="card__head"><h2>Fulfilment</h2></header>
          ${order.fulfillmentStatus === 'fulfilled' ? `
            <p class="muted">Shipped with ${esc(order.fulfillment.carrier)} · ${esc(order.fulfillment.tracking)}</p>
            <form method="post" action="/admin/orders/${attr(order.id)}/unfulfill"><button class="btn btn--ghost btn--sm" type="submit">Mark unfulfilled</button></form>`
          : `<form method="post" action="/admin/orders/${attr(order.id)}/fulfill" class="form-grid">
              <label class="field"><span class="field__label">Carrier</span>
                <select name="carrier">${['UPS', 'FedEx', 'USPS', 'DHL', 'Local courier'].map(c => `<option>${c}</option>`).join('')}</select>
              </label>
              <label class="field"><span class="field__label">Tracking number</span><input type="text" name="tracking" value="1Z${Math.random().toString().slice(2, 12)}" ></label>
              <button class="btn btn--primary btn--sm btn--block" type="submit">${icon('truck', { size: 15 })} Fulfil order &amp; email customer</button>
            </form>`}
        </section>
        <section class="card">
          <header class="card__head"><h2>Payment</h2></header>
          <p class="muted">${esc(order.payment.brand.toUpperCase())} ending ${esc(order.payment.last4)}<br>Auth ${esc(order.payment.authCode)}<br>Mode ${esc(order.payment.mode || 'sandbox')}</p>
          ${order.status === 'refunded' ? '<p class="pill pill--refunded">Refunded in full</p>' : `<form method="post" action="/admin/orders/${attr(order.id)}/refund" class="form-grid">
            <label class="field"><span class="field__label">Refund amount</span><input type="number" name="amount" step="0.01" value="${(order.total / 100).toFixed(2)}"></label>
            <label class="check"><input type="checkbox" name="restock" checked><span>Restock items</span></label>
            <button class="btn btn--outline btn--sm btn--block" type="submit">Refund &amp; email customer</button>
          </form>`}
          ${order.status !== 'cancelled' && order.status !== 'refunded' ? `<form method="post" action="/admin/orders/${attr(order.id)}/cancel" onsubmit="return confirm('Cancel this order and restock items?')"><button class="btn btn--ghost btn--sm btn--block" type="submit">Cancel order</button></form>` : ''}
        </section>
        <section class="card">
          <header class="card__head"><h2>Customer</h2></header>
          <p><strong>${esc(order.customerName)}</strong><br><a href="mailto:${attr(order.email)}">${esc(order.email)}</a>${order.customerId ? `<br><a class="link-inline" href="/admin/customers/${attr(order.customerId)}">${icon('external', { size: 13 })} Customer profile</a>` : ''}</p>
          <h3>Shipping address</h3>
          <address class="muted">${esc(order.shippingAddress.line1)}${order.shippingAddress.line2 ? `, ${esc(order.shippingAddress.line2)}` : ''}<br>${esc(order.shippingAddress.city)}, ${esc(order.shippingAddress.province)} ${esc(order.shippingAddress.zip)}<br>${esc(order.shippingAddress.country)}</address>
        </section>
        <section class="card">
          <header class="card__head"><h2>Emails</h2></header>
          <ul class="link-list">
            ${order.confirmationEmail ? `<li><a href="${attr(order.confirmationEmail)}" target="_blank" rel="noopener">Order confirmation</a></li>` : ''}
            <li><a href="/admin/emails" target="_blank">All generated emails</a></li>
          </ul>
        </section>
        <section class="card">
          <header class="card__head"><h2>Print</h2></header>
          <a class="btn btn--outline btn--sm btn--block" href="/admin/orders/${attr(order.id)}/packing-slip" target="_blank">${icon('box', { size: 15 })} Packing slip</a>
        </section>
      </aside>
    </div>`;
  return adminShell(ctx, { title: `Order ${order.number}`, subtitle: `${new Date(order.createdAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} · ${esc(order.email)}`, content, active: '/admin/orders' });
}

function packingSlip(ctx, order) {
  const s = ctx.settings;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing slip ${esc(order.number)}</title>
  <style>body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:40px;color:#191614}h1{font-size:20px;letter-spacing:.2em;text-transform:uppercase}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{text-align:left;padding:10px 6px;border-bottom:1px solid #e6e1d8;font-size:14px}.muted{color:#6e675e;font-size:13px}.box{border:1px solid #e6e1d8;padding:16px;margin-top:20px}@media print{.no-print{display:none}}</style>
  </head><body>
  <h1>${esc(s.brandName)} — packing slip</h1>
  <p class="muted">${esc(order.number)} · ${new Date(order.createdAt).toDateString()} · ${esc(order.email)}</p>
  <div class="box">
    <strong>Ship to</strong>
    <p class="muted">${esc(order.shippingAddress.firstName)} ${esc(order.shippingAddress.lastName)}<br>${esc(order.shippingAddress.line1)}${order.shippingAddress.line2 ? `<br>${esc(order.shippingAddress.line2)}` : ''}<br>${esc(order.shippingAddress.city)}, ${esc(order.shippingAddress.province)} ${esc(order.shippingAddress.zip)}<br>${esc(order.shippingAddress.country)}</p>
  </div>
  <table><thead><tr><th>Item</th><th>Variant</th><th>SKU</th><th>Qty</th></tr></thead>
  <tbody>${order.items.map(i => `<tr><td>${esc(i.title)}</td><td>${esc(i.color)} / ${esc(i.size)}</td><td>${esc(i.sku)}</td><td>${i.quantity}</td></tr>`).join('')}</tbody></table>
  <p class="muted">Thank you — free repairs for two years. Questions? ${esc(s.supportEmail)}</p>
  <button class="no-print" onclick="window.print()">Print</button>
  </body></html>`;
}

/* ---------------------------------- products -------------------------------- */
function productsList(ctx) {
  const { q = '', filter = '' } = ctx.query;
  let products = store.all('products').slice();
  if (q) products = products.filter(p => `${p.title} ${p.type} ${p.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  if (filter === 'low') products = products.filter(p => p.inventoryQuantity <= 6);
  if (filter === 'sale') products = products.filter(p => p.compareAtPrice && p.compareAtPrice > p.price);
  const content = `
    <div class="chip-bar">
      <a class="chip ${!filter ? 'is-active' : ''}" href="/admin/products">All (${store.all('products').length})</a>
      <a class="chip ${filter === 'low' ? 'is-active' : ''}" href="/admin/products?filter=low">Low stock</a>
      <a class="chip ${filter === 'sale' ? 'is-active' : ''}" href="/admin/products?filter=sale">On sale</a>
      ${q ? `<span class="chip-bar__meta">Search “${esc(q)}” · ${products.length} results</span>` : ''}
    </div>
    <section class="card">
      <div class="table-wrap"><table class="table table--admin">
        <thead><tr><th>Product</th><th>Type</th><th>Price</th><th>Compare at</th><th>Variants</th><th>Inventory</th><th>Status</th><th></th></tr></thead>
        <tbody>${products.map(p => {
          const stock = p.variants.reduce((s, v) => s + v.stock, 0);
          return `<tr>
            <td><div class="cell-item"><img src="${attr(p.images[0].src)}" alt="" width="40" height="48" loading="lazy"><div><a href="/admin/products/${attr(p.id)}"><strong>${esc(p.title)}</strong></a><br><span class="muted">${esc(p.handle)}</span></div></div></td>
            <td>${esc(p.type)}</td>
            <td>${money(p.price)}</td>
            <td>${p.compareAtPrice ? money(p.compareAtPrice) : '—'}</td>
            <td>${p.variants.length}</td>
            <td><span class="pill ${stock === 0 ? 'pill--soldout' : stock <= 12 ? 'pill--low' : 'pill--ok'}">${stock === 0 ? 'Sold out' : `${stock} in stock`}</span></td>
            <td><span class="pill pill--${p.status === 'active' ? 'ok' : 'draft'}">${esc(p.status)}</span></td>
            <td class="table__actions">
              <a class="btn btn--mini btn--outline" href="/admin/products/${attr(p.id)}">Edit</a>
              <a class="btn btn--mini btn--ghost" href="/products/${attr(p.handle)}" target="_blank" rel="noopener">View</a>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>`;
  return adminShell(ctx, { title: 'Products', subtitle: `${products.length} of ${store.all('products').length} products`, content, active: '/admin/products', actions: `<a class="btn btn--primary btn--sm" href="/admin/products/new">Add product</a>` });
}

function productForm(ctx, product, { notice = '' } = {}) {
  const isNew = !product;
  const p = product || {
    id: '', handle: '', title: '', tagline: '', type: 'T-Shirt', category: 'men', status: 'active',
    price: 0, compareAtPrice: 0, descriptionHtml: '', features: [], materials: '', care: '', fit: '',
    tags: [], badges: [], collections: [], images: [{ src: '/images/p-everyday-tee.jpg', alt: '' }], variants: [],
    inventoryPolicy: 'deny', seo: { title: '', description: '' }
  };
  const content = `
    ${notice ? `<div class="alert alert--ok">${icon('check', { size: 16 })} ${esc(notice)}</div>` : ''}
    <form method="post" action="${isNew ? '/admin/products/new' : `/admin/products/${attr(p.id)}`}" class="form-grid form-grid--wide">
      <section class="card">
        <header class="card__head"><h2>Product details</h2></header>
        <label class="field"><span class="field__label">Title <em>*</em></span><input type="text" name="title" value="${attr(p.title)}" required></label>
        <div class="field-row">
          <label class="field"><span class="field__label">Handle</span><input type="text" name="handle" value="${attr(p.handle)}" ${isNew ? 'placeholder="auto-generated from the title"' : ''}></label>
          <label class="field"><span class="field__label">Type</span><input type="text" name="type" value="${attr(p.type)}"></label>
        </div>
        <label class="field"><span class="field__label">Tagline</span><input type="text" name="tagline" value="${attr(p.tagline)}"></label>
        <div class="field-row field-row--3">
          <label class="field"><span class="field__label">Price (USD)</span><input type="number" step="0.01" name="price" value="${(p.price / 100).toFixed(2)}"></label>
          <label class="field"><span class="field__label">Compare-at price</span><input type="number" step="0.01" name="compareAtPrice" value="${p.compareAtPrice ? (p.compareAtPrice / 100).toFixed(2) : ''}"></label>
          <label class="field"><span class="field__label">Status</span><select name="status">${['active', 'draft', 'archived'].map(s => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        </div>
        <div class="field-row">
          <label class="field"><span class="field__label">Category</span><select name="category">${['men', 'women', 'active', 'unisex'].map(c => `<option ${p.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field"><span class="field__label">Badges</span><input type="text" name="badges" value="${attr((p.badges || []).join(', '))}" placeholder="New, Bestseller, Sale"></label>
        </div>
        <label class="field"><span class="field__label">Tags</span><input type="text" name="tags" value="${attr((p.tags || []).join(', '))}" placeholder="hoodie, fleece, training"></label>
        <label class="field"><span class="field__label">Collections</span><input type="text" name="collections" value="${attr((p.collections || []).join(', '))}" placeholder="men, essentials, new-in"></label>
        <label class="field"><span class="field__label">Description HTML</span><textarea name="descriptionHtml" rows="8">${esc(p.descriptionHtml)}</textarea></label>
        <label class="field"><span class="field__label">Features (one per line)</span><textarea name="features" rows="4">${esc((p.features || []).join('\n'))}</textarea></label>
        <div class="field-row">
          <label class="field"><span class="field__label">Materials</span><input type="text" name="materials" value="${attr(p.materials)}"></label>
          <label class="field"><span class="field__label">Fit note</span><input type="text" name="fit" value="${attr(p.fit)}"></label>
        </div>
        <label class="field"><span class="field__label">Care instructions</span><textarea name="care" rows="2">${esc(p.care)}</textarea></label>
        <div class="field-row">
          <label class="field"><span class="field__label">SEO title</span><input type="text" name="seoTitle" value="${attr(p.seo.title)}"></label>
          <label class="field"><span class="field__label">SEO description</span><input type="text" name="seoDescription" value="${attr(p.seo.description)}"></label>
        </div>
      </section>
      <aside>
        <section class="card">
          <header class="card__head"><h2>Media</h2></header>
          <img class="media-preview" src="${attr(p.images[0].src)}" alt="" width="220" height="260">
          <label class="field"><span class="field__label">Primary image path</span><input type="text" name="image1" value="${attr(p.images[0].src)}"></label>
          <label class="field"><span class="field__label">Secondary image path</span><input type="text" name="image2" value="${attr((p.images[1] || {}).src || '')}"></label>
        </section>
        ${!isNew ? `<section class="card">
          <header class="card__head"><h2>Inventory</h2><span class="muted">${p.variants.length} variants</span></header>
          <div class="variant-editor">
            ${p.variants.map(v => `<div class="variant-row">
              <span class="variant-row__name">${esc(v.color)} / ${esc(v.size)}<em>${esc(v.sku)}</em></span>
              <input type="number" name="stock_${attr(v.id)}" value="${v.stock}" min="0" aria-label="Stock for ${attr(v.sku)}">
            </div>`).join('')}
          </div>
        </section>
        <section class="card">
          <header class="card__head"><h2>Danger zone</h2></header>
          <div class="panel__actions">
            <form method="post" action="/admin/products/${attr(p.id)}/duplicate"><button class="btn btn--ghost btn--sm" type="submit">Duplicate</button></form>
            <form method="post" action="/admin/products/${attr(p.id)}/delete" onsubmit="return confirm('Delete this product? This cannot be undone.')"><button class="btn btn--ghost btn--sm" type="submit">Delete product</button></form>
          </div>
        </section>` : ''}
        <button class="btn btn--primary btn--block" type="submit">${isNew ? 'Create product' : 'Save changes'}</button>
      </aside>
    </form>`;
  return adminShell(ctx, { title: isNew ? 'Add product' : p.title, subtitle: isNew ? 'Create a new catalog item' : `Handle: /products/${esc(p.handle)}`, content, active: '/admin/products' });
}

/* --------------------------------- collections ------------------------------ */
function collectionsList(ctx, notice = '') {
  const products = store.all('products');
  const content = `
    ${notice ? `<div class="alert alert--ok">${icon('check', { size: 16 })} ${esc(notice)}</div>` : ''}
    ${store.all('collections').map(c => `<section class="card">
      <form method="post" action="/admin/collections/${attr(c.id)}">
        <header class="card__head"><h2>${esc(c.title)}</h2><span class="muted">/collections/${esc(c.handle)} · ${c.productHandles.length} products</span></header>
        <div class="field-row">
          <label class="field"><span class="field__label">Title</span><input type="text" name="title" value="${attr(c.title)}"></label>
          <label class="field"><span class="field__label">Image path</span><input type="text" name="image" value="${attr(c.image)}"></label>
        </div>
        <label class="field"><span class="field__label">Description</span><textarea name="description" rows="2">${esc(c.description)}</textarea></label>
        <fieldset class="field"><legend class="field__label">Products in this collection</legend>
          <div class="check-grid">
            ${products.map(p => `<label class="check"><input type="checkbox" name="products" value="${attr(p.handle)}" ${c.productHandles.includes(p.handle) ? 'checked' : ''}><span>${esc(p.title)}</span></label>`).join('')}
          </div>
        </fieldset>
        <div class="panel__actions">
          <button class="btn btn--primary btn--sm" type="submit">Save collection</button>
          <a class="btn btn--ghost btn--sm" href="/collections/${attr(c.handle)}" target="_blank" rel="noopener">View on storefront</a>
        </div>
      </form>
    </section>`).join('')}`;
  return adminShell(ctx, { title: 'Collections', subtitle: `${store.all('collections').length} collections`, content, active: '/admin/collections' });
}

/* ---------------------------------- customers -------------------------------- */
function customersList(ctx) {
  const { q = '' } = ctx.query;
  let customers = store.all('customers').slice().sort((a, b) => b.totalSpent - a.totalSpent);
  if (q) customers = customers.filter(c => `${c.email} ${c.firstName} ${c.lastName}`.toLowerCase().includes(q.toLowerCase()));
  const content = `
    <section class="card">
      <div class="table-wrap"><table class="table table--admin">
        <thead><tr><th>Customer</th><th>Location</th><th>Orders</th><th>Spent</th><th>Marketing</th><th>Tags</th><th></th></tr></thead>
        <tbody>${customers.map(c => `<tr>
          <td><a href="/admin/customers/${attr(c.id)}"><strong>${esc(c.firstName)} ${esc(c.lastName)}</strong></a><br><span class="muted">${esc(c.email)}</span></td>
          <td>${esc((c.addresses[0] && `${c.addresses[0].city}, ${c.addresses[0].province}`) || '—')}</td>
          <td>${c.ordersCount}</td>
          <td>${money(c.totalSpent)}</td>
          <td><span class="pill ${c.acceptsMarketing ? 'pill--ok' : 'pill--draft'}">${c.acceptsMarketing ? 'Subscribed' : 'No'}</span></td>
          <td>${(c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
          <td class="table__actions">
            <a class="btn btn--mini btn--outline" href="/admin/customers/${attr(c.id)}">Profile</a>
            <a class="btn btn--mini btn--ghost" href="mailto:${attr(c.email)}">Email</a>
          </td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  return adminShell(ctx, { title: 'Customers', subtitle: `${customers.length} customers · ${money(store.all('customers').reduce((s, c) => s + c.totalSpent, 0))} lifetime value`, content, active: '/admin/customers' });
}

function customerDetail(ctx, customer, notice = '') {
  const orders = store.all('orders').filter(o => o.customerId === customer.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const content = `
    ${notice ? `<div class="alert alert--ok">${icon('check', { size: 16 })} ${esc(notice)}</div>` : ''}
    <div class="cols cols--2">
      <section class="card">
        <header class="card__head"><h2>Profile</h2><span class="muted">Customer since ${new Date(customer.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span></header>
        <form method="post" action="/admin/customers/${attr(customer.id)}" class="form-grid">
          <div class="field-row">
            <label class="field"><span class="field__label">First name</span><input type="text" name="firstName" value="${attr(customer.firstName)}"></label>
            <label class="field"><span class="field__label">Last name</span><input type="text" name="lastName" value="${attr(customer.lastName)}"></label>
          </div>
          <label class="field"><span class="field__label">Email</span><input type="email" name="email" value="${attr(customer.email)}"></label>
          <label class="field"><span class="field__label">Phone</span><input type="text" name="phone" value="${attr(customer.phone || '')}"></label>
          <label class="field"><span class="field__label">Tags (comma separated)</span><input type="text" name="tags" value="${attr((customer.tags || []).join(', '))}"></label>
          <label class="field"><span class="field__label">Internal note</span><textarea name="note" rows="3">${esc(customer.note || '')}</textarea></label>
          <label class="check"><input type="checkbox" name="acceptsMarketing" ${customer.acceptsMarketing ? 'checked' : ''}><span>Subscribed to marketing email</span></label>
          <button class="btn btn--primary btn--sm" type="submit">Save customer</button>
        </form>
      </section>
      <section class="card">
        <header class="card__head"><h2>Stats</h2></header>
        <div class="mini-stats">
          <div><span>Orders</span><strong>${orders.length}</strong></div>
          <div><span>Lifetime spend</span><strong>${money(customer.totalSpent)}</strong></div>
          <div><span>Average order</span><strong>${money(orders.length ? customer.totalSpent / orders.length : 0)}</strong></div>
          <div><span>Points</span><strong>${Math.floor(customer.totalSpent / 100)}</strong></div>
        </div>
        <h3>Addresses</h3>
        <ul class="address-mini">${(customer.addresses || []).map(a => `<li>${esc(a.label || 'Address')} — ${esc(a.line1)}, ${esc(a.city)} ${esc(a.province)} ${a.isDefault ? '<em class="pill pill--ok">Default</em>' : ''}</li>`).join('') || '<li class="muted">None on file</li>'}</ul>
      </section>
    </div>
    <section class="card">
      <header class="card__head"><h2>Order history</h2></header>
      <div class="table-wrap"><table class="table table--admin">
        <thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Status</th><th>Total</th><th></th></tr></thead>
        <tbody>${orders.map(o => `<tr>
          <td><a href="/admin/orders/${attr(o.id)}"><strong>${esc(o.number)}</strong></a></td>
          <td>${new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
          <td>${o.items.reduce((s, i) => s + i.quantity, 0)}</td>
          <td><span class="pill pill--${attr(o.status)}">${esc(o.status)}</span></td>
          <td>${money(o.total)}</td>
          <td><a class="btn btn--mini btn--outline" href="/admin/orders/${attr(o.id)}">View</a></td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No orders yet.</td></tr>'}</tbody>
      </table></div>
    </section>`;
  return adminShell(ctx, { title: `${customer.firstName} ${customer.lastName}`, subtitle: esc(customer.email), content, active: '/admin/customers' });
}

/* ---------------------------------- discounts -------------------------------- */
function discountsPage(ctx, notice = '') {
  const discounts = store.all('discounts');
  const content = `
    ${notice ? `<div class="alert alert--ok">${icon('check', { size: 16 })} ${esc(notice)}</div>` : ''}
    <section class="card">
      <header class="card__head"><h2>Active discount codes</h2><span class="muted">${discounts.filter(d => d.active).length} live</span></header>
      <div class="table-wrap"><table class="table table--admin">
        <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Minimum</th><th>Used</th><th>Window</th><th>Status</th><th></th></tr></thead>
        <tbody>${discounts.map(d => `<tr>
          <td><strong>${esc(d.code)}</strong><br><span class="muted">${esc(d.description || '')}</span></td>
          <td>${esc(d.type)}</td>
          <td>${d.type === 'percent' ? `${d.value}%` : d.type === 'fixed' ? money(d.value) : 'Free shipping'}</td>
          <td>${d.minSubtotal ? money(d.minSubtotal) : '—'}</td>
          <td>${d.used || 0}${d.usageLimit ? ` / ${d.usageLimit}` : ''}</td>
          <td class="muted">${d.endsAt ? `Ends ${new Date(d.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'No end date'}</td>
          <td><span class="pill ${d.active ? 'pill--ok' : 'pill--draft'}">${d.active ? 'Active' : 'Disabled'}</span></td>
          <td class="table__actions">
            <form method="post" action="/admin/discounts/${attr(d.id)}/toggle"><button class="btn btn--mini btn--outline" type="submit">${d.active ? 'Disable' : 'Enable'}</button></form>
            <form method="post" action="/admin/discounts/${attr(d.id)}/delete" onsubmit="return confirm('Delete ${esc(d.code)}?')"><button class="btn btn--mini btn--ghost" type="submit">Delete</button></form>
          </td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>
    <section class="card">
      <header class="card__head"><h2>Create a discount</h2></header>
      <form method="post" action="/admin/discounts" class="form-grid">
        <div class="field-row field-row--3">
          <label class="field"><span class="field__label">Code</span><input type="text" name="code" placeholder="SPRING15" required></label>
          <label class="field"><span class="field__label">Type</span><select name="type"><option value="percent">Percentage</option><option value="fixed">Fixed amount ($)</option><option value="shipping">Free shipping</option></select></label>
          <label class="field"><span class="field__label">Value</span><input type="number" name="value" step="0.01" value="10"></label>
        </div>
        <div class="field-row">
          <label class="field"><span class="field__label">Minimum order ($)</span><input type="number" name="minSubtotal" step="1" value="0"></label>
          <label class="field"><span class="field__label">Usage limit (blank = unlimited)</span><input type="number" name="usageLimit" step="1"></label>
        </div>
        <label class="field"><span class="field__label">Description</span><input type="text" name="description" placeholder="15% off for spring campaign"></label>
        <button class="btn btn--primary btn--sm" type="submit">Create discount</button>
      </form>
    </section>`;
  return adminShell(ctx, { title: 'Discounts', subtitle: 'Codes customers can apply at checkout', content, active: '/admin/discounts' });
}

/* ----------------------------------- reviews --------------------------------- */
function reviewsPage(ctx, notice = '') {
  const reviews = store.all('reviews').slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const groups = ['pending', 'published', 'rejected'];
  const content = `
    ${notice ? `<div class="alert alert--ok">${icon('check', { size: 16 })} ${esc(notice)}</div>` : ''}
    ${groups.map(status => {
      const list = reviews.filter(r => r.status === status);
      if (!list.length) return '';
      return `<section class="card">
        <header class="card__head"><h2>${status.replace(/^\w/, c => c.toUpperCase())} reviews</h2><span class="muted">${list.length}</span></header>
        <ul class="review-admin">
          ${list.map(r => `<li>
            <div class="review-admin__head">
              <div><strong>${esc(r.title)}</strong><span class="muted"> · ${esc(r.productTitle)}</span></div>
              <div>${ui.stars(r.rating, { showValue: false })}</div>
            </div>
            <p>${esc(r.body)}</p>
            <p class="muted">${esc(r.author)} · ${esc(r.email)} · ${new Date(r.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}${r.verified ? ' · verified buyer' : ''}</p>
            ${r.reply ? `<div class="review-admin__reply"><strong>Studio reply:</strong> ${esc(r.reply)}</div>` : ''}
            <div class="review-admin__actions">
              ${status !== 'published' ? `<form method="post" action="/admin/reviews/${attr(r.id)}/publish"><button class="btn btn--mini btn--primary" type="submit">Publish</button></form>` : ''}
              ${status !== 'rejected' ? `<form method="post" action="/admin/reviews/${attr(r.id)}/reject"><button class="btn btn--mini btn--outline" type="submit">Reject</button></form>` : ''}
              <form method="post" action="/admin/reviews/${attr(r.id)}/reply" class="inline-form">
                <input type="text" name="reply" value="${attr(r.reply || '')}" placeholder="Reply as the studio…">
                <button class="btn btn--mini btn--ghost" type="submit">Save reply</button>
              </form>
              <form method="post" action="/admin/reviews/${attr(r.id)}/delete" onsubmit="return confirm('Delete this review?')"><button class="btn btn--mini btn--ghost" type="submit">Delete</button></form>
            </div>
          </li>`).join('')}
        </ul>
      </section>`;
    }).join('')}`;
  return adminShell(ctx, { title: 'Reviews', subtitle: `${reviews.filter(r => r.status === 'pending').length} awaiting moderation`, content, active: '/admin/reviews' });
}

/* ----------------------------------- pages ----------------------------------- */
function pagesEditor(ctx, notice = '') {
  const db = store.getDb();
  const content = `
    ${notice ? `<div class="alert alert--ok">${icon('check', { size: 16 })} ${esc(notice)}</div>` : ''}
    ${db.pages.map(p => `<section class="card">
      <form method="post" action="/admin/pages/${attr(p.id)}">
        <header class="card__head"><h2>${esc(p.title)}</h2><span class="muted">/pages/${esc(p.handle)} · template ${esc(p.template)}</span></header>
        <div class="field-row">
          <label class="field"><span class="field__label">Title</span><input type="text" name="title" value="${attr(p.title)}"></label>
          <label class="field"><span class="field__label">SEO description</span><input type="text" name="seoDescription" value="${attr(p.seo.description)}"></label>
        </div>
        <label class="field"><span class="field__label">Body (HTML)</span><textarea name="body" rows="14">${esc(p.body)}</textarea></label>
        <div class="panel__actions">
          <button class="btn btn--primary btn--sm" type="submit">Save page</button>
          <a class="btn btn--ghost btn--sm" href="/pages/${attr(p.handle)}" target="_blank" rel="noopener">Preview</a>
        </div>
      </form>
    </section>`).join('')}
    <section class="card">
      <header class="card__head"><h2>Journal</h2><span class="muted">${db.posts.length} articles</span></header>
      <div class="table-wrap"><table class="table table--admin">
        <thead><tr><th>Article</th><th>Author</th><th>Published</th><th></th></tr></thead>
        <tbody>${db.posts.map(post => `<tr>
          <td><strong>${esc(post.title)}</strong><br><span class="muted">${esc(post.excerpt.slice(0, 90))}…</span></td>
          <td>${esc(post.author)}</td>
          <td>${new Date(post.publishedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}</td>
          <td><a class="btn btn--mini btn--outline" href="/blogs/journal/${attr(post.handle)}" target="_blank" rel="noopener">View</a></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>
    <section class="card">
      <header class="card__head"><h2>FAQ content</h2><span class="muted">Shown on /pages/faq</span></header>
      <ul class="faq-admin">${db.meta.faqs.map(f => `<li><strong>${esc(f.q)}</strong><span class="muted">${esc(f.group)}</span><p>${esc(f.a)}</p></li>`).join('')}</ul>
    </section>`;
  return adminShell(ctx, { title: 'Pages & content', subtitle: 'Storefront copy, policies and journal', content, active: '/admin/pages' });
}

/* ---------------------------------- messages --------------------------------- */
function messagesPage(ctx, notice = '') {
  const messages = store.all('messages').slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const content = `
    ${notice ? `<div class="alert alert--ok">${icon('check', { size: 16 })} ${esc(notice)}</div>` : ''}
    <section class="card">
      <header class="card__head"><h2>Support inbox</h2><span class="muted">${messages.filter(m => m.status === 'open').length} open · ${messages.length} total</span></header>
      <ul class="message-admin">
        ${messages.map(m => `<li class="${m.status === 'open' ? 'is-open' : ''}">
          <div class="message-admin__head">
            <div><strong>${esc(m.name)}</strong> <span class="muted">${esc(m.email)}</span></div>
            <div><span class="pill ${m.status === 'open' ? 'pill--paid' : 'pill--ok'}">${esc(m.status)}</span><time>${new Date(m.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
          </div>
          <p class="muted">${esc(m.topic)}${m.orderNumber ? ` · order ${esc(m.orderNumber)}` : ''} · via ${esc(m.source || 'contact form')}</p>
          <p>${esc(m.message)}</p>
          ${m.reply ? `<div class="review-admin__reply"><strong>Reply sent:</strong> ${esc(m.reply)}</div>` : ''}
          <div class="message-admin__actions">
            <form method="post" action="/admin/messages/${attr(m.id)}/reply" class="inline-form">
              <input type="text" name="reply" placeholder="Write a reply — saved to the thread and emails the customer…">
              <button class="btn btn--mini btn--primary" type="submit">Send reply</button>
            </form>
            ${m.status === 'open' ? `<form method="post" action="/admin/messages/${attr(m.id)}/resolve"><button class="btn btn--mini btn--outline" type="submit">Mark resolved</button></form>` : `<form method="post" action="/admin/messages/${attr(m.id)}/reopen"><button class="btn btn--mini btn--ghost" type="submit">Reopen</button></form>`}
          </div>
        </li>`).join('') || '<li class="muted">No messages yet.</li>'}
      </ul>
    </section>
    <section class="card">
      <header class="card__head"><h2>Newsletter subscribers</h2><span class="muted">${store.all('subscribers').filter(s => s.status === 'subscribed').length} subscribed</span></header>
      <div class="table-wrap"><table class="table table--admin">
        <thead><tr><th>Email</th><th>Source</th><th>Status</th><th>Joined</th></tr></thead>
        <tbody>${store.all('subscribers').map(s => `<tr><td>${esc(s.email)}</td><td>${esc(s.source)}</td><td><span class="pill ${s.status === 'subscribed' ? 'pill--ok' : 'pill--draft'}">${esc(s.status)}</span></td><td>${new Date(s.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
    <section class="card">
      <header class="card__head"><h2>Back-in-stock requests</h2><span class="muted">${store.all('backInStock').filter(n => n.status === 'waiting').length} waiting</span></header>
      <div class="table-wrap"><table class="table table--admin">
        <thead><tr><th>Email</th><th>Piece</th><th>Size</th><th>Requested</th></tr></thead>
        <tbody>${store.all('backInStock').map(n => `<tr><td>${esc(n.email)}</td><td>${esc(n.title)} <span class="muted">${esc(n.color || '')}</span></td><td>${esc(n.size || '')}</td><td>${new Date(n.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nobody is waiting on a size right now.</td></tr>'}</tbody>
      </table></div>
      <p class="muted">These come from the product page when a size is sold out. Nothing is sent automatically — email them from the outbox when the stock lands.</p>
    </section>`;
  return adminShell(ctx, { title: 'Support inbox', subtitle: 'Messages, subscribers, waitlists and replies', content, active: '/admin/messages' });
}

/* ------------------------------------ POS ------------------------------------ */
function posPage(ctx, notice = '') {
  const products = store.all('products').filter(p => p.inventoryQuantity > 0);
  const content = `
    ${notice ? `<div class="alert alert--ok">${icon('check', { size: 16 })} ${esc(notice)}</div>` : ''}
    <div class="cols cols--pos">
      <section class="card">
        <header class="card__head"><h2>Studio till</h2><span class="muted">Tap a product to add it to the sale</span></header>
        <div class="pos-grid">
          ${products.map(p => `<button class="pos-item" type="button" data-pos-add="${attr(p.id)}" data-pos-title="${attr(p.title)}" data-pos-price="${p.price}" data-pos-variant="${attr((p.variants.find(v => v.stock > 0) || p.variants[0]).id)}" data-pos-image="${attr(p.images[0].src)}">
            <img src="${attr(p.images[0].src)}" alt="" width="90" height="104" loading="lazy">
            <span>${esc(p.title)}</span>
            <em>${money(p.price)}</em>
          </button>`).join('')}
        </div>
      </section>
      <aside class="card">
        <header class="card__head"><h2>Current sale</h2></header>
        <div class="pos-cart" data-pos-cart><p class="muted">No items yet.</p></div>
        <dl class="totals totals--admin">
          <div><dt>Subtotal</dt><dd data-pos-subtotal>$0.00</dd></div>
          <div><dt>Tax (NY 8.875%)</dt><dd data-pos-tax>$0.00</dd></div>
          <div class="totals__grand"><dt>Total</dt><dd data-pos-total>$0.00</dd></div>
        </dl>
        <form method="post" action="/admin/pos/charge" class="form-grid" data-pos-form>
          <input type="hidden" name="lines" data-pos-lines>
          <label class="field"><span class="field__label">Customer email (optional)</span><input type="email" name="email" placeholder="walkin@studio.local"></label>
          <label class="field"><span class="field__label">Payment</span><select name="method"><option value="Cash">Cash</option><option value="Terminal card">Terminal card</option><option value="Gift card">Gift card</option></select></label>
          <button class="btn btn--primary btn--block" type="submit" data-pos-submit disabled>Charge <span data-pos-button-total>$0.00</span></button>
        </form>
        <p class="muted">POS orders are tagged <em>in-store</em>, decrement inventory and appear in the orders list with payment captured.</p>
      </aside>
    </div>`;
  return adminShell(ctx, { title: 'Point of sale', subtitle: 'Brooklyn studio till — in-person sales sync with online inventory', content, active: '/admin/pos' });
}

/* ---------------------------------- settings --------------------------------- */
function settingsPage(ctx, notice = '') {
  const s = ctx.settings;
  const content = `
    ${notice ? `<div class="alert alert--ok">${icon('check', { size: 16 })} ${esc(notice)}</div>` : ''}
    <div class="cols cols--2">
      <section class="card">
        <header class="card__head"><h2>Store details</h2></header>
        <form method="post" action="/admin/settings" class="form-grid">
          <input type="hidden" name="section" value="general">
          <label class="field"><span class="field__label">Brand name</span><input type="text" name="brandName" value="${attr(s.brandName)}"></label>
          <label class="field"><span class="field__label">Tagline</span><input type="text" name="tagline" value="${attr(s.tagline)}"></label>
          <div class="field-row">
            <label class="field"><span class="field__label">Support email</span><input type="email" name="supportEmail" value="${attr(s.supportEmail)}"></label>
            <label class="field"><span class="field__label">Support phone</span><input type="text" name="supportPhone" value="${attr(s.supportPhone)}"></label>
          </div>
          <div class="field-row field-row--3">
            <label class="field"><span class="field__label">Street</span><input type="text" name="line1" value="${attr(s.address.line1)}"></label>
            <label class="field"><span class="field__label">City</span><input type="text" name="city" value="${attr(s.address.city)}"></label>
            <label class="field"><span class="field__label">State</span><input type="text" name="province" value="${attr(s.address.province)}"></label>
          </div>
          <div class="field-row field-row--3">
            <label class="field"><span class="field__label">ZIP</span><input type="text" name="zip" value="${attr(s.address.zip)}"></label>
            <label class="field"><span class="field__label">Domain</span><input type="text" name="domain" value="${attr(s.domain)}"></label>
            <label class="field"><span class="field__label">Free shipping over ($)</span><input type="number" name="freeShippingThreshold" value="${(s.freeShippingThreshold / 100).toFixed(2)}"></label>
          </div>
          <label class="field"><span class="field__label">SEO title</span><input type="text" name="seoTitle" value="${attr(s.seo.title)}"></label>
          <label class="field"><span class="field__label">SEO description</span><textarea name="seoDescription" rows="2">${esc(s.seo.description)}</textarea></label>
          <button class="btn btn--primary btn--sm" type="submit">Save store details</button>
        </form>
      </section>
      <section class="card">
        <header class="card__head"><h2>Announcement bar</h2></header>
        <form method="post" action="/admin/settings" class="form-grid">
          <input type="hidden" name="section" value="announcements">
          <label class="field"><span class="field__label">Messages (one per line)</span><textarea name="announcements" rows="5">${esc(s.announcements.join('\n'))}</textarea></label>
          <button class="btn btn--primary btn--sm" type="submit">Update announcements</button>
        </form>
        <header class="card__head"><h2>Payments &amp; checkout</h2></header>
        <form method="post" action="/admin/settings" class="form-grid">
          <input type="hidden" name="section" value="payments">
          <label class="check"><input type="checkbox" name="testMode" ${s.payments.testMode ? 'checked' : ''}><span>Sandbox / test mode (no real charges)</span></label>
          <label class="check"><input type="checkbox" name="shopPay" ${s.payments.shopPay ? 'checked' : ''}><span>Enable Shop Pay</span></label>
          <label class="check"><input type="checkbox" name="applePay" ${s.payments.applePay ? 'checked' : ''}><span>Enable Apple Pay</span></label>
          <label class="check"><input type="checkbox" name="googlePay" ${s.payments.googlePay ? 'checked' : ''}><span>Enable Google Pay</span></label>
          <label class="check"><input type="checkbox" name="giftCards" ${s.payments.giftCards ? 'checked' : ''}><span>Enable gift cards</span></label>
          <label class="check"><input type="checkbox" name="installments" ${s.payments.installments ? 'checked' : ''}><span>Enable Shop Pay Installments</span></label>
          <button class="btn btn--primary btn--sm" type="submit">Save payment settings</button>
        </form>
      </section>
    </div>
    <section class="card">
      <header class="card__head"><h2>Storefront features</h2></header>
      <form method="post" action="/admin/settings" class="form-grid">
        <input type="hidden" name="section" value="features">
        <div class="check-grid">
          ${Object.entries(s.features).map(([key, val]) => `<label class="check"><input type="checkbox" name="${attr(key)}" ${val ? 'checked' : ''}><span>${esc(key)}</span></label>`).join('')}
        </div>
        <button class="btn btn--primary btn--sm" type="submit">Save features</button>
      </form>
    </section>
    <section class="card">
      <header class="card__head"><h2>Generated emails</h2><a class="link-arrow" href="/admin/emails">Open outbox ${icon('arrow', { size: 14 })}</a></header>
      <p class="muted">Every transactional email this store produces is written to disk so you can inspect it. ${store.all('emails').length} generated so far.</p>
    </section>
    <section class="card">
      <header class="card__head"><h2>Admin account</h2></header>
      <form method="post" action="/admin/settings" class="form-grid">
        <input type="hidden" name="section" value="admin">
        <div class="field-row">
          <label class="field"><span class="field__label">Admin name</span><input type="text" name="adminName" value="${attr(s.admin.name || '')}"></label>
          <label class="field"><span class="field__label">Admin email</span><input type="email" name="adminEmail" value="${attr(s.admin.email)}"></label>
        </div>
        <label class="field"><span class="field__label">New password</span><input type="password" name="adminPassword" placeholder="Leave blank to keep current"></label>
        <button class="btn btn--primary btn--sm" type="submit">Save admin account</button>
      </form>
    </section>`;
  return adminShell(ctx, { title: 'Settings', subtitle: 'Store details, payments, features and admin access', content, active: '/admin/settings' });
}

function emailsPage(ctx, file) {
  const db = store.getDb();
  if (file) {
    const filePath = require('path').join(store.EMAIL_DIR, require('path').basename(file));
    const fs = require('fs');
    if (!fs.existsSync(filePath)) return { status: 404, html: adminShell(ctx, { title: 'Email not found', content: '<section class="card"><p>That email no longer exists.</p></section>', active: '/admin/settings' }) };
    return { raw: fs.readFileSync(filePath, 'utf8') };
  }
  const content = `
    <section class="card">
      <header class="card__head"><h2>Outbox</h2><span class="muted">${db.emails.length} emails written to data/emails</span></header>
      <div class="table-wrap"><table class="table table--admin">
        <thead><tr><th>Email</th><th>Generated</th><th></th></tr></thead>
        <tbody>${db.emails.slice().reverse().map(e => `<tr>
          <td>${esc(e.file.replace('.html', ''))}</td>
          <td class="muted">${new Date(e.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</td>
          <td><a class="btn btn--mini btn--outline" href="/admin/emails/${encodeURIComponent(e.file)}" target="_blank" rel="noopener">Open</a></td>
        </tr>`).join('') || '<tr><td colspan="3" class="muted">No emails generated yet.</td></tr>'}</tbody>
      </table></div>
    </section>`;
  return { html: adminShell(ctx, { title: 'Email outbox', subtitle: 'Transactional emails produced by the store', content, active: '/admin/settings' }) };
}

function loginView(ctx, { error = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin login · ${esc(ctx.settings.brandName)}</title><link rel="stylesheet" href="/css/admin.css"></head>
<body class="admin admin--auth">
  <div class="admin-login">
    <div class="admin-login__card">
      <span class="admin__brand"><span>VENNIX</span><em>BACK OFFICE</em></span>
      <h1>Sign in</h1>
      ${error ? `<div class="alert alert--error">${icon('info', { size: 16 })} ${esc(error)}</div>` : ''}
      <form method="post" action="/admin/login" class="form-grid">
        <label class="field"><span class="field__label">Email</span><input type="email" name="email" value="${attr(ctx.settings.admin.email)}" autocomplete="username" required></label>
        <label class="field"><span class="field__label">Password</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
        <button class="btn btn--primary btn--block" type="submit">Sign in to admin</button>
      </form>
      ${process.env.NODE_ENV !== 'production' ? `<p class="muted">Demo password (seed default): <code>vennix123</code>. Set <code>ADMIN_PASSWORD</code> for production.</p>` : ''}
      <a class="link-arrow" href="/">${icon('arrowLeft', { size: 14 })} Back to storefront</a>
    </div>
  </div>
</body></html>`;
}

/* ----------------------------------- router ---------------------------------- */
async function handle(ctx) {
  const { req, res, url, query } = ctx;
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (path === '/admin/login') {
    if (method === 'GET') return html(res, loginView(ctx));
    if (loginRateLimited(req)) {
      return html(res, loginView(ctx, { error: 'Too many sign-in attempts. Try again in a minute.' }), 429);
    }
    const body = await ctx.body();
    const s = ctx.settings;
    if (body.email === s.admin.email && auth.verifyPassword(body.password, s.admin.salt, s.admin.passwordHash)) {
      const session = auth.createSession({ type: 'admin', email: s.admin.email, name: s.admin.name || 'Admin', userAgent: req.headers['user-agent'] || '' });
      auth.setSessionCookie(res, session.id);
      store.logActivity(s.admin.email, 'admin.login', `Signed in from ${req.headers['user-agent'] || 'unknown device'}`);
      return redirect(res, '/admin');
    }
    store.logActivity('unknown', 'admin.login_failed', String(body.email || ''));
    return html(res, loginView(ctx, { error: 'Those credentials did not match our records.' }), 401);
  }
  if (path === '/admin/logout') {
    // Only allow POST to defend against CSRF via top-level navigation.
    if (method !== 'POST') return redirect(res, '/admin');
    if (ctx.adminSession) { auth.destroySession(ctx.adminSession.id); store.logActivity(ctx.adminSession.email, 'admin.logout', 'Signed out'); }
    return redirect(res, '/admin/login', 303);
  }
  if (!ctx.adminSession) return redirect(res, '/admin/login');

  const admin = ctx.adminSession;

  if (method === 'GET') {
    if (path === '/admin' || path === '/admin/') return html(res, dashboard(ctx));
    if (path === '/admin/orders') return html(res, ordersList(ctx));
    let m = path.match(/^\/admin\/orders\/([a-z]{3}_\d+)$/);
    if (m) {
      const order = store.find('orders', o => o.id === m[1]);
      if (!order) return html(res, adminShell(ctx, { title: 'Order not found', content: '<section class="card"><p>That order does not exist.</p></section>' }), 404);
      return html(res, orderDetail(ctx, order));
    }
    m = path.match(/^\/admin\/orders\/([a-z]{3}_\d+)\/packing-slip$/);
    if (m) {
      const order = store.find('orders', o => o.id === m[1]);
      if (!order) return html(res, '<p>Not found</p>', 404);
      return html(res, packingSlip(ctx, order));
    }
    if (path === '/admin/products') return html(res, productsList(ctx));
    if (path === '/admin/products/new') return html(res, productForm(ctx, null));
    m = path.match(/^\/admin\/products\/([a-z]{3}_\d+)$/);
    if (m) {
      const product = store.find('products', p => p.id === m[1]);
      if (!product) return html(res, adminShell(ctx, { title: 'Product not found', content: '<section class="card"><p>That product does not exist.</p></section>' }), 404);
      return html(res, productForm(ctx, product));
    }
    if (path === '/admin/collections') return html(res, collectionsList(ctx));
    if (path === '/admin/customers') return html(res, customersList(ctx));
    m = path.match(/^\/admin\/customers\/([a-z]{3}_\d+)$/);
    if (m) {
      const customer = store.find('customers', c => c.id === m[1]);
      if (!customer) return html(res, adminShell(ctx, { title: 'Customer not found', content: '<section class="card"><p>That customer does not exist.</p></section>' }), 404);
      return html(res, customerDetail(ctx, customer));
    }
    if (path === '/admin/discounts') return html(res, discountsPage(ctx));
    if (path === '/admin/reviews') return html(res, reviewsPage(ctx));
    if (path === '/admin/pages') return html(res, pagesEditor(ctx));
    if (path === '/admin/messages') return html(res, messagesPage(ctx));
    if (path === '/admin/pos') return html(res, posPage(ctx));
    if (path === '/admin/settings') return html(res, settingsPage(ctx));
    if (path === '/admin/emails') { const out = emailsPage(ctx); return html(res, out.html); }
    m = path.match(/^\/admin\/emails\/(.+)$/);
    if (m) {
      const out = emailsPage(ctx, decodeURIComponent(m[1]));
      if (out.raw) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(out.raw);
      }
      return html(res, out.html, out.status || 200);
    }
    return html(res, adminShell(ctx, { title: 'Not found', content: '<section class="card"><p>That admin page does not exist. Use the sidebar.</p></section>', active: '' }), 404);
  }

  if (method === 'POST') {
    const body = await ctx.body();

    let m = path.match(/^\/admin\/orders\/([a-z]{3}_\d+)\/(fulfill|unfulfill|refund|cancel|note)$/);
    if (m) {
      const order = store.find('orders', o => o.id === m[1]);
      if (!order) return redirect(res, '/admin/orders');
      if (m[2] === 'fulfill') {
        store.update('orders', order.id, {
          status: 'fulfilled', fulfillmentStatus: 'fulfilled',
          fulfillment: { carrier: body.carrier || 'UPS', tracking: body.tracking || `1Z${Date.now().toString().slice(-10)}`, fulfilledAt: new Date().toISOString() },
          timeline: [...(order.timeline || []), { at: new Date().toISOString(), label: 'Fulfilled', note: `Shipped with ${body.carrier} · ${body.tracking}` }]
        });
        const updated = store.find('orders', o => o.id === order.id);
        emails.record('shipping', updated, ctx.settings);
        store.writeEmail(`invoice-${updated.number}-${Date.now()}`, emails.orderConfirmation(updated, ctx.settings));
        store.logActivity(admin.email, 'order.fulfilled', `${order.number} via ${body.carrier}`);
      } else if (m[2] === 'unfulfill') {
        store.update('orders', order.id, { status: 'paid', fulfillmentStatus: 'unfulfilled', fulfillment: null, timeline: [...(order.timeline || []), { at: new Date().toISOString(), label: 'Fulfilment reverted', note: 'Marked unfulfilled by admin' }] });
        store.logActivity(admin.email, 'order.unfulfilled', order.number);
      } else if (m[2] === 'refund') {
        const amount = Math.round((Number(body.amount) || order.total / 100) * 100);
        if (body.restock === 'on') {
          order.items.forEach(i => {
            const found = cartLib.productFor(i.variantId);
            if (!found) return;
            found.variant.stock += i.quantity;
            found.product.inventoryQuantity = found.product.variants.reduce((s, v) => s + v.stock, 0);
            store.insert('inventoryLog', { sku: found.variant.sku, delta: i.quantity, reason: `Refund ${order.number}`, at: new Date().toISOString() });
          });
        }
        store.update('orders', order.id, {
          status: 'refunded', financialStatus: 'refunded', refundAmount: amount,
          timeline: [...(order.timeline || []), { at: new Date().toISOString(), label: 'Refunded', note: `${money(amount)} refunded${body.restock === 'on' ? ' · items restocked' : ''}` }]
        });
        const updated = store.find('orders', o => o.id === order.id);
        emails.record('refund', updated, ctx.settings);
        store.logActivity(admin.email, 'order.refunded', `${order.number} · ${money(amount)}`);
      } else if (m[2] === 'cancel') {
        order.items.forEach(i => {
          const found = cartLib.productFor(i.variantId);
          if (!found) return;
          found.variant.stock += i.quantity;
          found.product.inventoryQuantity = found.product.variants.reduce((s, v) => s + v.stock, 0);
        });
        store.update('orders', order.id, { status: 'cancelled', financialStatus: 'voided', timeline: [...(order.timeline || []), { at: new Date().toISOString(), label: 'Cancelled', note: 'Order cancelled and inventory restored' }] });
        store.logActivity(admin.email, 'order.cancelled', order.number);
      } else if (m[2] === 'note') {
        store.update('orders', order.id, { note: body.note });
        store.logActivity(admin.email, 'order.note', order.number);
      }
      return redirect(res, `/admin/orders/${order.id}`);
    }

    if (path === '/admin/products/new') {
      const handle = (body.handle || body.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const price = Math.round((Number(body.price) || 0) * 100);
      const compare = body.compareAtPrice ? Math.round(Number(body.compareAtPrice) * 100) : null;
      const product = store.insert('products', {
        handle, title: body.title, tagline: body.tagline || '', type: body.type || 'Apparel', category: body.category || 'unisex',
        vendor: ctx.settings.brandName, status: body.status || 'active', publishedAt: new Date().toISOString(),
        price, compareAtPrice: compare, currency: 'USD',
        collections: (body.collections || '').split(',').map(s => s.trim()).filter(Boolean),
        tags: (body.tags || '').split(',').map(s => s.trim()).filter(Boolean),
        badges: (body.badges || '').split(',').map(s => s.trim()).filter(Boolean),
        descriptionHtml: body.descriptionHtml || '<p>New product.</p>',
        features: (body.features || '').split('\n').map(s => s.trim()).filter(Boolean),
        materials: body.materials || '', care: body.care || '', fit: body.fit || '', fitNotes: '',
        shippingWeight: 300,
        images: [{ src: body.image1 || '/images/p-everyday-tee.jpg', alt: body.title }, ...(body.image2 ? [{ src: body.image2, alt: body.title }] : [])],
        options: [{ name: 'Colour', position: 1, values: [{ name: 'Bone', hex: '#EDE7DC', key: 'bone' }] }, { name: 'Size', position: 2, values: ['S', 'M', 'L', 'XL'].map(s => ({ name: s })) }],
        variants: ['S', 'M', 'L', 'XL'].map(size => ({
          id: `var_${handle.slice(0, 6)}_bone_${size}`.toLowerCase(), sku: `${store.getDb().settings.orderPrefix || 'VEN'}-${handle.slice(0, 3).toUpperCase()}-BO-${size}`,
          color: 'Bone', colorHex: '#EDE7DC', colorKey: 'bone', size, price, compareAtPrice: compare, stock: 12, weight: 300,
          image: body.image1 || '/images/p-everyday-tee.jpg', position: 0
        })),
        inventoryQuantity: 48, inventoryPolicy: 'deny', trackInventory: true,
        rating: { avg: 0, count: 0 },
        seo: { title: body.seoTitle || body.title, description: body.seoDescription || body.tagline || '' }
      });
      store.logActivity(admin.email, 'product.created', product.title);
      return redirect(res, `/admin/products/${product.id}`);
    }

    m = path.match(/^\/admin\/products\/([a-z]{3}_\d+)$/);
    if (m) {
      const product = store.find('products', p => p.id === m[1]);
      if (product) {
        const price = Math.round((Number(body.price) || product.price / 100) * 100);
        const compare = body.compareAtPrice ? Math.round(Number(body.compareAtPrice) * 100) : null;
        const patch = {
          title: body.title || product.title,
          handle: (body.handle || product.handle).toLowerCase().replace(/[^a-z0-9\-]/g, ''),
          tagline: body.tagline || product.tagline,
          type: body.type || product.type,
          category: body.category || product.category,
          status: body.status || product.status,
          price, compareAtPrice: compare,
          collections: body.collections === undefined ? product.collections : (body.collections || '').split(',').map(s => s.trim()).filter(Boolean),
          tags: body.tags === undefined ? product.tags : (body.tags || '').split(',').map(s => s.trim()).filter(Boolean),
          badges: body.badges === undefined ? product.badges : (body.badges || '').split(',').map(s => s.trim()).filter(Boolean),
          descriptionHtml: body.descriptionHtml || product.descriptionHtml,
          features: body.features === undefined ? product.features : (body.features || '').split('\n').map(s => s.trim()).filter(Boolean),
          materials: body.materials || product.materials,
          care: body.care || product.care,
          fit: body.fit || product.fit,
          seo: { title: body.seoTitle || product.title, description: body.seoDescription || product.seo.description }
        };
        const images = [{ src: body.image1 || product.images[0].src, alt: product.title }];
        if (body.image2) images.push({ src: body.image2, alt: product.title });
        patch.images = images;
        store.update('products', product.id, patch);

        // variant stock + price sync
        product.variants.forEach(v => {
          const key = `stock_${v.id}`;
          if (body[key] !== undefined) {
            const next = Math.max(0, Number(body[key]) || 0);
            if (next !== v.stock) store.insert('inventoryLog', { sku: v.sku, delta: next - v.stock, reason: `Manual adjustment (${admin.email})`, at: new Date().toISOString() });
            v.stock = next;
          }
          v.price = price;
          v.compareAtPrice = compare;
        });
        product.inventoryQuantity = product.variants.reduce((s, v) => s + v.stock, 0);
        store.save();
        store.logActivity(admin.email, 'product.updated', product.title);
        return html(res, productForm(ctx, store.find('products', p => p.id === product.id), { notice: 'Product saved.' }));
      }
      return redirect(res, '/admin/products');
    }

    m = path.match(/^\/admin\/products\/([a-z]{3}_\d+)\/(duplicate|delete)$/);
    if (m) {
      const product = store.find('products', p => p.id === m[1]);
      if (product && m[2] === 'duplicate') {
        const copy = JSON.parse(JSON.stringify(product));
        delete copy.id;
        copy.title = `${product.title} (copy)`;
        copy.handle = `${product.handle}-copy`;
        copy.status = 'draft';
        copy.variants = copy.variants.map(v => ({ ...v, id: `${v.id}_copy` }));
        const created = store.insert('products', copy);
        store.logActivity(admin.email, 'product.duplicated', product.title);
        return redirect(res, `/admin/products/${created.id}`);
      }
      if (product && m[2] === 'delete') {
        store.remove('products', product.id);
        store.logActivity(admin.email, 'product.deleted', product.title);
      }
      return redirect(res, '/admin/products');
    }

    m = path.match(/^\/admin\/collections\/([a-z]{3}_\d+)$/);
    if (m) {
      const collection = store.find('collections', c => c.id === m[1]);
      if (collection) {
        const handles = [].concat(body.products || []).filter(Boolean);
        store.update('collections', collection.id, { title: body.title, description: body.description, image: body.image, productHandles: handles });
        store.logActivity(admin.email, 'collection.updated', `${collection.title} (${handles.length} products)`);
        return html(res, collectionsList(ctx, 'Collection saved.'));
      }
      return redirect(res, '/admin/collections');
    }

    m = path.match(/^\/admin\/customers\/([a-z]{3}_\d+)$/);
    if (m) {
      const customer = store.find('customers', c => c.id === m[1]);
      if (customer) {
        store.update('customers', customer.id, {
          firstName: body.firstName, lastName: body.lastName, email: String(body.email).toLowerCase(),
          phone: body.phone, note: body.note,
          tags: (body.tags || '').split(',').map(s => s.trim()).filter(Boolean),
          acceptsMarketing: body.acceptsMarketing === 'on'
        });
        store.logActivity(admin.email, 'customer.updated', customer.email);
        return html(res, customerDetail(ctx, store.find('customers', c => c.id === customer.id), 'Customer saved.'));
      }
      return redirect(res, '/admin/customers');
    }

    if (path === '/admin/discounts') {
      const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9\-]/g, '');
      if (!code) return html(res, discountsPage(ctx, 'Enter a code to create a discount.'));
      store.insert('discounts', {
        code, type: body.type, value: body.type === 'fixed' ? Math.round((Number(body.value) || 0) * 100) : Number(body.value) || 0,
        minSubtotal: Math.round((Number(body.minSubtotal) || 0) * 100),
        usageLimit: body.usageLimit ? Number(body.usageLimit) : null, used: 0, active: true,
        description: body.description || '', startsAt: new Date().toISOString(), endsAt: null
      });
      store.logActivity(admin.email, 'discount.created', code);
      return html(res, discountsPage(ctx, `Discount ${code} created.`));
    }

    m = path.match(/^\/admin\/discounts\/([a-z]{3}_\d+)\/(toggle|delete)$/);
    if (m) {
      const d = store.find('discounts', x => x.id === m[1]);
      if (d && m[2] === 'toggle') { store.update('discounts', d.id, { active: !d.active }); store.logActivity(admin.email, 'discount.updated', `${d.code} → ${!d.active ? 'disabled' : 'enabled'}`); }
      if (d && m[2] === 'delete') { store.remove('discounts', d.id); store.logActivity(admin.email, 'discount.deleted', d.code); }
      return html(res, discountsPage(ctx, 'Discount updated.'));
    }

    m = path.match(/^\/admin\/reviews\/(rev_[A-Za-z0-9_]+)\/(publish|reject|delete|reply)$/);
    if (m) {
      const review = store.find('reviews', r => r.id === m[1]);
      if (review) {
        if (m[2] === 'publish') store.update('reviews', review.id, { status: 'published' });
        if (m[2] === 'reject') store.update('reviews', review.id, { status: 'rejected' });
        if (m[2] === 'reply') store.update('reviews', review.id, { reply: String(body.reply || '').slice(0, 600) });
        if (m[2] === 'delete') store.remove('reviews', review.id);
        // keep product rating in sync with published reviews
        const product = store.find('products', p => p.handle === review.productHandle);
        if (product) {
          const published = store.all('reviews').filter(r => r.productHandle === product.handle && r.status === 'published');
          if (published.length) product.rating = { avg: Math.round((published.reduce((s, r) => s + r.rating, 0) / published.length) * 10) / 10, count: Math.max(product.rating.count, published.length) };
        }
        store.save();
        store.logActivity(admin.email, `review.${m[2]}`, review.productTitle);
      }
      return html(res, reviewsPage(ctx, 'Review updated.'));
    }

    if (path === '/admin/messages/reply-all') return redirect(res, '/admin/messages');

    m = path.match(/^\/admin\/messages\/(msg_\d+)\/(reply|resolve|reopen)$/);
    if (m) {
      const message = store.find('messages', x => x.id === m[1]);
      if (message) {
        if (m[2] === 'reply' && String(body.reply || '').trim()) {
          store.update('messages', message.id, { reply: String(body.reply).slice(0, 2000), status: 'resolved', repliedAt: new Date().toISOString() });
          store.writeEmail(`support-reply-${message.id}-${Date.now()}`, commerce.emailShell(`Re: ${message.topic}`, `<h1>Re: ${esc(message.topic)}</h1><p>${esc(body.reply)}</p><p class="muted">Replying to your message: “${esc(message.message.slice(0, 200))}…”</p>`, ctx.settings));
          store.logActivity(admin.email, 'message.replied', message.email);
        }
        if (m[2] === 'resolve') store.update('messages', message.id, { status: 'resolved' });
        if (m[2] === 'reopen') store.update('messages', message.id, { status: 'open' });
      }
      return html(res, messagesPage(ctx, 'Inbox updated.'));
    }

    m = path.match(/^\/admin\/pages\/(pag_\d+)$/);
    if (m) {
      const page = store.find('pages', p => p.id === m[1]);
      if (page) {
        store.update('pages', page.id, { title: body.title, body: body.body, seo: { ...page.seo, description: body.seoDescription } });
        store.logActivity(admin.email, 'page.updated', page.handle);
        return html(res, pagesEditor(ctx, `${page.title} saved.`));
      }
      return redirect(res, '/admin/pages');
    }

    if (path === '/admin/pos/charge') {
      const lines = String(body.lines || '').split(',').map(s => s.split(':')).filter(p => p[0] && Number(p[1]) > 0);
      if (!lines.length) return html(res, posPage(ctx, 'Add at least one item to the sale.'));
      const items = [];
      for (const [variantId, qtyRaw] of lines) {
        const found = cartLib.productFor(variantId);
        if (!found) continue;
        const qty = Math.min(Number(qtyRaw), found.variant.stock);
        if (qty <= 0) continue;
        found.variant.stock -= qty;
        found.product.inventoryQuantity = found.product.variants.reduce((s, v) => s + v.stock, 0);
        store.insert('inventoryLog', { sku: found.variant.sku, delta: -qty, reason: 'In-store sale', at: new Date().toISOString() });
        items.push({
          id: store.uid('oi'), productId: found.product.id, handle: found.product.handle, title: found.product.title,
          variantId, color: found.variant.color, size: found.variant.size, sku: found.variant.sku,
          price: found.variant.price, quantity: qty, image: found.product.images[0].src, weight: found.variant.weight
        });
      }
      if (!items.length) return html(res, posPage(ctx, 'Those items just sold out — nothing to charge.'));
      const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
      const tax = commerce.taxFor({ province: 'NY', country: 'United States' }, subtotal);
      const total = subtotal + tax.amount;
      const sequence = store.all('orders').length + 1;
      const order = {
        id: store.nextId('ord'), number: `${store.getDb().settings.orderPrefix || 'VEN'}-${1000 + sequence}`, sequence,
        email: String(body.email || 'walkin@studio.local').toLowerCase(), customerId: null,
        customerName: 'In-store customer', items, subtotal, discount: null, discountAmount: 0,
        shipping: { method: 'pickup', label: 'In-store pickup', amount: 0 },
        tax: { name: tax.name, rate: tax.rate, amount: tax.amount }, total, currency: 'USD',
        status: 'fulfilled', financialStatus: 'paid', fulfillmentStatus: 'fulfilled',
        fulfillment: { carrier: 'In-store', tracking: '—', fulfilledAt: new Date().toISOString() },
        shippingAddress: { firstName: 'In-store', lastName: 'customer', line1: ctx.settings.address.line1, city: ctx.settings.address.city, province: ctx.settings.address.province, zip: ctx.settings.address.zip, country: 'United States' },
        billingAddress: {}, payment: { brand: String(body.method || 'Cash').toLowerCase().replace(/\s+/g, '_'), last4: '0000', authCode: `POS${Date.now().toString().slice(-6)}`, mode: 'in-store' },
        timeline: [{ at: new Date().toISOString(), label: 'Sold in store', note: `Paid by ${body.method} at the Brooklyn studio till` }],
        note: '', giftNote: '', tags: ['in-store'], source: 'Point of Sale', channel: 'pos',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      store.insert('orders', order);
      emails.record('confirmation', order, ctx.settings);
      store.logActivity(admin.email, 'pos.sale', `${order.number} · ${money(total)} · ${body.method}`);
      return html(res, posPage(ctx, `Sale ${order.number} recorded — ${money(total)} taken by ${body.method}.`));
    }

    if (path === '/admin/settings') {
      const section = body.section;
      if (section === 'general') {
        Object.assign(ctx.settings, {
          brandName: body.brandName, tagline: body.tagline, supportEmail: body.supportEmail, supportPhone: body.supportPhone,
          domain: body.domain,
          freeShippingThreshold: Math.round((Number(body.freeShippingThreshold) || 75) * 100),
          address: { ...ctx.settings.address, line1: body.line1, city: body.city, province: body.province, zip: body.zip },
          seo: { title: body.seoTitle, description: body.seoDescription }
        });
        store.save();
      }
      if (section === 'announcements') {
        ctx.settings.announcements = String(body.announcements || '').split('\n').map(s => s.trim()).filter(Boolean);
        store.save();
      }
      if (section === 'payments') {
        ctx.settings.payments = { ...ctx.settings.payments, testMode: body.testMode === 'on', shopPay: body.shopPay === 'on', applePay: body.applePay === 'on', googlePay: body.googlePay === 'on', giftCards: body.giftCards === 'on', installments: body.installments === 'on' };
        store.save();
      }
      if (section === 'features') {
        const features = {};
        Object.keys(ctx.settings.features).forEach(k => { features[k] = body[k] === 'on'; });
        ctx.settings.features = features;
        store.save();
      }
      if (section === 'admin') {
        ctx.settings.admin.name = body.adminName || ctx.settings.admin.name;
        ctx.settings.admin.email = body.adminEmail || ctx.settings.admin.email;
        if (body.adminPassword) {
          const pw = auth.hashPassword(body.adminPassword);
          ctx.settings.admin.passwordHash = pw.hash;
          ctx.settings.admin.salt = pw.salt;
        }
        store.save();
      }
      store.logActivity(admin.email, 'settings.updated', section || 'general');
      return html(res, settingsPage(ctx, 'Settings saved.'));
    }

    return redirect(res, '/admin');
  }

  res.writeHead(405); return res.end('Method not allowed');
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location });
  res.end();
}

function html(res, body, status = 200) {
  const buf = Buffer.from(body);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length, 'X-Robots-Tag': 'noindex' });
  res.end(buf);
}

module.exports = { handle, adminShell };
