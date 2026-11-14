// Consultas y acciones de recepción.
//
// Estados de una habitación (mismas reglas que app/src/format.ts → roomState):
//   surtida      → normal; así amanecen todas.
//   por_revisar  → el Excel de salidas la marcó y nadie la ha revisado después.
//   en_revision  → hay una revisión abierta.
//   revisada     → se revisó, hubo consumo y falta surtirla. Al surtir vuelve a surtida.
// Sin consumo no hay nada que surtir: la habitación vuelve a surtida y solo queda en el reporte.
// Las habitaciones sin minibar (SM) nunca quedan por revisar.
import * as XLSX from 'xlsx';
import { randomUUID } from 'node:crypto';
import { db, nextRev, transaction } from './db.js';
import { catalog, productImages, regenerateRooms } from './seed.js';

/** "bw 243", "Hab. BW-243" → "BW243" (igual que app/src/rooms.ts). */
const normalizeRoomNumber = (raw) =>
  raw.toUpperCase().replace(/HAB(ITACI[OÓ]N)?\.?/g, '').replace(/[\s\-_.#]/g, '');

const TYPES = new Set(catalog.types.map((t) => t.code));

function itemsFor(inspectionIds) {
  const map = new Map();
  if (inspectionIds.length === 0) return map;
  const rows = db
    .prepare(
      `SELECT ii.inspection_id, ii.product_id, p.name, ii.quantity, ii.unit_price, ii.reason, ii.expires_on
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
      .prepare(`SELECT * FROM inspections WHERE finished_at IS NOT NULL AND restocked_at IS NULL AND kind != 'cambio' ${filter} ORDER BY finished_at`)
      .all(...args)
  );
  const open = db.prepare(`SELECT * FROM inspections WHERE finished_at IS NULL ${filter}`).all(...args);
  const lastFinished = db
    .prepare(`SELECT room_id, MAX(finished_at) AS at FROM inspections WHERE finished_at IS NOT NULL AND kind != 'cambio' ${filter} GROUP BY room_id`)
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

// Las novedades NAP o no reconocido no se vuelven a surtir: el consumo ya se contó en la revisión.
const restocks = (i) => !(i.kind === 'novedad' && (i.charge === 'nap' || i.charge === 'no_reconocido'));

function summarize(room, st) {
  const pending = st?.pending ?? [];
  const missing = new Map();
  for (const i of pending)
    if (restocks(i))
    for (const it of i.items) {
      const m = missing.get(it.product_id) ?? { product_id: it.product_id, name: it.name, quantity: 0, unit_price: it.unit_price };
      m.quantity += it.quantity;
      missing.set(it.product_id, m);
    }
  const missingList = [...missing.values()];
  const units = missingList.reduce((s, m) => s + m.quantity, 0);
  let status = 'surtida';
  if (room.type !== 'SM') {
    if (room.review_at && (!st?.lastFinishedAt || st.lastFinishedAt < room.review_at)) status = 'por_revisar';
    else if (units > 0) status = 'revisada';
  }
  const last = pending[pending.length - 1] ?? null;
  return {
    ...room,
    status,
    missing: missingList,
    units,
    total: missingList.reduce((s, m) => s + m.quantity * m.unit_price, 0),
    reviewed_at: last?.finished_at ?? null,
    reviewed_by: last?.inspector ?? null,
    restocked_at: st?.lastRestockAt ?? null,
    needs_confirm: false,
    has_novedad: status === 'revisada' && pending.some((i) => i.kind === 'novedad'),
    charges: status === 'revisada' ? [...new Set(pending.map((i) => i.charge).filter(Boolean))] : [],
    double_cycle: !!room.double_cycle,
    pending_checkout: !!room.pending_checkout,
  };
}

const roomSql = `
  SELECT r.id, r.number, r.type, r.block_id, b.code AS block_code, b.name AS block_name,
         g.guest_name, g.flight_time, g.review_at, g.worker_id, w.name AS worker_name, g.double_cycle, g.pending_checkout
    FROM rooms r JOIN blocks b ON b.id = r.block_id LEFT JOIN guests g ON g.room_id = r.id
    LEFT JOIN workers w ON w.id = g.worker_id AND w.active = 1`;

export function listRooms() {
  const rooms = db.prepare(`${roomSql} WHERE r.active = 1 ORDER BY r.sort`).all();
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
export function setGuest(roomId, { guest_name, flight_time, review, worker_id, double_cycle, pending_checkout }) {
  const cur = db.prepare(`SELECT * FROM guests WHERE room_id = ?`).get(roomId);
  const noMinibar = db.prepare(`SELECT type FROM rooms WHERE id = ?`).get(roomId)?.type === 'SM';
  const reviewAt = noMinibar ? null : review === true ? Date.now() : review === false ? null : cur?.review_at ?? null;
  const keep = (v, old, map = (x) => x) => (v === undefined ? old ?? null : map(v));
  db.prepare(
    `INSERT INTO guests (room_id, guest_name, flight_time, review_at, worker_id, double_cycle, pending_checkout, updated_at, rev)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET guest_name = excluded.guest_name, flight_time = excluded.flight_time,
       review_at = excluded.review_at, worker_id = excluded.worker_id, double_cycle = excluded.double_cycle,
       pending_checkout = excluded.pending_checkout, updated_at = excluded.updated_at, rev = excluded.rev`
  ).run(
    roomId,
    keep(guest_name, cur?.guest_name, (v) => (v ? String(v).trim() : null)) || null,
    keep(flight_time, cur?.flight_time, (v) => (v ? String(v).trim() : null)) || null,
    reviewAt,
    keep(worker_id, cur?.worker_id, (v) => v || null),
    keep(double_cycle, cur?.double_cycle, (v) => (v ? 1 : 0)) ?? 0,
    keep(pending_checkout, cur?.pending_checkout, (v) => (v ? 1 : 0)) ?? 0,
    Date.now(),
    nextRev()
  );
}

/**
 * Recepción registra una revisión (o una novedad, o un consumo adicional) sin pasar por la
 * tablet: queda terminada en este momento con lo consumido.
 */
export function createInspection(roomId, { kind = 'revision', inspector, items = [], charge, notes }) {
  if (!['revision', 'consumo', 'novedad'].includes(kind)) return null;
  if (!db.prepare(`SELECT 1 FROM rooms WHERE id = ?`).get(roomId)) return null;
  const id = randomUUID();
  const now = Date.now();
  const price = db.prepare(`SELECT price FROM products WHERE id = ?`);
  transaction(() => {
    db.prepare(
      `INSERT INTO inspections (id, room_id, inspector, device_id, kind, started_at, finished_at, notes, charge, updated_at, rev)
       VALUES (?, ?, ?, 'recepcion', ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, roomId, inspector?.trim() || 'Recepción', kind, now, now, notes?.trim() || null, CHARGES.includes(charge) ? charge : null, now, nextRev());
    const item = db.prepare(
      `INSERT INTO inspection_items (id, inspection_id, product_id, quantity, unit_price, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of items) {
      const p = price.get(it.product_id);
      const q = Math.max(0, it.quantity | 0);
      if (p && q) item.run(`${id}:${it.product_id}`, id, it.product_id, q, p.price, now, nextRev());
    }
  });
  return id;
}

/** Nota de una revisión o novedad (descripción detallada). */
export function setNotes(inspectionId, notes) {
  return db.prepare(`UPDATE inspections SET notes = ?, updated_at = ?, rev = ? WHERE id = ?`).run(notes?.trim() || null, Date.now(), nextRev(), inspectionId).changes > 0;
}

// ---------- Trabajadores ----------

export function workers() {
  return db
    .prepare(
      `SELECT w.id, w.name, COUNT(g.room_id) AS assigned
         FROM workers w LEFT JOIN guests g ON g.worker_id = w.id
        WHERE w.active = 1 GROUP BY w.id ORDER BY w.name COLLATE NOCASE`
    )
    .all();
}

export function createWorker(name) {
  const id = randomUUID();
  db.prepare(`INSERT INTO workers (id, name, updated_at, rev) VALUES (?, ?, ?, ?)`).run(id, name.trim(), Date.now(), nextRev());
  return id;
}

export function updateWorker(id, { name }) {
  return db.prepare(`UPDATE workers SET name = ?, updated_at = ?, rev = ? WHERE id = ? AND active = 1`).run(name.trim(), Date.now(), nextRev(), id).changes > 0;
}

/** Se desactiva (su historial se conserva) y sus habitaciones quedan sin asignar. */
export function deleteWorker(id) {
  transaction(() => {
    db.prepare(`UPDATE workers SET active = 0, updated_at = ?, rev = ? WHERE id = ?`).run(Date.now(), nextRev(), id);
    for (const { room_id } of db.prepare(`SELECT room_id FROM guests WHERE worker_id = ?`).all(id)) setGuest(room_id, { worker_id: null });
  });
  return true;
}

/** Asigna (o quita, con workerId null) varias habitaciones a la vez. */
export function assignRooms(workerId, roomIds) {
  transaction(() => {
    for (const id of roomIds) setGuest(id, { worker_id: workerId || null });
  });
  return true;
}

const CHARGES = ['post', 'nap', 'no_reconocido'];

/** Tipo de novedad o cobro: 'post', 'nap' (no se acercó a pagar), 'no_reconocido' o null. */
export function setCharge(inspectionId, charge) {
  const value = CHARGES.includes(charge) ? charge : null;
  return db.prepare(`UPDATE inspections SET charge = ?, updated_at = ?, rev = ? WHERE id = ?`).run(value, Date.now(), nextRev(), inspectionId).changes > 0;
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
 * El número puede venir sin el bloque ("243" en vez de "BW243"): se busca la habitación que
 * tenga ese número. Si varios bloques lo tienen (101 está en C, K y L) hace falta una columna
 * "Bloque"; sin ella la fila se devuelve en `ambiguous` y no se marca nada. Las habitaciones
 * sin minibar no se marcan (`noMinibar`).
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
  const cWorker = col(/trabaj|camarer|encargad|revisa|asignad|responsable/);
  const cDouble = col(/doble|ciclo/);
  const cPending = col(/pendiente|por salir/);
  const cBlock = col(/bloque|torre|edificio|sector/);
  const yes = (v) => /^(x|si|s|1|true|y|yes)$/.test(norm(v));
  const workerByName = new Map(workers().map((w) => [norm(w.name), w.id]));
  const unknownWorkers = new Set();

  // Habitaciones por su número completo y por el número sin letras.
  const byFull = new Map();
  const byDigits = new Map();
  for (const room of db.prepare(`SELECT r.id, r.number, r.type, b.code FROM rooms r JOIN blocks b ON b.id = r.block_id WHERE r.active = 1`).all()) {
    byFull.set(room.number, room);
    const digits = room.number.replace(/\D/g, '');
    if (!byDigits.has(digits)) byDigits.set(digits, []);
    byDigits.get(digits).push(room);
  }
  const marked = [];
  const notFound = [];
  const ambiguous = [];
  const noMinibar = [];
  transaction(() => {
    for (const r of rows.slice(headerIdx + 1)) {
      const raw = r[cRoom];
      if (raw == null || raw === '') continue;
      const typed = normalizeRoomNumber(String(raw));
      const block = cBlock >= 0 && r[cBlock] != null ? normalizeRoomNumber(String(r[cBlock])).replace(/^BLOQUE/, '') : '';
      let room = byFull.get(typed) ?? (block ? byFull.get(block + typed) : undefined);
      if (!room && /^\d+$/.test(typed)) {
        let same = byDigits.get(typed) ?? [];
        if (block) same = same.filter((x) => x.code.toUpperCase() === block);
        if (same.length > 1) {
          ambiguous.push(`${typed} (${same.map((x) => x.code).join(', ')})`);
          continue;
        }
        room = same[0];
      }
      if (!room) {
        notFound.push(String(raw));
        continue;
      }
      if (room.type === 'SM') {
        noMinibar.push(room.number);
        continue;
      }
      const id = room.id;
      const number = room.number;
      const workerName = cWorker >= 0 && r[cWorker] != null ? String(r[cWorker]).trim() : '';
      const workerId = workerName ? workerByName.get(norm(workerName)) : undefined;
      if (workerName && !workerId) unknownWorkers.add(workerName);
      setGuest(id, {
        guest_name: cGuest >= 0 && r[cGuest] != null ? String(r[cGuest]) : null,
        flight_time: cFlight >= 0 ? flightText(r[cFlight]) : null,
        review: true,
        ...(workerId ? { worker_id: workerId } : {}),
        ...(cDouble >= 0 ? { double_cycle: yes(r[cDouble]) } : {}),
        ...(cPending >= 0 ? { pending_checkout: yes(r[cPending]) } : {}),
      });
      const type = cType >= 0 ? String(r[cType] ?? '').trim().toUpperCase() : '';
      if (TYPES.has(type)) setRoomType(id, type);
      marked.push(number);
    }
  });
  return { ok: true, marked: marked.length, rooms: marked, notFound, ambiguous, noMinibar, unknownWorkers: [...unknownWorkers] };
}

// ---------- Reporte del día ----------

export function dayReport({ from, to }) {
  const rooms = listRooms();
  let reviewed = withItems(
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
  const changes = reviewed.filter((i) => i.kind === 'cambio');
  reviewed = reviewed.filter((i) => i.kind !== 'cambio');
  const pendingReview = rooms.filter((r) => r.status === 'por_revisar');
  const pendingRestock = rooms.filter((r) => r.status === 'revisada');
  // Sí = revisadas con consumo · No = revisadas sin consumo · Pendientes = faltó revisarlas.
  const unitsByRoom = new Map();
  for (const i of reviewed) unitsByRoom.set(i.room_id, (unitsByRoom.get(i.room_id) ?? 0) + i.units);
  const withConsumption = [...unitsByRoom.values()].filter((u) => u > 0).length;
  return {
    changes,
    counts: {
      si: withConsumption,
      no: unitsByRoom.size - withConsumption,
      pendientes: pendingReview.length,
      revisadas: new Set(reviewed.map((i) => i.room_id)).size,
      por_revisar: pendingReview.length,
      por_surtir: pendingRestock.length,
      surtidas: restocked.length,
      novedades: reviewed.filter((i) => i.kind === 'novedad').length,
      nap: reviewed.filter((i) => i.charge === 'nap').length,
      no_reconocido: reviewed.filter((i) => i.charge === 'no_reconocido').length,
      cambios: changes.length,
      total: reviewed.reduce((s, i) => s + i.total, 0),
    },
    reviewed,
    restocked,
    pendingReview: pendingReview.map((r) => ({ room_id: r.id, room_number: r.number, block_code: r.block_code, guest_name: r.guest_name, flight_time: r.flight_time, worker_name: r.worker_name, pending_checkout: r.pending_checkout })),
    pendingRestock: pendingRestock.map((r) => ({ room_id: r.id, room_number: r.number, block_code: r.block_code, units: r.units, total: r.total, missing: r.missing })),
  };
}

/** Salidas del día: las marcadas "por revisar" en el día (y, si es hoy, todas las que siguen
 *  por revisar), en el orden de las habitaciones. */
export function checkouts({ from, to }) {
  const now = Date.now();
  const today = now >= from && now < to;
  return listRooms().filter((r) => r.type !== 'SM' && ((r.review_at >= from && r.review_at < to) || (today && r.status === 'por_revisar')));
}

export function products() {
  // `fixed_image`: la foto viene con el programa y no se cambia desde recepción.
  return db
    .prepare(`SELECT id, name, price, presentation, image, active, sort FROM products ORDER BY sort`)
    .all()
    .map((p) => ({ ...p, fixed_image: !!productImages[p.id] }));
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

export function updateProduct(id, { name, price, active, image, presentation }) {
  const p = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  if (!p) return false;
  db.prepare(`UPDATE products SET name = ?, price = ?, active = ?, image = ?, presentation = ?, updated_at = ?, rev = ? WHERE id = ?`).run(
    name?.trim() || p.name,
    price != null ? Math.max(0, Math.round(price)) : p.price,
    active != null ? (active ? 1 : 0) : p.active,
    image !== undefined && !productImages[id] ? image : p.image,
    presentation !== undefined ? presentation?.trim() || null : p.presentation,
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
      `SELECT b.id, b.code, b.name, b.ranges, b.sort,
              (SELECT COUNT(*) FROM rooms r WHERE r.block_id = b.id AND r.active = 1) AS rooms
         FROM blocks b WHERE b.ranges IS NOT NULL ORDER BY b.sort`
    )
    .all()
    .map((b) => ({ ...b, ranges: JSON.parse(b.ranges) }));
}

/** Series válidas: [prefijo, desde, hasta] con desde ≤ hasta. */
function cleanRanges(ranges) {
  return (ranges ?? [])
    .map(([p, a, z]) => [String(p ?? '').toUpperCase().replace(/\s/g, ''), Math.round(Number(a)), Math.round(Number(z))])
    .filter(([, a, z]) => a > 0 && z >= a && z - a < 1000);
}

export function updateBlock(id, { code, name, ranges }) {
  const b = db.prepare(`SELECT * FROM blocks WHERE id = ?`).get(id);
  if (!b) return false;
  transaction(() => {
    db.prepare(`UPDATE blocks SET code = ?, name = ?, ranges = ?, updated_at = ?, rev = ? WHERE id = ?`).run(
      code?.trim() || b.code, name?.trim() || b.name, ranges ? JSON.stringify(cleanRanges(ranges)) : b.ranges, Date.now(), nextRev(), id
    );
    regenerateRooms(id);
  });
  return true;
}

export function createBlock({ code, name, ranges }) {
  const id = norm(code).replace(/[^a-z0-9]+/g, '') || randomUUID();
  if (db.prepare(`SELECT 1 FROM blocks WHERE id = ?`).get(id)) return null;
  const sort = (db.prepare(`SELECT MAX(sort) AS m FROM blocks`).get().m ?? 0) + 1;
  transaction(() => {
    db.prepare(`INSERT INTO blocks (id, code, name, ranges, sort, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id, code.trim(), (name || code).trim(), JSON.stringify(cleanRanges(ranges)), sort, Date.now(), nextRev()
    );
    regenerateRooms(id);
  });
  return id;
}

// ---------- Analítica ----------

/** Indicadores para el panel de analítica en un rango de días. */
export function analytics({ from, to }) {
  const inspections = withItems(
    db
      .prepare(
        `SELECT i.*, r.number AS room_number, r.type AS room_type, b.code AS block_code
           FROM inspections i JOIN rooms r ON r.id = i.room_id JOIN blocks b ON b.id = r.block_id
          WHERE i.finished_at >= ? AND i.finished_at < ? AND i.kind != 'cambio'`
      )
      .all(from, to)
  );
  const work = inspections.filter((i) => i.kind !== 'confirmacion');
  const durations = work.map((i) => i.finished_at - i.started_at).filter((d) => d > 0);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

  const people = new Map();
  for (const i of inspections) {
    const p = people.get(i.inspector) ?? { name: i.inspector, revisiones: 0, durations: [], total: 0, novedades: 0, last_at: 0 };
    if (i.kind !== 'confirmacion') {
      p.revisiones++;
      p.durations.push(i.finished_at - i.started_at);
    }
    p.total += i.total;
    if (i.kind === 'novedad') p.novedades++;
    p.last_at = Math.max(p.last_at, i.finished_at);
    people.set(i.inspector, p);
  }

  const products = new Map();
  const blocks = new Map();
  const types = new Map();
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, revisiones: 0, total: 0 }));
  for (const i of inspections) {
    const h = new Date(i.finished_at).getHours();
    if (i.kind !== 'confirmacion') hours[h].revisiones++;
    hours[h].total += i.total;
    const b = blocks.get(i.block_code) ?? { code: i.block_code, total: 0, units: 0 };
    b.total += i.total;
    b.units += i.units;
    blocks.set(i.block_code, b);
    const t = types.get(i.room_type) ?? { type: i.room_type, total: 0, units: 0 };
    t.total += i.total;
    t.units += i.units;
    types.set(i.room_type, t);
    for (const it of i.items) {
      const p = products.get(it.product_id) ?? { id: it.product_id, name: it.name, units: 0, total: 0 };
      p.units += it.quantity;
      p.total += it.quantity * it.unit_price;
      products.set(it.product_id, p);
    }
  }

  const DAY = 24 * 60 * 60 * 1000;
  const days = [];
  for (let d = from; d < to; d += DAY) {
    const list = inspections.filter((i) => i.finished_at >= d && i.finished_at < d + DAY);
    days.push({ day: d, total: list.reduce((s, i) => s + i.total, 0), units: list.reduce((s, i) => s + i.units, 0), revisiones: list.filter((i) => i.kind !== 'confirmacion').length });
  }

  // Mapa de calor: día de la semana (lunes = 0) × hora.
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const i of work) {
    const d = new Date(i.finished_at);
    heat[(d.getDay() + 6) % 7][d.getHours()]++;
  }
  const kinds = { revision: 0, consumo: 0, novedad: 0, confirmacion: 0 };
  for (const i of inspections) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
  const withConsumption = work.filter((i) => i.units > 0);

  return {
    heat,
    kinds,
    kpis: {
      ticket: withConsumption.length ? Math.round(withConsumption.reduce((t, i) => t + i.total, 0) / withConsumption.length) : 0,
      revisiones: work.length,
      habitaciones: new Set(work.map((i) => i.room_id)).size,
      tiempo_medio: avg(durations),
      total: inspections.reduce((s, i) => s + i.total, 0),
      unidades: inspections.reduce((s, i) => s + i.units, 0),
      novedades: inspections.filter((i) => i.kind === 'novedad').length,
      con_consumo: work.filter((i) => i.units > 0).length,
      nap: inspections.filter((i) => i.charge === 'nap').length,
      no_reconocido: inspections.filter((i) => i.charge === 'no_reconocido').length,
    },
    people: [...people.values()]
      .map(({ durations: ds, ...p }) => ({ ...p, tiempo_medio: avg(ds) }))
      .sort((a, b) => b.revisiones - a.revisiones),
    products: [...products.values()].sort((a, b) => b.units - a.units),
    blocks: [...blocks.values()].sort((a, b) => b.total - a.total),
    types: [...types.values()].sort((a, b) => b.total - a.total),
    hours,
    days,
  };
}
