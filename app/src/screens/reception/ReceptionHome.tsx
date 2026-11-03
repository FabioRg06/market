// Vista principal de recepción (computador o tablet).
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { api } from '../../api';
import type { InspectionWithItems, RoomRow } from '../../types';
import { dayLabel, dayRange, duration, money, time } from '../../format';
import RoomGrid from '../../RoomGrid';
import { Btn, C, Card, Empty, Header, Screen, s, tabular } from '../../ui';
import { GearGlyph } from '../../icons';
import RoomDetail from './RoomDetail';
import ConfigPanel from './ConfigPanel';

type Tab = 'habitaciones' | 'dia' | 'config';
const DAY = 24 * 60 * 60 * 1000;

interface DaySummary {
  inspections: InspectionWithItems[];
  restocked: { id: string; room_id: string; restocked_at: number; restocked_by: string; room_number: string; block_name: string }[];
  totalRooms: number;
}

export default function ReceptionHome({ onSettings }: { onSettings: () => void }) {
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const [tab, setTab] = useState<Tab>('habitaciones');
  const [day, setDay] = useState(Date.now());
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const { from, to } = dayRange(day);
  const isToday = dayLabel(day) === 'Hoy';

  const load = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([
        api.get<RoomRow[]>(`/api/rooms?from=${from}&to=${to}`),
        api.get<DaySummary>(`/api/day?from=${from}&to=${to}`),
      ]);
      setRooms(r);
      setSummary(d);
      setError(null);
      setTick((t) => t + 1);
    } catch (e: any) {
      setError(e.message ?? 'Sin conexión con el servidor');
    }
  }, [from, to]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const select = useCallback((r: RoomRow) => setSelected(r.id), []);
  const dayTotal = summary?.inspections.reduce((sum, i) => sum + i.total, 0) ?? 0;

  const detail = selected && (
    <RoomDetail roomId={selected} refreshKey={tick} onClose={() => setSelected(null)} onChanged={load} />
  );
  if (selected && !wide) return <Screen>{detail}</Screen>;

  return (
    <Screen>
      <Header
        eyebrow="Recepción"
        title="Minibar del hotel"
        right={
          <Pressable onPress={onSettings} hitSlop={12} accessibilityRole="button" accessibilityLabel="Ajustes">
            <GearGlyph size={22} color={C.body} />
          </Pressable>
        }
      />

      <View style={[s.row, { paddingHorizontal: 16, paddingTop: 12, flexWrap: 'wrap', gap: 8 }]}>
        {(
          [
            ['habitaciones', 'Habitaciones'],
            ['dia', 'Registro del día'],
            ['config', 'Productos'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <Btn key={t} title={label} variant={tab === t ? 'primary' : 'secondary'} onPress={() => setTab(t)} style={{ minHeight: 44 }} />
        ))}
        {tab !== 'config' && (
          <View style={[s.row, { marginLeft: 'auto', gap: 6 }]}>
            <Text style={{ color: C.muted, fontWeight: '600' }}>Consumo del día</Text>
            <Text style={{ fontWeight: '700', fontSize: 26, color: C.ink, marginRight: 10 }}>{money(dayTotal)}</Text>
            <Btn title="‹" variant="secondary" onPress={() => setDay(day - DAY)} style={{ minHeight: 44, paddingHorizontal: 14 }} />
            <Text style={{ fontWeight: '600', fontSize: 20, minWidth: 100, textAlign: 'center', color: C.ink }}>{dayLabel(day)}</Text>
            <Btn
              title="›"
              variant="secondary"
              disabled={isToday}
              onPress={() => setDay(Math.min(Date.now(), day + DAY))}
              style={{ minHeight: 44, paddingHorizontal: 14 }}
            />
          </View>
        )}
      </View>

      {error && (
        <View style={{ marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#FBE4E2' }}>
          <Text style={{ color: C.danger, fontWeight: '700' }}>
            No hay conexión con el servidor ({error}). Revisa que el computador de recepción esté encendido o la dirección en Ajustes.
          </Text>
        </View>
      )}

      {tab === 'config' ? (
        <ConfigPanel onChanged={load} />
      ) : (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>
            {tab === 'habitaciones' ? (
              <RoomGrid rooms={rooms} onPress={select} selectedId={selected} emptyText={error ? 'Sin datos del servidor.' : undefined} />
            ) : (
              <DayLog summary={summary} onOpen={setSelected} />
            )}
          </View>
          {wide && selected && (
            <View style={{ width: 460, borderLeftWidth: 1, borderLeftColor: C.line, backgroundColor: C.bg }}>{detail}</View>
          )}
        </View>
      )}
    </Screen>
  );
}

function DayLog({ summary, onOpen }: { summary: DaySummary | null; onOpen: (roomId: string) => void }) {
  if (!summary) return <Empty text="Cargando…" />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, maxWidth: 900 }}>
      <Text style={s.label}>
        Revisiones · {summary.inspections.length} de {summary.totalRooms}
      </Text>
      {summary.inspections.length === 0 && <Empty text="Nadie ha revisado habitaciones este día." />}
      {summary.inspections.map((i) => {
        const st = i.finished_at ? (i.units > 0 && !i.restocked_at ? 'revisada' : 'surtida') : 'en_revision';
        const c = C.status[st];
        return (
          <Card key={i.id} onPress={() => onOpen(i.room_id)} style={{ gap: 4, borderLeftWidth: 6, borderLeftColor: c.solid }}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={{ fontWeight: '700', fontSize: 24, color: C.ink }}>
                {i.room_number} <Text style={{ fontWeight: '600', fontSize: 16, color: C.muted }}>{i.block_name}</Text>
              </Text>
              <Text style={{ fontWeight: '700', fontSize: 22, color: C.ink }}>{money(i.total)}</Text>
            </View>
            <Text style={s.muted}>
              {i.inspector} · entró {time(i.started_at)} ·{' '}
              {i.finished_at ? `salió ${time(i.finished_at)} (${duration(i.started_at, i.finished_at)})` : 'en revisión'}
            </Text>
            <Text style={{ color: C.ink }}>{i.units ? i.items.map((it) => `${it.quantity} ${it.name}`).join(', ') : 'Sin consumo'}</Text>
            {i.units > 0 && (
              <Text style={{ fontWeight: '700', color: c.ink }}>
                {i.restocked_at ? `Surtida ${time(i.restocked_at)} · ${i.restocked_by}` : 'Falta surtir'}
              </Text>
            )}
          </Card>
        );
      })}
      <Text style={[s.label, { marginTop: 14 }]}>Surtidas · {summary.restocked.length}</Text>
      {summary.restocked.length === 0 && <Empty text="No se surtió ninguna habitación este día." />}
      {summary.restocked.map((r) => (
        <Card key={r.id} onPress={() => onOpen(r.room_id)}>
          <Text style={{ color: C.ink }}>
            <Text style={{ fontWeight: '700', fontSize: 20 }}>{r.room_number}</Text> · {time(r.restocked_at)} por {r.restocked_by}
          </Text>
        </Card>
      ))}
    </ScrollView>
  );
}
