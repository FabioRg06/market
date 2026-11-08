// Recepción: consola para el computador. Sidebar con las secciones, barra superior con
// la acción de la sección y, en Habitaciones, la barra del estado de todo el hotel.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { api } from '../../api';
import type { RoomRow, RoomStatus } from '../../types';
import { dayRange, money, STATUS_LABEL, time } from '../../format';
import RoomGrid from '../../RoomGrid';
import { BoxGlyph, ChartGlyph, PeopleGlyph, DocGlyph, DoorGlyph, GearGlyph, GridGlyph, LayersGlyph, UploadGlyph } from '../../icons';
import { C, Confirm, Drawer, Screen, tabular } from '../../ui';
import { canPickFiles, fileToBase64, pickFile } from '../../webfile';
import RoomDetail from './RoomDetail';
import ReportPanel from './ReportPanel';
import InventoryPanel from './InventoryPanel';
import BlocksPanel from './BlocksPanel';
import AnalyticsPanel from './AnalyticsPanel';
import WorkersPanel from './WorkersPanel';

type Section = 'habitaciones' | 'trabajadores' | 'analitica' | 'reporte' | 'inventario' | 'bloques';

const NAV: { key: Section; label: string; Icon: (p: { size?: number; color?: string }) => React.ReactElement }[] = [
  { key: 'habitaciones', label: 'Habitaciones', Icon: GridGlyph },
  { key: 'trabajadores', label: 'Trabajadores', Icon: PeopleGlyph },
  { key: 'analitica', label: 'Analítica', Icon: ChartGlyph },
  { key: 'reporte', label: 'Reporte del día', Icon: DocGlyph },
  { key: 'inventario', label: 'Inventario', Icon: BoxGlyph },
  { key: 'bloques', label: 'Bloques', Icon: LayersGlyph },
];

const NAVY = '#0B1640';
const ORDER: RoomStatus[] = ['por_revisar', 'revisada', 'surtida'];

interface ImportResult {
  ok: boolean;
  marked?: number;
  notFound?: string[];
  unknownWorkers?: string[];
  error?: string;
}

