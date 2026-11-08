// Catálogo del hotel. Los bloques (C, K, L, BW, R, 500) y sus series de habitaciones
// (C101–C122, C201–C223…) se crean desde app/src/catalog.json la primera vez; después
// recepción los edita desde la sección Bloques y las habitaciones se regeneran.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nextRev, transaction } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, '..', '..', 'app', 'src', 'catalog.json');

export const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const knownType = new Map();
for (const [type, numbers] of Object.entries(catalog.roomTypes ?? {})) for (const n of numbers) knownType.set(n, type);
const blockDefault = new Map(catalog.blocks.map((b) => [b.id, b.defaultType]));

/** Habitaciones que salen de las series de un bloque. */
function expand(ranges) {
  const out = [];
  for (const [prefix, from, to] of ranges) for (let n = Number(from); n <= Number(to); n++) out.push(`${prefix}${n}`);
  return out;
}

/**
 * Crea/activa las habitaciones de un bloque según sus series y desactiva las que sobran.
 * El orden global va por bloque y luego por serie.
 */
export function regenerateRooms(blockId) {
  const block = db.prepare(`SELECT * FROM blocks WHERE id = ?`).get(blockId);
  if (!block?.ranges) return;
  const numbers = expand(JSON.parse(block.ranges));
  const now = Date.now();
  const insert = db.prepare(`INSERT OR IGNORE INTO rooms (id, block_id, number, type, sort, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const fix = db.prepare(
    `UPDATE rooms SET block_id = ?, number = ?, sort = ?, active = 1, updated_at = ?, rev = ?
      WHERE id = ? AND (block_id != ? OR number != ? OR sort != ? OR active != 1)`
  );
  numbers.forEach((number, i) => {
    const sort = block.sort * 10000 + i;
    const type = knownType.get(number) ?? blockDefault.get(blockId) ?? catalog.defaultType;
    insert.run(`r${number}`, blockId, number, type, sort, now, nextRev());
    fix.run(blockId, number, sort, now, nextRev(), `r${number}`, blockId, number, sort);
  });
  const keep = new Set(numbers.map((n) => `r${n}`));
  const off = db.prepare(`UPDATE rooms SET active = 0, updated_at = ?, rev = ? WHERE id = ?`);
  for (const { id } of db.prepare(`SELECT id FROM rooms WHERE block_id = ? AND active = 1`).all(blockId)) if (!keep.has(id)) off.run(now, nextRev(), id);
}

/** Crea lo que falte del catálogo sin pisar lo que recepción haya cambiado. */
export function ensureCatalog() {
  const now = Date.now();
  transaction(() => {
    const insertBlock = db.prepare(
      `INSERT OR IGNORE INTO blocks (id, name, code, ranges, sort, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    // Bloques que ya existían de una versión anterior (sin series) reciben las del catálogo.
    const fillBlock = db.prepare(
      `UPDATE blocks SET name = ?, code = ?, ranges = ?, sort = ?, updated_at = ?, rev = ? WHERE id = ? AND ranges IS NULL`
    );
    catalog.blocks.forEach((b, i) => {
      insertBlock.run(b.id, b.name, b.code, JSON.stringify(b.ranges), i + 1, now, nextRev());
      fillBlock.run(b.name, b.code, JSON.stringify(b.ranges), i + 1, now, nextRev(), b.id);
    });

    // Habitaciones de todos los bloques con series; las de bloques sin series quedan inactivas.
    const withRanges = db.prepare(`SELECT id FROM blocks WHERE ranges IS NOT NULL ORDER BY sort`).all();
    for (const { id } of withRanges) regenerateRooms(id);
    const off = db.prepare(`UPDATE rooms SET active = 0, updated_at = ?, rev = ? WHERE id = ?`);
    for (const { id } of db.prepare(`SELECT r.id FROM rooms r JOIN blocks b ON b.id = r.block_id WHERE r.active = 1 AND b.ranges IS NULL`).all())
      off.run(now, nextRev(), id);

    const product = db.prepare(
      `INSERT OR IGNORE INTO products (id, name, price, presentation, sort, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of catalog.products) product.run(p.id, p.name, p.price, p.presentation ?? null, p.sort, now, nextRev());

    const typeInv = db.prepare(
      `INSERT OR IGNORE INTO type_inventory (type, product_id, quantity, updated_at, rev) VALUES (?, ?, ?, ?, ?)`
    );
    if (db.prepare(`SELECT COUNT(*) AS n FROM type_inventory`).get().n === 0)
      for (const [type, items] of Object.entries(catalog.typeInventory))
        for (const [productId, qty] of Object.entries(items)) typeInv.run(type, productId, qty, now, nextRev());

    applyWayiraMenu(now);
  });
}

/**
 * Una sola vez: precios y presentaciones del menú Market Wayira, Club Colombia, el tipo
 * "Solo nevera" y Ranchería solo con seco. Después todo se ajusta desde recepción.
 */
function applyWayiraMenu(now) {
  const done = db.prepare(`SELECT value FROM meta WHERE key = 'menu_wayira'`).get();
  if (done) return;
  const upd = db.prepare(`UPDATE products SET name = ?, price = ?, presentation = ?, sort = ?, updated_at = ?, rev = ? WHERE id = ?`);
  for (const p of catalog.products) upd.run(p.name, p.price, p.presentation ?? null, p.sort, now, nextRev(), p.id);
  const inv = db.prepare(
    `INSERT INTO type_inventory (type, product_id, quantity, updated_at, rev) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(type, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at, rev = excluded.rev`
  );
  for (const type of ['SN', 'CM'])
    for (const [productId, qty] of Object.entries(catalog.typeInventory[type])) inv.run(type, productId, qty, now, nextRev());
  inv.run('VIP', 'club_colombia', catalog.typeInventory.VIP.club_colombia ?? 0, now, nextRev());
  db.prepare(`UPDATE type_inventory SET quantity = 0, updated_at = ?, rev = ? WHERE type = 'SM'`).run(now, nextRev());
  db.prepare(`UPDATE rooms SET type = 'SS', updated_at = ?, rev = ? WHERE block_id = 'r' AND type = 'CM'`).run(now, nextRev());
  db.prepare(`INSERT INTO meta (key, value) VALUES ('menu_wayira', '1')`).run();
}
