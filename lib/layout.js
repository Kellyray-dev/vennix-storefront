'use strict';
/**
 * layout.js — the storefront shell: <head>, announcement bar, mega nav,
 * footer, cart drawer, search overlay, quick-view modal and client bootstrap.
 *
 * Navigation and the product index come from Shopify (lib/shopify/catalog);
 * brand presentation comes from config/storefront.json via lib/settings.
 */
const settings = require('./settings');
const catalog = require('./shopify/catalog');
const ui = require('./ui');

const { esc, attr, icon } = ui;

function brandWord(settingsArg) {
  return `<span class="brand__word">${ui.wordMark(settingsArg)}</span>`;
}

/* --------------------------------- chrome --------------------------------- */

/**
 * Everything the shell needs that comes from Shopify. Prepared once per
 * request so header, drawer, footer and client index share one fetch pass.
 */
async function prepareChrome() {
  const [collections, products] = await Promise.all([
    catalog.getCollections().catch(() => []),
    catalog.getAllProducts().catch(() => [])
  ]);
  return { collections, products };
}

function navModel(collections = []) {
  const byHandle = h => collections.find(c => c.handle === h);
  const count = h => {
    const c = byHandle(h);
    return c ? c.productHandles.length : 0;
  };
  return [
    {
      label: 'Shop', href: '/collections/all', mega: true,
      columns: [
        { title: 'By category', links: [byHandle('women'), byHandle('men'), byHandle('active'), byHandle('essentials')].filter(Boolean).map(c => ({ label: c.title, href: `/collections/${c.handle}`, meta: `${c.productHandles.length} styles` })) },
        { title: 'By activity', links: [
          { label: 'Training & gym', href: '/collections/active?tag=training', meta: 'Wicking knits, shorts' },
          { label: 'Running', href: '/collections/active?tag=running', meta: 'Packable shells, base layers' },
          { label: 'Studio & yoga', href: '/collections/active?tag=yoga', meta: 'Seamless, compression' },
          { label: 'Everyday', href: '/collections/essentials', meta: 'Heavyweight staples' }
        ] }
      ],
      feature: { image: '/images/p-atlas-hoodie.jpg', eyebrow: 'Capsule 01', title: 'The Atlas Hoodie', copy: '480 gsm brushed-back fleece. Back in every colour.', href: '/products/atlas-heavyweight-hoodie' }
    },
    { label: 'New in', href: '/collections/new-in' },
    { label: 'Bestsellers', href: '/collections/bestsellers' },
    { label: 'Journal', href: '/blogs/journal' },
    { label: 'About', href: '/pages/about' },
    { label: 'Help', href: '/pages/faq' }
  ];
}

/**
 * Footer social list. Driven entirely by settings.socials, so a brand that runs
 * Pinterest and LinkedIn (and not Instagram) gets exactly those — no dead links.
 */
