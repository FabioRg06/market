// Detalle de una habitación (va dentro del drawer de recepción): huésped y vuelo, tipo,
// lo que falta reponer como factura, y el historial de revisiones.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '../../api';
import type { InspectionWithItems, InventoryLine, RoomRow, RoomType } from '../../types';
import { dayLabel, duration, KIND_LABEL, ROOM_TYPES, STATUS_LABEL, time, TYPE_BY_CODE } from '../../format';
import { Btn, C, Confirm, Empty, Input, Receipt, s, tabular, TypeBadge } from '../../ui';

interface Detail {
  room: RoomRow;
  inventory: InventoryLine[];
  inspections: InspectionWithItems[];
}

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export default function RoomDetail({
  roomId,
  refreshKey,
  onClose,
  onChanged,
}: {
  roomId: string;
  refreshKey: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | 'restock' | 'guest'>(null);
  const [guest, setGuest] = useState('');
  const [flight, setFlight] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.get<Detail>(`/api/rooms/${roomId}`));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [roomId]);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function act(fn: () => Promise<unknown>) {
    await fn();
    await load();
    onChanged();
  }

  if (!data)
    return (
      <View style={{ flex: 1 }}>
        <DrawerTop title="Habitación" onClose={onClose} />
        <Empty text={error ? `No se pudo cargar (${error}).` : 'Cargando…'} />
      </View>
    );

  const r = data.room;
  const c = C.status[r.status];
  const flightOk = !flight.trim() || TIME_RE.test(flight.trim());

  return (
    <View style={{ flex: 1 }}>
      <DrawerTop
        title={`Habitación ${r.number}`}
        subtitle={`${r.block_code ?? ''} · ${TYPE_BY_CODE[r.type]?.name ?? r.type}`}
        badge={<TypeBadge type={r.type} size="md" />}
        onClose={onClose}
      />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={{ backgroundColor: c.tint, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: c.ink }}>{STATUS_LABEL[r.status]}</Text>
            {r.has_novedad && <Text style={{ fontSize: 12, fontWeight: '800', color: C.danger }}>NOVEDAD</Text>}
            {r.needs_confirm && <Text style={{ fontSize: 12, fontWeight: '800', color: c.ink }}>FALTA CONFIRMAR</Text>}
          </View>
          <View style={[s.row, { gap: 20 }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Huésped</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: r.guest_name ? C.ink : C.faint }} numberOfLines={1}>
                {r.guest_name ?? 'Sin huésped'}
              </Text>
            </View>
            <View>
              <Text style={s.label}>Vuelo</Text>
              <Text style={[{ fontSize: 16, fontWeight: '600', color: C.ink }, tabular]}>{r.flight_time ?? '—'}</Text>
            </View>
          </View>
          <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
            <Btn
              title="Editar huésped"
              variant="secondary"
              onPress={() => {
                setGuest(r.guest_name ?? '');
                setFlight(r.flight_time ?? '');
                setAsk('guest');
              }}
              style={{ minHeight: 38 }}
            />
            {r.status === 'surtida' && (
              <Btn
                title="Marcar por revisar"
                variant="secondary"
                onPress={() => act(() => api.put(`/api/rooms/${roomId}/guest`, { guest_name: r.guest_name, flight_time: r.flight_time, review: true }))}
                style={{ minHeight: 38 }}
              />
            )}
            {r.status === 'por_revisar' && (
              <Btn
                title="Quitar de por revisar"
                variant="quiet"
                onPress={() => act(() => api.put(`/api/rooms/${roomId}/guest`, { guest_name: r.guest_name, flight_time: r.flight_time, review: false }))}
                style={{ minHeight: 38 }}
              />
            )}
          </View>
        </View>

        {r.status === 'revisada' && (
          <Receipt
            title="Pendiente por surtir"
            subtitle={`Revisada por ${r.reviewed_by ?? '—'} a las ${time(r.reviewed_at)}`}
            lines={r.missing}
            footer={<Btn title="Marcar surtida" onPress={() => setAsk('restock')} style={{ marginTop: 6 }} />}
          />
        )}

        <View style={{ gap: 6 }}>
          <Text style={s.label}>Tipo de habitación</Text>
          <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
            {ROOM_TYPES.map((t) => (
              <Pressable
                key={t.code}
                onPress={() => t.code !== r.type && act(() => api.put(`/api/rooms/${roomId}/type`, { type: t.code }))}
                accessibilityRole="button"
                accessibilityState={{ selected: t.code === r.type }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: t.code === r.type ? C.brand : C.line,
                  backgroundColor: C.surface,
                }}
              >
                <TypeBadge type={t.code as RoomType} />
                <Text style={{ fontSize: 13, color: C.body }}>{t.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={s.label}>Minibar ({TYPE_BY_CODE[r.type]?.name})</Text>
          <Text style={{ color: C.body, lineHeight: 20 }}>
            {data.inventory.length ? data.inventory.map((l) => `${l.quantity} ${l.name}`).join(' · ') : 'Sin productos'}
          </Text>
        </View>

        <Text style={s.label}>Historial</Text>
        {data.inspections.length === 0 && <Empty text="Esta habitación todavía no tiene revisiones." />}
        {data.inspections.map((i) => (
          <Receipt
            key={i.id}
            title={`${KIND_LABEL[i.kind] ?? 'Revisión'} · ${dayLabel(i.started_at)}`}
            subtitle={`${i.inspector} · ${time(i.started_at)} – ${i.finished_at ? time(i.finished_at) : 'en curso'}${
              i.finished_at ? ` (${duration(i.started_at, i.finished_at)})` : ''
            }`}
            lines={i.items}
            footer={
              i.restocked_at ? (
                <Text style={{ fontSize: 12, fontWeight: '600', color: C.status.surtida.ink }}>
                  Surtida {dayLabel(i.restocked_at).toLowerCase()} a las {time(i.restocked_at)} · {i.restocked_by}
                </Text>
              ) : i.finished_at ? (
                <Text style={{ fontSize: 12, fontWeight: '600', color: C.status.revisada.ink }}>Falta surtir</Text>
              ) : null
            }
          />
        ))}
      </ScrollView>

      <Confirm
        visible={ask === 'restock'}
        title={`¿Marcar la ${r.number} como surtida?`}
        message={`Queda surtida a las ${time(Date.now())}.`}
        confirmText="Marcar surtida"
        onConfirm={() => {
          setAsk(null);
          act(() => api.post(`/api/rooms/${roomId}/restock`, { by: 'Recepción' }));
        }}
        onCancel={() => setAsk(null)}
      />
      <Confirm
        visible={ask === 'guest'}
        title={`Huésped de la ${r.number}`}
        confirmText="Guardar"
        cancelText="Cancelar"
        onConfirm={() => {
          if (!flightOk) return;
          setAsk(null);
          act(() => api.put(`/api/rooms/${roomId}/guest`, { guest_name: guest, flight_time: flight }));
        }}
        onCancel={() => setAsk(null)}
      >
        <View>
          <Text style={s.label}>Nombre</Text>
          <Input value={guest} onChangeText={setGuest} placeholder="Nombre de quien se queda" />
        </View>
        <View>
          <Text style={s.label}>Hora del vuelo</Text>
          <Input value={flight} onChangeText={setFlight} placeholder="14:30" keyboardType="numbers-and-punctuation" maxLength={5} />
          {!flightOk && <Text style={{ color: C.danger, marginTop: 4 }}>Escribe la hora como 14:30.</Text>}
        </View>
      </Confirm>
    </View>
  );
}

function DrawerTop({ title, subtitle, badge, onClose }: { title: string; subtitle?: string; badge?: React.ReactNode; onClose: () => void }) {
  return (
    <View style={[s.header, { gap: 10 }]}>
      <View style={{ flex: 1 }}>
        <View style={[s.row, { gap: 8 }]}>
          <Text style={s.title}>{title}</Text>
          {badge}
        </View>
        {subtitle ? <Text style={s.eyebrow}>{subtitle}</Text> : null}
      </View>
      <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cerrar">
        <Text style={{ fontSize: 24, color: C.onBrand }}>✕</Text>
      </Pressable>
    </View>
  );
}
