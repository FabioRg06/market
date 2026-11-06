// Base local para el navegador. Mismas funciones que `db.native.ts` (SQLite de la tablet),
// pero guardada en el almacenamiento del navegador (localStorage). Metro usa este archivo
// en web y `db.native.ts` en Android/iOS.
//
// Ojo: si alguien borra los datos del navegador se pierde lo que no se haya enviado.
import type * as Native from './db.native';
import type {
  Block,
  Guest,
  Inspection,
  InspectionItem,
  InspectionKind,
  InspectionWithItems,
  InventoryLine,
  LineItem,
  Product,
  RoomInventory,
  RoomRow,
  RoomType,
} from '../types';
import { roomState } from '../format';
import { uuid } from '../uuid';
import catalog from '../catalog.json';
import { CATALOG_ROOMS } from '../rooms';

type Dirty = { dirty: 0 | 1 };
interface Store {
  meta: Record<string, string>;
  blocks: Record<string, Pick<Block, 'id' | 'code' | 'name'>>;
  roomTypes: Record<string, RoomType>;
  products: Record<string, Product>;
  typeInv: Record<string, number>; // "<tipo>:<producto>" → cantidad
  guests: Record<string, Guest>;
  inv: Record<string, RoomInventory & Dirty>;
  insp: Record<string, Inspection & Dirty & { synced?: 1 }>;
  items: Record<string, InspectionItem & Dirty>;
}

const KEY = 'market.db.v2';
const KEEP_DAYS = 3; // el navegador guarda menos historia que la tablet

const ROOMS = CATALOG_ROOMS.map(({ id, number, block_id }) => ({ id, number, block_id }));
const CATALOG_TYPE = new Map(CATALOG_ROOMS.map((r) => [r.id, r.type]));
const ROOM_BY_ID = new Map(ROOMS.map((r) => [r.id, r]));

function empty(): Store {
  const products: Record<string, Product> = {};
  for (const p of catalog.products) products[p.id] = { ...p, std_qty: 0, image: null, active: 1, updated_at: 0 };
  const typeInv: Record<string, number> = {};
  for (const [type, items] of Object.entries(catalog.typeInventory))
    for (const [productId, qty] of Object.entries(items)) typeInv[`${type}:${productId}`] = qty;
  const blocks: Store['blocks'] = {};
  for (const b of catalog.blocks) blocks[b.id] = { id: b.id, code: b.code, name: b.name };
  return { meta: {}, blocks, roomTypes: {}, products, typeInv, guests: {}, inv: {}, insp: {}, items: {} };
}

function load(): Store {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch {}
  return empty();
}

const st: Store = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {}
}

const invKey = (roomId: string, productId: string) => `${roomId}:${productId}`;
const typeOf = (roomId: string): RoomType => st.roomTypes[roomId] ?? CATALOG_TYPE.get(roomId) ?? (catalog.defaultType as RoomType);
const sortedProducts = () => Object.values(st.products).filter((p) => p.active).sort((a, b) => a.sort - b.sort);
const plain = ({ dirty, synced, ...i }: Inspection & Dirty & { synced?: 1 }): Inspection => i;

function itemsIndex() {
  const map = new Map<string, LineItem[]>();
  for (const it of Object.values(st.items)) {
    if (it.quantity <= 0) continue;
    if (!map.has(it.inspection_id)) map.set(it.inspection_id, []);
    map.get(it.inspection_id)!.push({
      product_id: it.product_id,
      name: st.products[it.product_id]?.name ?? it.product_id,
      quantity: it.quantity,
      unit_price: it.unit_price,
    });
  }
  return map;
}

function buildRows(roomIds: { id: string; number: string; block_id: string }[]): RoomRow[] {
  const items = itemsIndex();
  const by = new Map<string, Inspection[]>();
  for (const i of Object.values(st.insp)) {
    if (!by.has(i.room_id)) by.set(i.room_id, []);
    by.get(i.room_id)!.push(i);
  }
  return roomIds.map((r) => {
    const list = by.get(r.id) ?? [];
    const pending = list
      .filter((i) => i.finished_at && !i.restocked_at)
      .sort((a, b) => a.finished_at! - b.finished_at!)
      .map((i) => ({ kind: i.kind, inspector: i.inspector, finished_at: i.finished_at!, items: items.get(i.id) ?? [] }));
    const fin = Math.max(0, ...list.map((i) => i.finished_at ?? 0)) || null;
    const res = Math.max(0, ...list.map((i) => i.restocked_at ?? 0)) || null;
    const g = st.guests[r.id];
    const b = st.blocks[r.block_id];
    return {
      ...r,
      type: typeOf(r.id),
      block_code: b?.code ?? null,
      block_name: b?.name ?? '',
      guest_name: g?.guest_name ?? null,
      flight_time: g?.flight_time ?? null,
      review_at: g?.review_at ?? null,
      ...roomState(g?.review_at ?? null, pending, list.some((i) => !i.finished_at), fin, res),
    };
  });
}

