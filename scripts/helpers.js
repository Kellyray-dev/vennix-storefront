'use strict';
/**
 * helpers.js — shared bits for the verification scripts.
 *
 * `ensureBase()` is the important one: when no base URL is passed (and
 * BASE_URL is unset) it boots a throwaway storefront on an ephemeral port and
 * returns a stop() function. Every suite therefore runs against a *fresh*
 * process, which means a clean rate-limit table and a clean cart memory —
 * suites can be run in any order, or twice in a row, without inheriting each
 * other's state.
 *
 * With an explicit base URL (CI passes one, or you point a suite at a running
 * server) nothing is spawned and nothing is stopped.
 */
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Shopify connection variables the offline suites must never inherit. */
const LIVE_ENV_KEYS = [
  'SHOPIFY_STORE_DOMAIN', 'SHOPIFY_STOREFRONT_ACCESS_TOKEN', 'SHOPIFY_API_VERSION',
  'SHOPIFY_PRIMARY_DOMAIN', 'SHOPIFY_ACCOUNT_URL', 'SHOPIFY_CHECKOUT_HOSTS'
];

/**
 * Env for a throwaway offline child server: strip any live-store
 * configuration from the inherited environment AND stop the child re-reading
 * it from `.env` (VENNIX_SKIP_ENV_FILE). The offline chain asserts fixture
 * content, so it must render the demo catalogue even on a machine that is
 * configured for the live store. Explicit `extra` keys always win.
 */
function offlineChildEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of LIVE_ENV_KEYS) delete env[key];
  return { ...env, VENNIX_SKIP_ENV_FILE: '1', ...extra };
}

async function startTestServer({ env = {} } = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: offlineChildEnv({ PORT: '0', HOST: '127.0.0.1', ...env }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => { log += d.toString(); });
  child.stderr.on('data', d => { log += d.toString(); });

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${log}`)), 20000);
    const check = () => {
      const m = /Storefront listening on http:\/\/[^\s:]+:(\d+)/.exec(log);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); return; }
      setTimeout(check, 100);
    };
    check();
  });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) break;
    } catch { /* keep waiting */ }
    await wait(150);
  }
  return {
    base,
    port,
    log: () => log,
    stop: () => new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } resolve(); }, 3000);
    })
  };
}

/**
 * Resolve the base URL for a suite: explicit argument/BASE_URL wins, otherwise
 * a throwaway server is started for this suite.
 */
async function ensureBase(input) {
  const explicit = String(input || process.env.BASE_URL || '').trim();
  if (explicit) return { base: explicit.replace(/\/$/, ''), stop: async () => {}, managed: false };
  const server = await startTestServer();
  return { base: server.base, stop: server.stop, managed: true, server };
}

module.exports = { ensureBase, startTestServer, offlineChildEnv, wait };
