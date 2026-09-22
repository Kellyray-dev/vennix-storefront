'use strict';
/**
 * Checkout handoff + order-help pages.
 *
 * Checkout itself is Shopify's: the storefront hands the cart over to
 * Shopify's hosted checkout (cart.checkoutUrl) where shipping, taxes,
 * discounts, payment and confirmation all happen. Orders, confirmation
 * emails and tracking live in Shopify — the pages below explain that
 * without pretending to own order data the storefront does not have.
 */
const settings = require('../settings');
const ui = require('../ui');
const { esc, attr, icon, money, breadcrumbs } = ui;

/** Empty-cart state for /checkout (the only time this route renders a page). */
function render(ctx) {
  const { cart } = ctx;
  if (!cart.count) {
    return {
      title: 'Checkout', description: 'Checkout', canonical: '/checkout', bodyClass: 'template-checkout', jsonLd: [],
      content: `<div class="wrap">
        <div class="empty-state empty-state--lg">
          ${icon('cart', { size: 32 })}
          <h1>Your cart is empty</h1>
          <p>Add something to the cart and checkout will be waiting.</p>
          <a class="btn btn--primary" href="/collections/all">Shop all products</a>
        </div>
      </div>`
    };
  }
  // Fallback if the redirect could not be issued — explicit handoff button.
  return {
    title: 'Secure checkout',
    description: `Complete your ${ui.brand()} order.`,
    canonical: '/checkout',
    bodyClass: 'template-checkout',
    jsonLd: [],
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Checkout' }])}
      <h1>Continue to secure checkout</h1>
      <p class="page-head__meta">${cart.count} ${cart.count === 1 ? 'item' : 'items'} · estimated ${money(cart.total)} — shipping, taxes and discount codes are finalised by Shopify.</p>
    </div>
    <div class="wrap">
      <div class="panel" style="max-width:560px;margin:0 auto;text-align:center">
        ${icon('lock', { size: 30 })}
        <h2>Checkout is powered by Shopify</h2>
        <p class="muted">You will complete payment, shipping and address details in the secure Shopify checkout.</p>
        <a class="btn btn--primary btn--lg btn--block" href="/checkout">${icon('lock', { size: 16 })} Continue to Shopify checkout</a>
        <a class="btn btn--ghost btn--block" href="/cart">Back to cart</a>
      </div>
    </div>`
  };
}

/**
 * Order tracking / lookup. Orders live in Shopify, so this page points
 * customers at the places Shopify owns: their confirmation email, the
 * Shopify-hosted account, and support as the human fallback.
 */
function renderTrack(ctx, { error = '' } = {}) {
  const accountUrl = settings.get().accountUrl;
  return {
    title: 'Track your order',
    description: `Track a ${ui.brand()} order placed through our Shopify checkout.`,
    canonical: '/track',
    bodyClass: 'template-track',
    jsonLd: [],
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Track order' }])}
      <h1>Track your order</h1>
      <p class="page-head__meta">Orders are placed and fulfilled through Shopify — your tracking lives with them.</p>
    </div>
    <div class="wrap track">
      <div class="panel track__form">
        <h2>Where your tracking lives</h2>
        ${error ? `<p class="form-msg form-msg--error" role="alert">${esc(error)}</p>` : ''}
        <ol class="steps">
          <li><span>1</span> Check your <strong>order confirmation email</strong> — the tracking link arrives the moment your parcel ships.</li>
          <li><span>2</span> Signed in to the store? Your order history and tracking are in your ${esc(ui.brand())} account.</li>
          <li><span>3</span> Lost the email? Support can look it up from the address you ordered with.</li>
        </ol>
        <div class="cta-row" style="margin-top:18px">
          ${accountUrl ? `<a class="btn btn--primary" href="${attr(accountUrl)}" rel="noopener">${icon('user', { size: 16 })} Open my account</a>` : ''}
          <a class="btn btn--outline" href="/pages/contact?topic=Order+status">${icon('mail', { size: 16 })} Contact support</a>
        </div>
      </div>
      <aside class="panel track__help">
        <h2>While you wait</h2>
        <ul class="summary-notes">
          <li>${icon('truck', { size: 15 })} Standard delivery is 4–6 business days</li>
          <li>${icon('clock', { size: 15 })} Orders before 2pm ET ship same day</li>
          <li>${icon('refresh', { size: 15 })} Returns window is 30 days from delivery</li>
        </ul>
        <p class="muted">Questions about a charge or a delivery? <a href="/pages/contact">Contact support</a> with the email you ordered with.</p>
      </aside>
    </div>`
  };
}

/** Legacy order-number URLs: point at Shopify instead of pretending. */
function renderLegacyOrder(ctx, number) {
  return {
    title: `Order ${number}`,
    description: `Looking for ${ui.brand()} order ${number}.`,
    canonical: '/track',
    bodyClass: 'template-order',
    jsonLd: [],
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Orders', url: '/track' }, { label: String(number) }])}
      <h1>Order ${esc(String(number))}</h1>
    </div>
    <div class="wrap">
      <div class="panel" style="max-width:640px;margin:0 auto">
        <h2>This order lives with Shopify</h2>
        <p class="muted">Order records, payment details and tracking are stored securely in Shopify, not on this storefront. Use the link in your confirmation email, ${settings.get().accountUrl ? `your <a href="${attr(settings.get().accountUrl)}" rel="noopener">account</a>, or ` : ''}<a href="/pages/contact">contact support</a> with your order number and the email you checked out with.</p>
        <div class="cta-row">
          <a class="btn btn--primary" href="/track">${icon('truck', { size: 16 })} Track an order</a>
          <a class="btn btn--ghost" href="/collections/all">Continue shopping</a>
        </div>
      </div>
    </div>`
  };
}

module.exports = { render, renderTrack, renderLegacyOrder };
