// Base de datos local del teléfono (SQLite, como las bases internas de Android).
// Todo lo que hace quien revisa se guarda aquí primero; las filas con `dirty = 1`
// son las que aún no llegan al servidor de recepción.
import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import type {
  Inspection,
  InspectionItem,
  InspectionSummary,
  InspectionWithItems,
  InventoryLine,
  RoomInventory,
  RoomRow,
  SyncPayload,
} from '../types';
import { roomStatus, startOfDay } from '../format';
import catalog from '../catalog.json';

const db = SQLite.openDatabaseSync('market.db');

// Si cambia el esquema se rehace la base (solo guarda copias de lo que tiene el servidor
// y lo pendiente; en producción conviene migrar en vez de borrar).
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

// El catálogo fijo (700 habitaciones, 13 productos) viene dentro de la app: así se puede
// revisar desde el primer día aunque el teléfono nunca haya visto el servidor.
if ((db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM rooms`)?.n ?? 0) === 0) {
  db.withTransactionSync(() => {
    for (const b of catalog.blocks) {
      db.runSync(`INSERT OR IGNORE INTO blocks (id, name, updated_at) VALUES (?, ?, 0)`, b.id, b.name);
      for (let n = b.from; n <= b.to; n++)
        db.runSync(`INSERT OR IGNORE INTO rooms (id, block_id, number, updated_at) VALUES (?, ?, ?, 0)`, `r${n}`, b.id, String(n));
    }
    for (const p of catalog.products)
      db.runSync(
        `INSERT OR IGNORE INTO products (id, name, price, std_qty, sort, updated_at) VALUES (?, ?, ?, ?, ?, 0)`,
        p.id, p.name, p.price, p.std_qty, p.sort
      );
  });
}

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

function withItems(inspections: Inspection[]): InspectionWithItems[] {
  return inspections.map((i) => {
    const items = db.getAllSync<InspectionWithItems['items'][number]>(
      `SELECT ii.product_id, p.name, ii.quantity, ii.unit_price
         FROM inspection_items ii JOIN products p ON p.id = ii.product_id
        WHERE ii.inspection_id = ? AND ii.quantity > 0 ORDER BY p.sort`,
      i.id
    );
    return {
      ...i,
      items,
      units: items.reduce((s, it) => s + it.quantity, 0),
      total: items.reduce((s, it) => s + it.quantity * it.unit_price, 0),
    };
  });
}

/** Las 700 habitaciones con huésped y estado del día. Se filtra en memoria (es rápido). */
export function listRooms(): RoomRow[] {
  const rooms = db.getAllSync<Omit<RoomRow, 'status' | 'last'>>(
    `SELECT r.id, r.number, r.block_id, b.name AS block_name, g.guest_name, g.flight_time
       FROM rooms r JOIN blocks b ON b.id = r.block_id LEFT JOIN guests g ON g.room_id = r.id
      WHERE r.active = 1 ORDER BY CAST(r.number AS INTEGER)`
  );
  const today = db.getAllSync<InspectionSummary & { room_id: string }>(
    `SELECT i.id, i.room_id, i.inspector, i.started_at, i.finished_at, i.restocked_at, i.restocked_by,
            COALESCE(SUM(ii.quantity), 0) AS units, COALESCE(SUM(ii.quantity * ii.unit_price), 0) AS total
       FROM inspections i LEFT JOIN inspection_items ii ON ii.inspection_id = i.id
      WHERE i.started_at >= ? GROUP BY i.id ORDER BY i.started_at DESC`,
    startOfDay(Date.now())
  );
  const latest = new Map<string, InspectionSummary>();
  for (const i of today) if (!latest.has(i.room_id)) latest.set(i.room_id, i);
  return rooms.map((r) => {
    const last = latest.get(r.id) ?? null;
    return { ...r, status: roomStatus(last), last };
  });
}

export function getRoom(roomId: string) {
  return db.getFirstSync<{ id: string; number: string; block_name: string; guest_name: string | null; flight_time: string | null }>(
    `SELECT r.id, r.number, b.name AS block_name, g.guest_name, g.flight_time
       FROM rooms r JOIN blocks b ON b.id = r.block_id LEFT JOIN guests g ON g.room_id = r.id WHERE r.id = ?`,
    roomId
  );
}

export function getInventory(roomId: string): InventoryLine[] {
  return db.getAllSync<InventoryLine>(
    `SELECT p.id AS product_id, p.name, p.price, COALESCE(ri.quantity, p.std_qty) AS quantity
       FROM products p LEFT JOIN room_inventory ri ON ri.product_id = p.id AND ri.room_id = ?
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
    db.getAllSync<Inspection>(
      `SELECT * FROM inspections WHERE room_id = ? ORDER BY started_at DESC LIMIT ?`,
      roomId,
      limit
    )
  );
}

export function pendingCount(): number {
  return pendingRoomIds().size;
}

// ---------- escrituras (funcionan sin conexión) ----------

