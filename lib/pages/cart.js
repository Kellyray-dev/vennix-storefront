'use strict';
/**
 * Cart page. Renders the Shopify-backed display cart from lib/cart.
 * Shipping and tax are Shopify's job — shown as calculated at checkout.
 */
const ui = require('../ui');
const { esc, attr, icon, productGrid, sectionHeader, money, trustRow } = ui;

function lineRow(line) {
  const url = line.url || '#';
  return `<li class="cart-page__line" data-line="${attr(line.id)}">
    <a class="cart-page__media" href="${attr(url)}"><img src="${attr(line.image)}" alt="${attr(line.title)}" width="200" height="240" loading="lazy"></a>
    <div class="cart-page__info">
      <div class="cart-page__info-top">
        <div>
          <h3><a href="${attr(url)}">${esc(line.title)}</a></h3>
          <p class="muted">${esc(line.color)} · ${esc(line.size)}${line.sku ? ` · ${esc(line.sku)}` : ''}</p>
          ${line.personalization && line.personalization.text ? `<p class="cart-line__monogram">${icon('spark', { size: 13 })} ${esc(line.personalization.label || 'Monogram')}: <strong>${esc(line.personalization.text)}</strong>${line.personalization.placement ? ` · ${esc(line.personalization.placement)}` : ''}${line.personalization.price ? ` — ${money(line.personalization.price)}` : ' — <em>recorded with your order</em>'}</p>` : ''}
          ${line.stock !== undefined && line.stock > 0 && line.stock <= 5 ? `<p class="cart-line__stock">Only ${line.stock} left in this size</p>` : ''}
          ${line.stock !== undefined && line.stock <= 0 ? `<p class="cart-line__stock cart-line__stock--out">Sold out — remove to continue</p>` : ''}
        </div>
        <div class="cart-page__price">
          ${line.compareAtPrice && line.compareAtPrice > line.price ? `<s>${money(line.compareAtPrice * line.quantity)}</s>` : ''}
          <strong>${money(line.price * line.quantity)}</strong>
          ${line.compareAtPrice && line.compareAtPrice > line.price ? `<em class="save-pill">Save ${money((line.compareAtPrice - line.price) * line.quantity)}</em>` : ''}
        </div>
      </div>
      <div class="cart-page__actions">
        <div class="qty" data-qty>
          <button type="button" data-line-dec="${attr(line.id)}" aria-label="Decrease quantity">${icon('minus', { size: 14 })}</button>
          <input type="number" value="${line.quantity}" min="0" max="20" inputmode="numeric" data-line-qty="${attr(line.id)}" aria-label="Quantity for ${attr(line.title)}">
          <button type="button" data-line-inc="${attr(line.id)}" aria-label="Increase quantity">${icon('plus', { size: 14 })}</button>
        </div>
        <button class="link-inline" type="button" data-wish="${attr(line.handle || '')}">${icon('heart', { size: 15 })} Save for later</button>
        <button class="link-inline" type="button" data-line-remove="${attr(line.id)}">${icon('trash', { size: 15 })} Remove</button>
      </div>
    </div>
  </li>`;
}

function summary(cart, { checkout = true } = {}) {
  return `<aside class="order-summary" data-summary>
    <h2 class="order-summary__title">Order summary</h2>
    <ul class="order-summary__lines">
      ${cart.lines.map(l => `<li>
        <span class="order-summary__thumb"><img src="${attr(l.image)}" alt="" width="64" height="80" loading="lazy"><em>${l.quantity}</em></span>
        <span class="order-summary__name"><a href="${attr(l.url || '/collections/all')}">${esc(l.title)}</a><small>${esc(l.color)} · ${esc(l.size)}</small></span>
        <span class="order-summary__amt">${money(l.price * l.quantity)}</span>
      </li>`).join('')}
    </ul>
    <form class="discount-form" data-discount-form action="/api/cart/discount" method="post">
      <label for="discount">Discount code</label>
      <div class="discount-form__row">
        <input id="discount" type="text" name="code" placeholder="Code" value="${attr(cart.discount ? cart.discount.code : '')}" ${cart.discount ? 'readonly' : ''} autocomplete="off">
        <button class="btn btn--outline btn--sm" type="submit">${cart.discount ? 'Remove' : 'Apply'}</button>
      </div>
      <p class="form-msg" data-form-msg role="status"></p>
      <p class="discount-form__hint">Codes are validated by Shopify at checkout — try <button type="button" class="link-inline" data-fill-code="WELCOME10">WELCOME10</button> if your store offers it.</p>
    </form>
    <dl class="totals">
      <div><dt>Subtotal</dt><dd data-sum-subtotal>${money(cart.subtotal)}</dd></div>
      ${cart.savings ? `<div class="totals__save"><dt>Product savings</dt><dd>−${money(cart.savings)}</dd></div>` : ''}
      ${cart.discount ? `<div class="totals__discount"><dt>Discount · ${esc(cart.discount.code)}</dt><dd>−${money(cart.discountAmount)}</dd></div>` : ''}
      <div><dt>Shipping</dt><dd data-sum-shipping>Calculated at checkout</dd></div>
      <div><dt>Taxes</dt><dd data-sum-tax>Calculated at checkout</dd></div>
      <div class="totals__grand"><dt>Estimated total</dt><dd data-sum-total>${money(cart.total)}</dd></div>
    </dl>
    ${checkout ? `<a class="btn btn--primary btn--block btn--lg" href="/checkout">${icon('lock', { size: 16 })} Secure checkout</a>` : ''}
    <ul class="pay-badges" aria-label="Accepted payment methods"><li>Visa</li><li>Mastercard</li><li>Amex</li><li>Discover</li><li>Shop&nbsp;Pay</li><li>Apple&nbsp;Pay</li><li>G&nbsp;Pay</li></ul>
    <ul class="summary-notes">
      <li>${icon('truck', { size: 15 })} Free standard shipping over ${ui.freeShipText()}</li>
      <li>${icon('refresh', { size: 15 })} 30-day returns, prepaid label included</li>
      <li>${icon('lock', { size: 15 })} Checkout, payment and order data secured by Shopify</li>
    </ul>
  </aside>`;
}

