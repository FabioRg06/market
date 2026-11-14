// Reporte del día: revisadas, sin revisar, surtidas y lo que falta surtir. Se descarga en PDF,
// junto con la lista en PDF de las salidas que hay que revisar.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api, withSession } from '../../api';
import { getSettings } from '../../settings';
import type { InspectionWithItems, RoomType } from '../../types';
import { CHARGE_LABEL, dayLabel, dayRange, duration, KIND_LABEL, money, REASON_LABEL, time } from '../../format';
import { Btn, C, Empty, s, tabular, TypeBadge } from '../../ui';
import { openUrl } from '../../webfile';

const DAY = 24 * 60 * 60 * 1000;

interface Report {
  counts: { si: number; no: number; pendientes: number; nap: number; no_reconocido: number; cambios: number; revisadas: number; por_revisar: number; por_surtir: number; surtidas: number; novedades: number; total: number };
  reviewed: (InspectionWithItems & { room_type: RoomType })[];
  restocked: { room_id: string; room_number: string; block_code: string; restocked_at: number; restocked_by: string }[];
  pendingReview: { room_id: string; room_number: string; block_code: string; guest_name: string | null; flight_time: string | null }[];
  pendingRestock: { room_id: string; room_number: string; block_code: string; units: number; total: number }[];
  changes: (InspectionWithItems & { room_type: RoomType })[];
}

