'use strict';
/**
 * leads.js — tiny local store for NON-COMMERCE captures only:
 * newsletter signups, contact messages, back-in-stock alert requests and
 * pending review submissions.
 *
 * This is deliberately NOT a product/inventory/order database — none of it
 * can contradict Shopify, which remains the single source of truth for
 * commerce. Swap points for real tooling (Klaviyo, Judge.me, …) are
 * documented in the README.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.LEADS_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'leads.json');

const TABLES = ['subscribers', 'messages', 'backInStock', 'reviews', 'activity'];

let db = null;
let writeScheduled = false;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function emptyDb() {
  const d = { meta: { version: 1, createdAt: new Date().toISOString() }, sequences: {} };
  for (const t of TABLES) d[t] = [];
  return d;
}

function load() {
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const t of TABLES) if (!Array.isArray(db[t])) db[t] = [];
    } catch (err) {
      const backup = DB_FILE.replace('.json', `.corrupt-${Date.now()}.json`);
      fs.renameSync(DB_FILE, backup);
      console.error(`[leads] leads.json unreadable (${err.message}); moved to ${path.basename(backup)} and starting fresh.`);
      db = emptyDb();
    }
  } else {
    db = emptyDb();
  }
  return db;
}

function getDb() { return db || load(); }

function saveNow() {
  ensureDir();
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
  writeScheduled = false;
}

function save() {
  if (writeScheduled) return;
  writeScheduled = true;
  setTimeout(() => { try { saveNow(); } catch (e) { console.error('[leads] save failed', e); } }, 120);
}

function nextId(table) {
  const d = getDb();
  d.sequences[table] = (d.sequences[table] || 0) + 1;
  save();
  const prefix = { subscribers: 'sub', messages: 'msg', backInStock: 'ntf', reviews: 'rev', activity: 'act' }[table] || table.slice(0, 3);
  return `${prefix}_${d.sequences[table].toString().padStart(6, '0')}`;
}

function uid(prefix = 'id') { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }

function all(table) { return getDb()[table] || []; }
function find(table, predicate) { return all(table).find(predicate); }

function insert(table, row) {
  const d = getDb();
  if (!d[table]) d[table] = [];
  const record = { id: row.id || nextId(table), createdAt: row.createdAt || new Date().toISOString(), ...row };
  d[table].push(record);
  save();
  return record;
}

function update(table, id, patch) {
  const row = getDb()[table].find(r => r.id === id);
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: new Date().toISOString() });
  save();
  return row;
}

function logActivity(actor, action, detail) {
  return insert('activity', { actor, action, detail, at: new Date().toISOString() });
}

module.exports = { DB_FILE, TABLES, getDb, save, saveNow, all, find, insert, update, nextId, uid, logActivity };
