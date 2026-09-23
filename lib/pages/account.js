'use strict';
/**
 * Account pages.
 *
 * Customer accounts, order history and addresses are Shopify's: the
 * storefront links through to the Shopify-hosted account pages. The piece
 * the storefront keeps for itself is the wishlist — it is a client-side
 * (localStorage) feature and never needed a backend.
 */
const settings = require('../settings');
const ui = require('../ui');
const { nonceAttr } = require('../security');
const { esc, attr, icon, breadcrumbs, productGrid } = ui;

function accountAside(active) {
  const s = settings.get();
  const links = [
    { href: '/account', label: 'Overview', icon: 'grid', key: 'overview' },
    { href: '/account/wishlist', label: 'Saved items', icon: 'heart', key: 'wishlist' },
    { href: s.accountUrl || '/track', label: 'Account on Shopify', icon: 'external', key: 'shopify', external: true },
    { href: '/track', label: 'Track an order', icon: 'truck', key: 'track' }
  ];
  return `<aside class="account-nav">
    <div class="account-nav__card">
      <span class="review__avatar" aria-hidden="true">V</span>
      <div><strong>${esc(s.brandName)} account</strong><span>Powered by Shopify</span></div>
    </div>
    <nav aria-label="Account">
      <ul>${links.map(l => l.external
        ? `<li><a href="${attr(l.href)}" rel="noopener" class="${active === l.key ? 'is-active' : ''}">${icon(l.icon, { size: 17 })} ${esc(l.label)}</a></li>`
        : `<li><a href="${attr(l.href)}" class="${active === l.key ? 'is-active' : ''}">${icon(l.icon, { size: 17 })} ${esc(l.label)}</a></li>`
      ).join('')}</ul>
    </nav>
    <div class="account-nav__help">
      <h2 class="sr-only">Account help</h2>
      <h3>Need a hand?</h3>
      <p>${icon('mail', { size: 14 })} <a href="/pages/contact">Support</a></p>
    </div>
  </aside>`;
}

function shellAccount({ title, content, active, subtitle = '' }) {
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
      ${accountAside(active)}
      <div class="account__main">${content}</div>
    </div>`
  };
}

/** Account hub — everything order/customer-related continues on Shopify. */
function overview(ctx) {
  const s = settings.get();
  return shellAccount({
    title: 'Your account',
    active: 'overview',
    subtitle: 'Orders, addresses and details are managed securely on Shopify.',
    content: `
      <div class="panel">
        <h2>${icon('lock', { size: 18 })} Sign in, orders, addresses</h2>
        <p class="muted">${esc(s.brandName)} uses Shopify customer accounts — your order history, saved addresses, returns and payment details all live in one secure place.</p>
        <div class="cta-row">
          ${s.accountUrl ? `<a class="btn btn--primary" href="${attr(s.accountUrl)}" rel="noopener">Open my ${esc(s.brandName)} account ${icon('external', { size: 15 })}</a>` : ''}
          <a class="btn btn--outline" href="/track">${icon('truck', { size: 16 })} Track an order</a>
        </div>
      </div>
      <div class="panel">
        <h2>${icon('heart', { size: 18 })} Saved items</h2>
        <p class="muted">Your wishlist is saved on this device — no account needed.</p>
        <a class="btn btn--ghost" href="/account/wishlist">View saved items</a>
      </div>
      <div class="panel">
        <h2>${icon('mail', { size: 18 })} Need help with an order?</h2>
        <p class="muted">Support replies within one business day, Mon–Fri 9am–5pm EST.</p>
        <a class="btn btn--ghost" href="/pages/contact?topic=Order+status">Contact support</a>
      </div>`
  });
}

/** Wishlist page — client-side list rendered from the catalog index. */
function wishlist(ctx) {
  return shellAccount({
    title: 'Saved items',
    active: 'wishlist',
    subtitle: 'Saved on this device — available even without an account.',
    content: `
      <div class="grid grid--products" data-wish-grid>
        <div class="empty-state" style="grid-column:1/-1">
          ${icon('heart', { size: 30 })}
          <h2>Nothing saved yet</h2>
          <p>Tap the heart on any product to keep it here.</p>
          <a class="btn btn--primary" href="/collections/all">Browse the range</a>
        </div>
      </div>
      <script${nonceAttr()}>
        // The wishlist grid hydrates client-side from data-catalog-index +
        // localStorage (public/js/main.js). This empty state is the no-JS view.
      </script>`
  });
}

module.exports = { overview, wishlist };
