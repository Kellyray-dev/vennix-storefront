'use strict';
/**
 * emails.js — transactional email bodies. In this build they are rendered to
 * data/emails/*.html so you can inspect exactly what a customer receives.
 */
const commerce = require('./commerce');
const store = require('./store');

function money(c) { return commerce.money(c); }

function itemsTable(order) {
  const rows = order.items.map(i => `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #F0ECE4">
      <strong>${i.title}</strong><br><span style="color:#6E675E;font-size:13px">${i.color} / ${i.size} · Qty ${i.quantity} · ${i.sku}</span>
    </td>
    <td style="padding:10px 0;border-bottom:1px solid #F0ECE4;text-align:right">${money(i.price * i.quantity)}</td>
  </tr>`).join('');
  return `<table>${rows}
    <tr><td>Subtotal</td><td style="text-align:right">${money(order.subtotal)}</td></tr>
    ${order.discount ? `<tr><td>Discount — ${order.discount.code}</td><td style="text-align:right">−${money(order.discountAmount)}</td></tr>` : ''}
    <tr><td>Shipping — ${order.shipping.label}</td><td style="text-align:right">${order.shipping.amount === 0 ? 'Free' : money(order.shipping.amount)}</td></tr>
    <tr><td>${order.tax.name}</td><td style="text-align:right">${money(order.tax.amount)}</td></tr>
    <tr class="tot"><td>Total</td><td style="text-align:right">${money(order.total)}</td></tr>
  </table>`;
}

function addressBlock(a) {
  return `${a.firstName} ${a.lastName}<br>${a.line1}${a.line2 ? `<br>${a.line2}` : ''}<br>${a.city}, ${a.province} ${a.zip}<br>${a.country}`;
}

function orderConfirmation(order, settings) {
  const body = `
  <h1>Thanks, ${order.customerName.split(' ')[0]} — your order is confirmed.</h1>
  <p style="color:#6E675E;font-size:14px">Order ${order.number} · placed ${new Date(order.createdAt).toDateString()} · payment ${order.payment.brand.toUpperCase()} ending ${order.payment.last4}</p>
  ${itemsTable(order)}
  <h3 style="margin:26px 0 8px;font-size:15px">Shipping to</h3>
  <p style="font-size:14px;color:#4A443C;line-height:1.6">${addressBlock(order.shippingAddress)}</p>
  <p style="margin:26px 0"><a class="btn" href="https://${settings.domain}/orders/${order.number}?email=${encodeURIComponent(order.email)}">Track your order</a></p>
  <p style="font-size:13px;color:#6E675E">Free returns for 30 days. Two-year repair service on everything we make.</p>`;
  return commerce.emailShell(`Order ${order.number} confirmed`, body, settings);
}

function shippingConfirmation(order, settings) {
  const body = `
  <h1>On its way.</h1>
  <p style="color:#6E675E;font-size:14px">Order ${order.number} left our Brooklyn studio with ${order.fulfillment ? order.fulfillment.carrier : 'the carrier'}.</p>
  <p style="font-size:15px">Tracking number: <strong>${order.fulfillment ? order.fulfillment.tracking : '—'}</strong></p>
  ${itemsTable(order)}
  <p style="margin:26px 0"><a class="btn" href="https://${settings.domain}/orders/${order.number}?email=${encodeURIComponent(order.email)}">Track package</a></p>`;
  return commerce.emailShell(`Order ${order.number} has shipped`, body, settings);
}

function refundConfirmation(order, settings) {
  const body = `
  <h1>Refund processed</h1>
  <p style="color:#6E675E;font-size:14px">Order ${order.number}</p>
  <p>We have refunded <strong>${money(order.refundAmount || order.total)}</strong> to your ${order.payment.brand.toUpperCase()} ending ${order.payment.last4}. It usually appears within 3–5 business days.</p>
  ${itemsTable(order)}`;
  return commerce.emailShell(`Refund for order ${order.number}`, body, settings);
}

function welcomeEmail(customer, settings) {
  const body = `
  <h1>Welcome to ${settings.brandName || 'Vennix'}, ${customer.firstName}.</h1>
  <p>Your account is ready. You can track orders, start a return and save sizes for faster checkout.</p>
  <p>As a thank you, here is <strong>10% off</strong> your first order: <strong>WELCOME10</strong></p>
  <p style="margin:26px 0"><a class="btn" href="https://${settings.domain}/collections/all">Shop Capsule 01</a></p>`;
  return commerce.emailShell(`Welcome to ${settings.brandName || 'Vennix'}`, body, settings);
}

function newsletterEmail(email, settings) {
  const body = `
  <h1>You are on the list.</h1>
  <p style="color:#6E675E;font-size:14px">${email}</p>
  <p>We email twice a month: new pieces, restocks and run club dates. No noise.</p>
  <p style="margin:26px 0"><a class="btn" href="https://${settings.domain}/collections/new-in">See what is new</a></p>
  <p style="font-size:13px;color:#6E675E">Unsubscribe any time — one click, no questions.</p>`;
  return commerce.emailShell('You are subscribed', body, settings);
}

function passwordResetEmail(customer, token, settings) {
  const body = `
  <h1>Reset your password</h1>
  <p>Tap the button below to choose a new password. This link expires in one hour.</p>
  <p style="margin:26px 0"><a class="btn" href="https://${settings.domain}/account/reset?token=${encodeURIComponent(token)}">Choose new password</a></p>
  <p style="font-size:13px;color:#6E675E">If you did not request this, you can safely ignore the email.</p>`;
  return commerce.emailShell(`Reset your ${settings.brandName || 'Vennix'} password`, body, settings);
}

function orderStatusEmail(order, settings) {
  const body = `
  <h1>Order ${order.number} is ${order.status}</h1>
  <p style="color:#6E675E;font-size:14px">A quick update from the studio.</p>
  ${itemsTable(order)}`;
  return commerce.emailShell(`Update on order ${order.number}`, body, settings);
}

function record(kind, order, settings) {
  const html = kind === 'shipping' ? shippingConfirmation(order, settings)
    : kind === 'refund' ? refundConfirmation(order, settings)
      : kind === 'status' ? orderStatusEmail(order, settings)
        : orderConfirmation(order, settings);
  const name = `${kind}-${order.number}-${Date.now()}`;
  const file = store.writeEmail(name, html);
  return { file: `/admin/emails/${file}`, html };
}

module.exports = {
  orderConfirmation, shippingConfirmation, refundConfirmation, welcomeEmail,
  newsletterEmail, passwordResetEmail, orderStatusEmail, record, itemsTable
};
