'use strict';
/**
 * ratelimit.js — tiny in-memory sliding-window limiter keyed on IP + route.
 * Single-process only; enough to blunt credential stuffing and form spam.
 * Uses the socket address by default; only trusts X-Forwarded-For when
 * TRUST_PROXY=1 (deployments behind a reverse proxy).
 */

function getClientIp(req) {
  const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return xff.toString().split(',')[0].trim();
  }
  return (req.socket.remoteAddress || 'unknown').toString();
}

function makeLimiter({ maxBuckets = 5000, pruneTo = 4000 } = {}) {
  const buckets = new Map();

  function prune(windowMs) {
    if (buckets.size <= maxBuckets) return;
    const now = Date.now();
    for (const [k, v] of buckets) {
      const filtered = v.filter(t => now - t < windowMs);
      if (filtered.length === 0) buckets.delete(k);
      else if (filtered.length !== v.length) buckets.set(k, filtered);
      if (buckets.size <= pruneTo) break;
    }
  }

  /** Returns true when the request is allowed. */
  function allow(req, key, { windowMs = 60_000, max = 10 } = {}) {
    const ip = getClientIp(req);
    const bucketKey = `${ip}:${key}`;
    const now = Date.now();
    let bucket = buckets.get(bucketKey);
    bucket = (bucket || []).filter(t => now - t < windowMs);
    if (bucket.length >= max) {
      if (bucket.length === 0) buckets.delete(bucketKey);
      else buckets.set(bucketKey, bucket);
      prune(windowMs);
      return false;
    }
    bucket.push(now);
    buckets.set(bucketKey, bucket);
    prune(windowMs);
    return true;
  }

  return { allow };
}

module.exports = { makeLimiter, getClientIp };
