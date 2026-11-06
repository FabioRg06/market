// Catálogo fijo del hotel: bloques con código y rangos de habitaciones (C101, BW243, R701…),
// inventario global y lo que lleva cada tipo de habitación. Viene de app/src/catalog.json,
// el mismo archivo que trae la app, para que ambos usen los mismos ids y la tablet
// funcione sin conexión.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nextRev, transaction } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, '..', '..', 'app', 'src', 'catalog.json');

export const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

/** Mismo cálculo que app/src/rooms.ts. */
export function catalogRooms() {
  const typeOf = new Map();
  for (const [type, numbers] of Object.entries(catalog.roomTypes ?? {})) for (const n of numbers) typeOf.set(n, type);
  const out = [];
  for (const b of catalog.blocks)
    for (const [prefix, from, to] of b.ranges)
      for (let n = from; n <= to; n++) {
        const number = `${prefix}${n}`;
        out.push({ id: `r${number}`, number, block_id: b.id, sort: out.length, type: typeOf.get(number) ?? catalog.defaultType });
      }
  return out;
}

/** Crea lo que falte y desactiva habitaciones que ya no existen; no toca lo que recepción cambió. */
export function ensureCatalog() {
  const now = Date.now();
  transaction(() => {
    const block = db.prepare(`INSERT OR IGNORE INTO blocks (id, name, code, updated_at, rev) VALUES (?, ?, ?, ?, ?)`);
    const insertRoom = db.prepare(
      `INSERT OR IGNORE INTO rooms (id, block_id, number, type, sort, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const fixRoom = db.prepare(
      `UPDATE rooms SET block_id = ?, number = ?, sort = ?, active = 1, updated_at = ?, rev = ?
        WHERE id = ? AND (block_id != ? OR number != ? OR sort != ? OR active != 1)`
    );
    for (const b of catalog.blocks) block.run(b.id, b.name, b.code, now, nextRev());
    const rooms = catalogRooms();
    const ids = new Set(rooms.map((r) => r.id));
    for (const r of rooms) {
      insertRoom.run(r.id, r.block_id, r.number, r.type, r.sort, now, nextRev());
      fixRoom.run(r.block_id, r.number, r.sort, now, nextRev(), r.id, r.block_id, r.number, r.sort);
    }
    const off = db.prepare(`UPDATE rooms SET active = 0, updated_at = ?, rev = ? WHERE id = ?`);
    for (const { id } of db.prepare(`SELECT id FROM rooms WHERE active = 1`).all()) if (!ids.has(id)) off.run(now, nextRev(), id);

    const product = db.prepare(
      `INSERT OR IGNORE INTO products (id, name, price, sort, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const p of catalog.products) product.run(p.id, p.name, p.price, p.sort, now, nextRev());
    const typeInv = db.prepare(
      `INSERT OR IGNORE INTO type_inventory (type, product_id, quantity, updated_at, rev) VALUES (?, ?, ?, ?, ?)`
    );
    if (db.prepare(`SELECT COUNT(*) AS n FROM type_inventory`).get().n === 0)
      for (const [type, items] of Object.entries(catalog.typeInventory))
        for (const [productId, qty] of Object.entries(items)) typeInv.run(type, productId, qty, now, nextRev());
  });
}
