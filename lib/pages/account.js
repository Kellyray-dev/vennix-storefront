'use strict';
const store = require('../store');
const ui = require('../ui');
const { esc, attr, icon, breadcrumbs, money, inputField } = ui;

function accountAside(customer, active) {
  const links = [
    { href: '/account', label: 'Overview', icon: 'grid', key: 'overview' },
    { href: '/account/orders', label: 'Orders', icon: 'box', key: 'orders' },
    { href: '/account/addresses', label: 'Addresses', icon: 'pin', key: 'addresses' },
    { href: '/account/wishlist', label: 'Saved items', icon: 'heart', key: 'wishlist' },
    { href: '/account/details', label: 'Account details', icon: 'user', key: 'details' },
    { href: '/account/logout', label: 'Log out', icon: 'logout', key: 'logout' }
  ];
  return `<aside class="account-nav">
    <div class="account-nav__card">
      <span class="review__avatar" aria-hidden="true">${esc((customer.firstName || 'M').slice(0, 1))}</span>
      <div><strong>${esc(customer.firstName)} ${esc(customer.lastName)}</strong><span>${esc(customer.email)}</span></div>
      ${customer.tags && customer.tags.includes('vip') ? '<em class="pill pill--vip">VIP</em>' : ''}
    </div>
    <nav aria-label="Account">
      <ul>${links.map(l => l.key === 'logout'
        ? `<li><form method="post" action="/account/logout" class="account-nav__logout"><button type="submit" class="${active === l.key ? 'is-active' : ''}">${icon(l.icon, { size: 17 })} ${esc(l.label)}</button></form></li>`
        : `<li><a href="${attr(l.href)}" class="${active === l.key ? 'is-active' : ''}">${icon(l.icon, { size: 17 })} ${esc(l.label)}</a></li>`
      ).join('')}</ul>
    </nav>
    <div class="account-nav__help">
      <h3>Need a hand?</h3>
      <p>${icon('mail', { size: 14 })} <a href="/pages/contact">Support</a>${store.getDb().settings.supportPhone ? `<br>${icon('phone', { size: 14 })} ${esc(store.getDb().settings.supportPhone)}` : ''}</p>
    </div>
  </aside>`;
}

