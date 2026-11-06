// Habitaciones del hotel según catalog.json: cada bloque tiene rangos fijos
// (prefijo + desde + hasta), p. ej. BW 243 o R 701. Mismo cálculo que server/src/seed.js.
import catalog from './catalog.json';
import type { RoomType } from './types';

export interface CatalogRoom {
  id: string;
  number: string;
  block_id: string;
  sort: number;
  type: RoomType;
}

const typeOf = new Map<string, RoomType>();
for (const [type, numbers] of Object.entries(catalog.roomTypes ?? {}))
  for (const n of numbers) typeOf.set(n, type as RoomType);

export const CATALOG_ROOMS: CatalogRoom[] = (() => {
  const out: CatalogRoom[] = [];
  for (const b of catalog.blocks)
    for (const [prefix, from, to] of b.ranges as [string, number, number][])
      for (let n = from; n <= to; n++) {
        const number = `${prefix}${n}`;
        out.push({
          id: `r${number}`,
          number,
          block_id: b.id,
          sort: out.length,
          type: typeOf.get(number) ?? (catalog.defaultType as RoomType),
        });
      }
  return out;
})();

/** "bw 243", "Hab. BW-243" → "BW243". */
export function normalizeRoomNumber(raw: string) {
  return raw.toUpperCase().replace(/HAB(ITACI[OÓ]N)?\.?/g, '').replace(/[\s\-_.#]/g, '');
}
