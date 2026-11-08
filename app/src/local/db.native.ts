// Base de datos local de la tablet (SQLite, como las bases internas de Android).
// Todo lo que hace quien revisa se guarda aquí primero; las filas con `dirty = 1`
// son las que aún no llegan al servidor de recepción.
import * as SQLite from 'expo-sqlite';
import type {
  Worker,
  Inspection,
  InspectionItem,
  InspectionKind,
  InspectionWithItems,
  InventoryLine,
  LineItem,
  RoomInventory,
  RoomRow,
  SyncPayload,
} from '../types';
import { roomState } from '../format';
import { uuid } from '../uuid';
import catalog from '../catalog.json';
import { CATALOG_ROOMS } from '../rooms';

const db = SQLite.openDatabaseSync('market.db');

// Versiones viejas (antes de la 2) se rehacen; de ahí en adelante solo se agregan columnas.
const SCHEMA_VERSION = 2;
const version = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
if (version < SCHEMA_VERSION) {
  db.execSync(`
    DROP TABLE IF EXISTS meta; DROP TABLE IF EXISTS blocks; DROP TABLE IF EXISTS rooms;
    DROP TABLE IF EXISTS products; DROP TABLE IF EXISTS guests; DROP TABLE IF EXISTS room_inventory;
    DROP TABLE IF EXISTS inspections; DROP TABLE IF EXISTS inspection_items;
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

db.execSync(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY, block_id TEXT NOT NULL, number TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0,
    std_qty INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS type_inventory (
    type TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, PRIMARY KEY (type, product_id)
  );
  CREATE TABLE IF NOT EXISTS guests (
    room_id TEXT PRIMARY KEY, guest_name TEXT, flight_time TEXT, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS room_inventory (
    room_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, dirty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (room_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS inspections (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, inspector TEXT NOT NULL, device_id TEXT,
    started_at INTEGER NOT NULL, finished_at INTEGER, restocked_at INTEGER, restocked_by TEXT,
    notes TEXT, updated_at INTEGER NOT NULL, dirty INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS inspection_items (
    id TEXT PRIMARY KEY, inspection_id TEXT NOT NULL, product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL, dirty INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_insp_room ON inspections(room_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_items_insp ON inspection_items(inspection_id);
`);

// Columnas nuevas: se agregan sin perder lo que la tablet tenga guardado.
function addColumn(table: string, column: string, definition: string) {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return false;
  db.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}
const migrated = [
  addColumn('blocks', 'code', 'TEXT'),
  addColumn('rooms', 'type', `TEXT NOT NULL DEFAULT '${catalog.defaultType}'`),
  addColumn('products', 'image', 'TEXT'),
  addColumn('guests', 'review_at', 'INTEGER'),
  addColumn('inspections', 'kind', "TEXT NOT NULL DEFAULT 'revision'"),
  addColumn('rooms', 'sort', 'INTEGER NOT NULL DEFAULT 0'),
  addColumn('blocks', 'sort', 'INTEGER NOT NULL DEFAULT 0'),
  addColumn('guests', 'worker_id', 'TEXT'),
  addColumn('guests', 'double_cycle', 'INTEGER NOT NULL DEFAULT 0'),
  addColumn('guests', 'pending_checkout', 'INTEGER NOT NULL DEFAULT 0'),
  addColumn('inspections', 'charge', 'TEXT'),
  addColumn('inspection_items', 'reason', 'TEXT'),
  addColumn('inspection_items', 'expires_on', 'TEXT'),
  addColumn('products', 'presentation', 'TEXT'),
].some(Boolean);
db.execSync(`CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
)`);
// Con columnas nuevas se vuelve a descargar todo del servidor para llenarlas.
if (migrated) db.runSync(`DELETE FROM meta WHERE key = 'last_rev'`);

// El catálogo viene dentro de la app para poder revisar desde el primer día aunque la tablet
// nunca haya visto el servidor. Después manda el servidor: recepción puede cambiar bloques y
// habitaciones, y eso llega al sincronizar.
db.withTransactionSync(() => {
  if ((db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM rooms WHERE active = 1`)?.n ?? 0) === 0) {
    catalog.blocks.forEach((b, i) =>
      db.runSync(`INSERT OR IGNORE INTO blocks (id, name, code, sort, updated_at) VALUES (?, ?, ?, ?, 0)`, b.id, b.name, b.code, i + 1)
    );
    for (const r of CATALOG_ROOMS)
      db.runSync(
        `INSERT OR IGNORE INTO rooms (id, block_id, number, type, sort, updated_at) VALUES (?, ?, ?, ?, ?, 0)`,
        r.id, r.block_id, r.number, r.type, r.sort
      );
  }
  for (const p of catalog.products)
    db.runSync(
      `INSERT OR IGNORE INTO products (id, name, price, presentation, sort, updated_at) VALUES (?, ?, ?, ?, ?, 0)`,
      p.id, p.name, p.price, (p as { presentation?: string }).presentation ?? null, p.sort
    );
  if ((db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM type_inventory`)?.n ?? 0) === 0)
    for (const [type, items] of Object.entries(catalog.typeInventory))
      for (const [productId, qty] of Object.entries(items))
        db.runSync(`INSERT OR IGNORE INTO type_inventory (type, product_id, quantity, updated_at) VALUES (?, ?, ?, 0)`, type, productId, qty);
});

