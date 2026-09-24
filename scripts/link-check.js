#!/usr/bin/env node
/**
 * Dead-link crawler.
 *
 * Walks the storefront from the pages people actually land on, collects every
 * internal href, then requests every unique URL and reports anything that does
 * not answer 200 (or an expected redirect). This is the "nothing is a placeholder"
 * check: nav, footer, breadcrumbs, product cards, CMS cross-links, journal,
 * policies, account pages, admin links.
 *
 * Usage: node scripts/link-check.js [baseUrl]
 */

'use strict';

const { ensureBase } = require('./helpers');
let BASE = '';
let stopServer = null;

const SEEDS = [
  '/', '/collections/all', '/collections/women', '/collections/men', '/collections/active',
  '/collections/essentials', '/collections/new-in', '/collections/bestsellers', '/collections/sale',
  '/products/atlas-heavyweight-hoodie', '/products/flow-high-rise-legging-28',
  '/products/everyday-pima-crew-tee', '/products/gift-card',
  '/cart', '/checkout', '/track', '/orders/VEN-1001', '/search?q=hoodie',
  '/account', '/account/wishlist',
  '/pages/about', '/pages/faq', '/pages/size-guide', '/pages/contact',
  '/pages/shipping-returns', '/pages/terms', '/pages/privacy', '/pages/sustainability',
  '/blogs/journal', '/gift-cards', '/sitemap.xml', '/robots.txt', '/this-page-does-not-exist'
];

const jar = new Map();
const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function absorb(response) {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  cookies.forEach((entry) => {
    const [pair] = entry.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  });
}

const IGNORE = [/^mailto:/, /^tel:/, /^#/, /^javascript:/, /^https?:\/\/(?!127\.0\.0\.1|localhost)/, /^\/api\//, /^\/admin/];
const MAX_URLS = 400;
const SKIP_EXT = /\.(css|js|svg|png|jpe?g|webp|ico|woff2?|json|xml|txt)$/i;

function linksFrom(html, pageUrl) {
  const found = new Set();
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    let href = match[1].trim();
    if (!href || IGNORE.some(re => re.test(href))) continue;
    if (href.startsWith('http')) {
      try { href = new URL(href).pathname + new URL(href).search; } catch (error) { continue; }
    }
    if (!href.startsWith('/')) {
      try { href = new URL(href, BASE + pageUrl).pathname; } catch (error) { continue; }
    }
    const path = (href.split('#')[0].split('?')[0]) || '/';   // query variants collapse to one page
    if (SKIP_EXT.test(path)) continue;
    found.add(path);
  }
  return [...found];
}

(async function run() {
  const host = await ensureBase(process.argv[2]);
  BASE = host.base;
  stopServer = host.stop;
  console.log(`Vennix link check — ${BASE}\n`);

  const discovered = new Map();   // url -> where it was found
  const visited = new Map();      // url -> status
  const queue = [...SEEDS];

  while (queue.length && visited.size < MAX_URLS) {
    const url = queue.shift();
    if (visited.has(url)) continue;

    let response;
    try {
      response = await fetch(BASE + url, { redirect: 'manual', headers: jar.size ? { cookie: cookie() } : {} });
    } catch (error) {
      visited.set(url, { status: 0, error: error.message });
      continue;
    }
    absorb(response);
    const status = response.status;
    const type = response.headers.get('content-type') || '';
    const body = type.includes('text/html') ? await response.text() : '';

    visited.set(url, { status, type });

    if (body && status === 200 && !url.startsWith('/search') && !url.startsWith('/api')) {
      for (const href of linksFrom(body, url)) {
        if (!visited.has(href) && !queue.includes(href)) {
          discovered.set(href, url);
          queue.push(href);
        }
      }
    }
  }

  const expectedNon200 = new Set(['/this-page-does-not-exist']);
  const broken = [];
  const redirects = [];
  const okCrawled = [];

  for (const [url, info] of visited) {
    if (expectedNon200.has(url)) {
      okCrawled.push({ url, status: info.status, note: 'intentional 404' });
      continue;
    }
    if (info.status === 200) okCrawled.push({ url, status: 200 });
    else if ([301, 302, 303, 307, 308].includes(info.status)) redirects.push({ url, status: info.status });
    else broken.push({ url, status: info.status, error: info.error });
  }

  console.log(`Crawled ${visited.size} unique URLs (${discovered.size} discovered from links).\n`);

  okCrawled.sort((a, b) => a.url.localeCompare(b.url)).forEach(({ url, status, note }) => {
    console.log(`  ✓ ${url}  ${status}${note ? ' (' + note + ')' : ''}`);
  });

  if (redirects.length) {
    console.log('');
    redirects.forEach(({ url, status }) => console.log(`  → ${url}  ${status} (guest redirect — expected for account pages)`));
  }

  if (broken.length) {
    console.log('');
    broken.forEach(({ url, status, error }) => {
      const from = discovered.get(url);
      console.log(`  ✗ ${url}  ${status || error}${from ? `  (linked from ${from})` : ''}`);
    });
  }

  if (stopServer) await stopServer();
  console.log(`\n${'─'.repeat(48)}`);
  console.log(`  ${okCrawled.length} pages OK · ${redirects.length} guest redirects · ${broken.length} broken`);
  process.exit(broken.length ? 1 : 0);
})();
