import type { InspectionKind, LineItem, RoomState, RoomStatus, RoomType } from './types';
import catalog from './catalog.json';

const DAY = 24 * 60 * 60 * 1000;

export function startOfDay(ms: number) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayRange(ms: number) {
  const from = startOfDay(ms);
  return { from, to: from + DAY };
}

export function money(v: number) {
  return '$ ' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Hora con segundos: 14:05:32. */
export function time(ms: number | null | undefined) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function dayLabel(ms: number) {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Duración con minutos y segundos: "6 min 12 s". */
export function duration(from: number, to: number | null) {
  if (!to) return '';
  const sec = Math.max(0, Math.round((to - from) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h} h ${m} min ${s} s` : m ? `${m} min ${s} s` : `${s} s`;
}

export const STATUS_LABEL: Record<RoomStatus, string> = {
  surtida: 'Surtida',
  por_revisar: 'Por revisar',
  revisada: 'Revisada',
};

export const KIND_LABEL: Record<InspectionKind, string> = {
  revision: 'Revisión',
  consumo: 'Consumo adicional',
  novedad: 'Novedad',
  confirmacion: 'Confirmación sin consumo',
  cambio: 'Cambio de producto',
};

export const CHARGE_LABEL: Record<string, string> = { post: 'Post', nap: 'NAP', no_reconocido: 'No reconocido' };

/** Tipos de novedad, en el orden en que se ofrecen. */
export const NOVEDAD_TYPES: { key: 'post' | 'no_reconocido' | 'nap'; label: string; hint: string }[] = [
  { key: 'post', label: 'Post', hint: 'Consumo hallado después de la salida' },
  { key: 'no_reconocido', label: 'No reconocido', hint: 'El huésped no reconoce el consumo' },
  { key: 'nap', label: 'No se acercó a pagar', hint: 'NAP' },
];
export const REASON_LABEL: Record<string, string> = { vencido: 'Vencido', danado: 'Dañado' };

export const ROOM_TYPES = catalog.types as { code: RoomType; name: string; color: string; ink: string }[];
export const TYPE_BY_CODE = Object.fromEntries(ROOM_TYPES.map((t) => [t.code, t])) as Record<
  RoomType,
  (typeof ROOM_TYPES)[number]
>;

interface PendingInspection {
  kind: InspectionKind;
  charge?: string | null;
  inspector: string;
  finished_at: number;
  items: LineItem[];
}

/**
 * Estado de una habitación (mismas reglas que server/src/reception.js → summarize).
 * `pending` = revisiones terminadas que aún no se surten, en orden de cuando terminaron.
 */
/** Las novedades NAP o no reconocido no se vuelven a surtir: el consumo ya se contó en la revisión. */
export const restocks = (i: { kind: string; charge?: string | null }) =>
  !(i.kind === 'novedad' && (i.charge === 'nap' || i.charge === 'no_reconocido'));

export function roomState(
  reviewAt: number | null,
  pending: PendingInspection[],
  hasOpen: boolean,
  lastFinishedAt: number | null,
  lastRestockAt: number | null
): RoomState {
  const missing = new Map<string, LineItem>();
  for (const i of pending)
    if (restocks(i))
    for (const it of i.items) {
      if (it.quantity <= 0) continue;
      const m = missing.get(it.product_id) ?? { ...it, quantity: 0 };
      m.quantity += it.quantity;
      missing.set(it.product_id, m);
    }
  const missingList = [...missing.values()];
  let status: RoomStatus = 'surtida';
  const units = missingList.reduce((s, m) => s + m.quantity, 0);
  // Sin consumo no hay nada que surtir: vuelve a surtida y solo queda en el reporte.
  if (reviewAt && (!lastFinishedAt || lastFinishedAt < reviewAt)) status = 'por_revisar';
  else if (units > 0) status = 'revisada';
  const last = pending[pending.length - 1];
  return {
    status,
    missing: missingList,
    units,
    total: missingList.reduce((s, m) => s + m.quantity * m.unit_price, 0),
    reviewed_at: last?.finished_at ?? null,
    reviewed_by: last?.inspector ?? null,
    restocked_at: lastRestockAt,
    needs_confirm: false,
    has_novedad: status === 'revisada' && pending.some((i) => i.kind === 'novedad'),
    charges: (status === 'revisada' ? [...new Set(pending.map((i) => i.charge).filter(Boolean))] : []) as RoomState['charges'],
  };
}

/** "2 Agua · 1 Coca-Cola · …" para mostrar lo que falta en una línea. */
export function missingText(missing: LineItem[]) {
  return missing.map((m) => `${m.quantity} ${m.name}`).join(' · ');
}