export function startInspection(roomId: string, inspector: string, deviceId: string): string {
  const id = randomUUID();
  const now = Date.now();
  db.runSync(
    `INSERT INTO inspections (id, room_id, inspector, device_id, started_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    id,
    roomId,
    inspector,
    deviceId,
    now,
    now
  );
  return id;
}

export function setConsumed(inspectionId: string, productId: string, quantity: number, unitPrice: number) {
  const now = Date.now();
  db.runSync(
    `INSERT INTO inspection_items (id, inspection_id, product_id, quantity, unit_price, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET quantity = excluded.quantity, unit_price = excluded.unit_price,
       updated_at = excluded.updated_at, dirty = 1`,
    `${inspectionId}:${productId}`,
    inspectionId,
    productId,
    Math.max(0, quantity),
    unitPrice,
    now
  );
}

export function finishInspection(id: string, notes: string) {
  const now = Date.now();
  db.runSync(
    `UPDATE inspections SET finished_at = ?, notes = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    now,
    notes.trim() || null,
    now,
    id
  );
}

/** Terminar marcando que no se consumió nada. */
export function finishWithoutConsumption(id: string, notes: string) {
  const now = Date.now();
  db.withTransactionSync(() => {
    db.runSync(
      `UPDATE inspection_items SET quantity = 0, updated_at = ?, dirty = 1 WHERE inspection_id = ? AND quantity > 0`,
      now,
      id
    );
    finishInspection(id, notes);
  });
}

export function cancelInspection(id: string) {
  // Solo se puede cancelar si nunca llegó al servidor.
  db.withTransactionSync(() => {
    db.runSync(`DELETE FROM inspection_items WHERE inspection_id = ?`, id);
    db.runSync(`DELETE FROM inspections WHERE id = ?`, id);
  });
}

export function wasSynced(id: string) {
  return getMeta(`synced:${id}`) === '1';
}

export function markRestocked(id: string, by: string) {
  const now = Date.now();
  db.runSync(
    `UPDATE inspections SET restocked_at = ?, restocked_by = ?, updated_at = ?, dirty = 1
      WHERE id = ? AND restocked_at IS NULL`,
    now,
    by,
    now,
    id
  );
}

export function setInventoryQty(roomId: string, productId: string, quantity: number) {
  db.runSync(
    `INSERT INTO room_inventory (room_id, product_id, quantity, updated_at, dirty) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(room_id, product_id) DO UPDATE SET quantity = excluded.quantity,
       updated_at = excluded.updated_at, dirty = 1`,
    roomId,
    productId,
    Math.max(0, quantity),
    Date.now()
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
        r.room_id,
        r.product_id,
        r.updated_at
      );
  });
}

/** Guarda lo que llegó del servidor sin pisar cambios locales más nuevos. */
export function applyPull(data: SyncPayload) {
  db.withTransactionSync(() => {
    for (const b of data.blocks)
      db.runSync(
        `INSERT INTO blocks (id, name, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
        b.id, b.name, b.updated_at
      );
    for (const r of data.rooms)
      db.runSync(
        `INSERT INTO rooms (id, block_id, number, active, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET block_id = excluded.block_id, number = excluded.number,
           active = excluded.active, updated_at = excluded.updated_at`,
        r.id, r.block_id, r.number, r.active, r.updated_at
      );
    for (const p of data.products)
      db.runSync(
        `INSERT INTO products (id, name, price, std_qty, sort, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, price = excluded.price, std_qty = excluded.std_qty,
           sort = excluded.sort, active = excluded.active, updated_at = excluded.updated_at`,
        p.id, p.name, p.price, p.std_qty, p.sort, p.active, p.updated_at
      );
    for (const g of data.guests ?? [])
      db.runSync(
        `INSERT INTO guests (room_id, guest_name, flight_time, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(room_id) DO UPDATE SET guest_name = excluded.guest_name,
           flight_time = excluded.flight_time, updated_at = excluded.updated_at`,
        g.room_id, g.guest_name, g.flight_time, g.updated_at
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
        `INSERT INTO inspections (id, room_id, inspector, device_id, started_at, finished_at,
                                  restocked_at, restocked_by, notes, updated_at, dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET room_id = excluded.room_id, inspector = excluded.inspector,
           device_id = excluded.device_id, started_at = excluded.started_at,
           finished_at = excluded.finished_at, restocked_at = excluded.restocked_at,
           restocked_by = excluded.restocked_by, notes = excluded.notes,
           updated_at = excluded.updated_at, dirty = 0
         WHERE inspections.dirty = 0 OR excluded.updated_at > inspections.updated_at`,
        i.id, i.room_id, i.inspector, i.device_id, i.started_at, i.finished_at,
        i.restocked_at, i.restocked_by, i.notes, i.updated_at
      );
      setMeta(`synced:${i.id}`, '1');
    }
    for (const it of data.inspection_items)
      db.runSync(
        `INSERT INTO inspection_items (id, inspection_id, product_id, quantity, unit_price, updated_at, dirty)
         VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET quantity = excluded.quantity, unit_price = excluded.unit_price,
           updated_at = excluded.updated_at, dirty = 0
         WHERE inspection_items.dirty = 0 OR excluded.updated_at > inspection_items.updated_at`,
        it.id, it.inspection_id, it.product_id, it.quantity, it.unit_price, it.updated_at
      );
    setMeta('last_rev', String(data.rev));
  });
}

export const localDbAvailable = true;
