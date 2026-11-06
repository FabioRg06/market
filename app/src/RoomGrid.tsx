// Búsqueda, filtros y cuadrícula de habitaciones. Lo usan las dos vistas.
// La búsqueda y los bloques van dentro de la lista: al bajar se esconden y las habitaciones
// ocupan toda la pantalla; al volver arriba aparecen. Los estados van en el botón de filtros.
// Pensado para 700 tarjetas: altura fija, filtros en memoria y solo se dibuja lo visible.
import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, LayoutChangeEvent, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { RoomRow, RoomStatus } from './types';
import { missingText, STATUS_LABEL } from './format';
import { Btn, C, Empty, s, tabular, TypeBadge } from './ui';
import { CloudPending, DoorGlyph, FilterGlyph, SearchGlyph } from './icons';
import catalog from './catalog.json';

const CARD_H = 132;
const GAP = 10;
const STATUSES: RoomStatus[] = ['por_revisar', 'en_revision', 'revisada', 'surtida'];
const NO_PENDING = new Set<string>();

export default function RoomGrid({
  rooms,
  onPress,
  selectedId,
  pendingIds = NO_PENDING,
  reserveRight = 0,
  emptyText = 'Ninguna habitación coincide con el filtro.',
}: {
  rooms: RoomRow[];
  onPress: (room: RoomRow) => void;
  selectedId?: string | null;
  pendingIds?: Set<string>;
  /** Espacio a la derecha de la búsqueda para un botón flotante (la tuerca). */
  reserveRight?: number;
  emptyText?: string;
}) {
  const [width, setWidth] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<RoomStatus | null>(null);
  const [block, setBlock] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const counts = useMemo(() => {
    const c: Record<RoomStatus, number> = { surtida: 0, por_revisar: 0, en_revision: 0, revisada: 0 };
    for (const r of rooms) if (!block || r.block_id === block) c[r.status]++;
    return c;
  }, [rooms, block]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rooms.filter(
      (r) =>
        (!status || r.status === status) &&
        (!block || r.block_id === block) &&
        (!q || r.number.startsWith(q) || (r.guest_name ?? '').toLowerCase().includes(q))
    );
  }, [rooms, query, status, block]);

  const phone = width > 0 && width < 600;
  const pad = phone ? 12 : 20;
  const minCard = phone ? 140 : 168;
  // En web la barra de desplazamiento ocupa espacio; en el teléfono va encima.
  const inner = width - pad * 2 - (Platform.OS === 'web' ? 16 : 0);
  const columns = Math.max(2, Math.floor((inner + GAP) / (minCard + GAP)));
  const cardW = width ? Math.floor((inner - GAP * (columns - 1)) / columns) : 0;
  const press = useCallback((r: RoomRow) => onPress(r), [onPress]);

  const header = (
    <View style={g.header}>
      <View style={[s.row, { gap: 8, paddingRight: reserveRight }]}>
        <View style={g.search}>
          <SearchGlyph size={18} color={C.muted} />
          <TextInput
            placeholder="Buscar número o huésped"
            placeholderTextColor={C.faint}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            style={g.searchInput}
          />
        </View>
        <Pressable
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Filtros"
          style={[g.iconBtn, status && { backgroundColor: C.brand, borderColor: C.brand }]}
        >
          <FilterGlyph size={20} color={status ? C.onBrand : C.body} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        <Tab label="Todos" active={!block} onPress={() => setBlock(null)} />
        {catalog.blocks.map((b) => (
          <Tab key={b.id} label={rooms.find((r) => r.block_id === b.id)?.block_code ?? b.code} active={block === b.id} onPress={() => setBlock(block === b.id ? null : b.id)} />
        ))}
      </ScrollView>
      {status && (
        <Pressable onPress={() => setStatus(null)} style={g.activeFilter} accessibilityRole="button" accessibilityLabel="Quitar filtro">
          <View style={[g.dot, { backgroundColor: C.status[status].solid }]} />
          <Text style={g.activeFilterText}>{STATUS_LABEL[status]}</Text>
          <Text style={[g.activeFilterText, { color: C.muted }]}>✕</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <FlatList
          key={columns}
          data={filtered}
          numColumns={columns}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: pad, paddingTop: 12, paddingBottom: 32, gap: GAP }}
          columnWrapperStyle={{ gap: GAP }}
          initialNumToRender={columns * 7}
          maxToRenderPerBatch={columns * 4}
          windowSize={7}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={<Empty text={emptyText} />}
          renderItem={({ item }) => (
            <RoomCard
              room={item}
              width={cardW}
              selected={item.id === selectedId}
              pending={pendingIds.has(item.id)}
              onPress={press}
            />
          )}
        />
      )}

      <Modal visible={filtersOpen} transparent animationType="fade" onRequestClose={() => setFiltersOpen(false)}>
        <Pressable style={g.overlay} onPress={() => setFiltersOpen(false)}>
          <Pressable style={g.sheet} onPress={() => {}}>
            <Text style={g.sheetTitle}>Filtrar por estado</Text>
            {STATUSES.map((st) => {
              const active = status === st;
              return (
                <Pressable
                  key={st}
                  onPress={() => {
                    setStatus(active ? null : st);
                    setFiltersOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[g.option, active && { backgroundColor: C.bg }]}
                >
                  <View style={[g.swatch, { backgroundColor: C.status[st].tint, borderColor: C.status[st].solid }]} />
                  <Text style={[g.optionText, active && { color: C.brand, fontWeight: '700' }]}>{STATUS_LABEL[st]}</Text>
                  <Text style={[g.optionCount, tabular]}>{counts[st]}</Text>
                </Pressable>
              );
            })}
            <Btn
              title="Ver todas"
              variant="secondary"
              onPress={() => {
                setStatus(null);
                setFiltersOpen(false);
              }}
              style={{ marginTop: 6 }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Flag({ text, color }: { text: string; color: string }) {
  return <Text style={[g.flag, { color }]}>{text}</Text>;
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[g.tab, active && g.tabActive]}>
      <Text style={[g.tabText, active && { color: C.brand, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

export const RoomCard = memo(function RoomCard({
  room,
  width,
  selected,
  pending,
  onPress,
}: {
  room: RoomRow;
  width: number;
  selected?: boolean;
  pending?: boolean;
  onPress: (r: RoomRow) => void;
}) {
  const c = C.status[room.status];
  return (
    <Pressable
      onPress={() => onPress(room)}
      accessibilityRole="button"
      accessibilityLabel={`Habitación ${room.number}, ${STATUS_LABEL[room.status]}${pending ? ', sin enviar' : ''}`}
      style={({ pressed }) => [
        g.card,
        {
          width,
          backgroundColor: c.tint,
          borderColor: selected ? C.brand : c.border,
          borderWidth: selected ? 1.5 : 1,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      {room.has_novedad && <View style={g.notif} accessibilityLabel="Tiene novedad" />}
      <View style={g.topRow}>
        <TypeBadge type={room.type} />
        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          {room.needs_confirm && <Flag text="Confirmar" color={c.ink} />}
          {pending && <CloudPending size={15} color={C.muted} />}
        </View>
      </View>
      <View style={g.numberRow}>
        <DoorGlyph size={20} color={c.solid} fill={room.status === 'surtida' ? undefined : c.border} />
        <Text style={[g.number, tabular]}>{room.number}</Text>
      </View>
      <Text style={[g.guest, !room.guest_name && { color: C.faint }]} numberOfLines={1}>
        {room.guest_name ?? 'Sin huésped'}
      </Text>
      {room.status === 'revisada' ? (
        <Text style={[g.missing, { color: room.units ? C.danger : c.ink }]} numberOfLines={1}>
          {room.units ? `Falta: ${missingText(room.missing)}` : 'Sin consumo'}
        </Text>
      ) : (
        <Text style={g.flight} numberOfLines={1}>
          Vuelo <Text style={[g.flightTime, tabular]}>{room.flight_time ?? '—'}</Text>
        </Text>
      )}
    </Pressable>
  );
});

const g = StyleSheet.create({
  header: { gap: 10, marginBottom: 2 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
  },
  searchInput: { flex: 1, fontSize: 15, color: C.ink, paddingVertical: 0 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'transparent' },
  tabActive: { backgroundColor: C.surface, borderColor: C.brand },
  tabText: { fontSize: 13, color: C.muted, fontWeight: '500' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  activeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
  },
  activeFilterText: { fontSize: 13, fontWeight: '600', color: C.body },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: C.surface, borderRadius: 16, padding: 18, gap: 4, width: '100%', maxWidth: 400, alignSelf: 'center' },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.ink, marginBottom: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10 },
  swatch: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5 },
  optionText: { flex: 1, fontSize: 15, color: C.ink },
  optionCount: { fontSize: 15, fontWeight: '600', color: C.muted },
  card: {
    height: CARD_H,
    borderRadius: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingTop: 18,
  },
  topRow: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // Punto rojo tipo notificación para las novedades.
  notif: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.danger,
    borderWidth: 2,
    borderColor: C.surface,
    zIndex: 2,
  },
  flag: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  missing: { fontSize: 12, fontWeight: '600', maxWidth: '100%' },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  number: { fontSize: 26, fontWeight: '700', color: C.ink, letterSpacing: -0.5 },
  guest: { fontSize: 13, fontWeight: '500', color: C.body, maxWidth: '100%' },
  flight: { fontSize: 12, color: C.muted },
  flightTime: { fontWeight: '600', color: C.body },
});
