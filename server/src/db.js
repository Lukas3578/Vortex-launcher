'use strict';
/**
 * Speicher: PostgreSQL (DATABASE_URL gesetzt) oder SQLite-Datei (DATA_DIR).
 *
 * Warum beides: Kostenlose Hoster (Render & Co.) loeschen die Festplatte bei
 * jedem Neustart -- dort gehoert eine Postgres-Datenbank dazu (z. B. Neon,
 * kostenlos). Auf einem eigenen Server/VPS reicht die SQLite-Datei.
 *
 * Alle Abfragen sind mit "?" geschrieben; fuer Postgres werden daraus $1, $2 ...
 */
const path = require('path');
const fs = require('fs');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     uuid TEXT PRIMARY KEY, name TEXT NOT NULL, created BIGINT NOT NULL, last_seen BIGINT NOT NULL,
     settings TEXT NOT NULL DEFAULT '{}', profile TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, uuid TEXT NOT NULL, created BIGINT NOT NULL, expires BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS friends (
     owner TEXT NOT NULL, friend TEXT NOT NULL, since BIGINT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
     nickname TEXT NOT NULL DEFAULT '', muted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner, friend))`,
  `CREATE TABLE IF NOT EXISTS requests (src TEXT NOT NULL, dst TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY (src, dst))`,
  `CREATE TABLE IF NOT EXISTS blocks (owner TEXT NOT NULL, target TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY (owner, target))`,
  `CREATE TABLE IF NOT EXISTS convs (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
     created BIGINT NOT NULL, last_msg BIGINT NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS members (
     conv TEXT NOT NULL, uuid TEXT NOT NULL, joined BIGINT NOT NULL, last_read BIGINT NOT NULL DEFAULT 0,
     muted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (conv, uuid))`,
  `CREATE TABLE IF NOT EXISTS messages (
     id BIGINT PRIMARY KEY, conv TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL, created BIGINT NOT NULL,
     edited BIGINT NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, reply_to BIGINT NOT NULL DEFAULT 0,
     kind TEXT NOT NULL DEFAULT 'text', extra TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS messages_conv ON messages (conv, id)`,
  `CREATE TABLE IF NOT EXISTS cosmetics (
     uuid TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', image TEXT NOT NULL DEFAULT '', image_hash TEXT NOT NULL DEFAULT '',
     image_banned INTEGER NOT NULL DEFAULT 0, updated BIGINT NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS cosmetic_reports (reporter TEXT NOT NULL, target TEXT NOT NULL, image_hash TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL, PRIMARY KEY (reporter, target))`,
  `CREATE TABLE IF NOT EXISTS wallets (
     uuid TEXT PRIMARY KEY, balance BIGINT NOT NULL DEFAULT 0, earned BIGINT NOT NULL DEFAULT 0, minutes BIGINT NOT NULL DEFAULT 0,
     created BIGINT NOT NULL, updated BIGINT NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS earnings (uuid TEXT NOT NULL, day TEXT NOT NULL, minutes BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (uuid, day))`,
  `CREATE TABLE IF NOT EXISTS owned (uuid TEXT NOT NULL, item TEXT NOT NULL, source TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY (uuid, item))`,
  `CREATE TABLE IF NOT EXISTS coin_tx (
     id TEXT PRIMARY KEY, uuid TEXT NOT NULL, kind TEXT NOT NULL, amount BIGINT NOT NULL, item TEXT NOT NULL DEFAULT '',
     other TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS coin_tx_uuid ON coin_tx (uuid, created)`,
  `CREATE TABLE IF NOT EXISTS shop_items (
     id TEXT PRIMARY KEY, cat TEXT NOT NULL, name TEXT NOT NULL, price BIGINT NOT NULL, rarity TEXT NOT NULL,
     giftable INTEGER NOT NULL DEFAULT 1, limited INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
     deleted INTEGER NOT NULL DEFAULT 0, updated BIGINT NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS shop_admins (uuid TEXT PRIMARY KEY, name TEXT NOT NULL, created BIGINT NOT NULL)`
];

const NUMERIC = new Set(['created', 'last_seen', 'since', 'favorite', 'muted', 'expires', 'last_msg', 'joined',
  'last_read', 'id', 'edited', 'deleted', 'reply_to', 'n', 'updated', 'image_banned',
  'balance', 'earned', 'minutes', 'amount', 'price', 'giftable', 'limited', 'active']);

/** Postgres liefert BIGINT als Text -- hier wieder Zahlen daraus machen. */
function fixRow(row) {
  if (!row) return row;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (NUMERIC.has(k) && (typeof v === 'bigint' || (typeof v === 'string' && /^-?\d+$/.test(v)))) row[k] = Number(v);
  }
  return row;
}

async function open(env = process.env) {
  if (env.DATABASE_URL) {
    const { Pool } = require('pg');
    const ssl = /sslmode=disable/.test(env.DATABASE_URL) || /localhost|127\.0\.0\.1/.test(env.DATABASE_URL)
      ? false : { rejectUnauthorized: false };
    const pool = new Pool({ connectionString: env.DATABASE_URL, ssl, max: 5 });
    const toPg = sql => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
    const db = {
      kind: 'postgres',
      async all(sql, params = []) { return (await pool.query(toPg(sql), params)).rows.map(fixRow); },
      async get(sql, params = []) { return fixRow((await pool.query(toPg(sql), params)).rows[0]); },
      async run(sql, params = []) { const r = await pool.query(toPg(sql), params); return { changes: r.rowCount }; },
      async close() { await pool.end(); }
    };
    for (const s of SCHEMA) await db.run(s);
    return db;
  }
  const { DatabaseSync } = require('node:sqlite');
  const dir = env.DATA_DIR || path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = env.DB_FILE || path.join(dir, 'friends.db');
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  for (const s of SCHEMA) sqlite.exec(s);
  const cache = new Map();
  const stmt = sql => { let s = cache.get(sql); if (!s) { s = sqlite.prepare(sql); cache.set(sql, s); } return s; };
  const norm = params => params.map(p => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
  return {
    kind: 'sqlite',
    file,
    async all(sql, params = []) { return stmt(sql).all(...norm(params)).map(r => fixRow({ ...r })); },
    async get(sql, params = []) { const r = stmt(sql).get(...norm(params)); return r ? fixRow({ ...r }) : undefined; },
    async run(sql, params = []) { const r = stmt(sql).run(...norm(params)); return { changes: Number(r.changes) }; },
    async close() { sqlite.close(); }
  };
}

module.exports = { open };
