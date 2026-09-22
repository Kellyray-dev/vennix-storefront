'use strict';
/**
 * auth.js — cookie plumbing only.
 *
 * Authentication itself (customer accounts, logins, order history) belongs
 * to Shopify customer accounts — the storefront only keeps a small cookie
 * utility used by the cart-id cookie. The full session/password admin that
 * used to live here is retired with the custom backend (legacy/auth.js).
 */

function isProd() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Append a Set-Cookie header without clobbering previously set cookies.
 * Node's `res.setHeader('Set-Cookie', …)` replaces the header, so we build
 * an array of cookies and set them together.
 */
function appendCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) return res.setHeader('Set-Cookie', cookie);
  const arr = Array.isArray(existing) ? existing.slice() : [String(existing)];
  arr.push(cookie);
  res.setHeader('Set-Cookie', arr);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function serializeCookie(name, value, { maxAge, httpOnly = true, sameSite = 'Lax', path = '/', secure = isProd() } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) bits.push('HttpOnly');
  if (secure) bits.push('Secure');
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  return bits.join('; ');
}

module.exports = { parseCookies, serializeCookie, appendCookie };
