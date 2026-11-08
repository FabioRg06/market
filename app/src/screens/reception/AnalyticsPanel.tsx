// Analítica de recepción: cuánto se consume y cuándo, qué se vende más, quién revisa y
// a qué ritmo, y cómo está el hotel ahora mismo. Pensado para el computador.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../api';
import type { RoomRow, RoomStatus, RoomType } from '../../types';
import { duration, KIND_LABEL, money, startOfDay, STATUS_LABEL, time, TYPE_BY_CODE } from '../../format';
import { C, s, tabular } from '../../ui';
import { AreaChart, Columns, Donut, HBars, Heatmap, PALETTE, Sparkline, TINT } from '../../charts';

const DAY = 24 * 60 * 60 * 1000;
type Range = 1 | 7 | 30;

interface Analytics {
  kpis: { ticket: number; revisiones: number; habitaciones: number; tiempo_medio: number; total: number; unidades: number; novedades: number; con_consumo: number };
  people: { name: string; revisiones: number; tiempo_medio: number; total: number; novedades: number; last_at: number }[];
  products: { id: string; name: string; units: number; total: number }[];
  blocks: { code: string; total: number; units: number }[];
  types: { type: RoomType; total: number; units: number }[];
  hours: { hour: number; revisiones: number; total: number }[];
  days: { day: number; total: number; units: number; revisiones: number }[];
  heat: number[][];
  kinds: Record<string, number>;
}

/** Categorías del minibar (los productos nuevos caen en "Otros"). Colores fijos por categoría. */
const CATEGORIES = [
  { key: 'bebidas', label: 'Bebidas', color: PALETTE[0], ids: ['agua', 'cocacola', 'gatorade', 'hit'] },
  { key: 'snacks', label: 'Snacks', color: PALETTE[1], ids: ['detodito_g', 'detodito_p', 'mani_g', 'mani_p', 'salchichas'] },
  { key: 'aseo', label: 'Aseo personal', color: PALETTE[2], ids: ['crema', 'cepillo', 'shampoo'] },
  { key: 'otros', label: 'Otros', color: PALETTE[3], ids: [] as string[] },
];
const categoryOf = (id: string) => CATEGORIES.find((c) => c.ids.includes(id)) ?? CATEGORIES[3];

const STATUS_ORDER: RoomStatus[] = ['por_revisar', 'revisada', 'surtida'];
const KIND_COLORS: Record<string, string> = { revision: PALETTE[0], consumo: PALETTE[1], novedad: PALETTE[4], confirmacion: PALETTE[2] };
const TYPE_COLORS: Record<string, string> = { CM: PALETTE[2], SS: PALETTE[6], SM: PALETTE[1], PR: PALETTE[4], VIP: PALETTE[3] };

const mins = (ms: number) => (ms ? duration(0, ms) : '—');
const short = (v: number) => (v >= 1e6 ? `$ ${(v / 1e6).toFixed(1).replace('.', ',')} M` : v >= 1e3 ? `$ ${Math.round(v / 1e3)} mil` : money(v));

