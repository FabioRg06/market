// Versión web: en el computador de recepción no hay base local, se lee directo
// del servidor. En Android/iOS Metro usa `db.native.ts` en lugar de este archivo.
import type * as Native from './db.native';

const unavailable = (): never => {
  throw new Error('La base local solo existe en la app del teléfono.');
};

export const localDbAvailable = false;
export const getMeta: typeof Native.getMeta = () => null;
export const setMeta: typeof Native.setMeta = () => {};
export const hasCatalog: typeof Native.hasCatalog = () => false;
export const pendingCount: typeof Native.pendingCount = () => 0;
export const listRooms: typeof Native.listRooms = unavailable;
export const getRoom: typeof Native.getRoom = unavailable;
export const getInventory: typeof Native.getInventory = unavailable;
export const getOpenInspection: typeof Native.getOpenInspection = unavailable;
export const getAnyOpenInspection: typeof Native.getAnyOpenInspection = () => null;
export const pendingRoomIds: typeof Native.pendingRoomIds = () => new Set();
export const getInspection: typeof Native.getInspection = unavailable;
export const getConsumption: typeof Native.getConsumption = unavailable;
export const roomHistory: typeof Native.roomHistory = unavailable;
export const startInspection: typeof Native.startInspection = unavailable;
export const setConsumed: typeof Native.setConsumed = unavailable;
export const finishInspection: typeof Native.finishInspection = unavailable;
export const finishWithoutConsumption: typeof Native.finishWithoutConsumption = unavailable;
export const cancelInspection: typeof Native.cancelInspection = unavailable;
export const wasSynced: typeof Native.wasSynced = unavailable;
export const markRestocked: typeof Native.markRestocked = unavailable;
export const setInventoryQty: typeof Native.setInventoryQty = unavailable;
export const getDirty: typeof Native.getDirty = unavailable;
export const markClean: typeof Native.markClean = unavailable;
export const applyPull: typeof Native.applyPull = unavailable;
