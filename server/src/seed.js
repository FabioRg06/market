// Catálogo fijo del hotel: 700 habitaciones en 7 bloques y los 13 productos del minibar.
// Viene de app/src/catalog.json, el mismo archivo que trae la app del teléfono, para que
// ambos usen los mismos ids y el teléfono funcione aunque nunca se haya conectado.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nextRev, transaction } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, '..', '..', 'app', 'src', 'catalog.json');

export const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

/** Crea lo que falte del catálogo; no toca precios ya cambiados desde recepción. */
export function ensureCatalog() {
  const now = Date.now();
  transaction(() => {
    const block = db.prepare(`INSERT OR IGNORE INTO blocks (id, name, updated_at, rev) VALUES (?, ?, ?, ?)`);
    const room = db.prepare(
      `INSERT OR IGNORE INTO rooms (id, block_id, number, updated_at, rev) VALUES (?, ?, ?, ?, ?)`
    );
    const product = db.prepare(
      `INSERT OR IGNORE INTO products (id, name, price, std_qty, sort, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const b of catalog.blocks) {
      if (block.run(b.id, b.name, now, nextRev()).changes === 0) continue;
      for (let n = b.from; n <= b.to; n++) room.run(`r${n}`, b.id, String(n), now, nextRev());
    }
    for (const p of catalog.products) product.run(p.id, p.name, p.price, p.std_qty, p.sort, now, nextRev());
  });
}
