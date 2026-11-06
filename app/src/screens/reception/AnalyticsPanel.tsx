// Analítica: quién está revisando y a qué ritmo, qué se consume más, a qué hora,
// en qué bloques y tipos de habitación. Pensado para el computador de recepción.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../api';
import type { RoomType } from '../../types';
import { duration, money, startOfDay, time, TYPE_BY_CODE } from '../../format';
import { C, s, tabular } from '../../ui';
import { Columns, HBars } from '../../charts';

const DAY = 24 * 60 * 60 * 1000;
type Range = 1 | 7 | 30;

interface Analytics {
  kpis: { revisiones: number; habitaciones: number; tiempo_medio: number; total: number; unidades: number; novedades: number; con_consumo: number };
  people: { name: string; revisiones: number; tiempo_medio: number; total: number; novedades: number; last_at: number }[];
  products: { id: string; name: string; units: number; total: number }[];
  blocks: { code: string; total: number; units: number }[];
  types: { type: RoomType; total: number; units: number }[];
  hours: { hour: number; revisiones: number; total: number }[];
  days: { day: number; total: number; revisiones: number }[];
}

const mins = (ms: number) => (ms ? duration(0, ms) : '—');

export default function AnalyticsPanel() {
  const [range, setRange] = useState<Range>(1);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const to = startOfDay(Date.now()) + DAY;
    try {
      setData(await api.get<Analytics>(`/api/analytics?from=${to - range * DAY}&to=${to}`));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [range]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const k = data?.kpis;
  const share = k && k.revisiones ? Math.round((k.con_consumo / k.revisiones) * 100) : 0;

  return (
    <ScrollView contentContainerStyle={st.page}>
      <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }]}>
        <Text style={st.lead}>{range === 1 ? 'Hoy' : `Últimos ${range} días`}</Text>
        <View style={st.segment} accessibilityRole="tablist">
          {([1, 7, 30] as Range[]).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRange(r)}
              accessibilityRole="tab"
              accessibilityState={{ selected: range === r }}
              style={[st.segItem, range === r && st.segOn]}
            >
              <Text style={[st.segText, range === r && { color: C.ink, fontWeight: '700' }]}>{r === 1 ? 'Hoy' : `${r} días`}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {error && <Text style={{ color: C.danger }}>No se pudo cargar la analítica ({error}).</Text>}

      {k && data && (
        <>
          <View style={st.kpis}>
            <Kpi value={money(k.total)} label="Consumo de minibar" strong />
            <Kpi value={String(k.revisiones)} label={`revisiones · ${k.habitaciones} habitaciones`} />
            <Kpi value={mins(k.tiempo_medio)} label="tiempo medio por revisión" />
            <Kpi value={`${share}%`} label="revisiones con consumo" />
            <Kpi value={String(k.novedades)} label="novedades" alert={k.novedades > 0} />
          </View>

          <View style={st.row2}>
            <Card title="Lo que más se consume" note={`${k.unidades} unidades`} grow={3}>
              <HBars
                data={data.products.slice(0, 10).map((p) => ({
                  key: p.id,
                  label: p.name,
                  value: p.units,
                  display: `${p.units} u`,
                  detail: money(p.total),
                }))}
              />
            </Card>
            <Card title="Equipo" note="revisiones · tiempo medio" grow={2}>
              {data.people.length === 0 ? (
                <Text style={st.empty}>Nadie ha revisado en este rango.</Text>
              ) : (
                data.people.map((p) => (
                  <View key={p.name} style={st.person}>
                    <View style={st.avatar}>
                      <Text style={st.avatarText}>{p.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={st.personName} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={[st.personMeta, tabular]}>
                        última {time(p.last_at)}
                        {p.novedades ? ` · ${p.novedades} novedades` : ''}
                      </Text>
                    </View>
                    <Text style={[st.personNum, tabular]}>{p.revisiones}</Text>
                    <Text style={[st.personTime, tabular]}>{mins(p.tiempo_medio)}</Text>
                  </View>
                ))
              )}
            </Card>
          </View>

          <View style={st.row2}>
            <Card title={range === 1 ? 'Revisiones por hora' : 'Consumo por día'} grow={3}>
              {range === 1 ? (
                <Columns
                  data={data.hours.map((h) => ({
                    key: String(h.hour),
                    label: String(h.hour).padStart(2, '0'),
                    value: h.revisiones,
                    display: `${h.revisiones} · ${money(h.total)}`,
                  }))}
                  labelEvery={3}
                />
              ) : (
                <Columns
                  data={data.days.map((d) => {
                    const dt = new Date(d.day);
                    return {
                      key: String(d.day),
                      label: `${dt.getDate()}/${dt.getMonth() + 1}`,
                      value: d.total,
                      display: money(d.total),
                    };
                  })}
                  labelEvery={range === 30 ? 5 : 1}
                />
              )}
            </Card>
            <Card title="Consumo por tipo de habitación" grow={2}>
              <HBars
                data={data.types.map((t) => ({
                  key: t.type,
                  label: TYPE_BY_CODE[t.type] && TYPE_BY_CODE[t.type].name !== t.type ? `${t.type} · ${TYPE_BY_CODE[t.type].name}` : t.type,
                  value: t.total,
                  display: money(t.total),
                  detail: `${t.units} u`,
                }))}
              />
            </Card>
          </View>

          <Card title="Consumo por bloque">
            <HBars
              data={data.blocks.map((b) => ({ key: b.code, label: b.code, value: b.total, display: money(b.total), detail: `${b.units} u` }))}
            />
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function Kpi({ value, label, strong, alert }: { value: string; label: string; strong?: boolean; alert?: boolean }) {
  return (
    <View style={[st.kpi, strong && st.kpiStrong]}>
      <Text style={[st.kpiValue, tabular, strong && { color: C.onBrand }, alert && { color: C.danger }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[st.kpiLabel, strong && { color: C.onBrandMuted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Card({ title, note, grow = 1, children }: { title: string; note?: string; grow?: number; children: React.ReactNode }) {
  return (
    <View style={[st.card, { flexGrow: grow, flexShrink: 1, flexBasis: 300 * grow, minWidth: 280 }]}>
      <View style={[s.row, { justifyContent: 'space-between', marginBottom: 14 }]}>
        <Text style={st.cardTitle}>{title}</Text>
        {note ? <Text style={st.cardNote}>{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const st = StyleSheet.create({
  page: { padding: 28, gap: 18, maxWidth: 1320, width: '100%', alignSelf: 'center' },
  lead: { fontSize: 15, color: C.muted, fontWeight: '600' },
  segment: { flexDirection: 'row', backgroundColor: '#E4E9F4', borderRadius: 10, padding: 3 },
  segItem: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  segOn: { backgroundColor: C.surface, shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segText: { fontSize: 13, color: C.muted, fontWeight: '500' },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  kpi: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 140,
    minWidth: 130,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 4,
  },
  kpiStrong: { backgroundColor: C.brand, borderColor: C.brand, flexBasis: 200 },
  kpiValue: { fontSize: 26, fontWeight: '800', color: C.ink, letterSpacing: -0.6 },
  kpiLabel: { fontSize: 12, color: C.muted },
  row2: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 20 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  cardNote: { fontSize: 12, color: C.muted },
  empty: { color: C.muted, fontSize: 13, paddingVertical: 24, textAlign: 'center' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F4F9' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#E4EAFB', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '800', color: C.brand },
  personName: { fontSize: 14, fontWeight: '600', color: C.ink },
  personMeta: { fontSize: 12, color: C.muted },
  personNum: { width: 36, textAlign: 'right', fontSize: 15, fontWeight: '700', color: C.ink },
  personTime: { width: 90, textAlign: 'right', fontSize: 13, color: C.body },
});