function shellAccount(ctx, { title, content, customer, active, subtitle = '' }) {
  const c = customer || ctx.customer;
  return {
    title,
    description: `${title} — ${ui.brand()} account`,
    canonical: '/account',
    bodyClass: 'template-account',
    jsonLd: [],
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Account', url: '/account' }, ...(active === 'overview' ? [] : [{ label: title }])])}
      <h1>${esc(title)}</h1>
      ${subtitle ? `<p class="page-head__meta">${esc(subtitle)}</p>` : ''}
    </div>
    <div class="wrap account">
      ${accountAside(c, active)}
      <div class="account__main">${content}</div>
    </div>`
  };
}

function loginPage(ctx, { mode = 'login', errors = {}, values = {}, notice = '' } = {}) {
  const settings = ctx.settings;
  return {
    title: mode === 'register' ? 'Create account' : 'Log in',
    description: `Log in to your ${ui.brand()} account to track orders, manage addresses and save sizes.`,
    canonical: '/account/login',
    bodyClass: 'template-account template-account--auth',
    jsonLd: [],
    content: `<div class="auth">
      <div class="auth__panel">
        <a class="brand brand--stack" href="/">${ui.wordMark()}</a>
        <div class="auth__tabs" role="tablist">
          <a role="tab" class="${mode === 'login' ? 'is-active' : ''}" href="/account/login" aria-selected="${mode === 'login'}">Log in</a>
          <a role="tab" class="${mode === 'register' ? 'is-active' : ''}" href="/account/register" aria-selected="${mode === 'register'}">Create account</a>
        </div>
        ${notice ? `<div class="alert alert--ok" role="status">${icon('check', { size: 18 })}<div>${esc(notice)}</div></div>` : ''}
        ${Object.keys(errors).length ? `<div class="alert alert--error" role="alert">${icon('info', { size: 18 })}<div>${esc(Object.values(errors)[0])}</div></div>` : ''}
        ${mode === 'login' ? `
          <form method="post" action="/account/login" class="auth__form">
            ${ctx.query.return ? `<input type="hidden" name="return" value="${attr(ctx.query.return)}">` : ''}
            ${inputField({ name: 'email', label: 'Email address', type: 'email', required: true, value: values.email || '', autocomplete: 'email', error: errors.email })}
            ${inputField({ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password', error: errors.password })}
            <div class="auth__row">
              <label class="check"><input type="checkbox" name="remember" checked><span>Keep me signed in</span></label>
              <a class="link-inline" href="/account/recover">Forgot password?</a>
            </div>
            <button class="btn btn--primary btn--block btn--lg" type="submit">${icon('lock', { size: 16 })} Log in</button>
          </form>
          <div class="auth__demo">
            <strong>Demo account</strong>
            <p>Email <code>hannah.b@example.com</code> · password <code>password123</code></p>
            <button class="btn btn--mini btn--outline" type="button" data-fill-demo>Fill demo credentials</button>
          </div>`
        : `
          <form method="post" action="/account/register" class="auth__form">
            <div class="field-row">
              ${inputField({ name: 'firstName', label: 'First name', required: true, value: values.firstName || '', autocomplete: 'given-name', error: errors.firstName })}
              ${inputField({ name: 'lastName', label: 'Last name', required: true, value: values.lastName || '', autocomplete: 'family-name', error: errors.lastName })}
            </div>
            ${inputField({ name: 'email', label: 'Email address', type: 'email', required: true, value: values.email || '', autocomplete: 'email', error: errors.email })}
            ${inputField({ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'new-password', error: errors.password, hint: 'At least 8 characters.' })}
            ${inputField({ name: 'passwordConfirm', label: 'Confirm password', type: 'password', required: true, autocomplete: 'new-password', error: errors.passwordConfirm })}
            <label class="check"><input type="checkbox" name="acceptsMarketing" checked><span>Email me new pieces and restocks (10% off your first order)</span></label>
            <button class="btn btn--primary btn--block btn--lg" type="submit">Create account</button>
          </form>`}
        <p class="auth__foot">${settings.payments.testMode ? 'Sandbox store — accounts use demo data only.' : ''} <a href="/collections/all">Continue shopping</a></p>
      </div>
      <div class="auth__aside">
        <img src="/images/lookbook-1.jpg" alt="" width="900" height="1100" loading="lazy">
        <div class="auth__aside-body">
          <h2>Members get more</h2>
          <ul class="mini-list">
            <li>${icon('check', { size: 15 })} Order tracking and one-tap reorders</li>
            <li>${icon('check', { size: 15 })} Saved sizes for faster checkout</li>
            <li>${icon('check', { size: 15 })} Early access to restocks</li>
            <li>${icon('check', { size: 15 })} 10% welcome code on sign-up</li>
          </ul>
        </div>
      </div>
    </div>`
  };
}

function overview(ctx, customer) {
  const orders = store.all('orders').filter(o => o.customerId === customer.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const spent = orders.filter(o => o.status !== 'refunded').reduce((s, o) => s + o.total, 0);
  const points = Math.floor(spent / 100);
  const recent = orders[0];
  const content = `
    <div class="stat-row">
      <div class="stat"><span>Orders</span><strong>${orders.length}</strong><em>since ${new Date(customer.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</em></div>
      <div class="stat"><span>Lifetime spend</span><strong>${money(spent)}</strong><em>${orders.filter(o => o.status === 'refunded').length} refunded</em></div>
      <div class="stat"><span>${esc(ui.brand())} points</span><strong>${points}</strong><em>100 points = $1 credit</em></div>
      <div class="stat"><span>Reward tier</span><strong>${spent > 30000 ? 'Gold' : spent > 15000 ? 'Silver' : 'Member'}</strong><em>${spent > 30000 ? 'Free express shipping' : `Spend ${money(Math.max(0, 15000 - spent))} for Silver`}</em></div>
    </div>
    ${recent ? `<section class="panel">
      <header class="panel__head"><h2>Latest order</h2><a class="link-arrow" href="/account/orders">All orders ${icon('arrow', { size: 15 })}</a></header>
      <div class="order-card">
        <div class="order-card__head">
          <div><strong>${esc(recent.number)}</strong><span class="muted"> · ${new Date(recent.createdAt).toDateString()}</span></div>
          <div><span class="pill pill--${attr(recent.status)}">${esc(recent.status)}</span> <span class="pill pill--${attr(recent.fulfillmentStatus)}">${esc(recent.fulfillmentStatus)}</span></div>
        </div>
        <ul class="order-card__items">
          ${recent.items.map(i => `<li><img src="${attr(i.image)}" alt="" width="60" height="72" loading="lazy"><span>${esc(i.title)}<small>${esc(i.color)} · ${esc(i.size)} · ×${i.quantity}</small></span></li>`).join('')}
        </ul>
        <div class="order-card__foot">
          <span>Total <strong>${money(recent.total)}</strong></span>
          <div class="panel__actions">
            ${recent.fulfillment ? `<a class="btn btn--outline btn--sm" href="/orders/${attr(recent.number)}?email=${encodeURIComponent(recent.email)}">${icon('truck', { size: 15 })} Track</a>` : ''}
            <button class="btn btn--ghost btn--sm" type="button" data-reorder="${attr(recent.id)}">${icon('refresh', { size: 15 })} Reorder</button>
            <a class="btn btn--primary btn--sm" href="/account/orders/${attr(recent.id)}">View order</a>
          </div>
        </div>
      </div>
    </section>` : ''}
    <section class="panel">
      <header class="panel__head"><h2>Saved items</h2><a class="link-arrow" href="/account/wishlist">Open wishlist ${icon('arrow', { size: 15 })}</a></header>
      <p class="muted">Items you heart on the storefront are saved to this browser. <button class="link-inline" type="button" data-wish-open>View saved items</button></p>
    </section>
    <section class="panel">
      <header class="panel__head"><h2>Default address</h2><a class="link-arrow" href="/account/addresses">Manage ${icon('arrow', { size: 15 })}</a></header>
      ${customer.addresses.length ? `<address>${esc(customer.addresses[0].firstName)} ${esc(customer.addresses[0].lastName)}<br>${esc(customer.addresses[0].line1)}<br>${esc(customer.addresses[0].city)}, ${esc(customer.addresses[0].province)} ${esc(customer.addresses[0].zip)}</address>` : '<p class="muted">No address saved yet.</p>'}
    </section>`;
  return shellAccount(ctx, { title: `Welcome back, ${customer.firstName}`, content, customer, active: 'overview', subtitle: 'Your orders, addresses and rewards in one place.' });
}

function orderList(ctx, customer) {
  const orders = store.all('orders').filter(o => o.customerId === customer.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const content = orders.length ? `<section class="panel panel--table">
    <header class="panel__head"><h2>${orders.length} orders</h2><span class="muted">Newest first</span></header>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Status</th><th>Total</th><th></th></tr></thead>
        <tbody>${orders.map(o => `<tr>
          <td><strong>${esc(o.number)}</strong></td>
          <td>${new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
          <td>${o.items.reduce((s, i) => s + i.quantity, 0)} items</td>
          <td><span class="pill pill--${attr(o.status)}">${esc(o.status)}</span> <span class="pill pill--${attr(o.fulfillmentStatus)}">${esc(o.fulfillmentStatus)}</span></td>
          <td>${money(o.total)}</td>
          <td class="table__actions">
            <a class="btn btn--outline btn--mini" href="/account/orders/${attr(o.id)}">View</a>
            <button class="btn btn--ghost btn--mini" type="button" data-reorder="${attr(o.id)}">Reorder</button>
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </section>` : `<div class="empty-state">
      ${icon('box', { size: 30 })}
      <h2>No orders yet</h2>
      <p>Your order history will appear here once you place your first order.</p>
      <a class="btn btn--primary" href="/collections/all">Start shopping</a>
    </div>`;
  return shellAccount(ctx, { title: 'Order history', content, customer, active: 'orders' });
}

function addresses(ctx, customer, { notice = '', errors = {} } = {}) {
  const content = `
    ${notice ? `<div class="alert alert--ok" role="status">${icon('check', { size: 18 })}<div>${esc(notice)}</div></div>` : ''}
    <section class="panel">
      <header class="panel__head"><h2>Saved addresses</h2><span class="muted">${customer.addresses.length} on file</span></header>
      <ul class="address-list">
        ${customer.addresses.map(a => `<li class="address-card">
          <div>
            <strong>${esc(a.label || 'Address')}${a.isDefault ? '<em class="pill pill--ok">Default</em>' : ''}</strong>
            <address>${esc(a.firstName)} ${esc(a.lastName)}<br>${esc(a.line1)}${a.line2 ? `<br>${esc(a.line2)}` : ''}<br>${esc(a.city)}, ${esc(a.province)} ${esc(a.zip)}<br>${esc(a.country)}</address>
          </div>
          <div class="panel__actions">
            ${a.isDefault ? '' : `<form method="post" action="/account/addresses/default"><input type="hidden" name="addressId" value="${attr(a.id)}"><button class="btn btn--outline btn--mini" type="submit">Make default</button></form>`}
            <form method="post" action="/account/addresses/delete" onsubmit="return confirm('Remove this address?')"><input type="hidden" name="addressId" value="${attr(a.id)}"><button class="btn btn--ghost btn--mini" type="submit">Remove</button></form>
          </div>
        </li>`).join('') || '<li class="muted">No addresses saved yet.</li>'}
      </ul>
    </section>
    <section class="panel">
      <header class="panel__head"><h2>Add an address</h2></header>
      <form method="post" action="/account/addresses" class="form-grid">
        <div class="field-row">
          ${inputField({ name: 'firstName', label: 'First name', required: true, value: customer.firstName })}
          ${inputField({ name: 'lastName', label: 'Last name', required: true, value: customer.lastName })}
        </div>
        ${inputField({ name: 'line1', label: 'Address', required: true, error: errors.line1 })}
        ${inputField({ name: 'line2', label: 'Apartment, suite (optional)' })}
        <div class="field-row field-row--3">
          ${inputField({ name: 'city', label: 'City', required: true })}
          <label class="field"><span class="field__label">State</span><select name="province">${require('../commerce').STATES.map(s => `<option value="${attr(s)}">${esc(s)}</option>`).join('')}</select></label>
          ${inputField({ name: 'zip', label: 'ZIP code', required: true })}
        </div>
        ${inputField({ name: 'label', label: 'Label', placeholder: 'Home, Work…' })}
        <label class="check"><input type="checkbox" name="isDefault"><span>Set as default address</span></label>
        <button class="btn btn--primary" type="submit">Save address</button>
      </form>
    </section>`;
  return shellAccount(ctx, { title: 'Addresses', content, customer, active: 'addresses' });
}

function details(ctx, customer, { notice = '', errors = {} } = {}) {
  const content = `
    ${notice ? `<div class="alert alert--ok" role="status">${icon('check', { size: 18 })}<div>${esc(notice)}</div></div>` : ''}
    <section class="panel">
      <header class="panel__head"><h2>Your details</h2></header>
      <form method="post" action="/account/details" class="form-grid">
        <div class="field-row">
          ${inputField({ name: 'firstName', label: 'First name', required: true, value: customer.firstName, error: errors.firstName })}
          ${inputField({ name: 'lastName', label: 'Last name', required: true, value: customer.lastName, error: errors.lastName })}
        </div>
        ${inputField({ name: 'email', label: 'Email address', type: 'email', required: true, value: customer.email, error: errors.email })}
        ${inputField({ name: 'phone', label: 'Phone', type: 'tel', value: customer.phone || '' })}
        <label class="check"><input type="checkbox" name="acceptsMarketing" ${customer.acceptsMarketing ? 'checked' : ''}><span>Email me new pieces and restocks</span></label>
        <button class="btn btn--primary" type="submit">Save changes</button>
      </form>
    </section>
    <section class="panel">
      <header class="panel__head"><h2>Password</h2></header>
      <form method="post" action="/account/password" class="form-grid">
        ${inputField({ name: 'currentPassword', label: 'Current password', type: 'password', required: true, error: errors.currentPassword })}
        <div class="field-row">
          ${inputField({ name: 'newPassword', label: 'New password', type: 'password', required: true, error: errors.newPassword, hint: 'At least 8 characters.' })}
          ${inputField({ name: 'confirmPassword', label: 'Confirm new password', type: 'password', required: true, error: errors.confirmPassword })}
        </div>
        <button class="btn btn--primary" type="submit">Update password</button>
      </form>
    </section>
    <section class="panel">
      <header class="panel__head"><h2>Marketing</h2></header>
      <p class="muted">You are currently <strong>${customer.acceptsMarketing ? 'subscribed' : 'not subscribed'}</strong> to the studio letter.</p>
      <form method="post" action="/account/marketing">
        <input type="hidden" name="subscribe" value="${customer.acceptsMarketing ? 'off' : 'on'}">
        <button class="btn btn--outline btn--sm" type="submit">${customer.acceptsMarketing ? 'Unsubscribe' : 'Subscribe'}</button>
      </form>
    </section>
    <section class="panel panel--danger">
      <header class="panel__head"><h2>Data &amp; privacy</h2></header>
      <p class="muted">Request an export of your data or delete your account. We respond within 30 days, as set out in the <a href="/pages/privacy">privacy policy</a>.</p>
      <div class="panel__actions">
        <a class="btn btn--ghost btn--sm" href="/pages/contact?topic=Data+request">Request data export</a>
        <a class="btn btn--ghost btn--sm" href="/pages/contact?topic=Delete+account">Delete my account</a>
      </div>
    </section>`;
  return shellAccount(ctx, { title: 'Account details', content, customer, active: 'details' });
}

function wishlist(ctx, customer) {
  const content = `<section class="panel">
    <header class="panel__head"><h2>Saved items</h2><span class="muted">Stored in this browser</span></header>
    <div data-wish-grid class="grid grid--products"></div>
    <script type="application/json" data-catalog-index>${JSON.stringify(store.all('products').map(p => ({ handle: p.handle, title: p.title, price: p.price, compareAtPrice: p.compareAtPrice, image: p.images[0].src, type: p.type, tagline: p.tagline, rating: p.rating, url: `/products/${p.handle}`, variant: (p.variants.find(v => v.stock > 0) || p.variants[0]).id })))}</script>
  </section>`;
  return shellAccount(ctx, { title: 'Saved items', content, customer, active: 'wishlist', subtitle: 'Heart anything on the storefront and it lands here.' });
}

function orderDetail(ctx, customer, order) {
  const content = `<section class="panel">
      <header class="panel__head">
        <h2>Order ${esc(order.number)}</h2>
        <span><span class="pill pill--${attr(order.status)}">${esc(order.status)}</span> <span class="pill pill--${attr(order.fulfillmentStatus)}">${esc(order.fulfillmentStatus)}</span></span>
      </header>
      <p class="muted">Placed ${new Date(order.createdAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} · ${order.items.reduce((s, i) => s + i.quantity, 0)} items</p>
      <ul class="order-items">
        ${order.items.map(i => `<li>
          <img src="${attr(i.image)}" alt="" width="90" height="110" loading="lazy">
          <div><a href="/products/${attr(i.handle)}"><strong>${esc(i.title)}</strong></a><p class="muted">${esc(i.color)} · ${esc(i.size)} · Qty ${i.quantity}</p>
          <button class="link-inline" type="button" data-reorder-item="${attr(i.variantId)}">${icon('refresh', { size: 14 })} Buy again</button></div>
          <span class="order-items__price">${money(i.price * i.quantity)}</span>
        </li>`).join('')}
      </ul>
      <dl class="totals">
        <div><dt>Subtotal</dt><dd>${money(order.subtotal)}</dd></div>
        ${order.discount ? `<div class="totals__discount"><dt>Discount · ${esc(order.discount.code)}</dt><dd>−${money(order.discountAmount)}</dd></div>` : ''}
        <div><dt>Shipping</dt><dd>${order.shipping.amount === 0 ? 'Free' : money(order.shipping.amount)}</dd></div>
        <div><dt>${esc(order.tax.name)}</dt><dd>${money(order.tax.amount)}</dd></div>
        <div class="totals__grand"><dt>Total</dt><dd>${money(order.total)}</dd></div>
      </dl>
      <div class="panel__actions">
        <a class="btn btn--outline btn--sm" href="/orders/${attr(order.number)}?email=${encodeURIComponent(order.email)}">${icon('truck', { size: 15 })} Tracking page</a>
        <button class="btn btn--ghost btn--sm" type="button" data-reorder="${attr(order.id)}">${icon('refresh', { size: 15 })} Reorder everything</button>
        <a class="btn btn--ghost btn--sm" href="/pages/contact?topic=Return+or+exchange&order=${attr(order.number)}">${icon('mail', { size: 15 })} Request a return</a>
      </div>
    </section>
    <section class="panel">
      <h2>Delivery address</h2>
      <address>${esc(order.shippingAddress.firstName)} ${esc(order.shippingAddress.lastName)}<br>${esc(order.shippingAddress.line1)}<br>${esc(order.shippingAddress.city)}, ${esc(order.shippingAddress.province)} ${esc(order.shippingAddress.zip)}</address>
    </section>`;
  return shellAccount(ctx, { title: order.number, content, customer, active: 'orders' });
}

function recoverPage(ctx, { notice = '', error = '', link = '' } = {}) {
  return {
    title: 'Reset your password',
    description: `Reset your ${ui.brand()} account password.`,
    canonical: '/account/recover',
    bodyClass: 'template-account template-account--auth',
    jsonLd: [],
    content: `<div class="auth auth--narrow">
      <div class="auth__panel">
        <a class="brand brand--stack" href="/">${ui.wordMark()}</a>
        <h2 class="auth__title">Reset your password</h2>
        <p class="muted">Enter the email on your account and we will send a reset link.</p>
        ${notice ? `<div class="alert alert--ok" role="status">${icon('check', { size: 18 })}<div><strong>Email sent.</strong><p>${esc(notice)}</p>${link ? `<p><a href="${attr(link)}">Open the reset link</a> <em>(shown here because this is a sandbox back office)</em></p>` : ''}</div></div>` : ''}
        ${error ? `<div class="alert alert--error" role="alert">${icon('info', { size: 18 })}<div>${esc(error)}</div></div>` : ''}
        <form method="post" action="/account/recover" class="auth__form">
          ${inputField({ name: 'email', label: 'Email address', type: 'email', required: true })}
          <button class="btn btn--primary btn--block" type="submit">Send reset link</button>
        </form>
        <p class="auth__foot"><a href="/account/login">Back to log in</a></p>
      </div>
    </div>`
  };
}

function resetPage(ctx, { token, customer, notice = '', error = '' } = {}) {
  return {
    title: 'Choose a new password',
    description: `Set a new password for your ${ui.brand()} account.`,
    canonical: '/account/reset',
    bodyClass: 'template-account template-account--auth',
    jsonLd: [],
    content: `<div class="auth auth--narrow">
      <div class="auth__panel">
        <a class="brand brand--stack" href="/">${ui.wordMark()}</a>
        <h2 class="auth__title">Choose a new password</h2>
        ${notice ? `<div class="alert alert--ok" role="status">${icon('check', { size: 18 })}<div>${esc(notice)} <a href="/account/login">Log in</a></div></div>` : ''}
        ${error ? `<div class="alert alert--error" role="alert">${icon('info', { size: 18 })}<div>${esc(error)}</div></div>` : ''}
        ${customer && token ? `<form method="post" action="/account/reset" class="auth__form">
          <input type="hidden" name="token" value="${attr(token)}">
          ${inputField({ name: 'password', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters.' })}
          ${inputField({ name: 'passwordConfirm', label: 'Confirm new password', type: 'password', required: true })}
          <button class="btn btn--primary btn--block" type="submit">Save new password</button>
        </form>` : `<p><a class="btn btn--outline" href="/account/recover">Request a new link</a></p>`}
      </div>
    </div>`
  };
}

module.exports = { loginPage, overview, orderList, addresses, details, wishlist, orderDetail, recoverPage, resetPage };