function render(ctx) {
  const { cart } = ctx;
  const products = ctx.chrome.products;
  if (!cart.count) {
    const picks = products.slice(0, 3);
    return {
      title: 'Your cart', description: `Your ${ui.brand()} cart`, canonical: '/cart', bodyClass: 'template-cart', jsonLd: [],
      content: `<div class="wrap page-head">
        ${ui.breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Cart' }])}
        <h1>Your cart</h1>
      </div>
      <div class="wrap">
        <div class="empty-state empty-state--lg">
          ${icon('cart', { size: 34 })}
          <h2>Your cart is empty</h2>
          <p>Once you add something it will live here for 60 days, on any device.</p>
          <div class="empty-state__cta">
            <a class="btn btn--primary" href="/collections/all">Shop all products</a>
            <a class="btn btn--ghost" href="/collections/bestsellers">See bestsellers</a>
          </div>
        </div>
      </div>
      <section class="sec wrap">
        ${sectionHeader({ eyebrow: 'Popular right now', title: 'Most people start here' })}
        ${productGrid(picks)}
      </section>`
    };
  }
  const inCart = new Set(cart.lines.map(l => l.handle));
  const related = products.filter(p => !inCart.has(p.handle) && !p.hidden).slice(0, 3);
  return {
    title: 'Your cart',
    description: `Review your ${ui.brand()} cart and check out securely.`,
    canonical: '/cart',
    bodyClass: 'template-cart',
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `https://${ctx.settings.domain}/` }, { '@type': 'ListItem', position: 2, name: 'Cart', item: `https://${ctx.settings.domain}/cart` }] }],
    content: `<div class="wrap page-head">
      ${ui.breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Cart' }])}
      <h1>Your cart <span class="page-head__count">${cart.count} ${cart.count === 1 ? 'item' : 'items'}</span></h1>
      ${cart.freeShipping.qualified
        ? `<p class="inline-note inline-note--ok">${icon('check', { size: 15 })} Free standard shipping unlocked.</p>`
        : `<p class="inline-note">${icon('truck', { size: 15 })} Add ${money(cart.freeShipping.remaining)} more for free standard shipping.</p>`}
    </div>
    <div class="wrap cart-page">
      <section class="cart-page__items" aria-label="Cart items">
        <ul class="cart-page__list">${cart.lines.map(lineRow).join('')}</ul>
        <div class="cart-page__extras">
          <label class="field"><span class="field__label">Gift note (optional)</span>
            <textarea name="giftNote" rows="3" placeholder="We will print this on a ${attr(ui.brand())} card and leave the prices off." data-gift-note>${esc(cart.giftNote || '')}</textarea>
          </label>
          <label class="field"><span class="field__label">Order note for the studio</span>
            <textarea name="note" rows="2" placeholder="Delivery instructions, alterations, anything else." data-order-note>${esc(cart.note || '')}</textarea>
          </label>
          <p class="form-msg" data-form-msg role="status"></p>
          <a class="link-arrow" href="/collections/all">${icon('arrowLeft', { size: 16 })} Continue shopping</a>
        </div>
        ${trustRow(ctx.settings.trustBadges)}
      </section>
      ${summary(cart)}
    </div>
    <section class="sec wrap">
      ${sectionHeader({ eyebrow: 'Don\'t forget', title: 'Add a finishing piece', copy: 'Free shipping is already unlocked — extras ship together.', link: '/collections/all', linkLabel: 'Shop all' })}
      ${productGrid(related)}
    </section>`
  };
}

module.exports = { render, summary };
