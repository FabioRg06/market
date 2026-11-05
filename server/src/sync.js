// Sincronización con las tablets.
//
// La tablet manda lo que guardó sin conexión (push) y recibe todo lo que
// cambió en el servidor desde la última vez (pull). Gana el registro con el
// `updated_at` más reciente, y todo es idempotente: reenviar lo mismo no duplica.
import { db, nextRev, currentRev, transaction } from './db.js';

const KINDS = new Set(['revision', 'consumo', 'novedad', 'confirmacion']);

const upsertInspection = db.prepare(`
  INSERT INTO inspections (id, room_id, inspector, device_id, kind, started_at, finished_at,
                           restocked_at, restocked_by, notes, updated_at, rev)
  VALUES (:id, :room_id, :inspector, :device_id, :kind, :started_at, :finished_at,
          :restocked_at, :restocked_by, :notes, :updated_at, :rev)
  ON CONFLICT(id) DO UPDATE SET
    room_id = excluded.room_id, inspector = excluded.inspector, device_id = excluded.device_id,
    kind = excluded.kind, started_at = excluded.started_at, finished_at = excluded.finished_at,
    restocked_at = excluded.restocked_at, restocked_by = excluded.restocked_by,
    notes = excluded.notes, updated_at = excluded.updated_at, rev = excluded.rev
  WHERE excluded.updated_at >= inspections.updated_at
`);

const upsertItem = db.prepare(`
  INSERT INTO inspection_items (id, inspection_id, product_id, quantity, unit_price, updated_at, rev)
  VALUES (:id, :inspection_id, :product_id, :quantity, :unit_price, :updated_at, :rev)
  ON CONFLICT(id) DO UPDATE SET
    quantity = excluded.quantity, unit_price = excluded.unit_price,
    updated_at = excluded.updated_at, rev = excluded.rev
  WHERE excluded.updated_at >= inspection_items.updated_at
`);

const upsertInventory = db.prepare(`
  INSERT INTO room_inventory (room_id, product_id, quantity, updated_at, rev)
  VALUES (:room_id, :product_id, :quantity, :updated_at, :rev)
  ON CONFLICT(room_id, product_id) DO UPDATE SET
    quantity = excluded.quantity, updated_at = excluded.updated_at, rev = excluded.rev
  WHERE excluded.updated_at >= room_inventory.updated_at
`);

function pick(row, keys) {
  const out = {};
  for (const k of keys) out[k] = row[k] ?? null;
  return out;
}

export function applyPush(changes = {}, deviceId = null) {
  transaction(() => {
    for (const row of changes.inspections ?? []) {
      upsertInspection.run({
        ...pick(row, ['id', 'room_id', 'inspector', 'started_at', 'finished_at',
          'restocked_at', 'restocked_by', 'notes', 'updated_at']),
        kind: KINDS.has(row.kind) ? row.kind : 'revision',
        device_id: row.device_id ?? deviceId,
        rev: nextRev(),
      });
    }
    for (const row of changes.inspection_items ?? []) {
      upsertItem.run({
        ...pick(row, ['id', 'inspection_id', 'product_id', 'quantity', 'updated_at']),
        unit_price: row.unit_price ?? 0,
        rev: nextRev(),
      });
    }
    for (const row of changes.room_inventory ?? []) {
      upsertInventory.run({
        ...pick(row, ['room_id', 'product_id', 'quantity', 'updated_at']),
        rev: nextRev(),
      });
    }
  });
}

const HISTORY_DAYS = 30;

export function pullSince(since = 0) {
  const rev = currentRev();
  const minStarted = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const q = (sql, ...params) => db.prepare(sql).all(since, ...params);
  return {
    rev,
    blocks: q(`SELECT id, code, name, updated_at FROM blocks WHERE rev > ?`),
    rooms: q(`SELECT id, block_id, number, type, active, updated_at FROM rooms WHERE rev > ?`),
    products: q(`SELECT id, name, price, std_qty, sort, image, active, updated_at FROM products WHERE rev > ?`),
    type_inventory: q(`SELECT type, product_id, quantity, updated_at FROM type_inventory WHERE rev > ?`),
    guests: q(`SELECT room_id, guest_name, flight_time, review_at, updated_at FROM guests WHERE rev > ?`),
    room_inventory: q(`SELECT room_id, product_id, quantity, updated_at FROM room_inventory WHERE rev > ?`),
    inspections: q(
      `SELECT id, room_id, inspector, device_id, kind, started_at, finished_at, restocked_at,
              restocked_by, notes, updated_at
         FROM inspections WHERE rev > ? AND started_at >= ?`,
      minStarted
    ),
    inspection_items: q(
      `SELECT ii.id, ii.inspection_id, ii.product_id, ii.quantity, ii.unit_price, ii.updated_at
         FROM inspection_items ii JOIN inspections i ON i.id = ii.inspection_id
        WHERE ii.rev > ? AND i.started_at >= ?`,
      minStarted
    ),
  };
}
