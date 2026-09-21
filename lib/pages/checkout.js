'use strict';
const store = require('../store');
const ui = require('../ui');
const commerce = require('../commerce');
const { esc, attr, icon, trustRow, money, breadcrumbs } = ui;

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'France', 'Japan'];

function stepper(step) {
  const steps = [
    { n: 1, label: 'Contact' }, { n: 2, label: 'Delivery' }, { n: 3, label: 'Payment' }
  ];
  return `<ol class="checkout-steps" aria-label="Checkout progress">
    ${steps.map(s => `<li class="${s.n < step ? 'is-done' : s.n === step ? 'is-current' : ''}"><span>${s.n < step ? icon('check', { size: 14 }) : s.n}</span>${esc(s.label)}</li>`).join('')}
  </ol>`;
}

function checkoutSummary(cart, ctx) {
  return `<aside class="order-summary order-summary--checkout">
    <h2 class="order-summary__title">Your order <span>${cart.count} ${cart.count === 1 ? 'item' : 'items'}</span></h2>
    <ul class="order-summary__lines">
      ${cart.lines.map(l => `<li>
        <span class="order-summary__thumb"><img src="${attr(l.image)}" alt="" width="64" height="80" loading="lazy"><em>${l.quantity}</em></span>
        <span class="order-summary__name"><a href="${attr(l.url || '/collections/all')}">${esc(l.title)}</a><small>${esc(l.color)} · ${esc(l.size)}</small>${l.personalization && l.personalization.text ? `<small class="order-summary__mono">${icon('spark', { size: 12 })} ${esc(l.personalization.label)}: <strong>${esc(l.personalization.text)}</strong></small>` : ''}</span>
        <span class="order-summary__amt">${money(l.price * l.quantity)}</span>
      </li>`).join('')}
    </ul>
    <form class="discount-form" data-discount-form action="/api/cart/discount" method="post">
      <label for="discount">Discount code</label>
      <div class="discount-form__row">
        <input id="discount" type="text" name="code" placeholder="WELCOME10" value="${attr(cart.discount ? cart.discount.code : '')}" ${cart.discount ? 'readonly' : ''}>
        <button class="btn btn--outline btn--sm" type="submit">${cart.discount ? 'Remove' : 'Apply'}</button>
      </div>
      <p class="form-msg" data-form-msg role="status"></p>
    </form>
    <dl class="totals" data-quote>
      <div><dt>Subtotal</dt><dd data-sum-subtotal>${money(cart.subtotal)}</dd></div>
      ${cart.savings ? `<div class="totals__save"><dt>Product savings</dt><dd>−${money(cart.savings)}</dd></div>` : ''}
      ${cart.discount ? `<div class="totals__discount"><dt>Discount · ${esc(cart.discount.code)}</dt><dd>−${money(cart.discountAmount)}</dd></div>` : ''}
      <div><dt>Shipping</dt><dd data-sum-shipping>${cart.shipping.amount === 0 ? 'Free' : money(cart.shipping.amount)}</dd></div>
      <div><dt data-tax-name>${esc(cart.tax.name)}</dt><dd data-sum-tax>${money(cart.tax.amount)}</dd></div>
      <div class="totals__grand"><dt>Total</dt><dd data-sum-total>${money(cart.total)}</dd></div>
    </dl>
    <p class="muted">${cart.tax.amount ? `Tax is calculated on the destination address (${esc(cart.tax.name)}).` : 'No tax in the selected region.'}</p>
    <ul class="summary-notes">
      <li>${icon('lock', { size: 15 })} Encrypted checkout · PCI-DSS SAQ-A</li>
      <li>${icon('refresh', { size: 15 })} 30-day free returns${ctx.customer ? ' · saved to your account' : ''}</li>
      <li>${icon('gift', { size: 15 })} Gift note available on the cart page</li>
    </ul>
  </aside>`;
}

