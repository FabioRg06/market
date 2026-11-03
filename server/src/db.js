// Base de datos central (vive en el computador de recepción).
// Usa el SQLite que trae Node 22 (node:sqlite), sin dependencias nativas.
//
// Cada tabla tiene una columna `rev`: un contador global que sube con cada
// escritura. Los teléfonos piden "todo lo que cambió desde la rev X", así no
// dependemos de que los relojes de los dispositivos estén bien.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.MARKET_DATA_DIR ?? path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'market.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blocks (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    rev        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id         TEXT PRIMARY KEY,
    block_id   TEXT NOT NULL REFERENCES blocks(id),
    number     TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    rev        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    price      INTEGER NOT NULL DEFAULT 0,
    std_qty    INTEGER NOT NULL DEFAULT 1,
    sort       INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    rev        INTEGER NOT NULL
  );

  -- Quién se queda en la habitación y a qué hora es su vuelo (lo llena recepción).
  CREATE TABLE IF NOT EXISTS guests (
    room_id     TEXT PRIMARY KEY REFERENCES rooms(id),
    guest_name  TEXT,
    flight_time TEXT,
    updated_at  INTEGER NOT NULL,
    rev         INTEGER NOT NULL
  );

  -- Inventario propio de una habitación cuando difiere del estándar (products.std_qty).
  CREATE TABLE IF NOT EXISTS room_inventory (
    room_id    TEXT NOT NULL REFERENCES rooms(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity   INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev        INTEGER NOT NULL,
    PRIMARY KEY (room_id, product_id)
  );

  -- Una revisión: alguien entra a la habitación, revisa y sale.
  CREATE TABLE IF NOT EXISTS inspections (
    id           TEXT PRIMARY KEY,
    room_id      TEXT NOT NULL REFERENCES rooms(id),
    inspector    TEXT NOT NULL,
    device_id    TEXT,
    started_at   INTEGER NOT NULL,
    finished_at  INTEGER,
    restocked_at INTEGER,
    restocked_by TEXT,
    notes        TEXT,
    updated_at   INTEGER NOT NULL,
    rev          INTEGER NOT NULL
  );

  -- Lo que se consumió en una revisión (id = "<inspection_id>:<product_id>").
  CREATE TABLE IF NOT EXISTS inspection_items (
    id            TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspections(id),
    product_id    TEXT NOT NULL REFERENCES products(id),
    quantity      INTEGER NOT NULL,
    unit_price    INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL,
    rev           INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_inspections_room ON inspections(room_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_inspections_started ON inspections(started_at);
  CREATE INDEX IF NOT EXISTS idx_items_inspection ON inspection_items(inspection_id);
`);

export function nextRev() {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'rev'`).get();
  const rev = (row ? Number(row.value) : 0) + 1;
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('rev', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(rev));
  return rev;
}

export function currentRev() {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'rev'`).get();
  return row ? Number(row.value) : 0;
}

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
