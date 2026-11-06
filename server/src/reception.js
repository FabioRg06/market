// Consultas y acciones de recepción.
//
// Estados de una habitación (mismas reglas que app/src/format.ts → roomState):
//   surtida      → normal; así amanecen todas.
//   por_revisar  → el Excel de salidas la marcó y nadie la ha revisado después.
//   en_revision  → hay una revisión abierta.
//   revisada     → se revisó (con o sin consumo) y falta surtirla. Al surtir vuelve a surtida.
import * as XLSX from 'xlsx';
import { db, nextRev, transaction } from './db.js';
import { catalog } from './seed.js';

const TYPES = new Set(catalog.types.map((t) => t.code));

function itemsFor(inspectionIds) {
  const map = new Map();
  if (inspectionIds.length === 0) return map;
  const rows = db
    .prepare(
      `SELECT ii.inspection_id, ii.product_id, p.name, ii.quantity, ii.unit_price
         FROM inspection_items ii JOIN products p ON p.id = ii.product_id
        WHERE ii.inspection_id IN (${inspectionIds.map(() => '?').join(',')}) AND ii.quantity > 0
        ORDER BY p.sort`
    )
    .all(...inspectionIds);
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

/** Estado y "lo que falta" de cada habitación a partir de sus revisiones sin surtir. */
function roomStates(roomIds = null) {
  const filter = roomIds ? `AND room_id IN (${roomIds.map(() => '?').join(',')})` : '';
  const args = roomIds ?? [];
  const pending = withItems(
    db
      .prepare(`SELECT * FROM inspections WHERE finished_at IS NOT NULL AND restocked_at IS NULL ${filter} ORDER BY finished_at`)
      .all(...args)
  );
  const open = db.prepare(`SELECT * FROM inspections WHERE finished_at IS NULL ${filter}`).all(...args);
  const lastFinished = db
    .prepare(`SELECT room_id, MAX(finished_at) AS at FROM inspections WHERE finished_at IS NOT NULL ${filter} GROUP BY room_id`)
    .all(...args);
  const lastRestock = db
    .prepare(`SELECT room_id, MAX(restocked_at) AS at FROM inspections WHERE restocked_at IS NOT NULL ${filter} GROUP BY room_id`)
    .all(...args);

  const states = new Map();
  const get = (id) => {
    if (!states.has(id)) states.set(id, { pending: [], open: null, lastFinishedAt: null, lastRestockAt: null });
    return states.get(id);
  };
  for (const i of pending) get(i.room_id).pending.push(i);
  for (const i of open) get(i.room_id).open = i;
  for (const r of lastFinished) get(r.room_id).lastFinishedAt = r.at;
  for (const r of lastRestock) get(r.room_id).lastRestockAt = r.at;
  return states;
}

function summarize(room, st) {
  const pending = st?.pending ?? [];
  const missing = new Map();
  for (const i of pending)
    for (const it of i.items) {
      const m = missing.get(it.product_id) ?? { product_id: it.product_id, name: it.name, quantity: 0, unit_price: it.unit_price };
      m.quantity += it.quantity;
      missing.set(it.product_id, m);
    }
  const missingList = [...missing.values()];
  let status = 'surtida';
  if (st?.open) status = 'en_revision';
  else if (room.review_at && (!st?.lastFinishedAt || st.lastFinishedAt < room.review_at)) status = 'por_revisar';
  else if (pending.length) status = 'revisada';
  const last = pending[pending.length - 1] ?? null;
  const units = missingList.reduce((s, m) => s + m.quantity, 0);
  return {
    ...room,
    status,
    missing: missingList,
    units,
    total: missingList.reduce((s, m) => s + m.quantity * m.unit_price, 0),
    reviewed_at: last?.finished_at ?? null,
    reviewed_by: last?.inspector ?? null,
    restocked_at: st?.lastRestockAt ?? null,
    // Revisada sin consumo: hay que volver a confirmarla cuando el huésped se vaya.
    needs_confirm: status === 'revisada' && units === 0 && !pending.some((i) => i.kind === 'confirmacion'),
    has_novedad: pending.some((i) => i.kind === 'novedad'),
  };
}

const roomSql = `
  SELECT r.id, r.number, r.type, r.block_id, b.code AS block_code, b.name AS block_name,
         g.guest_name, g.flight_time, g.review_at
    FROM rooms r JOIN blocks b ON b.id = r.block_id LEFT JOIN guests g ON g.room_id = r.id`;

export function listRooms() {
  const rooms = db.prepare(`${roomSql} WHERE r.active = 1 ORDER BY CAST(r.number AS INTEGER)`).all();
  const states = roomStates();
  return rooms.map((r) => summarize(r, states.get(r.id)));
}

const inventorySql = `
  SELECT p.id AS product_id, p.name, p.price, p.image,
         COALESCE(ri.quantity, ti.quantity, 0) AS quantity
    FROM products p
    LEFT JOIN room_inventory ri ON ri.product_id = p.id AND ri.room_id = ?
    LEFT JOIN type_inventory ti ON ti.product_id = p.id AND ti.type = ?
   WHERE p.active = 1 ORDER BY p.sort`;

export function roomDetail(id) {
  const room = db.prepare(`${roomSql} WHERE r.id = ?`).get(id);
  if (!room) return null;
  const inventory = db.prepare(inventorySql).all(id, room.type).filter((l) => l.quantity > 0);
  const inspections = withItems(
    db.prepare(`SELECT * FROM inspections WHERE room_id = ? ORDER BY started_at DESC LIMIT 100`).all(id)
  );
  return { room: summarize(room, roomStates([id]).get(id)), inventory, inspections };
}

/** Surtir: todas las revisiones pendientes de la habitación quedan surtidas. */
export function restockRoom(roomId, by) {
  const now = Date.now();
  const res = db
    .prepare(
      `UPDATE inspections SET restocked_at = ?, restocked_by = ?, updated_at = ?, rev = ?
        WHERE room_id = ? AND finished_at IS NOT NULL AND restocked_at IS NULL`
    )
    .run(now, by || 'Recepción', now, nextRev(), roomId);
  return res.changes > 0;
}

/** Recepción corrige lo consumido en una revisión que aún no se ha surtido (modo edición). */
export function setInspectionItems(inspectionId, items) {
  const insp = db.prepare(`SELECT * FROM inspections WHERE id = ?`).get(inspectionId);
  if (!insp || insp.restocked_at) return false;
  const price = db.prepare(`SELECT price FROM products WHERE id = ?`);
  const upsert = db.prepare(
    `INSERT INTO inspection_items (id, inspection_id, product_id, quantity, unit_price, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at, rev = excluded.rev`
  );
  transaction(() => {
    const now = Date.now();
    for (const it of items) {
      const p = price.get(it.product_id);
      if (!p) continue;
      upsert.run(`${inspectionId}:${it.product_id}`, inspectionId, it.product_id, Math.max(0, it.quantity | 0), p.price, now, nextRev());
    }
    db.prepare(`UPDATE inspections SET updated_at = ?, rev = ? WHERE id = ?`).run(now, nextRev(), inspectionId);
  });
  return true;
}

/** Huésped, vuelo y (opcional) marcar "por revisar". Vacío = habitación libre. */
export function setGuest(roomId, { guest_name, flight_time, review }) {
  const cur = db.prepare(`SELECT review_at FROM guests WHERE room_id = ?`).get(roomId);
  const reviewAt = review === true ? Date.now() : review === false ? null : cur?.review_at ?? null;
  db.prepare(
    `INSERT INTO guests (room_id, guest_name, flight_time, review_at, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET guest_name = excluded.guest_name, flight_time = excluded.flight_time,
       review_at = excluded.review_at, updated_at = excluded.updated_at, rev = excluded.rev`
  ).run(roomId, guest_name?.trim() || null, flight_time?.trim() || null, reviewAt, Date.now(), nextRev());
}

export function setRoomType(roomId, type) {
  if (!TYPES.has(type)) return false;
  db.prepare(`UPDATE rooms SET type = ?, updated_at = ?, rev = ? WHERE id = ?`).run(type, Date.now(), nextRev(), roomId);
  return true;
}

// ---------- Excel de salidas ----------

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function flightText(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // Excel guarda las horas como fracción del día.
    const mins = Math.round((v % 1) * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const m = String(v).match(/(\d{1,2})[:.h](\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : String(v).trim();
}

/**
 * Lee el Excel (o CSV) de salidas: cada fila con número de habitación queda "por revisar",
 * con su huésped y hora de vuelo. Columnas reconocidas: Habitación, Huésped/Nombre, Vuelo/Hora, Tipo.
 */
export function importSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const headerIdx = rows.findIndex((r) => r.some((c) => /hab/.test(norm(c))));
  if (headerIdx < 0) return { ok: false, error: 'No se encontró una columna "Habitación" en el archivo.' };
  const header = rows[headerIdx].map(norm);
  const col = (re) => header.findIndex((h) => re.test(h));
  const cRoom = col(/hab/);
  const cGuest = col(/huesped|nombre|cliente|pasajero/);
  const cFlight = col(/vuelo|hora|salida/);
  const cType = col(/^tipo/);

  const exists = db.prepare(`SELECT id FROM rooms WHERE id = ?`);
  const marked = [];
  const notFound = [];
  transaction(() => {
    for (const r of rows.slice(headerIdx + 1)) {
      const raw = r[cRoom];
      if (raw == null || raw === '') continue;
      const number = String(raw).match(/\d+/)?.[0];
      if (!number || !exists.get(`r${number}`)) {
        notFound.push(String(raw));
        continue;
      }
      const id = `r${number}`;
      setGuest(id, {
        guest_name: cGuest >= 0 && r[cGuest] != null ? String(r[cGuest]) : null,
        flight_time: cFlight >= 0 ? flightText(r[cFlight]) : null,
        review: true,
      });
      const type = cType >= 0 ? String(r[cType] ?? '').trim().toUpperCase() : '';
      if (TYPES.has(type)) setRoomType(id, type);
      marked.push(number);
    }
  });
  return { ok: true, marked: marked.length, rooms: marked, notFound };
}

// ---------- Reporte del día ----------

export function dayReport({ from, to }) {
  const rooms = listRooms();
  const reviewed = withItems(
    db
      .prepare(
        `SELECT i.*, r.number AS room_number, r.type AS room_type, b.code AS block_code
           FROM inspections i JOIN rooms r ON r.id = i.room_id JOIN blocks b ON b.id = r.block_id
          WHERE i.finished_at >= ? AND i.finished_at < ?
          ORDER BY i.finished_at DESC`
      )
      .all(from, to)
  );
  const restocked = db
    .prepare(
      `SELECT r.id AS room_id, r.number AS room_number, b.code AS block_code, MAX(i.restocked_at) AS restocked_at,
              i.restocked_by
         FROM inspections i JOIN rooms r ON r.id = i.room_id JOIN blocks b ON b.id = r.block_id
        WHERE i.restocked_at >= ? AND i.restocked_at < ?
        GROUP BY r.id ORDER BY restocked_at DESC`
    )
    .all(from, to);
  const pendingReview = rooms.filter((r) => r.status === 'por_revisar');
  const pendingRestock = rooms.filter((r) => r.status === 'revisada');
  return {
    counts: {
      revisadas: new Set(reviewed.map((i) => i.room_id)).size,
      por_revisar: pendingReview.length,
      por_surtir: pendingRestock.length,
      surtidas: restocked.length,
      novedades: reviewed.filter((i) => i.kind === 'novedad').length,
      total: reviewed.reduce((s, i) => s + i.total, 0),
    },
    reviewed,
    restocked,
    pendingReview: pendingReview.map((r) => ({ room_id: r.id, room_number: r.number, block_code: r.block_code, guest_name: r.guest_name, flight_time: r.flight_time })),
    pendingRestock: pendingRestock.map((r) => ({ room_id: r.id, room_number: r.number, block_code: r.block_code, units: r.units, total: r.total })),
  };
}

const KIND_LABEL = { revision: 'Revisión', consumo: 'Consumo', novedad: 'Novedad', confirmacion: 'Confirmación' };

export function dayReportCsv(range) {
  const rep = dayReport(range);
  const t = (ms) => (ms ? new Date(ms).toLocaleTimeString('es-CO', { hour12: false }) : '');
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Sección', 'Habitación', 'Bloque', 'Tipo', 'Quién', 'Entrada', 'Salida', 'Detalle', 'Total']];
  for (const i of rep.reviewed)
    lines.push([
      KIND_LABEL[i.kind] ?? 'Revisión', i.room_number, i.block_code, i.room_type, i.inspector, t(i.started_at), t(i.finished_at),
      i.units ? i.items.map((it) => `${it.quantity} ${it.name}`).join(', ') : 'Sin consumo', i.total,
    ]);
  for (const r of rep.pendingReview) lines.push(['Sin revisar', r.room_number, r.block_code, '', '', '', '', r.guest_name ?? '', '']);
  for (const r of rep.restocked) lines.push(['Surtida', r.room_number, r.block_code, '', r.restocked_by, '', t(r.restocked_at), '', '']);
  for (const r of rep.pendingRestock) lines.push(['Falta surtir', r.room_number, r.block_code, '', '', '', '', `${r.units} productos`, r.total]);
  return '﻿' + lines.map((l) => l.map(esc).join(';')).join('\r\n');
}

// ---------- Inventario global, por tipo, y bloques ----------

export function products() {
  return db.prepare(`SELECT id, name, price, image, active, sort FROM products ORDER BY sort`).all();
}

export function createProduct(name, price) {
  const base = norm(name).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'producto';
  let id = base;
  for (let n = 2; db.prepare(`SELECT 1 FROM products WHERE id = ?`).get(id); n++) id = `${base}_${n}`;
  const sort = (db.prepare(`SELECT MAX(sort) AS m FROM products`).get().m ?? 0) + 1;
  db.prepare(`INSERT INTO products (id, name, price, sort, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, name.trim(), Math.max(0, Math.round(price) || 0), sort, Date.now(), nextRev()
  );
  return id;
}

export function updateProduct(id, { name, price, active, image }) {
  const p = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  if (!p) return false;
  db.prepare(`UPDATE products SET name = ?, price = ?, active = ?, image = ?, updated_at = ?, rev = ? WHERE id = ?`).run(
    name?.trim() || p.name,
    price != null ? Math.max(0, Math.round(price)) : p.price,
    active != null ? (active ? 1 : 0) : p.active,
    image !== undefined ? image : p.image,
    Date.now(),
    nextRev(),
    id
  );
  return true;
}

export function typeInventory() {
  return db.prepare(`SELECT type, product_id, quantity FROM type_inventory`).all();
}

export function setTypeInventory(type, items) {
  if (!TYPES.has(type)) return false;
  const stmt = db.prepare(
    `INSERT INTO type_inventory (type, product_id, quantity, updated_at, rev) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(type, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at, rev = excluded.rev`
  );
  transaction(() => {
    for (const it of items) stmt.run(type, it.product_id, Math.max(0, it.quantity | 0), Date.now(), nextRev());
  });
  return true;
}

export function blocks() {
  return db
    .prepare(
      `SELECT b.id, b.code, b.name, MIN(CAST(r.number AS INTEGER)) AS first, MAX(CAST(r.number AS INTEGER)) AS last, COUNT(r.id) AS rooms
         FROM blocks b LEFT JOIN rooms r ON r.block_id = b.id GROUP BY b.id ORDER BY first`
    )
    .all();
}

export function updateBlock(id, { code, name }) {
  const b = db.prepare(`SELECT * FROM blocks WHERE id = ?`).get(id);
  if (!b) return false;
  db.prepare(`UPDATE blocks SET code = ?, name = ?, updated_at = ?, rev = ? WHERE id = ?`).run(
    code?.trim() || b.code, name?.trim() || b.name, Date.now(), nextRev(), id
  );
  return true;
}