// ---------- meta ----------

export function getMeta(key: string): string | null {
  return db.getFirstSync<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key)?.value ?? null;
}

export function setMeta(key: string, value: string) {
  db.runSync(
    `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}

export function hasCatalog() {
  return (db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM rooms`)?.n ?? 0) > 0;
}

// ---------- lecturas ----------

function itemsByInspection(ids: string[]): Map<string, LineItem[]> {
  const map = new Map<string, LineItem[]>();
  if (!ids.length) return map;
  const rows = db.getAllSync<LineItem & { inspection_id: string }>(
    `SELECT ii.inspection_id, ii.product_id, p.name, ii.quantity, ii.unit_price, ii.reason, ii.expires_on
       FROM inspection_items ii JOIN products p ON p.id = ii.product_id
      WHERE ii.quantity > 0 AND ii.inspection_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.sort`,
    ...ids
  );
  for (const { inspection_id, ...it } of rows) {
    if (!map.has(inspection_id)) map.set(inspection_id, []);
    map.get(inspection_id)!.push(it);
  }
  return map;
}

function withItems(inspections: Inspection[]): InspectionWithItems[] {
  const items = itemsByInspection(inspections.map((i) => i.id));
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

const roomSql = `
  SELECT r.id, r.number, r.type, r.block_id, b.code AS block_code, b.name AS block_name,
         g.guest_name, g.flight_time, g.review_at, g.worker_id, w.name AS worker_name,
         g.double_cycle, g.pending_checkout
    FROM rooms r JOIN blocks b ON b.id = r.block_id LEFT JOIN guests g ON g.room_id = r.id
    LEFT JOIN workers w ON w.id = g.worker_id AND w.active = 1`;

type RoomBase = Omit<RoomRow, keyof import('../types').RoomState | 'double_cycle' | 'pending_checkout'> & {
  double_cycle: number | null;
  pending_checkout: number | null;
};

function statesFor(rooms: RoomBase[], roomId?: string): RoomRow[] {
  const where = roomId ? 'AND room_id = ?' : '';
  const args = roomId ? [roomId] : [];
  const pending = db.getAllSync<Inspection>(
    `SELECT * FROM inspections WHERE finished_at IS NOT NULL AND restocked_at IS NULL AND kind != 'cambio' ${where} ORDER BY finished_at`,
    ...args
  );
  const items = itemsByInspection(pending.map((i) => i.id));
  const pendingBy = new Map<string, { kind: InspectionKind; charge?: string | null; inspector: string; finished_at: number; items: LineItem[] }[]>();
  for (const i of pending) {
    if (!pendingBy.has(i.room_id)) pendingBy.set(i.room_id, []);
    pendingBy.get(i.room_id)!.push({ kind: i.kind, charge: i.charge, inspector: i.inspector, finished_at: i.finished_at!, items: items.get(i.id) ?? [] });
  }
  const open = new Set(
    db.getAllSync<{ room_id: string }>(`SELECT room_id FROM inspections WHERE finished_at IS NULL ${where}`, ...args).map((r) => r.room_id)
  );
  const agg = db.getAllSync<{ room_id: string; fin: number | null; res: number | null }>(
    `SELECT room_id, MAX(CASE WHEN kind != 'cambio' THEN finished_at END) AS fin, MAX(restocked_at) AS res FROM inspections WHERE 1 = 1 ${where} GROUP BY room_id`,
    ...args
  );
  const aggBy = new Map(agg.map((a) => [a.room_id, a]));
  return rooms.map((r) => ({
    ...r,
    double_cycle: !!r.double_cycle,
    pending_checkout: !!r.pending_checkout,
    ...roomState(r.review_at, pendingBy.get(r.id) ?? [], open.has(r.id), aggBy.get(r.id)?.fin ?? null, aggBy.get(r.id)?.res ?? null),
  }));
}

/** Las habitaciones activas con huésped, tipo, trabajador y estado. Se filtra en memoria (es rápido). */
export function listRooms(): RoomRow[] {
  return statesFor(db.getAllSync<RoomBase>(`${roomSql} WHERE r.active = 1 ORDER BY r.sort`));
}

export function listWorkers(): Worker[] {
  return db.getAllSync<Worker>(`SELECT * FROM workers WHERE active = 1 ORDER BY name COLLATE NOCASE`);
}

export function getRoom(roomId: string): RoomRow | null {
  const r = db.getFirstSync<RoomBase>(`${roomSql} WHERE r.id = ?`, roomId);
  return r ? statesFor([r], roomId)[0] : null;
}

/** Lo que lleva el minibar: lo propio de la habitación o, si no, lo de su tipo. */
export function getInventory(roomId: string): InventoryLine[] {
  return db.getAllSync<InventoryLine>(
    `SELECT p.id AS product_id, p.name, p.price, p.presentation, p.image,
            COALESCE(ri.quantity, ti.quantity, 0) AS quantity
       FROM products p
       JOIN rooms r ON r.id = ?
       LEFT JOIN room_inventory ri ON ri.product_id = p.id AND ri.room_id = r.id
       LEFT JOIN type_inventory ti ON ti.product_id = p.id AND ti.type = r.type
      WHERE p.active = 1 ORDER BY p.sort`,
    roomId
  );
}

export function getOpenInspection(roomId: string): Inspection | null {
  return db.getFirstSync<Inspection>(
    `SELECT * FROM inspections WHERE room_id = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    roomId
  );
}

/** La revisión que quedó abierta en este dispositivo (solo puede haber una). */
export function getAnyOpenInspection(): Inspection | null {
  return db.getFirstSync<Inspection>(
    `SELECT * FROM inspections WHERE finished_at IS NULL AND dirty = 1 ORDER BY started_at DESC LIMIT 1`
  );
}

/** Habitaciones con revisiones terminadas que aún no llegan a recepción. */
export function pendingRoomIds(): Set<string> {
  const rows = db.getAllSync<{ room_id: string }>(
    `SELECT DISTINCT i.room_id FROM inspections i
      WHERE i.finished_at IS NOT NULL AND (i.dirty = 1 OR EXISTS
        (SELECT 1 FROM inspection_items ii WHERE ii.inspection_id = i.id AND ii.dirty = 1))`
  );
  return new Set(rows.map((r) => r.room_id));
}

export function getInspection(id: string): Inspection | null {
  return db.getFirstSync<Inspection>(`SELECT * FROM inspections WHERE id = ?`, id);
}

/** Cantidades consumidas por producto en una inspección. */
export function getConsumption(inspectionId: string): Record<string, number> {
  const rows = db.getAllSync<{ product_id: string; quantity: number }>(
    `SELECT product_id, quantity FROM inspection_items WHERE inspection_id = ?`,
    inspectionId
  );
  return Object.fromEntries(rows.map((r) => [r.product_id, r.quantity]));
}

export function roomHistory(roomId: string, limit = 10): InspectionWithItems[] {
  return withItems(
    db.getAllSync<Inspection>(`SELECT * FROM inspections WHERE room_id = ? ORDER BY started_at DESC LIMIT ?`, roomId, limit)
  );
}

export function pendingCount(): number {
  return pendingRoomIds().size;
}

// ---------- escrituras (funcionan sin conexión) ----------

export function startInspection(roomId: string, inspector: string, deviceId: string, kind: InspectionKind = 'revision'): string {
  const id = uuid();
  const now = Date.now();
  db.runSync(
    `INSERT INTO inspections (id, room_id, inspector, device_id, kind, started_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    id, roomId, inspector, deviceId, kind, now, now
  );
  return id;
}

/** Se volvió a revisar una habitación sin consumo y efectivamente no faltaba nada. */
export function confirmNoConsumption(roomId: string, inspector: string, deviceId: string) {
  const id = startInspection(roomId, inspector, deviceId, 'confirmacion');
  finishInspection(id, '');
}

export function setConsumed(
  inspectionId: string,
  productId: string,
  quantity: number,
  unitPrice: number,
  change?: { reason: string; expires_on: string | null }
) {
  const now = Date.now();
  db.runSync(
    `INSERT INTO inspection_items (id, inspection_id, product_id, quantity, unit_price, reason, expires_on, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET quantity = excluded.quantity, unit_price = excluded.unit_price,
       reason = excluded.reason, expires_on = excluded.expires_on, updated_at = excluded.updated_at, dirty = 1`,
    `${inspectionId}:${productId}`, inspectionId, productId, Math.max(0, quantity), unitPrice,
    change?.reason ?? null, change?.expires_on ?? null, now
  );
}

/** Tipo de novedad (post, NAP o no reconocido) de una revisión. */
export function setInspectionCharge(id: string, charge: string | null) {
  db.runSync(`UPDATE inspections SET charge = ?, updated_at = ?, dirty = 1 WHERE id = ?`, charge, Date.now(), id);
}

/** Cambio de producto: motivo y fecha de vencimiento para todo lo marcado. */
export function setChangeDetails(inspectionId: string, reason: string, expiresOn: string | null) {
  db.runSync(
    `UPDATE inspection_items SET reason = ?, expires_on = ?, unit_price = 0, updated_at = ?, dirty = 1 WHERE inspection_id = ?`,
    reason, expiresOn, Date.now(), inspectionId
  );
}

export function finishInspection(id: string, notes: string) {
  const now = Date.now();
  db.runSync(
    `UPDATE inspections SET finished_at = ?, notes = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    now, notes.trim() || null, now, id
  );
}

/** Terminar marcando que no se consumió nada. */
export function finishWithoutConsumption(id: string, notes: string) {
  const now = Date.now();
  db.withTransactionSync(() => {
    db.runSync(
      `UPDATE inspection_items SET quantity = 0, updated_at = ?, dirty = 1 WHERE inspection_id = ? AND quantity > 0`,
      now, id
    );
    finishInspection(id, notes);
  });
}

export function cancelInspection(id: string) {
  db.withTransactionSync(() => {
    db.runSync(`DELETE FROM inspection_items WHERE inspection_id = ?`, id);
    db.runSync(`DELETE FROM inspections WHERE id = ?`, id);
  });
}

export function wasSynced(id: string) {
  return getMeta(`synced:${id}`) === '1';
}

/** Surtir: todas las revisiones pendientes de la habitación quedan surtidas. */
export function restockRoom(roomId: string, by: string) {
  const now = Date.now();
  db.runSync(
    `UPDATE inspections SET restocked_at = ?, restocked_by = ?, updated_at = ?, dirty = 1
      WHERE room_id = ? AND finished_at IS NOT NULL AND restocked_at IS NULL AND kind != 'cambio'`,
    now, by, now, roomId
  );
}

export function setInventoryQty(roomId: string, productId: string, quantity: number) {
  db.runSync(
    `INSERT INTO room_inventory (room_id, product_id, quantity, updated_at, dirty) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(room_id, product_id) DO UPDATE SET quantity = excluded.quantity,
       updated_at = excluded.updated_at, dirty = 1`,
    roomId, productId, Math.max(0, quantity), Date.now()
  );
}

// ---------- sincronización ----------

export function getDirty() {
  return {
    // Una revisión abierta no se envía hasta terminarla (así se puede cancelar sin rastro).
    inspections: db.getAllSync<Inspection>(`SELECT * FROM inspections WHERE dirty = 1 AND finished_at IS NOT NULL`),
    inspection_items: db.getAllSync<InspectionItem>(
      `SELECT ii.* FROM inspection_items ii JOIN inspections i ON i.id = ii.inspection_id
        WHERE ii.dirty = 1 AND i.finished_at IS NOT NULL`
    ),
    room_inventory: db.getAllSync<RoomInventory>(`SELECT * FROM room_inventory WHERE dirty = 1`),
  };
}

/** Marca como enviadas las filas, salvo que se hayan vuelto a editar durante el envío. */
export function markClean(sent: ReturnType<typeof getDirty>) {
  db.withTransactionSync(() => {
    for (const r of sent.inspections) {
      db.runSync(`UPDATE inspections SET dirty = 0 WHERE id = ? AND updated_at = ?`, r.id, r.updated_at);
      setMeta(`synced:${r.id}`, '1');
    }
    for (const r of sent.inspection_items)
      db.runSync(`UPDATE inspection_items SET dirty = 0 WHERE id = ? AND updated_at = ?`, r.id, r.updated_at);
    for (const r of sent.room_inventory)
      db.runSync(
        `UPDATE room_inventory SET dirty = 0 WHERE room_id = ? AND product_id = ? AND updated_at = ?`,
        r.room_id, r.product_id, r.updated_at
      );
  });
}

/** Guarda lo que llegó del servidor sin pisar cambios locales más nuevos. */
export function applyPull(data: SyncPayload) {
  db.withTransactionSync(() => {
    for (const w of data.workers ?? [])
      db.runSync(
        `INSERT INTO workers (id, name, active, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = excluded.active, updated_at = excluded.updated_at`,
        w.id, w.name, w.active, w.updated_at
      );
    for (const b of data.blocks)
      db.runSync(
        `INSERT INTO blocks (id, name, code, sort, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, code = excluded.code, sort = excluded.sort, updated_at = excluded.updated_at`,
        b.id, b.name, b.code, b.sort ?? 0, b.updated_at
      );
    for (const r of data.rooms)
      db.runSync(
        `INSERT INTO rooms (id, block_id, number, type, sort, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET block_id = excluded.block_id, number = excluded.number, type = excluded.type,
           sort = excluded.sort, active = excluded.active, updated_at = excluded.updated_at`,
        r.id, r.block_id, r.number, r.type ?? catalog.defaultType, r.sort ?? 0, r.active, r.updated_at
      );
    for (const p of data.products)
      db.runSync(
        `INSERT INTO products (id, name, price, presentation, std_qty, sort, image, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, price = excluded.price, presentation = excluded.presentation, std_qty = excluded.std_qty,
           sort = excluded.sort, image = excluded.image, active = excluded.active, updated_at = excluded.updated_at`,
        p.id, p.name, p.price, p.presentation ?? null, p.std_qty, p.sort, p.image ?? null, p.active, p.updated_at
      );
    for (const t of data.type_inventory ?? [])
      db.runSync(
        `INSERT INTO type_inventory (type, product_id, quantity, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(type, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
        t.type, t.product_id, t.quantity, t.updated_at
      );
    for (const g of data.guests ?? [])
      db.runSync(
        `INSERT INTO guests (room_id, guest_name, flight_time, review_at, worker_id, double_cycle, pending_checkout, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(room_id) DO UPDATE SET guest_name = excluded.guest_name, flight_time = excluded.flight_time,
           review_at = excluded.review_at, worker_id = excluded.worker_id, double_cycle = excluded.double_cycle,
           pending_checkout = excluded.pending_checkout, updated_at = excluded.updated_at`,
        g.room_id, g.guest_name, g.flight_time, g.review_at ?? null, g.worker_id ?? null, g.double_cycle ?? 0, g.pending_checkout ?? 0, g.updated_at
      );
    for (const ri of data.room_inventory)
      db.runSync(
        `INSERT INTO room_inventory (room_id, product_id, quantity, updated_at, dirty) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(room_id, product_id) DO UPDATE SET quantity = excluded.quantity,
           updated_at = excluded.updated_at, dirty = 0
         WHERE room_inventory.dirty = 0 OR excluded.updated_at > room_inventory.updated_at`,
        ri.room_id, ri.product_id, ri.quantity, ri.updated_at
      );
    for (const i of data.inspections) {
      db.runSync(
        `INSERT INTO inspections (id, room_id, inspector, device_id, kind, started_at, finished_at,
                                  restocked_at, restocked_by, notes, charge, updated_at, dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET room_id = excluded.room_id, inspector = excluded.inspector,
           device_id = excluded.device_id, kind = excluded.kind, started_at = excluded.started_at,
           finished_at = excluded.finished_at, restocked_at = excluded.restocked_at,
           restocked_by = excluded.restocked_by, notes = excluded.notes, charge = excluded.charge,
           updated_at = excluded.updated_at, dirty = 0
         WHERE inspections.dirty = 0 OR excluded.updated_at > inspections.updated_at`,
        i.id, i.room_id, i.inspector, i.device_id, i.kind ?? 'revision', i.started_at, i.finished_at,
        i.restocked_at, i.restocked_by, i.notes, i.charge ?? null, i.updated_at
      );
      setMeta(`synced:${i.id}`, '1');
    }
    for (const it of data.inspection_items)
      db.runSync(
        `INSERT INTO inspection_items (id, inspection_id, product_id, quantity, unit_price, reason, expires_on, updated_at, dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET quantity = excluded.quantity, unit_price = excluded.unit_price,
           reason = excluded.reason, expires_on = excluded.expires_on, updated_at = excluded.updated_at, dirty = 0
         WHERE inspection_items.dirty = 0 OR excluded.updated_at > inspection_items.updated_at`,
        it.id, it.inspection_id, it.product_id, it.quantity, it.unit_price, it.reason ?? null, it.expires_on ?? null, it.updated_at
      );
    setMeta('last_rev', String(data.rev));
  });
}

export const localDbAvailable = true;
