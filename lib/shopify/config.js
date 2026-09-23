'use strict';
/**
 * Shopify connection configuration.
 *
 * LIVE mode  — SHOPIFY_STORE_DOMAIN + SHOPIFY_STOREFRONT_ACCESS_TOKEN are set:
 *              every product, price, stock level, collection, cart and
 *              checkout comes from that store's Storefront API.
 * DEMO mode  — no SHOPIFY_STORE_DOMAIN configured: the app boots against the
 *              bundled Storefront-API-compatible demo gateway
 *              (tools/mock-shopify), clearly labelled. Same code path,
 *              fixture data.
 *
 * Two rules this module enforces, because they are the difference between a
 * storefront and a demo that accidentally looks like a storefront:
 *
 *   1. Production (NODE_ENV=production) may never boot in demo mode unless
 *      VENNIX_ALLOW_DEMO=1 is set explicitly.
 *   2. With a store configured, nothing anywhere in the process can silently
 *      redirect the client at the mock gateway (see client.setEndpoint).
 */
const crypto = require('crypto');

/** Current stable Shopify Storefront API version (supported until 2027-07-16). */
const DEFAULT_API_VERSION = '2026-07';

/** Versions still supported by Shopify, oldest first. Anything else warns. */
const SUPPORTED_VERSIONS = ['2025-10', '2026-01', '2026-04', '2026-07'];

let warned = false;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function demoAllowed() {
  return process.env.VENNIX_ALLOW_DEMO === '1' || process.env.VENNIX_ALLOW_DEMO === 'true';
}

/** Normalise `https://My-Store.myshopify.com/admin` → `my-store.myshopify.com`. */
function normalizeDomain(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

function looksLikePlaceholder(domain) {
  return /your-store|yourstore|example\.com|example\.myshopify|\.test$|^localhost/.test(domain);
}

function validateDomain(domain) {
  if (!domain) return null;
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) {
    throw new Error(
      `SHOPIFY_STORE_DOMAIN "${domain}" is not a hostname. Use the store's myshopify domain, ` +
      'for example your-store.myshopify.com (no http://, no trailing path).'
    );
  }
  if (looksLikePlaceholder(domain)) {
    throw new Error(
      `SHOPIFY_STORE_DOMAIN "${domain}" looks like a placeholder copied from .env.example. ` +
      'Set the real myshopify domain of your store.'
    );
  }
  return domain;
}

function validateVersion(version) {
  if (!/^\d{4}-(0[147]|10)$/.test(version)) {
    throw new Error(
      `SHOPIFY_API_VERSION "${version}" is not a Shopify API version. ` +
      `Use the quarterly format, e.g. ${DEFAULT_API_VERSION}.`
    );
  }
  if (!SUPPORTED_VERSIONS.includes(version) && !warned) {
    warned = true;
    console.warn(
      `[vennix] warning: SHOPIFY_API_VERSION ${version} is not one of the versions Shopify ` +
      `currently supports (${SUPPORTED_VERSIONS.join(', ')}). Continuing, but expect failures.`
    );
  }
  if (version !== DEFAULT_API_VERSION && SUPPORTED_VERSIONS.includes(version) &&
      SUPPORTED_VERSIONS.indexOf(version) < SUPPORTED_VERSIONS.indexOf(DEFAULT_API_VERSION) && !warned) {
    warned = true;
    console.warn(`[vennix] warning: SHOPIFY_API_VERSION ${version} is older than the current stable ${DEFAULT_API_VERSION}.`);
  }
  return version;
}

function getConfig() {
  const rawDomain = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  const domain = validateDomain(normalizeDomain(rawDomain));
  const token = (process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || '').trim();
  const version = validateVersion((process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim());
  const demo = !domain;

  if (demo && isProduction() && !demoAllowed()) {
    throw new Error(
      'Refusing to start in DEMO mode with NODE_ENV=production: a production storefront must ' +
      'point at a real Shopify store. Set SHOPIFY_STORE_DOMAIN + SHOPIFY_STOREFRONT_ACCESS_TOKEN ' +
      '(see docs/SETUP.md), or — if you really do want the fixture catalogue in production — set ' +
      'VENNIX_ALLOW_DEMO=1.'
    );
  }

  if (!demo && !token) {
    throw new Error(
      'SHOPIFY_STORE_DOMAIN is set but SHOPIFY_STOREFRONT_ACCESS_TOKEN is missing. ' +
      'Create a Storefront API access token in Shopify admin (Settings → Apps and sales channels → ' +
      'Develop apps → your app → API credentials → Storefront API) — see docs/SETUP.md.'
    );
  }

  if (!demo && token.length < 16) {
    throw new Error(
      'SHOPIFY_STOREFRONT_ACCESS_TOKEN looks truncated (under 16 characters). Storefront API ' +
      'public access tokens are long strings; re-copy it and check the value is not quoted or wrapped.'
    );
  }

  // Where customers manage accounts / track orders: the Shopify-hosted pages
  // on the store's primary domain (falls back to the myshopify domain).
  const primaryDomainRaw = (process.env.SHOPIFY_PRIMARY_DOMAIN || '').trim() || domain;
  const primaryDomain = primaryDomainRaw ? normalizeDomain(primaryDomainRaw) : '';

  const ttl = Number(process.env.SHOPIFY_CACHE_TTL_MS || 15000);

  return {
    demo,
    production: isProduction(),
    domain,
    token,
    version,
    apiVersion: version,
    endpoint: demo ? null : `https://${domain}/api/${version}/graphql.json`,
    primaryDomain,
    accountUrl: process.env.SHOPIFY_ACCOUNT_URL || (primaryDomain ? `https://${primaryDomain}/account` : ''),
    checkoutCacheTtlMs: Number.isFinite(ttl) && ttl >= 0 ? ttl : 15000
  };
}

/** True when live mode is configured AND the mock gateway is off-limits. */
function liveModeLocked() {
  try {
    const cfg = getConfig();
    return !cfg.demo && !demoAllowed();
  } catch {
    return false; // bad config → getConfig() itself throws where it matters
  }
}

/** A stable fingerprint of the connection (safe to log — no token). */
function connectionId() {
  try {
    const cfg = getConfig();
    if (cfg.demo) return 'demo';
    return crypto.createHash('sha256').update(`${cfg.domain}|${cfg.version}`).digest('hex').slice(0, 12);
  } catch {
    return 'unconfigured';
  }
}

module.exports = {
  getConfig,
  DEFAULT_API_VERSION,
  SUPPORTED_VERSIONS,
  demoAllowed,
  isProduction,
  liveModeLocked,
  connectionId,
  normalizeDomain
};