export default function ReceptionHome({ onSettings }: { onSettings: () => void }) {
  const { width } = useWindowDimensions();
  const rail = width < 1100; // en pantallas angostas el menú queda solo con íconos
  const [section, setSection] = useState<Section>('habitaciones');
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ImportResult | null>(null);

  const load = useCallback(async () => {
    try {
      const { from, to } = dayRange(Date.now());
      const [list, rep] = await Promise.all([
        api.get<RoomRow[]>('/api/rooms'),
        api.get<{ counts: { total: number } }>(`/api/report?from=${from}&to=${to}`),
      ]);
      setRooms(list);
      setTodayTotal(rep.counts.total);
      setError(null);
      setSyncedAt(Date.now());
      setTick((t) => t + 1);
    } catch (e: any) {
      setError(e.message ?? 'Sin conexión con el servidor');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const select = useCallback((r: RoomRow) => setSelected(r.id), []);

  async function importExcel() {
    const file = await pickFile('.xlsx,.xls,.csv');
    if (!file) return;
    setImporting(true);
    try {
      setImported(await api.post<ImportResult>('/api/import', { file: await fileToBase64(file), name: file.name }));
      await load();
    } catch (e: any) {
      setImported({ ok: false, error: e.message });
    } finally {
      setImporting(false);
    }
  }

  const current = NAV.find((n) => n.key === section)!;

  return (
    <Screen style={{ flexDirection: 'row' }}>
      {/* Sidebar */}
      <View style={[st.side, rail && st.sideRail]}>
        <View style={[st.brand, rail && { justifyContent: 'center', paddingHorizontal: 0 }]}>
          <View style={st.brandMark}>
            <DoorGlyph size={18} color="#FFFFFF" />
          </View>
          {!rail && (
            <View>
              <Text style={st.brandName}>Market</Text>
              <Text style={st.brandSub}>Minibar · Recepción</Text>
            </View>
          )}
        </View>
        <View style={{ gap: 4, marginTop: 8 }}>
          {NAV.map(({ key, label, Icon }) => {
            const on = section === key;
            return (
              <Pressable
                key={key}
                onPress={() => setSection(key)}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: on }}
                style={({ hovered }: any) => [st.navItem, rail && st.navRail, on ? st.navOn : hovered && st.navHover]}
              >
                <Icon size={19} color={on ? '#FFFFFF' : '#8E9CC4'} />
                {!rail && <Text style={[st.navText, on && { color: '#FFFFFF', fontWeight: '700' }]}>{label}</Text>}
              </Pressable>
            );
          })}
        </View>
        <View style={{ flex: 1 }} />
        <View style={[st.sync, rail && { justifyContent: 'center' }]}>
          <View style={[st.syncDot, { backgroundColor: error ? '#F87171' : '#34D399' }]} />
          {!rail && <Text style={st.syncText}>{error ? 'Sin conexión' : `Al día · ${time(syncedAt)}`}</Text>}
        </View>
        <Pressable
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel="Ajustes"
          style={({ hovered }: any) => [st.navItem, rail && st.navRail, hovered && st.navHover]}
        >
          <GearGlyph size={19} color="#8E9CC4" />
          {!rail && <Text style={st.navText}>Ajustes</Text>}
        </Pressable>
      </View>

      {/* Contenido */}
      <View style={{ flex: 1 }}>
        <View style={st.top}>
          <Text style={st.topTitle}>{current.label}</Text>
          {section === 'habitaciones' && canPickFiles && (
            <Pressable onPress={importExcel} disabled={importing} accessibilityRole="button" style={({ hovered }: any) => [st.cta, hovered && { opacity: 0.9 }]}>
              <UploadGlyph size={16} color="#FFFFFF" />
              <Text style={st.ctaText}>{importing ? 'Cargando…' : 'Cargar salidas (Excel)'}</Text>
            </Pressable>
          )}
        </View>

        {error && (
          <View style={st.error}>
            <Text style={{ color: C.danger, fontWeight: '600' }}>No hay conexión con el servidor. Revisa que el computador de recepción esté encendido.</Text>
          </View>
        )}

        {section === 'habitaciones' && (
          <>
            <HotelBar rooms={rooms} todayTotal={todayTotal} />
            <RoomGrid rooms={rooms} onPress={select} selectedId={selected} showWorker emptyText={error ? 'Sin datos del servidor.' : undefined} />
          </>
        )}
        {section === 'trabajadores' && <WorkersPanel onChanged={load} />}
        {section === 'analitica' && <AnalyticsPanel />}
        {section === 'reporte' && <ReportPanel onOpenRoom={setSelected} />}
        {section === 'inventario' && <InventoryPanel />}
        {section === 'bloques' && <BlocksPanel onChanged={load} />}
      </View>

      <Drawer open={!!selected} onClose={() => setSelected(null)} width={520}>
        {selected && <RoomDetail roomId={selected} refreshKey={tick} onClose={() => setSelected(null)} onChanged={load} />}
      </Drawer>

      <Confirm
        visible={!!imported}
        title={imported?.ok ? 'Salidas cargadas' : 'No se pudo cargar'}
        message={
          imported?.ok
            ? `${imported.marked} habitaciones quedaron por revisar.${
                imported.notFound?.length ? `\nNo se encontraron: ${imported.notFound.slice(0, 15).join(', ')}${imported.notFound.length > 15 ? '…' : ''}` : ''
              }${imported.unknownWorkers?.length ? `\nTrabajadores que no existen (créalos en Trabajadores): ${imported.unknownWorkers.join(', ')}` : ''}`
            : imported?.error
        }
        confirmText="Listo"
        cancelText="Cerrar"
        onConfirm={() => setImported(null)}
        onCancel={() => setImported(null)}
      />
    </Screen>
  );
}

/** El hotel entero en una barra: cuántas habitaciones hay en cada estado. */
function HotelBar({ rooms, todayTotal }: { rooms: RoomRow[]; todayTotal: number }) {
  const total = rooms.length || 1;
  const count = (st: RoomStatus) => rooms.filter((r) => r.status === st).length;
  const novedades = rooms.filter((r) => r.has_novedad).length;
  return (
    <View style={st.hotel}>
      <View style={{ flex: 1, gap: 10, minWidth: 320 }}>
        <View style={st.bar} accessibilityLabel="Estado del hotel">
          {ORDER.map((k) => {
            const n = count(k);
            return n ? <View key={k} style={{ flex: n / total, backgroundColor: C.status[k].solid, minWidth: 4 }} /> : null;
          })}
        </View>
        <View style={st.legend}>
          {ORDER.map((k) => (
            <View key={k} style={st.legendItem}>
              <View style={[st.legendDot, { backgroundColor: C.status[k].solid }]} />
              <Text style={[st.legendNum, tabular]}>{count(k)}</Text>
              <Text style={st.legendText}>{STATUS_LABEL[k].toLowerCase()}</Text>
            </View>
          ))}
          {novedades > 0 && (
            <View style={st.legendItem}>
              <View style={[st.legendDot, { backgroundColor: C.danger }]} />
              <Text style={[st.legendNum, tabular]}>{novedades}</Text>
              <Text style={st.legendText}>con novedad</Text>
            </View>
          )}
        </View>
      </View>
      <View style={st.money}>
        <Text style={[st.moneyValue, tabular]}>{money(todayTotal)}</Text>
        <Text style={st.moneyLabel}>consumo de minibar hoy</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  side: { width: 236, backgroundColor: NAVY, paddingHorizontal: 14, paddingVertical: 18 },
  sideRail: { width: 72, paddingHorizontal: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingBottom: 18, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  brandMark: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  brandName: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  brandSub: { color: '#8E9CC4', fontSize: 12 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, height: 42, borderRadius: 10 },
  navRail: { justifyContent: 'center', paddingHorizontal: 0 },
  navOn: { backgroundColor: C.brand },
  navHover: { backgroundColor: 'rgba(255,255,255,0.06)' },
  navText: { color: '#C3CCE6', fontSize: 14, fontWeight: '500' },
  sync: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  syncText: { color: '#8E9CC4', fontSize: 12 },
  top: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  topTitle: { fontSize: 20, fontWeight: '800', color: C.ink, letterSpacing: -0.4 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.brand, paddingHorizontal: 16, height: 40, borderRadius: 10 },
  ctaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  error: { marginHorizontal: 28, marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: '#FBE4E2' },
  hotel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 24,
    marginHorizontal: 20,
    marginTop: 18,
    padding: 18,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
  },
  bar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2, backgroundColor: C.line },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, rowGap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 3 },
  legendNum: { fontSize: 15, fontWeight: '800', color: C.ink },
  legendText: { fontSize: 13, color: C.muted },
  money: { paddingLeft: 24, borderLeftWidth: 1, borderLeftColor: C.line },
  moneyValue: { fontSize: 26, fontWeight: '800', color: C.ink, letterSpacing: -0.6 },
  moneyLabel: { fontSize: 12, color: C.muted },
});
