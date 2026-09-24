'use strict';
/**
 * status.js — the graceful failure pages.
 *
 * These render without touching Shopify and without the layout chrome (both of
 * which are exactly what may be broken when one of these is needed). They reuse
 * the real stylesheet and brand mark so a shopper sees a branded pause screen
 * rather than a stack trace, and they never echo internal detail.
 *
 *   503 → Shopify is unreachable / throttling / the catalog could not be read
 *   500 → something in this presentation layer failed
 */
const settings = require('../settings');

function brandMark() {
  let s;
  try { s = settings.get(); } catch { s = { brandName: 'Vennix' }; }
  return `<span class="brand"><span class="brand__mark" aria-hidden="true">
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 26 16 5l12 21"/><path d="M10.5 26 16 16.5 21.5 26"/></svg>
  </span><span class="brand__word">${escapeHtml(s.brandName || 'Vennix')}</span></span>`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function page({ status, title, lead, detail, retryAfter, supportEmail }) {
  const mail = supportEmail ? `<p class="status__alt">Still stuck? <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a></p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/main.css">
</head>
<body>
<main id="main" class="status" style="min-height:70vh;display:grid;place-items:center;padding:12vh 20px">
  <div class="status__card" style="max-width:560px;text-align:center">
    ${brandMark()}
    <h1 style="margin:22px 0 8px;font-size:clamp(1.6rem,4vw,2.2rem);letter-spacing:-0.02em">${escapeHtml(title)}</h1>
    <p style="font-size:1.05rem;line-height:1.6;color:var(--ink-2,#4a4a4c)">${escapeHtml(lead)}</p>
    ${detail ? `<p class="status__detail" style="margin-top:10px;font-size:.9rem;color:var(--ink-3,#6b6b6e)">${escapeHtml(detail)}</p>` : ''}
    <p style="margin-top:26px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <a class="btn btn--primary" href="/">Back to the store</a>
      <a class="btn btn--outline" href="" data-retry>Try again</a>
    </p>
    ${mail}
    ${retryAfter ? `<p class="status__retry" style="margin-top:14px;font-size:.8rem;color:var(--ink-3,#6b6b6e)">Retrying in ${retryAfter}s is safe — nothing you did was lost.</p>` : ''}
  </div>
</main>
</body>
</html>`;
}

/**
 * 503 — the store could not be reached. Used when the failure is Shopify's
 * (unreachable, throttled, credentials rejected) rather than ours.
 */
function unavailable({ detail = '', retryAfter = 30 } = {}) {
  let s = {};
  try { s = settings.get(); } catch { /* settings are optional here */ }
  return {
    status: 503,
    retryAfter,
    html: page({
      title: 'The store is catching its breath',
      lead: 'We cannot reach the shop right now, so the catalogue and your cart are paused. Nothing was lost — try again in a moment.',
      detail,
      retryAfter,
      supportEmail: s.supportEmail
    })
  };
}

/** 500 — our failure, their patience. No stack traces, ever. */
function error() {
  let s = {};
  try { s = settings.get(); } catch { /* settings are optional here */ }
  return {
    status: 500,
    retryAfter: 0,
    html: page({
      title: 'Something went wrong',
      lead: 'This page could not be rendered. We can see the problem and are on it — try again in a moment.',
      detail: '',
      supportEmail: s.supportEmail
    })
  };
}

module.exports = { unavailable, error, brandMark };
