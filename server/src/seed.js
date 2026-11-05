// Catálogo fijo del hotel: bloques con código y rango, 700 habitaciones, inventario global
// y lo que lleva cada tipo de habitación. Viene de app/src/catalog.json, el mismo archivo
// que trae la app, para que ambos usen los mismos ids y la tablet funcione sin conexión.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nextRev, transaction } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, '..', '..', 'app', 'src', 'catalog.json');

export const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

/** Crea lo que falte; no toca lo que recepción ya haya cambiado. */
export function ensureCatalog() {
  const now = Date.now();
  transaction(() => {
    const block = db.prepare(`INSERT OR IGNORE INTO blocks (id, name, code, updated_at, rev) VALUES (?, ?, ?, ?, ?)`);
    const blockCode = db.prepare(`UPDATE blocks SET code = ?, updated_at = ?, rev = ? WHERE id = ? AND code IS NULL`);
    const room = db.prepare(
      `INSERT OR IGNORE INTO rooms (id, block_id, number, type, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const product = db.prepare(
      `INSERT OR IGNORE INTO products (id, name, price, sort, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const typeInv = db.prepare(
      `INSERT OR IGNORE INTO type_inventory (type, product_id, quantity, updated_at, rev) VALUES (?, ?, ?, ?, ?)`
    );
    for (const b of catalog.blocks) {
      block.run(b.id, b.name, b.code, now, nextRev());
      blockCode.run(b.code, now, nextRev(), b.id);
      for (let n = b.from; n <= b.to; n++) room.run(`r${n}`, b.id, String(n), catalog.defaultType, now, nextRev());
    }
    for (const p of catalog.products) product.run(p.id, p.name, p.price, p.sort, now, nextRev());
    const hasTypeInv = db.prepare(`SELECT COUNT(*) AS n FROM type_inventory`).get().n > 0;
    if (!hasTypeInv)
      for (const [type, items] of Object.entries(catalog.typeInventory))
        for (const [productId, qty] of Object.entries(items)) typeInv.run(type, productId, qty, now, nextRev());
  });
}
