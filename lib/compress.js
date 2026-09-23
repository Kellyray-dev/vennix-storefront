'use strict';
/**
 * compress.js — zero-dependency response compression (brotli → gzip).
 *
 * The single biggest performance lever on this storefront: main.css (99 KB)
 * and main.js (57 KB) ship as ~16 KB and ~13 KB over the wire. Node ships
 * brotli and gzip in `node:zlib`, so this stays dependency-free.
 *
 * Compressed copies of static files are cached in memory (bounded), and every
 * compressed response carries `Vary: Accept-Encoding` so caches never hand a
 * brotli body to a client that asked for identity.
 */
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const MIN_BYTES = Number(process.env.COMPRESS_MIN_BYTES || 700);
const MAX_CACHE_ENTRIES = 64;

/** Content types worth compressing (text-based ones). */
function isCompressible(contentType) {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (!type) return false;
  if (type.startsWith('text/')) return true;
  return /^application\/(javascript|json|ld\+json|xml|xhtml\+xml|manifest\+json)$/.test(type) ||
    /^(image\/svg\+xml|image\/x-icon)$/.test(type);
}

/** Pick the best encoding the client actually offered. */
function chooseEncoding(acceptEncoding) {
  const header = String(acceptEncoding || '').toLowerCase();
  if (!header) return 'identity';
  // Respect q-values well enough: prefer br, then gzip, then deflate.
  const offers = header.split(',').map(part => {
    const [name, ...params] = part.trim().split(';');
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
    return { name: name.trim(), q: q ? Number(q.slice(2)) : 1 };
  }).filter(o => o.name && o.q > 0);
  const has = name => offers.some(o => o.name === name);
  if (has('br') || has('brotli')) return 'br';
  if (has('gzip')) return 'gzip';
  if (has('deflate')) return 'deflate';
  return 'identity';
}

function encodingHeader(encoding) {
  return encoding === 'identity' ? '' : encoding;
}

function brotliOptions() {
  return {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 4,         // fast, still ~gzip-level
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: 64 * 1024
    }
  };
}

/** Compress a buffer in one go (HTML, JSON-API responses). */
function compressBuffer(buffer, encoding) {
  if (encoding === 'identity') return Promise.resolve(buffer);
  return new Promise((resolve, reject) => {
    const done = (err, out) => (err ? reject(err) : resolve(out));
    if (encoding === 'br') zlib.brotliCompress(buffer, brotliOptions(), done);
    else if (encoding === 'gzip') zlib.gzip(buffer, { level: 6 }, done);
    else zlib.deflate(buffer, { level: 6 }, done);
  });
}

/** A transform stream for piping files through. */
function createCompressStream(encoding) {
  if (encoding === 'br') return zlib.createBrotliCompress(brotliOptions());
  if (encoding === 'gzip') return zlib.createGzip({ level: 6 });
  if (encoding === 'deflate') return zlib.createDeflate({ level: 6 });
  return null;
}

/* -------------------------- static-asset body cache ------------------------- */

const cache = new Map();

function cacheKey(filePath, stat, encoding) {
  return crypto.createHash('sha1')
    .update(`${filePath}|${stat.size}|${stat.mtimeMs}|${encoding}`)
    .digest('hex');
}

function cachedBody(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  // refresh recency
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function storeBody(key, buffer) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // evict oldest inserted
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, buffer);
}

function cacheStats() {
  return { entries: cache.size, max: MAX_CACHE_ENTRIES };
}

module.exports = {
  isCompressible,
  chooseEncoding,
  encodingHeader,
  compressBuffer,
  createCompressStream,
  MIN_BYTES,
  cacheKey, cachedBody, storeBody, cacheStats
};