export default function ReportPanel({ onOpenRoom }: { onOpenRoom: (roomId: string) => void }) {
  const [day, setDay] = useState(Date.now());
  const [rep, setRep] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { from, to } = dayRange(day);
  const isToday = dayLabel(day) === 'Hoy';

  const load = useCallback(async () => {
    try {
      setRep(await api.get<Report>(`/api/report?from=${from}&to=${to}`));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [from, to]);
  useEffect(() => {
    load();
  }, [load]);

  // Sí = habitaciones revisadas con consumo; No = revisadas sin consumo.
  const unitsByRoom = new Map<string, number>();
  for (const i of rep?.reviewed ?? []) unitsByRoom.set(i.room_id, (unitsByRoom.get(i.room_id) ?? 0) + i.units);
  const si = (rep?.reviewed ?? []).filter((i) => (unitsByRoom.get(i.room_id) ?? 0) > 0);
  const no = (rep?.reviewed ?? []).filter((i) => (unitsByRoom.get(i.room_id) ?? 0) === 0);

  async function download() {
    const { serverUrl } = await getSettings();
    openUrl(withSession(`${serverUrl}/api/report.pdf?from=${from}&to=${to}`));
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
      <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
        <Btn title="‹" variant="secondary" onPress={() => setDay(day - DAY)} style={{ minHeight: 40, paddingHorizontal: 14 }} />
        <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink, minWidth: 110, textAlign: 'center' }}>{dayLabel(day)}</Text>
        <Btn title="›" variant="secondary" disabled={isToday} onPress={() => setDay(Math.min(Date.now(), day + DAY))} style={{ minHeight: 40, paddingHorizontal: 14 }} />
        <View style={{ flex: 1 }} />
        <Btn
          title="Reporte de salidas (PDF)"
          variant="secondary"
          onPress={async () => openUrl(withSession(`${(await getSettings()).serverUrl}/api/salidas.pdf?from=${from}&to=${to}`))}
          style={{ minHeight: 40 }}
        />
        <Btn title="Reporte del día (PDF)" onPress={download} style={{ minHeight: 40 }} />
      </View>

      {error && <Text style={{ color: C.danger }}>No se pudo cargar el reporte ({error}).</Text>}
      {!rep ? (
        <Empty text="Cargando…" />
      ) : (
        <>
          <View style={[s.row, { gap: 8 }]}>
            <Count label="Sí" value={rep.counts.si} color={C.status.revisada.solid} />
            <Count label="No" value={rep.counts.no} color={C.status.surtida.solid} />
            <Count label="Pendientes" value={rep.counts.pendientes} color={C.status.por_revisar.solid} />
            <Count label="Falta surtir" value={rep.counts.por_surtir} color={C.status.revisada.ink} />
            <Count label="Surtidas" value={rep.counts.surtidas} color={C.brand} />
            <Count label="Novedades" value={rep.counts.novedades} color={C.danger} />
            <Count label="Cambios" value={rep.counts.cambios} color={C.brand} />
            <Count label="Consumo" value={money(rep.counts.total)} />
          </View>

          <Section title={`Sí · revisadas con consumo (${si.length})`}>
            {si.length === 0 && <Empty text="Ninguna habitación revisada tuvo consumo este día." />}
            {si.map((i) => (
              <Row key={i.id} onPress={() => onOpenRoom(i.room_id)}>
                <Text style={[cell.room, tabular]}>{i.room_number}</Text>
                <TypeBadge type={i.room_type} />
                <Text style={[cell.kind, (i.kind === 'novedad' || i.charge) && { color: C.danger }]}>
                  {KIND_LABEL[i.kind] ?? 'Revisión'}
                  {i.charge ? ` · ${CHARGE_LABEL[i.charge]}` : ''}
                </Text>
                <Text style={[cell.text, { flex: 2 }]} numberOfLines={1}>
                  {i.units ? i.items.map((it) => `${it.quantity} ${it.name}`).join(', ') : 'Sin consumo'}{i.notes ? ` · Nota: ${i.notes}` : ''}
                </Text>
                <Text style={[cell.muted, tabular]}>
                  {i.inspector} · {time(i.started_at)}–{time(i.finished_at)} · {duration(i.started_at, i.finished_at)}
                </Text>
                <Text style={[cell.amount, tabular]}>{money(i.total)}</Text>
              </Row>
            ))}
          </Section>

          <Section title={`No · revisadas sin consumo (${no.length})`}>
            {no.length === 0 && <Empty text="Ninguna habitación se revisó sin consumo este día." />}
            {no.map((i) => (
              <Row key={i.id} onPress={() => onOpenRoom(i.room_id)}>
                <Text style={[cell.room, tabular]}>{i.room_number}</Text>
                <TypeBadge type={i.room_type} />
                <Text style={[cell.kind, (i.kind === 'novedad' || i.charge) && { color: C.danger }]}>
                  {KIND_LABEL[i.kind] ?? 'Revisión'}
                  {i.charge ? ` · ${CHARGE_LABEL[i.charge]}` : ''}
                </Text>
                <Text style={[cell.text, { flex: 2 }]} numberOfLines={1}>
                  {i.units ? i.items.map((it) => `${it.quantity} ${it.name}`).join(', ') : 'Sin consumo'}{i.notes ? ` · Nota: ${i.notes}` : ''}
                </Text>
                <Text style={[cell.muted, tabular]}>
                  {i.inspector} · {time(i.started_at)}–{time(i.finished_at)} · {duration(i.started_at, i.finished_at)}
                </Text>
                <Text style={[cell.amount, tabular]}>{money(i.total)}</Text>
              </Row>
            ))}
          </Section>

          <Section title={`Pendientes por revisar (${rep.pendingReview.length})`}>
            {rep.pendingReview.length === 0 && <Empty text="No quedó ninguna habitación pendiente por revisar." />}
            {rep.pendingReview.map((r) => (
              <Row key={r.room_id} onPress={() => onOpenRoom(r.room_id)}>
                <Text style={[cell.room, tabular]}>{r.room_number}</Text>
                <Text style={[cell.text, { flex: 2 }]}>{r.guest_name ?? 'Sin huésped'}</Text>
                <Text style={[cell.muted, tabular]}>Vuelo {r.flight_time ?? '—'}</Text>
              </Row>
            ))}
          </Section>

          <Section title={`Cambios de producto (${rep.changes.length})`}>
            {rep.changes.length === 0 && <Empty text="No hubo cambios de producto este día." />}
            {rep.changes.map((i) => (
              <Row key={i.id} onPress={() => onOpenRoom(i.room_id)}>
                <Text style={[cell.room, tabular]}>{i.room_number}</Text>
                <Text style={[cell.text, { flex: 2 }]} numberOfLines={2}>
                  {i.items.map((it) => `${it.quantity} ${it.name} · ${REASON_LABEL[it.reason ?? ''] ?? 'Cambio'}${it.expires_on ? ` (vence ${it.expires_on})` : ''}`).join(', ')}
                </Text>
                <Text style={[cell.muted, tabular]}>
                  {i.inspector} · {time(i.finished_at)}
                </Text>
              </Row>
            ))}
          </Section>

          <Section title={`Surtidas (${rep.restocked.length})`}>
            {rep.restocked.length === 0 && <Empty text="No se surtió ninguna habitación este día." />}
            {rep.restocked.map((r) => (
              <Row key={r.room_id} onPress={() => onOpenRoom(r.room_id)}>
                <Text style={[cell.room, tabular]}>{r.room_number}</Text>
                <Text style={[cell.text, { flex: 2 }]}>{r.restocked_by}</Text>
                <Text style={[cell.muted, tabular]}>{time(r.restocked_at)}</Text>
              </Row>
            ))}
          </Section>

          <Section title={`Falta surtir (${rep.pendingRestock.length})`}>
            {rep.pendingRestock.length === 0 && <Empty text="Todo lo revisado está surtido." />}
            {rep.pendingRestock.map((r) => (
              <Row key={r.room_id} onPress={() => onOpenRoom(r.room_id)}>
                <Text style={[cell.room, tabular]}>{r.room_number}</Text>
                <Text style={[cell.text, { flex: 2 }]}>{r.units ? `${r.units} productos` : 'Sin consumo'}</Text>
                <Text style={[cell.amount, tabular]}>{money(r.total)}</Text>
              </Row>
            ))}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

function Count({ label, value, color = C.ink }: { label: string; value: number | string; color?: string }) {
  return (
    // Todas las casillas en una sola fila: se reparten el ancho por igual.
    <View style={{ flex: 1, flexBasis: 0, minWidth: 0, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingVertical: 10 }}>
      <View style={[s.row, { gap: 6 }]}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, flexShrink: 0 }} />
        <Text style={[s.muted, { flexShrink: 1 }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[{ fontSize: 20, fontWeight: '700', color: C.ink, marginTop: 2 }, tabular]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line, overflow: 'hidden' }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: C.ink, padding: 14, borderBottomWidth: 1, borderBottomColor: C.line }}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.bg },
        pressed && { backgroundColor: C.bg },
      ]}
    >
      {children}
    </Pressable>
  );
}

const cell = {
  room: { width: 62, fontSize: 15, fontWeight: '700' as const, color: C.ink },
  kind: { width: 150, fontSize: 13, fontWeight: '600' as const, color: C.body },
  text: { flex: 1, fontSize: 14, color: C.ink },
  muted: { fontSize: 12, color: C.muted },
  amount: { minWidth: 80, textAlign: 'right' as const, fontSize: 14, fontWeight: '600' as const, color: C.ink },
};