export const localDbAvailable = true;

export const getMeta: typeof Native.getMeta = (key) => st.meta[key] ?? null;
export const setMeta: typeof Native.setMeta = (key, value) => {
  st.meta[key] = value;
  save();
};
export const hasCatalog: typeof Native.hasCatalog = () => true;

export const listRooms: typeof Native.listRooms = () => buildRows(ROOMS);

export const getRoom: typeof Native.getRoom = (roomId) => {
  const r = ROOM_BY_ID.get(roomId);
  return r ? buildRows([r])[0] : null;
};

export const getInventory: typeof Native.getInventory = (roomId) => {
  const type = typeOf(roomId);
  return sortedProducts().map(
    (p): InventoryLine => ({
      product_id: p.id,
      name: p.name,
      price: p.price,
      image: p.image ?? null,
      quantity: st.inv[invKey(roomId, p.id)]?.quantity ?? st.typeInv[`${type}:${p.id}`] ?? 0,
    })
  );
};

export const getOpenInspection: typeof Native.getOpenInspection = (roomId) => {
  const i = Object.values(st.insp).find((x) => x.room_id === roomId && !x.finished_at);
  return i ? plain(i) : null;
};

export const getAnyOpenInspection: typeof Native.getAnyOpenInspection = () => {
  const i = Object.values(st.insp).find((x) => !x.finished_at && x.dirty);
  return i ? plain(i) : null;
};

export const pendingRoomIds: typeof Native.pendingRoomIds = () => {
  const dirtyItems = new Set(Object.values(st.items).filter((it) => it.dirty).map((it) => it.inspection_id));
  const out = new Set<string>();
  for (const i of Object.values(st.insp)) if (i.finished_at && (i.dirty || dirtyItems.has(i.id))) out.add(i.room_id);
  return out;
};

export const getInspection: typeof Native.getInspection = (id) => (st.insp[id] ? plain(st.insp[id]) : null);

export const getConsumption: typeof Native.getConsumption = (inspectionId) =>
  Object.fromEntries(
    Object.values(st.items)
      .filter((it) => it.inspection_id === inspectionId)
      .map((it) => [it.product_id, it.quantity])
  );

export const roomHistory: typeof Native.roomHistory = (roomId, limit = 10) => {
  const items = itemsIndex();
  return Object.values(st.insp)
    .filter((i) => i.room_id === roomId)
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, limit)
    .map((i): InspectionWithItems => {
      const list = items.get(i.id) ?? [];
      return {
        ...plain(i),
        items: list,
        units: list.reduce((s, it) => s + it.quantity, 0),
        total: list.reduce((s, it) => s + it.quantity * it.unit_price, 0),
      };
    });
};

export const pendingCount: typeof Native.pendingCount = () => pendingRoomIds().size;

// ---------- escrituras (funcionan sin conexión) ----------

export const startInspection: typeof Native.startInspection = (roomId, inspector, deviceId, kind: InspectionKind = 'revision') => {
  const id = uuid();
  const now = Date.now();
  st.insp[id] = {
    id, room_id: roomId, inspector, device_id: deviceId, kind, started_at: now, finished_at: null,
    restocked_at: null, restocked_by: null, notes: null, updated_at: now, dirty: 1,
  };
  save();
  return id;
};

export const confirmNoConsumption: typeof Native.confirmNoConsumption = (roomId, inspector, deviceId) => {
  finishInspection(startInspection(roomId, inspector, deviceId, 'confirmacion'), '');
};

export const setConsumed: typeof Native.setConsumed = (inspectionId, productId, quantity, unitPrice) => {
  const id = `${inspectionId}:${productId}`;
  st.items[id] = {
    id, inspection_id: inspectionId, product_id: productId, quantity: Math.max(0, quantity),
    unit_price: unitPrice, updated_at: Date.now(), dirty: 1,
  };
  save();
};

export const finishInspection: typeof Native.finishInspection = (id, notes) => {
  const i = st.insp[id];
  if (!i) return;
  const now = Date.now();
  Object.assign(i, { finished_at: now, notes: notes.trim() || null, updated_at: now, dirty: 1 });
  save();
};

