/**
 * surtida → por_revisar (llegó en el Excel de salidas) → en_revision → revisada (con o sin
 * consumo, hasta que la surtan) → surtida.
 */
export type RoomStatus = 'surtida' | 'por_revisar' | 'en_revision' | 'revisada';

/** revision: la normal · consumo: el huésped sigue y consumió más · novedad: consumo hallado
 *  después de que el huésped se fue · confirmacion: se volvió a revisar y no faltaba nada. */
export type InspectionKind = 'revision' | 'consumo' | 'novedad' | 'confirmacion';

export type RoomType = 'CM' | 'SS' | 'SM' | 'PR' | 'VIP';

export interface Block {
  id: string;
  code: string | null;
  name: string;
  updated_at: number;
}

export interface Room {
  id: string;
  block_id: string;
  number: string;
  type: RoomType;
  sort?: number;
  active: number;
  updated_at: number;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  std_qty: number;
  sort: number;
  image: string | null;
  active: number;
  updated_at: number;
}

export interface TypeInventory {
  type: RoomType;
  product_id: string;
  quantity: number;
  updated_at: number;
}

export interface Guest {
  room_id: string;
  guest_name: string | null;
  flight_time: string | null;
  /** Cuándo se marcó "por revisar" (Excel de salidas). */
  review_at: number | null;
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
  kind: InspectionKind;
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

export interface LineItem {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
}

/** Inspección con sus consumos (la usan ambas vistas). */
export interface InspectionWithItems extends Inspection {
  items: LineItem[];
  units: number;
  total: number;
  room_number?: string;
  block_code?: string;
  room_type?: RoomType;
}

/** Estado calculado de una habitación. */
export interface RoomState {
  status: RoomStatus;
  /** Lo que falta reponer (suma de las revisiones sin surtir). */
  missing: LineItem[];
  units: number;
  total: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  restocked_at: number | null;
  /** Revisada sin consumo: falta confirmarla cuando el huésped salga. */
  needs_confirm: boolean;
  has_novedad: boolean;
}

export interface RoomRow extends RoomState {
  id: string;
  number: string;
  type: RoomType;
  block_id: string;
  block_code: string | null;
  block_name: string;
  guest_name: string | null;
  flight_time: string | null;
  review_at: number | null;
}

export interface InventoryLine {
  product_id: string;
  name: string;
  price: number;
  image: string | null;
  quantity: number;
}

export interface SyncPayload {
  rev: number;
  blocks: Block[];
  rooms: Room[];
  products: Product[];
  type_inventory: TypeInventory[];
  guests: Guest[];
  room_inventory: RoomInventory[];
  inspections: Inspection[];
  inspection_items: InspectionItem[];
}
