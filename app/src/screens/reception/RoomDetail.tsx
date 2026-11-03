// Detalle de una habitación para recepción: huésped y vuelo, inventario y consumo histórico.
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api } from '../../api';
import type { InspectionWithItems, InventoryLine } from '../../types';
import { dayLabel, duration, money, roomStatus, STATUS_LABEL, time } from '../../format';
import { Btn, C, Card, Confirm, Empty, Header, Input, s } from '../../ui';
import { DoorGlyph } from '../../icons';

interface Detail {
  room: { id: string; number: string; block_name: string; guest_name: string | null; flight_time: string | null };
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
  const [restock, setRestock] = useState<InspectionWithItems | null>(null);
  const [editing, setEditing] = useState(false);
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

  async function confirmRestock() {
    const insp = restock!;
    setRestock(null);
    await api.post(`/api/inspections/${insp.id}/restock`, { by: 'Recepción' });
    await load();
    onChanged();
  }

  function openEditor() {
    setGuest(data?.room.guest_name ?? '');
    setFlight(data?.room.flight_time ?? '');
    setEditing(true);
  }

  async function saveGuest(clear = false) {
    setEditing(false);
    await api.put(`/api/rooms/${roomId}/guest`, clear ? {} : { guest_name: guest, flight_time: flight });
    await load();
    onChanged();
  }

  if (!data)
    return (
      <>
        <Header title="Habitación" onBack={onClose} />
        <Empty text={error ? `No se pudo cargar (${error}).` : 'Cargando…'} />
      </>
    );

  const byDay = new Map<string, InspectionWithItems[]>();
  for (const i of data.inspections) {
    const k = dayLabel(i.started_at);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(i);
  }
  const today = data.inspections.find((i) => dayLabel(i.started_at) === 'Hoy') ?? null;
  const status = roomStatus(today);
  const c = C.status[status];
  const flightOk = !flight.trim() || TIME_RE.test(flight.trim());

  return (
    <>
      <Header eyebrow={data.room.block_name} title={`Habitación ${data.room.number}`} onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View style={{ backgroundColor: c.tint, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 }}>
          <View style={[s.row, { gap: 14 }]}>
            <DoorGlyph color={c.solid} size={36} fill={c.border} />
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Huésped</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: data.room.guest_name ? C.ink : C.muted }} numberOfLines={1}>
                {data.room.guest_name ?? 'Sin huésped'}
              </Text>
              <Text style={{ color: C.ink, marginTop: 2 }}>
                Vuelo <Text style={{ fontWeight: '700', fontSize: 22 }}>{data.room.flight_time ?? '—'}</Text>
              </Text>
            </View>
            <Text style={{ fontSize: 13, fontWeight: '600', color: c.ink }}>{STATUS_LABEL[status]}</Text>
          </View>
          <Btn title={data.room.guest_name ? 'Cambiar huésped o vuelo' : 'Registrar huésped'} variant="secondary" onPress={openEditor} />
        </View>

        <Card style={{ gap: 8 }}>
          <Text style={s.label}>Minibar</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }}>
            {data.inventory
              .filter((l) => l.quantity > 0)
              .map((l) => (
                <Text key={l.product_id} style={{ width: '50%', color: C.ink }}>
                  <Text style={{ fontWeight: '700', fontSize: 18 }}>{l.quantity}</Text> {l.name}
                </Text>
              ))}
          </View>
        </Card>

        <Text style={s.label}>Consumo histórico</Text>
        {data.inspections.length === 0 && <Empty text="Esta habitación todavía no tiene revisiones." />}
        {[...byDay.entries()].map(([label, list]) => (
          <View key={label} style={{ gap: 8 }}>
            <Text style={{ fontWeight: '600', fontSize: 18, color: C.muted }}>{label}</Text>
            {list.map((i) => (
              <Card key={i.id} style={{ gap: 4 }}>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <Text style={{ fontWeight: '700', fontSize: 22, color: C.ink }}>
                    {time(i.started_at)} – {i.finished_at ? time(i.finished_at) : '…'}
                  </Text>
                  <Text style={{ fontWeight: '700', fontSize: 22, color: C.ink }}>{money(i.total)}</Text>
                </View>
                <Text style={s.muted}>
                  {i.inspector}
                  {i.finished_at ? ` · ${duration(i.started_at, i.finished_at)}` : ' · en revisión'}
                </Text>
                {i.units === 0 ? (
                  <Text style={{ color: C.ink }}>Sin consumo</Text>
                ) : (
                  i.items.map((it) => (
                    <View key={it.product_id} style={[s.row, { justifyContent: 'space-between' }]}>
                      <Text style={{ color: C.ink }}>
                        {it.quantity} × {it.name}
                      </Text>
                      <Text style={{ color: C.ink }}>{money(it.quantity * it.unit_price)}</Text>
                    </View>
                  ))
                )}
                {i.notes ? <Text style={s.muted}>Nota: {i.notes}</Text> : null}
                {i.units > 0 &&
                  (i.restocked_at ? (
                    <Text style={{ fontWeight: '700', color: C.status.surtida.ink }}>
                      Surtida {dayLabel(i.restocked_at).toLowerCase()} {time(i.restocked_at)} · {i.restocked_by}
                    </Text>
                  ) : (
                    <View style={[s.row, { justifyContent: 'space-between', marginTop: 4 }]}>
                      <Text style={{ fontWeight: '700', color: C.status.revisada.ink }}>Falta surtir</Text>
                      <Btn title="Marcar surtida" variant="secondary" onPress={() => setRestock(i)} style={{ minHeight: 40 }} />
                    </View>
                  ))}
              </Card>
            ))}
          </View>
        ))}
      </ScrollView>

      <Confirm
        visible={!!restock}
        title="¿Marcar como surtida?"
        message={`Habitación ${data.room.number}: queda surtida a las ${time(Date.now())}.`}
        confirmText="Sí, surtida"
        onConfirm={confirmRestock}
        onCancel={() => setRestock(null)}
      />
      <Confirm
        visible={editing}
        title={`Huésped de la ${data.room.number}`}
        confirmText="Guardar"
        cancelText="Cancelar"
        onConfirm={() => flightOk && saveGuest()}
        onCancel={() => setEditing(false)}
      >
        <View>
          <Text style={s.label}>Nombre</Text>
          <Input value={guest} onChangeText={setGuest} placeholder="Nombre de quien se queda" autoFocus />
        </View>
        <View>
          <Text style={s.label}>Hora del vuelo</Text>
          <Input value={flight} onChangeText={setFlight} placeholder="14:30" keyboardType="numbers-and-punctuation" maxLength={5} />
          {!flightOk && <Text style={{ color: C.danger, marginTop: 4 }}>Escribe la hora como 14:30.</Text>}
        </View>
        {data.room.guest_name ? <Btn title="Dejar la habitación libre" variant="danger" onPress={() => saveGuest(true)} /> : null}
      </Confirm>
    </>
  );
}
