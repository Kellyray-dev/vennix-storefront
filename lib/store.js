'use strict';
/**
 * store.js — dependency-free JSON document store with atomic writes.
 * Mirrors the shape of a relational schema (tables + indexes) so it can be
 * swapped for Postgres/MySQL/SQLite without touching call sites.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const EMail_DIR = path.join(DATA_DIR, 'emails');

const TABLES = [
  'settings', 'products', 'collections', 'customers', 'orders', 'carts',
  'discounts', 'reviews', 'subscribers', 'messages', 'pages', 'posts',
  'sessions', 'activity', 'inventoryLog', 'emails'
];

let db = null;
let writeScheduled = false;

function ensureDirs() {
  for (const d of [DATA_DIR, EMail_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function emptyDb() {
  const d = { meta: { version: 1, createdAt: new Date().toISOString() }, sequences: {} };
  for (const t of TABLES) d[t] = t === 'settings' ? {} : [];
  return d;
}

function load() {
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const t of TABLES) if (db[t] === undefined) db[t] = t === 'settings' ? {} : [];
    } catch (err) {
      const backup = DB_FILE.replace('.json', `.corrupt-${Date.now()}.json`);
      fs.renameSync(DB_FILE, backup);
      console.error(`[store] db.json was unreadable (${err.message}); moved to ${path.basename(backup)} and reseeding.`);
      db = emptyDb();
    }
  } else {
    db = emptyDb();
  }
  return db;
}

function getDb() { return db || load(); }

function saveNow() {
  ensureDirs();
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
  writeScheduled = false;
}

/** Debounced persistence — call after any mutation. */
function save() {
  if (writeScheduled) return;
  writeScheduled = true;
  setTimeout(() => { try { saveNow(); } catch (e) { console.error('[store] save failed', e); } }, 120);
}

const ID_PREFIX = {
  products: 'prd', orders: 'ord', customers: 'cus', collections: 'col', discounts: 'dsc',
  reviews: 'rev', carts: 'crt', messages: 'msg', subscribers: 'sub', pages: 'pag', posts: 'pst',
  sessions: 'ses', activity: 'act', inventoryLog: 'inv', emails: 'eml', addresses: 'adr',
  backInStock: 'ntf'
};

function nextId(table) {
  const d = getDb();
  d.sequences[table] = (d.sequences[table] || 0) + 1;
  save();
  const prefix = ID_PREFIX[table] || table.slice(0, 3);
  return `${prefix}_${d.sequences[table].toString().padStart(6, '0')}`;
}

function uid(prefix = 'id') { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }

/* ------------------------------- querying ------------------------------- */
function all(table) { return getDb()[table] || []; }

function find(table, predicate) { return all(table).find(predicate); }

function filter(table, predicate) { return all(table).filter(predicate); }

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

function remove(table, id) {
  const d = getDb();
  const idx = d[table].findIndex(r => r.id === id);
  if (idx === -1) return false;
  d[table].splice(idx, 1);
  save();
  return true;
}

function logActivity(actor, action, detail) {
  return insert('activity', { actor, action, detail, at: new Date().toISOString() });
}

function writeEmail(file, html) {
  ensureDirs();
  const name = `${file}.html`;
  fs.writeFileSync(path.join(EMail_DIR, name), html);
  insert('emails', { file: name, subject: file, at: new Date().toISOString() });
  return name;
}

/** Re-seed helper: deletes db.json and reloads. Used by `npm run reset`. */
function reset() {
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  db = load();
  return db;
}

module.exports = {
  DATA_DIR, DB_FILE, EMAIL_DIR: EMail_DIR, TABLES,
  load, getDb, save, saveNow, reset,
  all, find, filter, insert, update, remove,
  nextId, uid, logActivity, writeEmail
};
