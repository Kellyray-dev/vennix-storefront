#!/usr/bin/env node
'use strict';
/**
 * doctor.js — configuration and deployment sanity check, no network required.
 *
 * Run it before a deploy (CI runs it too). It answers the questions that are
 * invisible until something is already broken:
 *
 *   - Are we pointing at a real store, or accidentally at the demo gateway?
 *   - Is the API version the current stable one?
 *   - Will cookies be Secure and rate limiting see the real client IP behind
 *     this deployment's proxy?
 *   - Is a strict CSP being enforced?
 *   - Does the site still advertise a placeholder domain in canonicals?
 *   - Is anything in the repo leaking a private token?
 *
 * Usage: node scripts/doctor.js [--json]
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
require('../lib/env').loadEnv({ cwd: ROOT, quiet: true });

const results = [];
function check(label, level, detail = '') {
  results.push({ label, level, detail });
  const mark = level === 'ok' ? '✓' : level === 'warn' ? '!' : '✗';
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
}
function section(name) { console.log(`\n${name}`); }

const asJson = process.argv.includes('--json');
if (!asJson) console.log('\nVennix — configuration doctor\n' + '─'.repeat(64));

section('Environment');
const nodeMajor = Number(process.version.slice(1).split('.')[0]);
check('Node version', nodeMajor >= 18 ? 'ok' : 'error', `${process.version} (requires >= 18)`);
check('NODE_ENV', process.env.NODE_ENV === 'production' ? 'ok' : 'warn',
  process.env.NODE_ENV || 'unset (cookies will not be Secure, HSTS off)');
const envFiles = ['.env.local', '.env'].filter(f => fs.existsSync(path.join(ROOT, f)));
check('env file', envFiles.length ? 'ok' : 'warn',
  envFiles.length ? `${envFiles.join(', ')} (git-ignored)` : 'none — relying on the host environment');

section('Shopify connection');
const config = require('../lib/shopify/config');
let cfg = null;
try {
  cfg = config.getConfig();
} catch (err) {
  check('configuration parses', 'error', err.message);
}
if (cfg) {
  check('mode', cfg.demo ? 'warn' : 'ok',
    cfg.demo ? 'DEMO (fixture catalogue — no store configured)' : `live → ${cfg.domain}`);
  check('API version', cfg.version === config.DEFAULT_API_VERSION ? 'ok' : 'warn',
    `${cfg.version}${cfg.version === config.DEFAULT_API_VERSION ? ' (current stable)' : ` (current stable is ${config.DEFAULT_API_VERSION})`}`);
  check('Storefront token', cfg.demo ? 'warn' : 'ok',
    cfg.demo ? 'not configured (demo needs none)' : require('../lib/security').redact(cfg.token));
  if (!cfg.demo) {
    check('checkout/account host', cfg.primaryDomain ? 'ok' : 'warn', cfg.primaryDomain || 'unset');
    check('demo fallback', config.liveModeLocked() ? 'ok' : 'warn',
      config.liveModeLocked() ? 'locked out while a store is configured' : 'VENNIX_ALLOW_DEMO is on — demo is reachable');
  }
}

section('Deployment');
const settings = require('../lib/settings');
const s = settings.get();
const placeholder = /(example\.com|example\.myshopify|localhost|^vennix\.test)/i.test(String(s.domain || ''));
check('public site domain (canonicals, sitemap)', placeholder ? 'warn' : 'ok',
  `${s.domain}${placeholder ? ' — looks like a placeholder; set PUBLIC_SITE_DOMAIN' : ''}`);
check('TRUST_PROXY', process.env.TRUST_PROXY ? 'ok' : 'warn',
  process.env.TRUST_PROXY ? 'on — client IP from X-Forwarded-For, Secure cookies from X-Forwarded-Proto'
    : 'off — rate limiting keys on the socket IP (set TRUST_PROXY=1 behind a proxy)');
const cspMode = require('../lib/security').cspMode();
check('Content-Security-Policy', cspMode === 'enforce' ? 'ok' : 'warn',
  cspMode === 'enforce' ? 'enforced (nonce-based, per request)'
    : cspMode === 'report-only' ? 'report-only (CSP_MODE=report-only)' : 'off (CSP_MODE=off)');
check('catalogue cache TTL', 'ok', `${cfg ? cfg.checkoutCacheTtlMs : 15000}ms (Shopify stays authoritative for cart/checkout)`);
check('compression', process.env.COMPRESSION_OFF === '1' ? 'warn' : 'ok',
  process.env.COMPRESSION_OFF === '1' ? 'disabled by COMPRESSION_OFF=1' : 'brotli → gzip (zero dependencies)');

section('Repository hygiene');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const repoUrl = pkg.repository && pkg.repository.url ? pkg.repository.url : '';
const metaOk = repoUrl.includes('kellyraydev/vennix-storefront');
check('package.json repository/bugs/homepage', metaOk ? 'ok' : 'error', metaOk ? 'kellyraydev/vennix-storefront' : repoUrl || 'missing');

const legacyRefs = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) {
      const src = fs.readFileSync(full, 'utf8');
      if (/require\(['"][^'"]*legacy\/(store|commerce|auth|admin|emails)/.test(src)) legacyRefs.push(path.relative(ROOT, full));
    }
  }
};
walk(path.join(ROOT, 'lib'));
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
if (/require\(['"][^'"]*legacy\//.test(serverSrc)) legacyRefs.push('server.js');
check('retired commerce backend stays isolated in legacy/', legacyRefs.length === 0 ? 'ok' : 'error',
  legacyRefs.length ? legacyRefs.join(', ') : 'nothing outside legacy/ requires it');

const tokenish = /(shpat_|shpss_|shpca_|shppa_)[A-Za-z0-9]{16,}/;
const leaked = [];
for (const dir of ['public', 'lib', 'scripts', 'shopify-theme', 'config']) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) continue;
  const recurse = d => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) recurse(full);
      else if (/\.(js|json|liquid|css|html|md)$/.test(entry.name)) {
        if (tokenish.test(fs.readFileSync(full, 'utf8'))) leaked.push(path.relative(ROOT, full));
      }
    }
  };
  recurse(base);
}
check('no hard-coded Shopify tokens in the tree', leaked.length === 0 ? 'ok' : 'error', leaked.join(', '));

const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
check('.gitignore covers .env and runtime leads', /\.env/.test(gitignore) && /leads\.json/.test(gitignore) ? 'ok' : 'warn');

const counts = results.reduce((acc, r) => { acc[r.level] = (acc[r.level] || 0) + 1; return acc; }, {});
const exitCode = counts.error ? 1 : 0;

if (asJson) {
  console.log(JSON.stringify({ counts, results }, null, 2));
} else {
  console.log('\n' + '─'.repeat(64));
  console.log(`  ${counts.ok || 0} ok · ${counts.warn || 0} warning(s) · ${counts.error || 0} error(s)`);
  if (counts.error) console.log('\n  Fix the errors above before deploying.');
  else if (!cfg || cfg.demo) console.log('\n  Warnings only. Set SHOPIFY_STORE_DOMAIN + SHOPIFY_STOREFRONT_ACCESS_TOKEN to go live.');
  console.log('');
}
process.exit(exitCode);