export default function AnalyticsPanel() {
  const [range, setRange] = useState<Range>(1);
  const [data, setData] = useState<Analytics | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const to = startOfDay(Date.now()) + DAY;
    try {
      const [a, r] = await Promise.all([
        api.get<Analytics>(`/api/analytics?from=${to - range * DAY}&to=${to}`),
        api.get<RoomRow[]>('/api/rooms'),
      ]);
      setData(a);
      setRooms(r);
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
  useEffect(() => {
    api
      .get<{ id: string; image: string | null }[]>('/api/products')
      .then((p) => setImages(Object.fromEntries(p.map((x) => [x.id, x.image]))))
      .catch(() => {});
  }, []);

  const byCategory = useMemo(() => {
    const totals = CATEGORIES.map((c) => ({ ...c, total: 0, units: 0 }));
    for (const p of data?.products ?? []) {
      const c = totals.find((t) => t.key === categoryOf(p.id).key)!;
      c.total += p.total;
      c.units += p.units;
    }
    return totals.filter((c) => c.total > 0);
  }, [data]);

  const k = data?.kpis;
  const share = k && k.revisiones ? Math.round((k.con_consumo / k.revisiones) * 100) : 0;
  const trendTotal = data ? (range === 1 ? data.hours.map((h) => h.total) : data.days.map((d) => d.total)) : [];
  const trendCount = data ? (range === 1 ? data.hours.map((h) => h.revisiones) : data.days.map((d) => d.revisiones)) : [];
  const statusCount = (st: RoomStatus) => rooms.filter((r) => r.status === st).length;
  const maxPerson = Math.max(1, ...(data?.people ?? []).map((p) => p.revisiones));

  return (
    <ScrollView contentContainerStyle={st.page}>
      <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }]}>
        <Text style={st.lead}>
          {range === 1 ? 'Hoy' : `Últimos ${range} días`}
          {k ? ` · ${k.habitaciones} habitaciones revisadas` : ''}
        </Text>
        <View style={st.segment} accessibilityRole="tablist">
          {([1, 7, 30] as Range[]).map((r) => (
            <Pressable key={r} onPress={() => setRange(r)} accessibilityRole="tab" accessibilityState={{ selected: range === r }} style={[st.segItem, range === r && st.segOn]}>
              <Text style={[st.segText, range === r && { color: C.ink, fontWeight: '700' }]}>{r === 1 ? 'Hoy' : `${r} días`}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {error && <Text style={{ color: C.danger }}>No se pudo cargar la analítica ({error}).</Text>}

      {k && data && (
        <>
          {/* Indicadores */}
          <View style={st.kpis}>
            <Kpi i={0} strong value={k.total >= 1e6 ? short(k.total) : money(k.total)} label="Consumo de minibar" sub={k.total >= 1e6 ? money(k.total) : undefined} spark={trendTotal} />
            <Kpi i={2} value={String(k.revisiones)} label="Revisiones" spark={trendCount} />
            <Kpi i={3} value={mins(k.tiempo_medio)} label="Tiempo medio" sub="por revisión" />
            <Kpi i={1} value={money(k.ticket)} label="Consumo medio" sub={`${share}% con consumo`} />
            <Kpi i={4} value={String(k.novedades)} label="Novedades" sub={k.novedades ? 'tras la salida' : 'ninguna'} />
          </View>

          <View style={st.row}>
            <Card title={range === 1 ? 'Consumo durante el día' : 'Consumo por día'} note={money(k.total)} grow={2}>
              {range === 1 ? (
                <AreaChart
                  data={data.hours.map((h) => ({ key: String(h.hour), label: `${String(h.hour).padStart(2, '0')}:00`, value: h.total, display: `${money(h.total)} · ${h.revisiones} rev.` }))}
                  labelEvery={3}
                />
              ) : (
                <AreaChart
                  data={data.days.map((d) => {
                    const dt = new Date(d.day);
                    return { key: String(d.day), label: `${dt.getDate()}/${dt.getMonth() + 1}`, value: d.total, display: `${money(d.total)} · ${d.units} u` };
                  })}
                  labelEvery={range === 30 ? 5 : 1}
                />
              )}
            </Card>
            <Card title="Estado del hotel ahora" grow={1}>
              <Donut
                data={STATUS_ORDER.map((st) => ({ key: st, label: STATUS_LABEL[st], value: statusCount(st), display: String(statusCount(st)), color: C.status[st].solid }))}
                center={{ value: String(rooms.length), label: 'habitaciones' }}
              />
            </Card>
          </View>

          <View style={st.row}>
            <Card title="Lo que más se consume" note={`${k.unidades} unidades`} grow={2}>
              <HBars
                data={data.products.slice(0, 10).map((p) => ({
                  key: p.id,
                  label: p.name,
                  value: p.units,
                  display: `${p.units} u`,
                  detail: money(p.total),
                  color: categoryOf(p.id).color,
                  image: { id: p.id, uri: images[p.id] ?? null },
                }))}
              />
              {byCategory.length > 0 && (
                <View style={st.catLegend}>
                  {byCategory.map((c) => (
                    <View key={c.key} style={st.catItem}>
                      <View style={[st.catDot, { backgroundColor: c.color }]} />
                      <Text style={st.catText}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
            <Card title="Ventas por categoría" grow={1}>
              <Donut
                data={byCategory.map((c) => ({ key: c.key, label: c.label, value: c.total, display: short(c.total), color: c.color }))}
                center={{ value: short(k.total), label: 'en total' }}
              />
            </Card>
          </View>

          <View style={st.row}>
            <Card title="Equipo" note="revisiones · tiempo medio" grow={2}>
              {data.people.length === 0 ? (
                <Text style={st.empty}>Nadie ha revisado en este rango.</Text>
              ) : (
                data.people.map((p, i) => (
                  <View key={p.name} style={st.person}>
                    <View style={[st.avatar, { backgroundColor: TINT[i % TINT.length] }]}>
                      <Text style={[st.avatarText, { color: PALETTE[i % PALETTE.length] }]}>{p.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={{ width: 150 }}>
                      <Text style={st.personName} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={[st.personMeta, tabular]} numberOfLines={1}>
                        última {time(p.last_at)}
                        {p.novedades ? ` · ${p.novedades} nov.` : ''}
                      </Text>
                    </View>
                    <View style={st.personTrack}>
                      <View style={[st.personBar, { width: `${(p.revisiones / maxPerson) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }]} />
                    </View>
                    <Text style={[st.personNum, tabular]}>{p.revisiones}</Text>
                    <Text style={[st.personTime, tabular]}>{mins(p.tiempo_medio)}</Text>
                    <Text style={[st.personMoney, tabular]}>{short(p.total)}</Text>
                  </View>
                ))
              )}
            </Card>
            <Card title="Tipo de revisión" grow={1}>
              <Donut
                data={Object.entries(data.kinds).map(([kind, n]) => ({
                  key: kind,
                  label: KIND_LABEL[kind as keyof typeof KIND_LABEL] ?? kind,
                  value: n,
                  display: String(n),
                  color: KIND_COLORS[kind],
                }))}
                center={{ value: String(Object.values(data.kinds).reduce((a, b) => a + b, 0)), label: 'registros' }}
              />
            </Card>
          </View>

          <View style={st.row}>
            <Card title="Consumo por bloque" grow={2}>
              <Columns data={data.blocks.map((b, i) => ({ key: b.code, label: b.code, value: b.total, display: short(b.total), color: PALETTE[i % PALETTE.length] }))} />
            </Card>
            <Card title="Por tipo de habitación" grow={1}>
              <Columns
                data={data.types.map((t) => ({
                  key: t.type,
                  label: TYPE_BY_CODE[t.type] ? t.type : t.type,
                  value: t.total,
                  display: short(t.total),
                  color: TYPE_COLORS[t.type] ?? PALETTE[5],
                }))}
              />
            </Card>
          </View>

          <Card title="¿Cuándo se revisa?" note="revisiones por día y hora">
            <Heatmap grid={data.heat} />
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function Kpi({ i, value, label, sub, spark, strong }: { i: number; value: string; label: string; sub?: string; spark?: number[]; strong?: boolean }) {
  const color = PALETTE[i];
  return (
    <View style={[st.kpi, { backgroundColor: strong ? C.brand : TINT[i], borderColor: strong ? C.brand : 'transparent' }]}>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
        <Text style={[st.kpiLabel, { color: strong ? C.onBrandMuted : C.body }]} numberOfLines={1}>
          {label}
        </Text>
        {!strong && <View style={[st.kpiDot, { backgroundColor: color }]} />}
      </View>
      <Text style={[st.kpiValue, tabular, strong && { color: C.onBrand }]} numberOfLines={1}>
        {value}
      </Text>
      {spark && <Sparkline values={spark} color={strong ? '#FFFFFF' : color} width={120} height={22} />}
      {sub ? (
        <Text style={[st.kpiSub, strong && { color: C.onBrandMuted }]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** Con `grow` se reparte el ancho de una fila; sin él ocupa la fila entera. */
function Card({ title, note, grow, children }: { title: string; note?: string; grow?: number; children: React.ReactNode }) {
  return (
    <View style={[st.card, grow != null && { flexGrow: grow, flexShrink: 1, flexBasis: 340 * grow, minWidth: 300 }]}>
      <View style={[s.row, { justifyContent: 'space-between', marginBottom: 16 }]}>
        <Text style={st.cardTitle}>{title}</Text>
        {note ? <Text style={[st.cardNote, tabular]}>{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const st = StyleSheet.create({
  page: { padding: 28, gap: 18, maxWidth: 1400, width: '100%', alignSelf: 'center' },
  lead: { fontSize: 15, color: C.muted, fontWeight: '600' },
  segment: { flexDirection: 'row', backgroundColor: '#E4E9F4', borderRadius: 10, padding: 3 },
  segItem: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  segOn: { backgroundColor: C.surface, shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segText: { fontSize: 13, color: C.muted, fontWeight: '500' },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  kpi: { flexGrow: 1, flexShrink: 1, flexBasis: 150, minWidth: 150, borderRadius: 16, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 16, gap: 8 },
  kpiDot: { width: 10, height: 10, borderRadius: 5 },
  kpiLabel: { fontSize: 12, fontWeight: '600', flex: 1 },
  kpiValue: { fontSize: 24, fontWeight: '800', color: C.ink, letterSpacing: -0.6 },
  kpiSub: { fontSize: 11, color: C.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 20 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  cardNote: { fontSize: 12, color: C.muted },
  empty: { color: C.muted, fontSize: 13, paddingVertical: 24, textAlign: 'center' },
  catLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1F4F9' },
  catItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  catDot: { width: 10, height: 10, borderRadius: 3 },
  catText: { fontSize: 12, color: C.body },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F4F9' },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800' },
  personName: { fontSize: 14, fontWeight: '600', color: C.ink },
  personMeta: { fontSize: 12, color: C.muted },
  personTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#F3F5FA', overflow: 'hidden', minWidth: 60 },
  personBar: { height: 10, borderRadius: 5 },
  personNum: { width: 34, textAlign: 'right', fontSize: 15, fontWeight: '700', color: C.ink },
  personTime: { width: 92, textAlign: 'right', fontSize: 13, color: C.body },
  personMoney: { width: 76, textAlign: 'right', fontSize: 13, color: C.muted },
});
