// Vista principal de recepción (computador o tablet).
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '../../api';
import type { RoomRow } from '../../types';
import { money } from '../../format';
import RoomGrid from '../../RoomGrid';
import { GearGlyph } from '../../icons';
import { Btn, C, Confirm, Drawer, Header, Screen, s, tabular } from '../../ui';
import { canPickFiles, fileToBase64, pickFile } from '../../webfile';
import RoomDetail from './RoomDetail';
import ReportPanel from './ReportPanel';
import InventoryPanel from './InventoryPanel';
import BlocksPanel from './BlocksPanel';

type Tab = 'habitaciones' | 'reporte' | 'inventario' | 'bloques';

interface ImportResult {
  ok: boolean;
  marked?: number;
  notFound?: string[];
  error?: string;
}

export default function ReceptionHome({ onSettings }: { onSettings: () => void }) {
  const [tab, setTab] = useState<Tab>('habitaciones');
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ImportResult | null>(null);

  const load = useCallback(async () => {
    try {
      setRooms(await api.get<RoomRow[]>('/api/rooms'));
      setError(null);
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
      const res = await api.post<ImportResult>('/api/import', { file: await fileToBase64(file), name: file.name });
      setImported(res);
      await load();
    } catch (e: any) {
      setImported({ ok: false, error: e.message });
    } finally {
      setImporting(false);
    }
  }

  const count = (st: RoomRow['status']) => rooms.filter((r) => r.status === st).length;
  const novedades = rooms.filter((r) => r.has_novedad).length;
  const pendingTotal = rooms.reduce((t, r) => t + (r.status === 'revisada' ? r.total : 0), 0);

  return (
    <Screen>
      <Header
        eyebrow="Recepción"
        title="Minibar del hotel"
        right={
          <View style={[s.row, { gap: 14 }]}>
            {canPickFiles && (
              <Btn
                title={importing ? 'Cargando…' : 'Cargar Excel de salidas'}
                variant="secondary"
                disabled={importing}
                onPress={importExcel}
                style={{ minHeight: 38 }}
              />
            )}
            <Pressable onPress={onSettings} hitSlop={12} accessibilityRole="button" accessibilityLabel="Ajustes">
              <GearGlyph size={22} color={C.onBrand} />
            </Pressable>
          </View>
        }
      />

      <View style={{ backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }}>
          {(
            [
              ['habitaciones', 'Habitaciones'],
              ['reporte', 'Reporte del día'],
              ['inventario', 'Inventario'],
              ['bloques', 'Bloques'],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t }}
              style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: tab === t ? C.brand : 'transparent' }}
            >
              <Text style={{ fontSize: 14, fontWeight: tab === t ? '700' : '500', color: tab === t ? C.brand : C.muted }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {error && (
        <View style={{ marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#FBE4E2' }}>
          <Text style={{ color: C.danger, fontWeight: '700' }}>
            No hay conexión con el servidor ({error}). Revisa que el computador de recepción esté encendido o la dirección en Ajustes.
          </Text>
        </View>
      )}

      {tab === 'habitaciones' && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10, padding: 16, paddingBottom: 0 }}>
            <Stat label="Por revisar" value={String(count('por_revisar'))} color={C.status.por_revisar.solid} />
            <Stat label="Revisadas · falta surtir" value={String(count('revisada'))} color={C.status.revisada.solid} />
            <Stat label="Novedades" value={String(novedades)} color={C.danger} />
            <Stat label="Surtidas" value={String(count('surtida'))} color={C.status.surtida.solid} />
            <Stat label="Por cobrar / reponer" value={money(pendingTotal)} />
          </ScrollView>
          <RoomGrid rooms={rooms} onPress={select} selectedId={selected} emptyText={error ? 'Sin datos del servidor.' : undefined} />
        </>
      )}
      {tab === 'reporte' && <ReportPanel onOpenRoom={setSelected} />}
      {tab === 'inventario' && <InventoryPanel />}
      {tab === 'bloques' && <BlocksPanel onChanged={load} />}

      <Drawer open={!!selected} onClose={() => setSelected(null)}>
        {selected && <RoomDetail roomId={selected} refreshKey={tick} onClose={() => setSelected(null)} onChanged={load} />}
      </Drawer>

      <Confirm
        visible={!!imported}
        title={imported?.ok ? 'Excel cargado' : 'No se pudo cargar'}
        message={
          imported?.ok
            ? `${imported.marked} habitaciones quedaron por revisar.${
                imported.notFound?.length ? `\nNo se encontraron: ${imported.notFound.slice(0, 15).join(', ')}${imported.notFound.length > 15 ? '…' : ''}` : ''
              }`
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

function Stat({ label, value, color = C.ink }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 10, minWidth: 130 }}>
      <View style={[s.row, { gap: 6 }]}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Text style={s.muted}>{label}</Text>
      </View>
      <Text style={[{ fontSize: 22, fontWeight: '700', color: C.ink, marginTop: 2 }, tabular]}>{value}</Text>
    </View>
  );
}
