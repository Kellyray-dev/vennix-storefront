#!/usr/bin/env node
/**
 * Render check.
 *
 * Boots the app on a spare port, requests every page shape, and fails on any
 * error status, stack trace or unrendered template expression in the response.
 * This is the fast guard that catches template-time crashes (the kind that only
 * appear when a page actually renders) without needing a browser or a manually
 * started server — so `npm run check` can stay instant while this runs in CI
 * and before every commit.
 *
 * Usage: node scripts/render-check.js [port]
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { offlineChildEnv } = require('./helpers');

const PORT = Number(process.argv[2] || 3099);
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;

const PAGES = [
  ['/', 'home'],
  ['/collections/all', 'collection index'],
  ['/collections/women', 'collection'],
  ['/collections/women?sort=price-asc&color=Clay', 'collection with filters'],
  ['/collections/active?tag=training', 'tag-filtered collection'],
  ['/collections/sale', 'virtual sale collection'],
  ['/products/atlas-heavyweight-hoodie', 'product with variants + monogram'],
  ['/products/velocity-long-sleeve-base-layer', 'product without reviews'],
  ['/products/gift-card', 'digital product'],
  ['/cart', 'cart'],
  ['/checkout', 'checkout handoff'],
  ['/account', 'account hub'],
  ['/account/wishlist', 'wishlist'],
  ['/pages/about', 'cms page'],
  ['/pages/faq', 'faq page'],
  ['/pages/size-guide', 'size guide'],
  ['/pages/contact', 'contact'],
  ['/pages/sustainability', 'sustainability'],
  ['/blogs/journal', 'journal index'],
  ['/blogs/journal/why-we-chose-480-gsm', 'journal post'],
  ['/gift-cards', 'gift cards'],
  ['/track', 'order tracking'],
  ['/search?q=hoodie', 'search results'],
  ['/search?q=zzzznothing', 'empty search'],
  ['/sitemap.xml', 'sitemap'],
  ['/robots.txt', 'robots'],
  ['/this-page-should-not-exist', '404']
];

const EXPECTED_404 = new Set(['/this-page-should-not-exist']);

// anything that means a template blew up rather than rendered
const CRASH_MARKERS = [
  'ReferenceError',
  'TypeError',
  'is not defined',
  'is not a function',
  'Cannot read properties',
  'Unexpected token',
  'undefined</',            // unrendered interpolation landing in markup
  '${',                     // a template literal that never evaluated
  '[object Object]'
];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForServer(attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(BASE + '/');
      if (response.ok) return true;
    } catch (error) { /* not up yet */ }
    await wait(250);
  }
  return false;
}

(async function main() {
  console.log(`\nVennix render check — port ${PORT}\n`);

  // Offline suite: the URL list below is the FIXTURE catalogue, so the child
  // must render demo mode even on a machine configured for the live store
  // (offlineChildEnv strips the Shopify variables and skips .env entirely).
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: offlineChildEnv({ PORT: String(PORT), NODE_ENV: 'test' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
  server.stderr.on('data', chunk => { serverLog += chunk.toString(); });

  const cleanup = () => { if (!server.killed) server.kill('SIGTERM'); };
  process.on('exit', cleanup);

  if (!(await waitForServer())) {
    console.log('  ✗ the server never came up');
    console.log(serverLog.split('\n').slice(-12).join('\n'));
    cleanup();
    process.exit(1);
  }

  let failures = 0;
  let checked = 0;

  for (const [route, label] of PAGES) {
    let response;
    let body = '';
    try {
      response = await fetch(BASE + route);
      body = await response.text();
    } catch (error) {
      failures += 1;
      console.log(`  ✗ ${route.padEnd(48)} request failed (${error.message})`);
      continue;
    }
    checked += 1;

    const expected = EXPECTED_404.has(route) ? 404 : 200;
    if (response.status !== expected) {
      failures += 1;
      console.log(`  ✗ ${route.padEnd(48)} ${response.status}, expected ${expected} — ${label}`);
      continue;
    }

    const marker = CRASH_MARKERS.find(m => body.includes(m));
    if (marker) {
      failures += 1;
      const at = body.indexOf(marker);
      console.log(`  ✗ ${route.padEnd(48)} rendered "${marker}" — ${body.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ')}`);
      continue;
    }

    const isHtml = (response.headers.get('content-type') || '').includes('html');
    if (isHtml && body.trim().length < 400) {
      failures += 1;
      console.log(`  ✗ ${route.padEnd(48)} suspiciously small response (${body.length} bytes)`);
      continue;
    }

    console.log(`  ✓ ${route.padEnd(48)} ${response.status} · ${label}`);
  }

  // any uncaught crash in the server log is a failure too
  const stackLines = serverLog.split('\n').filter(line => /^\s+at /.test(line));
  if (stackLines.length) {
    failures += 1;
    console.log('\n  ✗ the server logged a stack trace:');
    console.log(serverLog.split('\n').slice(-14).map(l => '    ' + l).join('\n'));
  }

  cleanup();

  console.log(`\n${'─'.repeat(48)}`);
  console.log(`  ${checked - failures} pages rendered · ${failures} problem(s)`);
  console.log('');

  // give the child a moment to exit so the port is free for the next step
  await wait(150);
  process.exit(failures ? 1 : 0);
})();