export const finishWithoutConsumption: typeof Native.finishWithoutConsumption = (id, notes) => {
  const now = Date.now();
  for (const it of Object.values(st.items))
    if (it.inspection_id === id && it.quantity > 0) Object.assign(it, { quantity: 0, updated_at: now, dirty: 1 });
  finishInspection(id, notes);
};

export const cancelInspection: typeof Native.cancelInspection = (id) => {
  for (const it of Object.values(st.items)) if (it.inspection_id === id) delete st.items[it.id];
  delete st.insp[id];
  save();
};

export const wasSynced: typeof Native.wasSynced = (id) => !!st.insp[id]?.synced;

export const restockRoom: typeof Native.restockRoom = (roomId, by) => {
  const now = Date.now();
  for (const i of Object.values(st.insp))
    if (i.room_id === roomId && i.finished_at && !i.restocked_at)
      Object.assign(i, { restocked_at: now, restocked_by: by, updated_at: now, dirty: 1 });
  save();
};

export const setInventoryQty: typeof Native.setInventoryQty = (roomId, productId, quantity) => {
  st.inv[invKey(roomId, productId)] = { room_id: roomId, product_id: productId, quantity: Math.max(0, quantity), updated_at: Date.now(), dirty: 1 };
  save();
};

// ---------- sincronización ----------

const strip = <T extends Dirty>({ dirty, ...rest }: T) => rest;

export const getDirty: typeof Native.getDirty = () => {
  const finished = (inspectionId: string) => !!st.insp[inspectionId]?.finished_at;
  return {
    inspections: Object.values(st.insp).filter((i) => i.dirty && i.finished_at).map(plain),
    inspection_items: Object.values(st.items).filter((it) => it.dirty && finished(it.inspection_id)).map(strip),
    room_inventory: Object.values(st.inv).filter((r) => r.dirty).map(strip),
  };
};

export const markClean: typeof Native.markClean = (sent) => {
  for (const r of sent.inspections) {
    const i = st.insp[r.id];
    if (i && i.updated_at === r.updated_at) i.dirty = 0;
    if (i) i.synced = 1;
  }
  for (const r of sent.inspection_items) {
    const it = st.items[r.id];
    if (it && it.updated_at === r.updated_at) it.dirty = 0;
  }
  for (const r of sent.room_inventory) {
    const x = st.inv[invKey(r.room_id, r.product_id)];
    if (x && x.updated_at === r.updated_at) x.dirty = 0;
  }
  save();
};

/** Guarda lo que llegó del servidor sin pisar cambios locales más nuevos. */
export const applyPull: typeof Native.applyPull = (data) => {
  const minKeep = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const b of data.blocks) st.blocks[b.id] = { id: b.id, code: b.code, name: b.name };
  for (const r of data.rooms) st.roomTypes[r.id] = r.type;
  for (const p of data.products) st.products[p.id] = p;
  for (const t of data.type_inventory ?? []) st.typeInv[`${t.type}:${t.product_id}`] = t.quantity;
  for (const g of data.guests ?? []) st.guests[g.room_id] = g;
  for (const r of data.room_inventory) {
    const k = invKey(r.room_id, r.product_id);
    const cur = st.inv[k];
    if (!cur || !cur.dirty || r.updated_at > cur.updated_at) st.inv[k] = { ...r, dirty: 0 };
  }
  for (const i of data.inspections) {
    // Se guarda lo reciente y todo lo que aún no está surtido (define el estado de la habitación).
    if (i.started_at < minKeep && i.restocked_at) continue;
    const cur = st.insp[i.id];
    if (!cur || !cur.dirty || i.updated_at > cur.updated_at) st.insp[i.id] = { ...i, kind: i.kind ?? 'revision', dirty: 0, synced: 1 };
  }
  for (const it of data.inspection_items) {
    if (!st.insp[it.inspection_id]) continue;
    const cur = st.items[it.id];
    if (!cur || !cur.dirty || it.updated_at > cur.updated_at) st.items[it.id] = { ...it, dirty: 0 };
  }
  // Se borra la historia vieja ya surtida y enviada, para no llenar el navegador.
  for (const i of Object.values(st.insp))
    if (i.started_at < minKeep && i.restocked_at && !i.dirty) {
      for (const it of Object.values(st.items)) if (it.inspection_id === i.id) delete st.items[it.id];
      delete st.insp[i.id];
    }
  st.meta.last_rev = String(data.rev);
  save();
};
