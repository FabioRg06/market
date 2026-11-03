/** sin_revisar → en_revision → revisada (consumió, falta surtir) → surtida (o sin consumo). */
export type RoomStatus = 'sin_revisar' | 'en_revision' | 'revisada' | 'surtida';

export interface Block {
  id: string;
  name: string;
  updated_at: number;
}

export interface Room {
  id: string;
  block_id: string;
  number: string;
  active: number;
  updated_at: number;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  std_qty: number;
  sort: number;
  active: number;
  updated_at: number;
}

export interface Guest {
  room_id: string;
  guest_name: string | null;
  flight_time: string | null;
  updated_at: number;
}

export interface RoomInventory {
  room_id: string;
  product_id: string;
  quantity: number;
  updated_at: number;
}

export interface Inspection {
  id: string;
  room_id: string;
  inspector: string;
  device_id: string | null;
  started_at: number;
  finished_at: number | null;
  restocked_at: number | null;
  restocked_by: string | null;
  notes: string | null;
  updated_at: number;
}

export interface InspectionItem {
  id: string;
  inspection_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  updated_at: number;
}

/** Inspección con sus consumos (la usan ambas vistas). */
export interface InspectionWithItems extends Inspection {
  items: { product_id: string; name: string; quantity: number; unit_price: number }[];
  units: number;
  total: number;
  room_number?: string;
  block_name?: string;
}

/** Lo mínimo de la última revisión del día para pintar la tarjeta. */
export interface InspectionSummary {
  id: string;
  inspector: string;
  started_at: number;
  finished_at: number | null;
  restocked_at: number | null;
  restocked_by: string | null;
  units: number;
  total: number;
}

export interface RoomRow {
  id: string;
  number: string;
  block_id: string;
  block_name: string;
  guest_name: string | null;
  flight_time: string | null;
  status: RoomStatus;
  last: InspectionSummary | null;
}

export interface InventoryLine {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface SyncPayload {
  rev: number;
  blocks: Block[];
  rooms: Room[];
  products: Product[];
  guests: Guest[];
  room_inventory: RoomInventory[];
  inspections: Inspection[];
  inspection_items: InspectionItem[];
}
