'use strict';
/**
 * env.js — zero-dependency `.env` loader.
 *
 * Lets you keep real Shopify credentials in a git-ignored `.env` (or
 * `.env.local`) instead of exporting them by hand. Real process environment
 * always wins, so a host (Render, Fly, Heroku, systemd, Docker) can override
 * anything without editing a file.
 *
 * Deliberately small: KEY=value, `export KEY=value`, `#` comments, optional
 * single/double quotes. No variable interpolation — a token is copied byte for
 * byte, because interpolating secrets is how secrets end up in shell history
 * and logs.
 *
 * This module is only loaded by the server and the live-verification scripts.
 * The offline test suite (scripts/test-shopify.js) intentionally does NOT load
 * it: those tests must run against the mock gateway with no store configured.
 */
const fs = require('fs');
const path = require('path');

const FILES = ['.env.local', '.env'];
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

function unquote(raw) {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = raw.slice(1, -1);
      // double quotes honour \n and \" ; single quotes are literal
      return first === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"') : inner;
    }
  }
  // strip trailing inline comments from unquoted values (# not preceded by space is left alone)
  const hash = raw.indexOf(' #');
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}

/**
 * Load .env files into process.env without clobbering existing values.
 * @returns {{loaded:string[], vars:string[]}} which files were read and which keys were set
 */
function loadEnv({ cwd = process.cwd(), override = false, quiet = false } = {}) {
  // Offline verification suites spawn server children with this set so a
  // developer's live .env never leaks into a suite that asserts fixture
  // content: the files are skipped entirely and the child boots in demo mode.
  if (process.env.VENNIX_SKIP_ENV_FILE === '1') return { loaded: [], vars: [] };
  const loaded = [];
  const vars = [];
  let alreadySet = 0;
  for (const file of FILES) {
    const file_path = path.join(cwd, file);
    let src;
    try { src = fs.readFileSync(file_path, 'utf8'); } catch { continue; }
    loaded.push(file);
    for (const rawLine of src.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const m = LINE.exec(rawLine);
      if (!m) continue;
      const key = m[1];
      if (!override && Object.prototype.hasOwnProperty.call(process.env, key)) {
        alreadySet++; // the real environment wins; the file value is ignored
        continue;
      }
      const value = unquote(m[2]);
      if (value === '') continue; // `KEY=` means "unset / use the default"
      process.env[key] = value;
      if (!vars.includes(key)) vars.push(key);
    }
  }
  if (!quiet && loaded.length) {
    // Never print values — only which keys arrived. When every key was
    // already present in the environment (e.g. a child process spawned by a
    // parent that loaded the same files), say so explicitly: "0 set" is not
    // the same as "file not found".
    const note = alreadySet && !vars.length
      ? `0 variable(s) set — all ${alreadySet} already present in the environment`
      : `${vars.length} variable(s) set${alreadySet ? `, ${alreadySet} already present in the environment` : ''}`;
    console.log(`[vennix] loaded ${loaded.join(', ')} (${note}; values not logged)`);
  }
  return { loaded, vars };
}

module.exports = { loadEnv };
