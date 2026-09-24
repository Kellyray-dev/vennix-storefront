'use strict';
/**
 * client.js — minimal Storefront API GraphQL client (Node 18+ fetch, zero
 * dependencies). Handles auth header, timeouts, bounded retries with backoff
 * (honouring Retry-After), and surfaces GraphQL errors as typed exceptions.
 *
 * In demo mode the endpoint is pointed at the in-process mock gateway
 * (tools/mock-shopify) — the wire format is identical, so this module is the
 * same code path in dev, CI and production.
 *
 * The private Storefront token lives here and here only: it goes out in one
 * request header to one host and is never rendered, logged or sent to a browser.
 */
const { getConfig, liveModeLocked, demoAllowed } = require('./config');

/** Error codes callers can branch on without string-matching messages. */
const CODES = {
  CONFIG: 'config',
  AUTH: 'auth',
  THROTTLE: 'throttle',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  SERVER: 'server',
  GRAPHQL: 'graphql',
  NOT_FOUND: 'not_found',
  BAD_RESPONSE: 'bad_response'
};

class ShopifyError extends Error {
  constructor(message, { code = CODES.GRAPHQL, errors = [], status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'ShopifyError';
    this.code = code;
    this.errors = errors;
    this.status = status;
    this.retryable = retryable;
  }
}

let endpointOverride = null;
let tokenOverride = null;

/** Used by the demo bootstrap to aim the client at the mock gateway. */
function setEndpoint(url, token = 'demo-storefront-token') {
  // Hard guard: with a real store configured, nothing may quietly aim the
  // client at the fixture gateway. Demo mode has to be opted into.
  if (liveModeLocked()) {
    throw new ShopifyError(
      'Refusing to point the Shopify client at the mock gateway: SHOPIFY_STORE_DOMAIN is set. ' +
      'Unset SHOPIFY_STORE_DOMAIN (or set VENNIX_ALLOW_DEMO=1) to run the demo.',
      { code: CODES.CONFIG }
    );
  }
  endpointOverride = url;
  tokenOverride = token;
}

function clearEndpoint() {
  endpointOverride = null;
  tokenOverride = null;
}

function isDemoOverride() {
  return !!endpointOverride;
}

function resolveTarget() {
  if (endpointOverride) return { endpoint: endpointOverride, token: tokenOverride, demo: true };
  const cfg = getConfig();
  return { endpoint: cfg.endpoint, token: cfg.token, demo: cfg.demo };
}

/* ---------------------------------- metrics -------------------------------- */

const metrics = {
  requests: 0,
  errors: 0,
  retries: 0,
  throttles: 0,
  lastError: null, // { at, code, message }
  lastSuccessAt: null
};

function getMetrics() {
  return { ...metrics, lastError: metrics.lastError ? { ...metrics.lastError } : null };
}

function noteError(code, message) {
  metrics.errors++;
  metrics.lastError = { at: new Date().toISOString(), code, message: String(message).slice(0, 300) };
}

/* ---------------------------------- helpers -------------------------------- */

function defaultTimeout() {
  const v = Number(process.env.SHOPIFY_TIMEOUT_MS || 9000);
  return Number.isFinite(v) && v > 0 ? v : 9000;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(res) {
  const raw = res && res.headers && res.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(15000, Math.max(0, seconds * 1000));
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.min(15000, Math.max(0, when - Date.now()));
  return null;
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return { code: CODES.AUTH, retryable: false };
  if (status === 404) return { code: CODES.NOT_FOUND, retryable: false };
  if (status === 429) return { code: CODES.THROTTLE, retryable: true };
  if (status >= 500) return { code: CODES.SERVER, retryable: true };
  return { code: CODES.BAD_RESPONSE, retryable: false };
}

function looksLikeAuthFailure(message) {
  return /access denied|invalid token|unauthor|authentication|forbidden|not authorized/i.test(String(message || ''));
}

/**
 * Send one GraphQL document to the Storefront API.
 *
 * @param {string} query
 * @param {object} variables
 * @param {{timeoutMs?:number, retries?:number}} [options]
 */
async function gql(query, variables = {}, { timeoutMs = defaultTimeout(), retries = 2 } = {}) {
  const { endpoint, token } = resolveTarget();
  if (!endpoint) {
    throw new ShopifyError('Shopify endpoint not configured (demo gateway not started?)', { code: CODES.CONFIG });
  }

  const body = JSON.stringify({ query, variables });
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    metrics.requests++;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Shopify-Storefront-Access-Token': token
        },
        body,
        signal: controller.signal
      });
      clearTimeout(timer);

      // Throttling: wait as long as Shopify asks (bounded), then retry.
      if (res.status === 429) {
        metrics.throttles++;
        const wait = retryAfterMs(res) ?? Math.min(4000, 400 * Math.pow(2, attempt));
        lastErr = new ShopifyError('Storefront API rate limit reached (429)', { code: CODES.THROTTLE, status: 429, retryable: true });
        if (attempt < retries) {
          metrics.retries++;
          await sleep(wait + Math.floor(Math.random() * 120));
          continue;
        }
        noteError(CODES.THROTTLE, lastErr.message);
        throw lastErr;
      }

      if (res.status >= 500) {
        lastErr = new ShopifyError(`Storefront API responded ${res.status}`, { code: CODES.SERVER, status: res.status, retryable: true });
        if (attempt < retries) {
          metrics.retries++;
          await sleep(Math.min(3000, 250 * Math.pow(2, attempt)) + Math.floor(Math.random() * 150));
          continue;
        }
        noteError(CODES.SERVER, lastErr.message);
        throw lastErr;
      }

      if (res.status === 401 || res.status === 403) {
        lastErr = new ShopifyError(
          'Shopify rejected the Storefront API token (401/403). Check SHOPIFY_STOREFRONT_ACCESS_TOKEN ' +
          'and that the app has the Storefront API integration installed on this store.',
          { code: CODES.AUTH, status: res.status }
        );
        noteError(CODES.AUTH, lastErr.message);
        throw lastErr;
      }

      const text = await res.text().catch(() => '');
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* fall through */ }
      if (!json) {
        lastErr = new ShopifyError(
          `Storefront API returned an unparseable response (HTTP ${res.status}).`,
          { code: res.status >= 400 ? classifyStatus(res.status).code : CODES.BAD_RESPONSE, status: res.status }
        );
        noteError(lastErr.code, lastErr.message);
        throw lastErr;
      }

      if (json.errors && json.errors.length) {
        const first = json.errors[0] || {};
        const msg = first.message || 'GraphQL error';
        const ext = first.extensions || {};
        const throttled = ext.code === 'THROTTLED' || /throttl/i.test(msg);
        const code = throttled ? CODES.THROTTLE : (looksLikeAuthFailure(msg) ? CODES.AUTH : CODES.GRAPHQL);
        lastErr = new ShopifyError(msg, { code, errors: json.errors, status: res.status, retryable: throttled });
        if (throttled && attempt < retries) {
          metrics.throttles++;
          metrics.retries++;
          await sleep(Math.min(4000, 400 * Math.pow(2, attempt)) + Math.floor(Math.random() * 120));
          continue;
        }
        noteError(code, msg);
        throw lastErr;
      }

      if (!res.ok) {
        lastErr = new ShopifyError(`Storefront API responded ${res.status}`, classifyStatus(res.status));
        noteError(lastErr.code, lastErr.message);
        throw lastErr;
      }

      metrics.lastSuccessAt = new Date().toISOString();
      if (process.env.SHOPIFY_DEBUG === '1') {
        console.log(`[shopify] ${Date.now() - started}ms ok`);
      }
      return json.data;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ShopifyError) {
        if (err.retryable && attempt < retries) continue;
        throw err;
      }
      const timedOut = err && err.name === 'AbortError';
      lastErr = new ShopifyError(
        timedOut
          ? `Storefront API request timed out after ${timeoutMs}ms`
          : `Storefront API request failed: ${err.message}`,
        { code: timedOut ? CODES.TIMEOUT : CODES.NETWORK, retryable: true }
      );
      if (attempt < retries) {
        metrics.retries++;
        await sleep(Math.min(3000, 250 * Math.pow(2, attempt)) + Math.floor(Math.random() * 150));
        continue;
      }
      noteError(lastErr.code, lastErr.message);
      throw lastErr;
    }
  }
  throw lastErr || new ShopifyError('Storefront API request failed', { code: CODES.NETWORK });
}

/** Collect userErrors from a mutation payload into { ok, error }. */
function mutationResult(payload, key) {
  const node = payload && payload[key];
  const userErrors = (node && node.userErrors) || [];
  if (userErrors.length) {
    return {
      ok: false,
      error: userErrors.map(e => e.message).join(' '),
      fields: userErrors.map(e => e.field).filter(Boolean)
    };
  }
  return { ok: true, cart: node && node.cart };
}

module.exports = {
  gql,
  setEndpoint,
  clearEndpoint,
  isDemoOverride,
  ShopifyError,
  mutationResult,
  CODES,
  getMetrics,
  demoAllowed
};
