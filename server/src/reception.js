// Consultas y acciones para la vista de recepción.
import { db, nextRev } from './db.js';

function itemsFor(inspectionIds) {
  if (inspectionIds.length === 0) return new Map();
  const placeholders = inspectionIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ii.inspection_id, ii.product_id, p.name, ii.quantity, ii.unit_price
         FROM inspection_items ii JOIN products p ON p.id = ii.product_id
        WHERE ii.inspection_id IN (${placeholders}) AND ii.quantity > 0
        ORDER BY p.sort`
    )
    .all(...inspectionIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.inspection_id)) map.set(r.inspection_id, []);
    map.get(r.inspection_id).push(r);
  }
  return map;
}

function withItems(inspections) {
  const items = itemsFor(inspections.map((i) => i.id));
  return inspections.map((i) => {
    const list = items.get(i.id) ?? [];
    return {
      ...i,
      items: list,
      units: list.reduce((s, it) => s + it.quantity, 0),
      total: list.reduce((s, it) => s + it.quantity * it.unit_price, 0),
    };
  });
}

// Mismas reglas que app/src/format.ts → roomStatus.
export function statusOf(insp) {
  if (!insp) return 'sin_revisar';
  if (!insp.finished_at) return 'en_revision';
  if (insp.units > 0 && !insp.restocked_at) return 'revisada';
  return 'surtida';
}

/** Todas las habitaciones con su huésped y el estado de su última revisión del día. */
export function listRooms({ from, to }) {
  const rooms = db
    .prepare(
      `SELECT r.id, r.number, r.block_id, b.name AS block_name, g.guest_name, g.flight_time
         FROM rooms r JOIN blocks b ON b.id = r.block_id LEFT JOIN guests g ON g.room_id = r.id
        WHERE r.active = 1
        ORDER BY CAST(r.number AS INTEGER)`
    )
    .all();
  const day = db
    .prepare(
      `SELECT i.id, i.room_id, i.inspector, i.started_at, i.finished_at, i.restocked_at, i.restocked_by,
              COALESCE(SUM(ii.quantity), 0) AS units,
              COALESCE(SUM(ii.quantity * ii.unit_price), 0) AS total
         FROM inspections i LEFT JOIN inspection_items ii ON ii.inspection_id = i.id
        WHERE i.started_at >= ? AND i.started_at < ?
        GROUP BY i.id ORDER BY i.started_at DESC`
    )
    .all(from, to);
  const latest = new Map();
  for (const i of day) if (!latest.has(i.room_id)) latest.set(i.room_id, i);
  return rooms.map((r) => {
    const last = latest.get(r.id) ?? null;
    return { ...r, status: statusOf(last), last };
  });
}

const inventorySql = `
  SELECT p.id AS product_id, p.name, p.price, COALESCE(ri.quantity, p.std_qty) AS quantity
    FROM products p LEFT JOIN room_inventory ri ON ri.product_id = p.id AND ri.room_id = ?
   WHERE p.active = 1 ORDER BY p.sort`;

export function roomDetail(id) {
  const room = db
    .prepare(
      `SELECT r.id, r.number, r.block_id, b.name AS block_name, g.guest_name, g.flight_time
         FROM rooms r JOIN blocks b ON b.id = r.block_id LEFT JOIN guests g ON g.room_id = r.id
        WHERE r.id = ?`
    )
    .get(id);
  if (!room) return null;
  const inventory = db.prepare(inventorySql).all(id);
  const inspections = withItems(
    db.prepare(`SELECT * FROM inspections WHERE room_id = ? ORDER BY started_at DESC LIMIT 100`).all(id)
  );
  return { room, inventory, inspections };
}

export function daySummary({ from, to }) {
  const inspections = withItems(
    db
      .prepare(
        `SELECT i.*, r.number AS room_number, b.name AS block_name
           FROM inspections i JOIN rooms r ON r.id = i.room_id JOIN blocks b ON b.id = r.block_id
          WHERE i.started_at >= ? AND i.started_at < ?
          ORDER BY i.started_at DESC`
      )
      .all(from, to)
  );
  const restocked = db
    .prepare(
      `SELECT i.id, i.room_id, i.restocked_at, i.restocked_by, r.number AS room_number, b.name AS block_name
         FROM inspections i JOIN rooms r ON r.id = i.room_id JOIN blocks b ON b.id = r.block_id
        WHERE i.restocked_at >= ? AND i.restocked_at < ?
        ORDER BY i.restocked_at DESC`
    )
    .all(from, to);
  const totalRooms = db.prepare(`SELECT COUNT(*) AS n FROM rooms WHERE active = 1`).get().n;
  return { inspections, restocked, totalRooms };
}

export function markRestocked(id, by) {
  const now = Date.now();
  const res = db
    .prepare(
      `UPDATE inspections SET restocked_at = ?, restocked_by = ?, updated_at = ?, rev = ?
        WHERE id = ? AND restocked_at IS NULL`
    )
    .run(now, by || 'Recepción', now, nextRev(), id);
  return res.changes > 0;
}

/** Huésped y hora de vuelo. Vacío = habitación libre. */
export function setGuest(roomId, guestName, flightTime) {
  db.prepare(
    `INSERT INTO guests (room_id, guest_name, flight_time, updated_at, rev) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET guest_name = excluded.guest_name, flight_time = excluded.flight_time,
       updated_at = excluded.updated_at, rev = excluded.rev`
  ).run(roomId, guestName?.trim() || null, flightTime?.trim() || null, Date.now(), nextRev());
}

// ---------- Productos (la lista es fija; recepción ajusta precio y cantidad estándar) ----------

export function products() {
  return db.prepare(`SELECT id, name, price, std_qty FROM products WHERE active = 1 ORDER BY sort`).all();
}

export function updateProduct(id, { price, std_qty }) {
  const p = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  if (!p) return false;
  db.prepare(`UPDATE products SET price = ?, std_qty = ?, updated_at = ?, rev = ? WHERE id = ?`).run(
    price != null ? Math.max(0, Math.round(price)) : p.price,
    std_qty != null ? Math.max(0, std_qty | 0) : p.std_qty,
    Date.now(),
    nextRev(),
    id
  );
  return true;
}
