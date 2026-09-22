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
 *              fixture data. A production deploy must set the env vars.
 */

const DEFAULT_API_VERSION = '2025-10';

function getConfig() {
  const domain = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  const token = (process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || '').trim();
  const version = (process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim();
  const demo = !domain;

  if (!demo && !token) {
    throw new Error(
      'SHOPIFY_STORE_DOMAIN is set but SHOPIFY_STOREFRONT_ACCESS_TOKEN is missing. ' +
      'Create a Storefront API access token in Shopify admin (Settings → Apps and sales channels → ' +
      'Develop apps → your app → API credentials → Storefront API) — see docs/SETUP.md.'
    );
  }

  // Where customers manage accounts / track orders: the Shopify-hosted pages
  // on the store's primary domain (falls back to the myshopify domain).
  const primaryDomain = (process.env.SHOPIFY_PRIMARY_DOMAIN || '').trim() || domain;

  return {
    demo,
    domain,
    token,
    version,
    endpoint: demo ? null : `https://${domain}/api/${version}/graphql.json`,
    primaryDomain,
    accountUrl: process.env.SHOPIFY_ACCOUNT_URL || (primaryDomain ? `https://${primaryDomain}/account` : ''),
    checkoutCacheTtlMs: Number(process.env.SHOPIFY_CACHE_TTL_MS || 15000)
  };
}

module.exports = { getConfig, DEFAULT_API_VERSION };