function render(ctx, { errors = {}, values = {}, stage = 2 } = {}) {
  const { cart, settings, customer, rawCart } = ctx;
  // Idempotency token: prevents double-submit / back-button resubmits from
  // creating duplicate orders.
  const crypto = require('crypto');
  if (rawCart) {
    rawCart._checkoutToken = rawCart._checkoutToken || crypto.randomBytes(12).toString('base64url');
  }
  const lastAddress = customer && customer.addresses && customer.addresses[0] ? customer.addresses[0] : {};
  const v = { firstName: '', lastName: '', line1: '', line2: '', city: '', province: 'NJ', zip: '', country: 'United States', phone: '', email: (customer && customer.email) || cart.email || '', note: cart.note || '', giftNote: cart.giftNote || '', ...lastAddress, ...values };
  const err = name => errors[name] ? `<span class="field__error">${esc(errors[name])}</span>` : '';
  const hasError = Object.keys(errors).length;

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

  return {
    title: 'Secure checkout',
    description: `Complete your ${ui.brand()} order.`,
    canonical: '/checkout',
    bodyClass: 'template-checkout',
    jsonLd: [],
    content: `
    <div class="checkout-topbar">
      <div class="wrap checkout-topbar__inner">
        <a class="brand brand--sm" href="/">${ui.wordMark()}</a>
        <span class="checkout-topbar__secure">${icon('lock', { size: 15 })} Secure checkout</span>
      </div>
    </div>
    <div class="wrap checkout">
      <form class="checkout__main" data-checkout-form action="/checkout" method="post" novalidate>
        <input type="hidden" name="_checkoutToken" value="${attr(rawCart && rawCart._checkoutToken || '')}">
        ${stepper(stage)}
        ${hasError ? `<div class="alert alert--error" role="alert">${icon('info', { size: 18 })}<div><strong>Please fix the highlighted fields.</strong><p>${esc(Object.values(errors)[0])}</p></div></div>` : ''}
        <div class="sandbox-banner">
          ${icon('shield', { size: 18 })}
          <div>
            <strong>Sandbox payment gateway</strong>
            <p>No real money moves. Use test card <code>4242 4242 4242 4242</code>, any future expiry, any CVC. Card <code>4000 0000 0000 0002</code> simulates a decline.</p>
            <button class="btn btn--mini btn--outline" type="button" data-fill-test-card>Fill test card</button>
          </div>
        </div>

        <section class="checkout-card">
          <header class="checkout-card__head">
            <h2><span class="step-dot">1</span> Contact</h2>
            ${customer ? `<span class="signed-in">${icon('check', { size: 14 })} Signed in as ${esc(customer.email)}</span>` : `<a class="link-inline" href="/account/login?return=/checkout">${icon('user', { size: 15 })} Log in for faster checkout</a>`}
          </header>
          <div class="checkout-card__body">
            ${ui.inputField({ name: 'email', label: 'Email address', type: 'email', required: true, value: v.email, autocomplete: 'email', error: errors.email, hint: 'Order confirmation and tracking go here.' })}
            ${ui.inputField({ name: 'phone', label: 'Phone (for delivery updates)', type: 'tel', value: v.phone, autocomplete: 'tel', error: errors.phone })}
            <label class="check check--inline"><input type="checkbox" name="acceptsMarketing" ${(!customer || customer.acceptsMarketing) ? 'checked' : ''}><span>Email me new pieces and restocks (twice a month)</span></label>
          </div>
        </section>

        <section class="checkout-card">
          <header class="checkout-card__head">
            <h2><span class="step-dot">2</span> Delivery address</h2>
            ${customer && customer.addresses.length ? `<button class="link-inline" type="button" data-use-saved-address>${icon('pin', { size: 15 })} Use saved address</button>` : ''}
          </header>
          <div class="checkout-card__body">
            <div class="field-row">
              ${ui.inputField({ name: 'firstName', label: 'First name', required: true, value: v.firstName, autocomplete: 'given-name', error: errors.firstName })}
              ${ui.inputField({ name: 'lastName', label: 'Last name', required: true, value: v.lastName, autocomplete: 'family-name', error: errors.lastName })}
            </div>
            <div class="field-row">
              ${ui.inputField({ name: 'line1', label: 'Address', required: true, value: v.line1, autocomplete: 'address-line1', error: errors.line1 })}
              ${ui.inputField({ name: 'line2', label: 'Apartment, suite (optional)', value: v.line2, autocomplete: 'address-line2' })}
            </div>
            <div class="field-row field-row--3">
              ${ui.inputField({ name: 'city', label: 'City', required: true, value: v.city, autocomplete: 'address-level2', error: errors.city })}
              <label class="field ${errors.province ? 'has-error' : ''}"><span class="field__label">State <em>*</em></span>
                <select name="province" autocomplete="address-level1" data-tax-state>
                  ${commerce.STATES.map(s => `<option value="${attr(s)}" ${v.province === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                </select>${err('province')}
              </label>
              ${ui.inputField({ name: 'zip', label: 'ZIP code', required: true, value: v.zip, autocomplete: 'postal-code', error: errors.zip })}
            </div>
            <label class="field"><span class="field__label">Country <em>*</em></span>
              <select name="country" data-tax-country>
                ${COUNTRIES.map(c => `<option value="${attr(c)}" ${v.country === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </label>
            <label class="check check--inline"><input type="checkbox" name="saveAddress" checked><span>Save this address for next time${customer ? '' : ' (creates an account option after checkout)'}</span></label>
          </div>
        </section>

        <section class="checkout-card">
          <header class="checkout-card__head"><h2><span class="step-dot">3</span> Shipping method</h2></header>
          <div class="checkout-card__body">
            <div class="ship-options" data-ship-options>
              ${cart.shippingOptions.map((m, i) => `<label class="ship-option ${i === 0 ? 'is-selected' : ''}">
                <input type="radio" name="shippingMethod" value="${attr(m.id)}" data-ship-radio ${cart.shipping.method === m.id || (!cart.shipping.method && i === 0) ? 'checked' : ''}>
                <span class="ship-option__body">
                  <strong>${esc(m.label)}</strong>
                  <em>${esc(m.detail)}</em>
                </span>
                <span class="ship-option__price">${m.price === 0 ? '<b>Free</b>' : money(m.price)}${m.originalPrice && m.isFree ? ` <s>${money(m.originalPrice)}</s>` : ''}</span>
              </label>`).join('')}
            </div>
            <p class="muted" data-ship-note>${cart.freeShipping.qualified ? `Free standard shipping applied automatically on orders over ${ui.freeShipText()}.` : `Add ${money(cart.freeShipping.remaining)} more to unlock free standard shipping.`}</p>
          </div>
        </section>

        <section class="checkout-card">
          <header class="checkout-card__head"><h2><span class="step-dot">4</span> Payment</h2><span class="checkout-card__sub">${icon('lock', { size: 14 })} Encrypted</span></header>
          <div class="checkout-card__body">
            <div class="express">
              <button type="button" class="express__btn express__btn--shop" data-fill-test-card>Shop&nbsp;Pay</button>
              <button type="button" class="express__btn express__btn--apple" data-fill-test-card>${icon('apple', { size: 18 })} Pay</button>
              <button type="button" class="express__btn express__btn--gpay" data-fill-test-card>G&nbsp;Pay</button>
            </div>
            <p class="express__note">Express buttons are wired to the sandbox gateway — they prefill the test card so you can complete a real end-to-end order.</p>
            <div class="field-row">
              ${ui.inputField({ name: 'cardNumber', label: 'Card number', required: true, value: values.cardNumber || '', placeholder: '4242 4242 4242 4242', attrs: 'inputmode="numeric" autocomplete="cc-number" maxlength="23" data-card-number', error: errors.cardNumber })}
              <span class="card-brand" data-card-brand></span>
            </div>
            <div class="field-row field-row--3">
              ${ui.inputField({ name: 'cardExpiry', label: 'Expiry (MM / YY)', required: true, value: values.cardExpiry || '', placeholder: '04 / 29', attrs: 'inputmode="numeric" autocomplete="cc-exp" maxlength="7" data-card-expiry', error: errors.cardExpiry })}
              ${ui.inputField({ name: 'cardCvc', label: 'Security code', required: true, value: values.cardCvc || '', placeholder: '123', attrs: 'inputmode="numeric" autocomplete="cc-csc" maxlength="4" data-card-cvc', error: errors.cardCvc })}
              ${ui.inputField({ name: 'cardName', label: 'Name on card', required: true, value: values.cardName || (customer ? `${customer.firstName} ${customer.lastName}` : ''), autocomplete: 'cc-name', error: errors.cardName })}
            </div>
            <label class="check check--inline"><input type="checkbox" name="billingSame" checked><span>Billing address is the same as delivery</span></label>
            <details class="billing-details">
              <summary>Enter a different billing address</summary>
              <div class="field-row">
                ${ui.inputField({ name: 'billingLine1', label: 'Billing address', value: '' })}
                ${ui.inputField({ name: 'billingCity', label: 'City', value: '' })}
              </div>
              <div class="field-row">
                <label class="field"><span class="field__label">State</span><select name="billingProvince">${commerce.STATES.map(s => `<option value="${attr(s)}">${esc(s)}</option>`).join('')}</select></label>
                ${ui.inputField({ name: 'billingZip', label: 'ZIP code', value: '' })}
              </div>
            </details>
          </div>
        </section>

        <section class="checkout-card">
          <header class="checkout-card__head"><h2>Almost done</h2></header>
          <div class="checkout-card__body">
            <label class="field"><span class="field__label">Gift note (optional)</span><textarea name="giftNote" rows="2" placeholder="Printed on a card, prices hidden.">${esc(v.giftNote)}</textarea></label>
            <label class="field"><span class="field__label">Delivery notes</span><textarea name="note" rows="2" placeholder="Leave with the concierge, etc.">${esc(v.note)}</textarea></label>
          </div>
        </section>

        <div class="checkout__submit">
          <button class="btn btn--primary btn--lg btn--block" type="submit" data-place-order>
            ${icon('lock', { size: 16 })} Place order · <span data-place-total>${money(cart.total)}</span>
          </button>
          <p class="muted">By placing this order you agree to our <a href="/pages/terms">terms of service</a> and <a href="/pages/privacy">privacy policy</a>. Sandbox mode — no real payment is taken.</p>
        </div>
      </form>
      <div class="checkout__aside">
        ${checkoutSummary(cart, ctx)}
        ${trustRow(settings.trustBadges.slice(0, 2))}
        <div class="need-help">
          <h3>Need help?</h3>
          <p>${settings.supportPhone ? `${icon('phone', { size: 15 })} ${esc(settings.supportPhone)}<br>` : ''}${icon('mail', { size: 15 })} <a href="mailto:${attr(settings.supportEmail)}">${esc(settings.supportEmail)}</a></p>
        </div>
      </div>
    </div>`
  };
}

function renderOrder(ctx, order, { justPlaced = false } = {}) {
  const statusPill = s => `<span class="pill pill--${attr(s)}">${esc(s.replace(/^\w/, c => c.toUpperCase()))}</span>`;
  const timeline = (order.timeline || []).map(t => `<li>
    <span class="timeline__dot"></span>
    <div><strong>${esc(t.label)}</strong><time>${new Date(t.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time><p>${esc(t.note || '')}</p></div>
  </li>`).join('');
  return {
    title: `Order ${order.number}`,
    description: `Status and details for ${ui.brand()} order ${order.number}.`,
    canonical: `/orders/${order.number}`,
    bodyClass: 'template-order',
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'Order', orderNumber: order.number, priceCurrency: 'USD', price: (order.total / 100).toFixed(2), orderStatus: 'https://schema.org/OrderProcessing', merchant: { '@type': 'Organization', name: ctx.settings.brandName } }],
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Orders', url: '/account/orders' }, { label: order.number }])}
      ${justPlaced ? `<div class="alert alert--ok" role="status">${icon('check', { size: 18 })}<div><strong>Thank you — your order is confirmed.</strong><p>A confirmation email is on its way to ${esc(order.email)}. ${ctx.settings.payments.testMode ? 'This was a sandbox order; no payment was taken.' : ''}</p></div></div>` : ''}
      <h1>Order ${esc(order.number)}</h1>
      <p class="page-head__meta">Placed ${new Date(order.createdAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} · ${statusPill(order.status)} ${statusPill(order.fulfillmentStatus)}</p>
    </div>
    <div class="wrap order-page">
      <div class="order-page__main">
        <section class="panel">
          <h2>Items</h2>
          <ul class="order-items">
            ${order.items.map(i => `<li>
              <img src="${attr(i.image)}" alt="" width="90" height="110" loading="lazy">
              <div>
                <a href="/products/${attr(i.handle)}"><strong>${esc(i.title)}</strong></a>
                <p class="muted">${esc(i.color)} · ${esc(i.size)} · Qty ${i.quantity} · ${esc(i.sku)}</p>
                ${i.personalization && i.personalization.text ? `<p class="cart-line__monogram">${icon('spark', { size: 13 })} ${esc(i.personalization.label)}: <strong>${esc(i.personalization.text)}</strong>${i.personalization.placement ? ` · ${esc(i.personalization.placement)}` : ''}</p>` : ''}
                <div class="order-items__actions">
                  <button class="link-inline" type="button" data-reorder-item="${attr(i.variantId)}">${icon('refresh', { size: 14 })} Buy it again</button>
                  <a class="link-inline" href="/products/${attr(i.handle)}">${icon('external', { size: 14 })} View product</a>
                </div>
              </div>
              <span class="order-items__price">${money(i.price * i.quantity)}</span>
            </li>`).join('')}
          </ul>
        </section>
        ${order.fulfillment ? `<section class="panel">
          <h2>Tracking</h2>
          <p class="tracking">${icon('truck', { size: 20 })} <strong>${esc(order.fulfillment.carrier)}</strong> · ${esc(order.fulfillment.tracking)}</p>
          <p class="muted">Dispatched ${new Date(order.fulfillment.fulfilledAt).toDateString()}. Updates appear within 24 hours.</p>
        </section>` : `<section class="panel">
          <h2>Fulfilment</h2>
          <p class="muted">Not shipped yet — orders placed before 2pm ET leave the studio the same business day.</p>
        </section>`}
        <section class="panel">
          <h2>Timeline</h2>
          <ol class="timeline">${timeline}</ol>
        </section>
        ${order.giftNote ? `<section class="panel">
          <h2>Gift note</h2>
          <p class="muted">Printed on a ${esc(ui.brand())} card and packed with the order — prices hidden.</p>
          <blockquote class="gift-quote">${esc(order.giftNote)}</blockquote>
        </section>` : ''}
        ${order.note ? `<section class="panel">
          <h2>Your delivery notes</h2>
          <p class="muted">${esc(order.note)}</p>
        </section>` : ''}
        <section class="panel">
          <h2>Need a change?</h2>
          <p class="muted">Return or exchange within 30 days, or email us — we answer within one business day.</p>
          <div class="panel__actions">
            <a class="btn btn--outline btn--sm" href="/pages/contact?topic=Return+or+exchange&order=${attr(order.number)}">${icon('refresh', { size: 15 })} Start a return</a>
            <a class="btn btn--ghost btn--sm" href="/pages/contact?topic=Order+question&order=${attr(order.number)}">${icon('mail', { size: 15 })} Ask about this order</a>
            <button class="btn btn--ghost btn--sm" type="button" data-print>${icon('box', { size: 15 })} Print receipt</button>
          </div>
        </section>
      </div>
      <aside class="order-page__aside">
        <section class="panel">
          <h2>Summary</h2>
          <dl class="totals">
            <div><dt>Subtotal</dt><dd>${money(order.subtotal)}</dd></div>
            ${order.discount ? `<div class="totals__discount"><dt>Discount · ${esc(order.discount.code)}</dt><dd>−${money(order.discountAmount)}</dd></div>` : ''}
            <div><dt>Shipping · ${esc(order.shipping.label)}</dt><dd>${order.shipping.amount === 0 ? 'Free' : money(order.shipping.amount)}</dd></div>
            <div><dt>${esc(order.tax.name)}</dt><dd>${money(order.tax.amount)}</dd></div>
            <div class="totals__grand"><dt>Total</dt><dd>${money(order.total)}</dd></div>
          </dl>
          <p class="muted">Paid with ${esc(order.payment.brand.toUpperCase())} ending ${esc(order.payment.last4)} · auth ${esc(order.payment.authCode)}${ctx.settings.payments.testMode ? ' · sandbox' : ''}</p>
        </section>
        <section class="panel">
          <h2>Shipping address</h2>
          <address>${esc(order.shippingAddress.firstName)} ${esc(order.shippingAddress.lastName)}<br>${esc(order.shippingAddress.line1)}${order.shippingAddress.line2 ? `<br>${esc(order.shippingAddress.line2)}` : ''}<br>${esc(order.shippingAddress.city)}, ${esc(order.shippingAddress.province)} ${esc(order.shippingAddress.zip)}<br>${esc(order.shippingAddress.country)}</address>
        </section>
        <section class="panel">
          <h2>Need an invoice?</h2>
          <p class="muted">A copy of this order was emailed to ${esc(order.email)}.</p>
          <button class="btn btn--outline btn--sm btn--block" type="button" data-print>Print / save as PDF</button>
        </section>
        <a class="btn btn--primary btn--block" href="/collections/all">Continue shopping</a>
      </aside>
    </div>`
  };
}

function renderTrack(ctx, { order = null, error = '', lookup = {} } = {}) {
  return {
    title: 'Track your order',
    description: `Track a ${ui.brand()} order with your order number and email.`,
    canonical: '/track',
    bodyClass: 'template-track',
    jsonLd: [],
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Track order' }])}
      <h1>Track your order</h1>
      <p class="page-head__meta">Enter the order number from your confirmation email (it looks like ${esc(ctx.settings.orderPrefix || 'VEN')}-1001) and the email you used.</p>
    </div>
    <div class="wrap track">
      <form class="panel track__form" data-track-form action="/track" method="post">
        <h2>Order lookup</h2>
        ${ui.inputField({ name: 'number', label: 'Order number', required: true, value: lookup.number || '', placeholder: `${ctx.settings.orderPrefix || 'VEN'}-1001` })}
        ${ui.inputField({ name: 'email', label: 'Email address', type: 'email', required: true, value: lookup.email || '', placeholder: 'you@email.com' })}
        <button class="btn btn--primary btn--block" type="submit">Find my order</button>
        ${error ? `<p class="form-msg form-msg--error" role="alert">${esc(error)}</p>` : ''}
        ${order ? `<div class="track__result">
          <h3>Order ${esc(order.number)}</h3>
          <p>${esc(order.status.replace(/^\w/, c => c.toUpperCase()))} · placed ${new Date(order.createdAt).toDateString()}</p>
          ${order.fulfillment ? `<p class="tracking">${icon('truck', { size: 18 })} ${esc(order.fulfillment.carrier)} ${esc(order.fulfillment.tracking)}</p>` : '<p class="muted">Not shipped yet — we will email tracking the moment it leaves.</p>'}
          <a class="btn btn--outline btn--sm" href="/orders/${attr(order.number)}?email=${encodeURIComponent(order.email)}">View full order</a>
        </div>` : ''}
      </form>
      <aside class="panel track__help">
        <h2>While you wait</h2>
        <ul class="summary-notes">
          <li>${icon('truck', { size: 15 })} Standard delivery is 4–6 business days</li>
          <li>${icon('clock', { size: 15 })} Orders before 2pm ET ship same day</li>
          <li>${icon('refresh', { size: 15 })} Returns window is 30 days from delivery</li>
        </ul>
        <p class="muted">Lost your order number? <a href="/pages/contact">Contact support</a> with the email you ordered with and we will find it.</p>
      </aside>
    </div>`
  };
}

module.exports = { render, renderOrder, renderTrack, checkoutSummary, COUNTRIES };
