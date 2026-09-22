'use strict';
/**
 * client.js — minimal Storefront API GraphQL client (Node 18+ fetch, zero
 * dependencies). Handles auth header, timeouts, one retry on transport
 * errors, and surfaces GraphQL errors as typed exceptions.
 *
 * In demo mode the endpoint is pointed at the in-process mock gateway
 * (tools/mock-shopify) — the wire format is identical, so this module is the
 * same code path in dev, CI and production.
 */
const { getConfig } = require('./config');

class ShopifyError extends Error {
  constructor(message, { errors = [], status = 0 } = {}) {
    super(message);
    this.name = 'ShopifyError';
    this.errors = errors;
    this.status = status;
  }
}

let endpointOverride = null;
let tokenOverride = null;

/** Used by the demo bootstrap to aim the client at the mock gateway. */
function setEndpoint(url, token = 'demo-storefront-token') {
  endpointOverride = url;
  tokenOverride = token;
}

function resolveTarget() {
  if (endpointOverride) return { endpoint: endpointOverride, token: tokenOverride, demo: true };
  const cfg = getConfig();
  return { endpoint: cfg.endpoint, token: cfg.token, demo: cfg.demo };
}

async function gql(query, variables = {}, { timeoutMs = 9000, retries = 1 } = {}) {
  const { endpoint, token } = resolveTarget();
  if (!endpoint) throw new ShopifyError('Shopify endpoint not configured (demo gateway not started?)');

  const body = JSON.stringify({ query, variables });
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': token
        },
        body,
        signal: controller.signal
      });
      clearTimeout(timer);

      if (res.status >= 500 || res.status === 429) {
        lastErr = new ShopifyError(`Storefront API responded ${res.status}`, { status: res.status });
        if (attempt < retries) continue;
        throw lastErr;
      }

      const json = await res.json().catch(() => null);
      if (!json) throw new ShopifyError('Storefront API returned an unparseable response', { status: res.status });
      if (json.errors && json.errors.length) {
        const msg = (json.errors[0] && json.errors[0].message) || 'GraphQL error';
        throw new ShopifyError(msg, { errors: json.errors, status: res.status });
      }
      if (!res.ok) throw new ShopifyError(`Storefront API responded ${res.status}`, { status: res.status });
      return json.data;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ShopifyError) throw err;
      lastErr = new ShopifyError(`Storefront API request failed: ${err.message}`);
      if (attempt < retries) continue;
      throw lastErr;
    }
  }
  throw lastErr || new ShopifyError('Storefront API request failed');
}

/** Collect userErrors from a mutation payload into { ok, error }. */
function mutationResult(payload, key) {
  const node = payload && payload[key];
  const userErrors = (node && node.userErrors) || [];
  if (userErrors.length) {
    return { ok: false, error: userErrors.map(e => e.message).join(' '), fields: userErrors.map(e => e.field) };
  }
  return { ok: true, cart: node && node.cart };
}

module.exports = { gql, setEndpoint, ShopifyError, mutationResult };
