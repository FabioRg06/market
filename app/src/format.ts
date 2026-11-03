import type { InspectionSummary, RoomStatus } from './types';

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

export function time(ms: number | null | undefined) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dayLabel(ms: number) {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function duration(from: number, to: number | null) {
  if (!to) return '';
  const min = Math.max(0, Math.round((to - from) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Estado de una habitación según su última revisión del día. */
export function roomStatus(last: Pick<InspectionSummary, 'finished_at' | 'units' | 'restocked_at'> | null): RoomStatus {
  if (!last) return 'sin_revisar';
  if (!last.finished_at) return 'en_revision';
  if (last.units > 0 && !last.restocked_at) return 'revisada';
  return 'surtida';
}

export const STATUS_LABEL: Record<RoomStatus, string> = {
  sin_revisar: 'Sin revisar',
  en_revision: 'En revisión',
  revisada: 'Revisada',
  surtida: 'Surtida',
};

/** Etiqueta para la tarjeta: "Sin consumo" cuando se revisó y no faltaba nada. */
export function statusLabel(status: RoomStatus, last: { units: number } | null) {
  if (status === 'surtida' && last && last.units === 0) return 'Sin consumo';
  return STATUS_LABEL[status];
}
