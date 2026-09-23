'use strict';
/**
 * auth.js — cookie plumbing only.
 *
 * Authentication itself (customer accounts, logins, order history) belongs
 * to Shopify customer accounts — the storefront only keeps the cookie
 * utilities used by the cart-id and CSRF cookies. The full session/password
 * admin that used to live here is retired with the custom backend
 * (legacy/auth.js).
 *
 * Two things this module guarantees:
 *   1. `Set-Cookie` is always appended, never overwritten (Node's setHeader
 *      would otherwise drop a cookie set earlier in the same request).
 *   2. Cookies are `Secure` as soon as the visitor's connection is TLS —
 *      including behind a TLS-terminating proxy — and, when every response is
 *      guaranteed TLS, they are additionally locked to the exact host with
 *      the `__Host-` prefix so a subdomain can never set or shadow them.
 */

const HOST_PREFIX = '__Host-';

function isProd() {
  return process.env.NODE_ENV === 'production';
}

/** Does this deployment sit behind a proxy we should read forwarded headers from? */
function trustsProxy() {
  const v = String(process.env.TRUST_PROXY || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** True when the visitor's connection is HTTPS (direct or via a TLS-terminating proxy). */
function requestSecure(req) {
  if (isProd() && process.env.VENNIX_FORCE_INSECURE_COOKIES !== '1') return true;
  if (!req || !req.headers) return false;
  const proto = req.headers['x-forwarded-proto'];
  if (!proto) return false;
  // Only trust the header when we're told to, or when it is unambiguous https
  // (a direct http client cannot set it unless a proxy put it there).
  if (!trustsProxy() && process.env.VENNIX_TRUST_ANY_PROTO !== '1') return false;
  return String(proto).split(',')[0].trim().toLowerCase() === 'https';
}

/**
 * Should cookies be locked to the host with the `__Host-` prefix?
 *
 * `__Host-` requires `Secure`, `Path=/` and no `Domain`, and browsers drop a
 * prefixed cookie that arrives over plain HTTP. So it is only ever enabled
 * when every response is guaranteed TLS, and it is decided once per process
 * (not per request) so a cookie is always set and cleared under the same
 * name.
 *
 *   COOKIE_HOST_PREFIX=auto  (default) on in production unless insecure
 *                            cookies are forced; off in dev/CI
 *   COOKIE_HOST_PREFIX=on    always (except when insecure cookies are forced)
 *   COOKIE_HOST_PREFIX=off   never
 */
function hostPrefixEnabled() {
  if (process.env.VENNIX_FORCE_INSECURE_COOKIES === '1') return false;
  const mode = String(process.env.COOKIE_HOST_PREFIX || 'auto').trim().toLowerCase();
  if (mode === 'off' || mode === '0' || mode === 'false') return false;
  if (mode === 'on' || mode === '1' || mode === 'true') return true;
  return isProd();
}

/** The cookie name to actually write for a logical cookie name. */
function cookieName(base) {
  return hostPrefixEnabled() ? HOST_PREFIX + base : base;
}

function parseCookies(req) {
  const out = {};
  const header = (req && req.headers && req.headers.cookie) || '';
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    let value;
    try { value = decodeURIComponent(part.slice(idx + 1).trim()); } catch { value = part.slice(idx + 1).trim(); }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Read a logical cookie by base name, accepting either the bare or the
 * `__Host-` prefixed form — a visitor whose first response predated a prefix
 * change (or who hit a non-TLS route once) keeps their cart.
 */
function cookieValue(req, base) {
  const cookies = parseCookies(req);
  const prefixed = HOST_PREFIX + base;
  // A __Host- cookie can only ever have been written by this exact host, so it
  // is always honoured — including when the prefix is currently off (a deploy
  // may turn it on and back off again).
  if (cookies[prefixed]) return cookies[prefixed];
  // The bare name is only honoured while the prefix is off: with the prefix on,
  // a sibling subdomain could otherwise plant a cookie for this host.
  if (!hostPrefixEnabled() && cookies[base]) return cookies[base];
  return null;
}

/**
 * Serialize one Set-Cookie value.
 *
 * When the name carries the `__Host-` prefix the attributes browsers require
 * are forced, because a prefixed cookie that violates them is rejected
 * outright (and the cart would silently stop persisting).
 */
function serializeCookie(name, value, {
  maxAge, httpOnly = true, sameSite = 'Lax', path = '/', secure = isProd(), domain = null
} = {}) {
  const prefixed = String(name).startsWith(HOST_PREFIX);
  const useSecure = prefixed ? true : secure;
  const usePath = prefixed ? '/' : path;
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${usePath}`, `SameSite=${sameSite}`];
  if (httpOnly) bits.push('HttpOnly');
  if (useSecure) bits.push('Secure');
  if (!prefixed && domain) bits.push(`Domain=${domain}`);
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  return bits.join('; ');
}

/**
 * Append a Set-Cookie header without clobbering previously set cookies.
 * Node's `res.setHeader('Set-Cookie', …)` replaces the header, so we build
 * an array of cookies and set them together.
 */
function appendCookie(res, cookie) {
  if (!res || typeof res.setHeader !== 'function') return;
  const existing = res.getHeader('Set-Cookie');
  if (!existing) return res.setHeader('Set-Cookie', cookie);
  const arr = Array.isArray(existing) ? existing.slice() : [String(existing)];
  arr.push(cookie);
  res.setHeader('Set-Cookie', arr);
}

/** Set (or refresh) a logical cookie. */
function setCookie(res, base, value, opts = {}) {
  const { secure = isProd(), ...rest } = opts;
  appendCookie(res, serializeCookie(cookieName(base), value, { secure, ...rest }));
  return cookieName(base);
}

/** Expire a logical cookie — same name and flags, `Max-Age=0`. */
function clearCookie(res, base, opts = {}) {
  const { secure = isProd(), ...rest } = opts;
  appendCookie(res, serializeCookie(cookieName(base), '', { secure, maxAge: 0, ...rest }));
  return cookieName(base);
}

module.exports = {
  isProd,
  trustsProxy,
  requestSecure,
  hostPrefixEnabled,
  cookieName,
  parseCookies,
  cookieValue,
  serializeCookie,
  appendCookie,
  setCookie,
  clearCookie
};
