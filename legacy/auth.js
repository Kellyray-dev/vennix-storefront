'use strict';
/**
 * auth.js — password hashing (scrypt), signed session cookies and route guards.
 * Sessions live in the store so they survive restarts and show up in the admin.
 */
const crypto = require('crypto');
const store = require('./store');

const SESSION_COOKIE = 'vnx_sid';
const SESSION_DAYS = 30;

function isProd() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Append a Set-Cookie header without clobbering previously set cookies.
 * Node's `res.setHeader('Set-Cookie', …)` replaces the header, so we build
 * an array of cookies and set them together so responses can emit both the
 * session and the cart cookie.
 */
function appendCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) return res.setHeader('Set-Cookie', cookie);
  const arr = Array.isArray(existing) ? existing.slice() : [String(existing)];
  arr.push(cookie);
  res.setHeader('Set-Cookie', arr);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSession({ type = 'customer', customerId = null, email = '', name = '', userAgent = '' }) {
  const id = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  store.insert('sessions', { id, type, customerId, email, name, userAgent, expiresAt });
  return { id, expiresAt, type, customerId, email, name };
}

function getSession(id) {
  if (!id) return null;
  const s = store.find('sessions', r => r.id === id);
  if (!s) return null;
  if (Date.parse(s.expiresAt) < Date.now()) { store.remove('sessions', s.id); return null; }
  return s;
}

function destroySession(id) { if (id) store.remove('sessions', id); }

/* ------------------------------ cookie plumbing ------------------------------ */
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

function setSessionCookie(res, id) {
  appendCookie(res, serializeCookie(SESSION_COOKIE, id, { maxAge: SESSION_DAYS * 86400 }));
}
function clearSessionCookie(res) {
  appendCookie(res, serializeCookie(SESSION_COOKIE, '', { maxAge: 0 }));
}

function currentSession(req) { return getSession(parseCookies(req)[SESSION_COOKIE]); }

function requireCustomer(req) {
  const s = currentSession(req);
  if (!s || (!s.customerId && s.type !== 'admin')) return null;
  return s;
}

function requireAdmin(req) {
  const s = currentSession(req);
  return s && s.type === 'admin' ? s : null;
}

function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }

module.exports = {
  SESSION_COOKIE, hashPassword, verifyPassword, createSession, getSession,
  destroySession, parseCookies, serializeCookie, setSessionCookie, clearSessionCookie,
  appendCookie, isProd,
  currentSession, requireCustomer, requireAdmin, randomToken, sign
};