const SOCIAL_LABELS = { tiktok: 'TikTok', pinterest: 'Pinterest', linkedin: 'LinkedIn', instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook', x: 'X' };

function socialLinks(s) {
  const socials = (s && s.socials) || {};
  return Object.keys(socials)
    .filter(key => socials[key])
    .map(key => `<li><a href="${attr(socials[key])}" rel="noopener noreferrer nofollow" target="_blank">${icon(key, { size: 15 })} ${esc(SOCIAL_LABELS[key] || key)}</a></li>`)
    .join('');
}

function announcementBar(s) {
  const items = s.announcements || [];
  if (!items.length) return '';
  return `<div class="announce" data-announce>
    <div class="announce__track" data-announce-track>
      ${items.map((a, i) => `<p class="announce__item ${i === 0 ? 'is-active' : ''}" data-announce-item>${esc(a)}</p>`).join('')}
    </div>
    <button class="announce__close" type="button" data-announce-close aria-label="Dismiss announcement">${icon('close', { size: 14 })}</button>
  </div>`;
}

function header({ settings: s, cart, nav, navActive = '', solid = false }) {
  return `<a class="skip-link" href="#main">Skip to content</a>
  ${announcementBar(s)}
  <header class="site-head ${solid ? 'is-solid' : ''}" data-header>
    <div class="wrap site-head__inner">
      <button class="icon-btn site-head__burger" type="button" data-menu-open aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu">${icon('menu')}</button>
      <nav class="main-nav" aria-label="Primary">
        <ul>
          ${nav.map(item => `<li class="${item.mega ? 'has-mega' : ''} ${navActive === item.label.toLowerCase() ? 'is-active' : ''}">
            <a href="${attr(item.href)}" ${item.mega ? 'aria-haspopup="true" aria-expanded="false" data-mega-trigger' : ''}>${esc(item.label)}${item.mega ? icon('chevronDown', { size: 14 }) : ''}</a>
            ${item.mega ? `<div class="mega" data-mega>
              <div class="wrap mega__inner">
                ${item.columns.map(col => `<div class="mega__col"><h3>${esc(col.title)}</h3><ul>${col.links.map(l => `<li><a href="${attr(l.href)}"><span>${esc(l.label)}</span><em>${esc(l.meta || '')}</em></a></li>`).join('')}</ul></div>`).join('')}
                <a class="mega__feature" href="${attr(item.feature.href)}">
                  <img src="${attr(item.feature.image)}" alt="" width="420" height="420" loading="lazy">
                  <span class="mega__feature-body">
                    <em>${esc(item.feature.eyebrow)}</em>
                    <strong>${esc(item.feature.title)}</strong>
                    <span>${esc(item.feature.copy)}</span>
                    <span class="link-arrow">Shop the hoodie ${icon('arrow', { size: 15 })}</span>
                  </span>
                </a>
              </div>
            </div>` : ''}
          </li>`).join('')}
        </ul>
      </nav>
      <a class="brand" href="/" aria-label="${attr(s.brandName)} home">
        <span class="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 26 16 5l12 21"/><path d="M10.5 26 16 16.5 21.5 26"/></svg>
        </span>
        ${brandWord(s)}
      </a>
      <div class="head-actions">
        <button class="icon-btn" type="button" data-search-open aria-label="Search products">${icon('search')}</button>
        <a class="icon-btn icon-btn--account" href="/account" aria-label="Your account">
          ${icon('user')}<span class="icon-btn__label">Account</span>
        </a>
        <button class="icon-btn" type="button" data-wish-open aria-label="Wishlist">
          ${icon('heart')}<span class="icon-btn__count" data-wish-count hidden>0</span>
        </button>
        <button class="icon-btn icon-btn--cart" type="button" data-cart-open aria-label="Open cart, ${cart.count} items">
          ${icon('cart')}<span class="icon-btn__count" data-cart-count ${cart.count ? '' : 'hidden'}>${cart.count}</span>
        </button>
      </div>
    </div>
    <div class="head-progress" data-header-progress hidden><span></span></div>
  </header>
  ${mobileMenu(nav)}
  ${searchOverlay()}
  ${cartDrawer(cart, s)}
  ${quickViewModal()}
  ${wishlistPanel()}
  <div class="scroll-progress" data-scroll-progress aria-hidden="true"></div>
  <div class="toast-wrap" data-toasts aria-live="polite" aria-atomic="false"></div>
  <div class="overlay" data-overlay hidden></div>`;
}

function mobileMenu(nav) {
  return `<aside class="mob-menu" id="mobile-menu" data-menu hidden aria-label="Mobile navigation">
    <div class="mob-menu__head">
      ${brandWord()}
      <button class="icon-btn" type="button" data-menu-close aria-label="Close menu">${icon('close')}</button>
    </div>
    <nav class="mob-menu__nav">
      <ul>
        ${nav.map(item => `<li>
          <a href="${attr(item.href)}">${esc(item.label)} ${icon('chevron', { size: 16 })}</a>
          ${item.mega ? `<ul class="mob-menu__sub">${item.columns.flatMap(c => c.links).map(l => `<li><a href="${attr(l.href)}">${esc(l.label)}</a></li>`).join('')}</ul>` : ''}
        </li>`).join('')}
      </ul>
    </nav>
    <div class="mob-menu__foot">
      <a class="btn btn--outline btn--block" href="/account">Account</a>
      <a class="btn btn--ghost btn--block" href="/pages/contact">Contact support</a>
      <p class="mob-menu__note">Free shipping over ${ui.freeShipText()} · Free 30-day returns</p>
    </div>
  </aside>`;
}

function searchOverlay() {
  const trending = ['Atlas hoodie', 'Fleece jogger', 'Legging', 'Base layer', 'Windbreaker', 'Pima tee'];
  return `<div class="search-overlay" data-search hidden role="dialog" aria-modal="true" aria-label="Search">
    <div class="search-overlay__inner">
      <form class="search-form" role="search" action="/search" method="get" data-search-form>
        ${icon('search')}
        <input type="search" name="q" placeholder="Search products, journal, help…" aria-label="Search" data-search-input autocomplete="off">
        <button class="icon-btn" type="button" data-search-close aria-label="Close search">${icon('close')}</button>
      </form>
      <div class="search-overlay__body" data-search-results>
        <div class="search-overlay__hint">
          <div data-recent-searches hidden></div>
          <h3>Popular right now</h3>
          <ul class="chip-list">${trending.map(t => `<li><a class="chip" href="/search?q=${encodeURIComponent(t)}">${esc(t)}</a></li>`).join('')}</ul>
          <h3>Quick links</h3>
          <ul class="search-links">
            <li><a href="/collections/new-in">New in</a></li>
            <li><a href="/collections/active">Active</a></li>
            <li><a href="/pages/size-guide">Size guide</a></li>
            <li><a href="/pages/shipping-returns">Shipping &amp; returns</a></li>
            <li><a href="/track">Track an order</a></li>
          </ul>
        </div>
      </div>
    </div>
  </div>`;
}

function cartDrawer(cart, s) {
  const freePct = cart.freeShipping.threshold ? Math.min(100, Math.round(((cart.freeShipping.threshold - cart.freeShipping.remaining) / cart.freeShipping.threshold) * 100)) : 0;
  return `<aside class="drawer" data-cart-drawer hidden aria-label="Shopping cart" role="dialog" aria-modal="true">
    <header class="drawer__head">
      <h2>Your cart <span class="drawer__count" data-drawer-count>${cart.count} ${cart.count === 1 ? 'item' : 'items'}</span></h2>
      <button class="icon-btn" type="button" data-drawer-close aria-label="Close cart">${icon('close')}</button>
    </header>
    <div class="drawer__ship" data-ship-progress>
      <p class="drawer__ship-msg">${cart.freeShipping.qualified
        ? `${icon('check', { size: 15 })} You have earned free standard shipping.`
        : cart.freeShipping.threshold ? `You are ${ui.money(cart.freeShipping.remaining)} away from free standard shipping.` : ''}</p>
      ${cart.freeShipping.threshold ? `<div class="bar"><span style="width:${cart.count ? freePct : 0}%"></span></div>` : ''}
    </div>
    <div class="drawer__body" data-cart-body>
      ${cartBody(cart)}
    </div>
    <footer class="drawer__foot" data-cart-foot ${cart.count ? '' : 'hidden'}>
      <div class="drawer__line"><span>Subtotal</span><strong data-cart-subtotal>${ui.money(cart.subtotal)}</strong></div>
      ${cart.discount ? `<div class="drawer__line drawer__line--discount"><span>Discount · ${esc(cart.discount.code)}</span><strong>−${ui.money(cart.discountAmount)}</strong></div>` : ''}
      <p class="drawer__note">Shipping, taxes and discount codes are calculated at Shopify checkout.</p>
      <a class="btn btn--primary btn--block" href="/checkout">${icon('lock', { size: 16 })} Checkout · <span data-cart-total>${ui.money(cart.total)}</span></a>
      <button class="btn btn--ghost btn--block" type="button" data-drawer-close>Continue shopping</button>
      <ul class="pay-badges" aria-label="Accepted payment methods">
        <li>Visa</li><li>Mastercard</li><li>Amex</li><li>Discover</li><li>Shop&nbsp;Pay</li><li>Apple&nbsp;Pay</li><li>G&nbsp;Pay</li>
      </ul>
    </footer>
  </aside>`;
}

function cartBody(cart, upsellProducts = []) {
  if (!cart.count) {
    return `<div class="drawer__empty">
      ${icon('cart', { size: 30 })}
      <h3>Your cart is empty</h3>
      <p>Not sure where to start? The Atlas Hoodie is the piece most people buy first.</p>
      <a class="btn btn--primary" href="/collections/all">Shop the range</a>
      <a class="btn btn--ghost" href="/products/atlas-heavyweight-hoodie">See the Atlas Hoodie</a>
    </div>`;
  }
  return `<ul class="cart-lines">${cart.lines.map(line => cartLine(line)).join('')}</ul>
  ${upsellRail(cart, upsellProducts)}`;
}

function cartLine(line) {
  return `<li class="cart-line" data-line="${attr(line.id)}">
    <a class="cart-line__media" href="${attr(line.url || '#')}">
      <img src="${attr(line.productImage || line.image || '/images/p-everyday-tee.jpg')}" alt="${attr(line.title)}" width="140" height="140" loading="lazy">
    </a>
    <div class="cart-line__body">
      <div class="cart-line__top">
        <a class="cart-line__title" href="${attr(line.url || '#')}">${esc(line.title)}</a>
        <button class="cart-line__remove" type="button" data-line-remove="${attr(line.id)}" aria-label="Remove ${attr(line.title)}">${icon('close', { size: 15 })}</button>
      </div>
      <p class="cart-line__meta">${esc(line.color)} · ${esc(line.size)}</p>
      ${line.personalization && line.personalization.text ? `<p class="cart-line__monogram">${icon('spark', { size: 13 })} ${esc(line.personalization.label || 'Monogram')}: <strong>${esc(line.personalization.text)}</strong>${line.personalization.placement ? ` · ${esc(line.personalization.placement)}` : ''}</p>` : ''}
      ${line.stock !== undefined && line.stock <= 5 && line.stock > 0 ? `<p class="cart-line__stock">Only ${line.stock} left</p>` : ''}
      <div class="cart-line__foot">
        <div class="qty" data-qty>
          <button type="button" data-line-dec="${attr(line.id)}" aria-label="Decrease quantity">${icon('minus', { size: 14 })}</button>
          <input type="number" value="${line.quantity}" min="0" max="20" inputmode="numeric" data-line-qty="${attr(line.id)}" aria-label="Quantity for ${attr(line.title)}">
          <button type="button" data-line-inc="${attr(line.id)}" aria-label="Increase quantity">${icon('plus', { size: 14 })}</button>
        </div>
        <div class="cart-line__price">
          ${line.compareAtPrice && line.compareAtPrice > line.price ? `<s>${ui.money(line.compareAtPrice * line.quantity)}</s>` : ''}
          <strong>${ui.money(line.price * line.quantity)}</strong>
        </div>
      </div>
    </div>
  </li>`;
}

function upsellRail(cart, products = []) {
  const inCart = new Set(cart.lines.map(l => l.handle));
  const picks = products
    .filter(p => !inCart.has(p.handle) && p.inventoryQuantity > 0 && !p.digital && !p.hidden)
    .sort((a, b) => b.rating.count - a.rating.count)
    .slice(0, 3);
  if (!picks.length) return '';
  return `<section class="upsell">
    <h3 class="upsell__title">Pairs well with</h3>
    <ul class="upsell__list">${picks.map(p => {
      const v = p.variants.find(x => x.stock > 0) || p.variants[0];
      return `<li>
        <img src="${attr(p.images[0] ? p.images[0].src : '')}" alt="" width="80" height="80" loading="lazy">
        <div><a href="/products/${attr(p.handle)}">${esc(p.title)}</a><span>${ui.money(v.price)}</span></div>
        <button class="btn btn--mini" type="button" data-add-variant="${attr(v.id)}">Add</button>
      </li>`;
    }).join('')}</ul>
  </section>`;
}

function quickViewModal() {
  return `<div class="quickview" data-quickview hidden role="dialog" aria-modal="true" aria-labelledby="qv-title">
    <div class="quickview__panel" data-quickview-panel>
      <button class="icon-btn quickview__close" type="button" data-quickview-close aria-label="Close quick view">${icon('close')}</button>
      <div class="quickview__loading">Loading product…</div>
    </div>
  </div>`;
}

function wishlistPanel() {
  return `<aside class="drawer drawer--wish" data-wish-panel hidden aria-label="Wishlist" role="dialog" aria-modal="true">
    <header class="drawer__head">
      <h2>Saved items</h2>
      <button class="icon-btn" type="button" data-wish-close aria-label="Close wishlist">${icon('close')}</button>
    </header>
    <div class="drawer__body" data-wish-body></div>
  </aside>`;
}

function footer(s, collections = []) {
  const year = new Date().getFullYear();
  const footCollections = collections.filter(c => ['women', 'men', 'active', 'essentials', 'new-in'].includes(c.handle));
  return `<footer class="site-foot">
    <div class="wrap site-foot__top">
      <div class="site-foot__brand">
        ${brandWord(s)}
        <p>${esc(s.tagline)}</p>
        <form class="news-form" data-newsletter novalidate>
          <label class="news-form__label" for="foot-email">Get the studio letter — 10% off your first order</label>
          <div class="news-form__row">
            <input id="foot-email" type="email" name="email" placeholder="you@email.com" required autocomplete="email">
            <button class="btn btn--primary" type="submit">Subscribe</button>
          </div>
          <p class="news-form__msg" data-newsletter-msg role="status"></p>
        </form>
        <ul class="socials">
          ${socialLinks(s)}
        </ul>
      </div>
      <nav class="site-foot__cols" aria-label="Footer">
        <div><h3>Shop</h3><ul>${footCollections.map(c => `<li><a href="/collections/${attr(c.handle)}">${esc(c.title)}</a></li>`).join('')}<li><a href="/collections/all">All products</a></li><li><a href="/gift-cards">Gift cards</a></li></ul></div>
        <div><h3>Help</h3><ul>
          <li><a href="/pages/faq">FAQ</a></li>
          <li><a href="/pages/shipping-returns">Shipping &amp; returns</a></li>
          <li><a href="/pages/size-guide">Size guide</a></li>
          <li><a href="/track">Track an order</a></li>
          <li><a href="/pages/contact">Contact us</a></li>
          <li><a href="/account">Order history</a></li>
        </ul></div>
        <div><h3>Studio</h3><ul>
          <li><a href="/pages/about">About</a></li>
          <li><a href="/blogs/journal">The Journal</a></li>
          <li><a href="/pages/about#repairs">Repair service</a></li>
          <li><a href="/pages/accessibility">Accessibility</a></li>
        </ul></div>
      </nav>
    </div>
    <div class="wrap site-foot__badges">
      ${ui.trustRow(s.trustBadges, 'trust--foot')}
    </div>
    <div class="wrap site-foot__base">
      <p>© ${year} ${esc(s.legalName)} · ${esc(s.address.line1)}, ${esc(s.address.city)} ${esc(s.address.province)}</p>
      <ul>
        <li><a href="/pages/privacy">Privacy</a></li>
        <li><a href="/pages/terms">Terms</a></li>
        <li><a href="/pages/accessibility">Accessibility</a></li>
        <li><a href="/sitemap.xml">Sitemap</a></li>
      </ul>
      <p class="site-foot__pay">Checkout securely with Visa · Mastercard · Amex · Discover · Shop Pay · Apple Pay · Google Pay — powered by Shopify</p>
    </div>
  </footer>`;
}

/** Small product index so the client can render wishlist / recently-viewed without extra requests. */
function catalogIndexJson(products = []) {
  const index = products.filter(p => !p.hidden).map(p => ({
    handle: p.handle, title: p.title, price: p.price, compareAtPrice: p.compareAtPrice || null,
    image: p.images[0] ? p.images[0].src : '/images/p-everyday-tee.jpg',
    type: p.type, tagline: p.tagline, rating: p.rating,
    url: `/products/${p.handle}`,
    variant: (p.variants.find(v => v.stock > 0) || p.variants[0] || { id: '' }).id
  }));
  return JSON.stringify(index).replace(/</g, '\\u003c');
}

/**
 * The full page shell. `chrome` is the result of prepareChrome(); `cart` is
 * the display cart from lib/cart. Async because the demo/production data
 * sources are network-backed.
 */
async function shell({ title, description, canonical, jsonLd = [], bodyClass = '', content, settings: sArg, cart, navActive = '', noHeader = false, chrome = null, upsellProducts = [], demo = false }) {
  const s = sArg || settings.get();
  const data = chrome || await prepareChrome();
  const nav = navModel(data.collections);
  const fullTitle = title ? `${title} | ${s.brandName}` : s.seo.title;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(description || s.seo.description)}">
${canonical ? `<link rel="canonical" href="https://${attr(s.domain)}${attr(canonical)}">` : ''}
<meta property="og:site_name" content="${attr(s.brandName)}">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(description || s.seo.description)}">
<meta property="og:type" content="website">
<meta property="og:image" content="https://${attr(s.domain)}/images/hero-editorial.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#191614">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/main.css">
${jsonLd.map(j => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
</head>
<body class="${attr(bodyClass)}" data-cart-count-total="${cart.count}">
${demo ? `<div class="demo-banner" role="note"><strong>Demo mode</strong> — no Shopify store connected. Catalog and carts run against a local fixture via a mock Storefront API. Set SHOPIFY_STORE_DOMAIN to go live.</div>` : ''}
<div class="page">
  ${noHeader ? '' : header({ settings: s, cart, nav, navActive })}
  <main id="main" tabindex="-1">${content}</main>
  ${noHeader ? '' : footer(s, data.collections)}
</div>
<script type="application/json" data-catalog-index>${catalogIndexJson(data.products)}</script>
<script src="/js/main.js" defer></script>
<script src="/js/motion.js" defer></script>
</body>
</html>`;
}

module.exports = { shell, prepareChrome, navModel, header, footer, cartDrawer, cartBody, cartLine, upsellRail, catalogIndexJson };
