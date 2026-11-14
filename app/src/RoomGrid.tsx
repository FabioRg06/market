// Búsqueda, filtros y cuadrícula de habitaciones. Lo usan las dos vistas.
// La búsqueda y los bloques van dentro de la lista: al bajar se esconden y las habitaciones
// ocupan toda la pantalla; al volver arriba aparecen. Los estados van en el botón de filtros.
// Pensado para cientos de tarjetas: altura fija, filtros en memoria y solo se dibuja lo visible.
// Se pueden activar varios filtros a la vez, y la búsqueda, los filtros, el bloque y el punto
// de la lista se conservan al entrar a una habitación y volver.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, LayoutChangeEvent, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { RoomRow, RoomStatus } from './types';
import { STATUS_LABEL } from './format';
import { Btn, C, Empty, s, tabular, TypeBadge } from './ui';
import { CloudPending, DoorGlyph, FilterGlyph, SearchGlyph } from './icons';

const CARD_H = 118;
const GAP = 10;
const STATUSES: RoomStatus[] = ['por_revisar', 'revisada', 'surtida'];

/** Filtros: los estados y las marcas de cada habitación. */
type Filter = RoomStatus | 'novedad' | 'por_salir' | 'doble_ciclo';
const FILTERS: { key: Filter; label: string; color: string; ring: string }[] = [
  ...STATUSES.map((st) => ({ key: st as Filter, label: STATUS_LABEL[st], color: C.status[st].tint, ring: C.status[st].solid })),
  { key: 'novedad', label: 'Con novedad', color: '#FDECEC', ring: C.danger },
  { key: 'por_salir', label: 'Pendiente por salir', color: '#FFF4E5', ring: '#C77D12' },
  { key: 'doble_ciclo', label: 'Doble ciclo', color: '#EEF2FE', ring: C.brand },
];
const matches = (r: RoomRow, f: Filter) =>
  f === 'novedad' ? r.has_novedad : f === 'por_salir' ? r.pending_checkout : f === 'doble_ciclo' ? r.double_cycle : r.status === f;
const isStatus = (f: Filter) => (STATUSES as Filter[]).includes(f);
/** Varios filtros: basta uno de los estados elegidos, y se deben cumplir todas las marcas. */
function matchesAll(r: RoomRow, active: Filter[]) {
  const statuses = active.filter(isStatus);
  if (statuses.length && !statuses.includes(r.status)) return false;
  return active.every((f) => isStatus(f) || matches(r, f));
}
const NO_PENDING = new Set<string>();

/** Lo que el usuario tenía puesto, por pantalla: sobrevive a salir y volver a la lista. */
interface Kept {
  query: string;
  active: Filter[];
  block: string | null;
  mine: boolean;
  offset: number;
}
const kept = new Map<string, Kept>();
const keptFor = (key: string): Kept => {
  if (!kept.has(key)) kept.set(key, { query: '', active: [], block: null, mine: true, offset: 0 });
  return kept.get(key)!;
};

export default function RoomGrid({
  rooms,
  onPress,
  selectedId,
  pendingIds = NO_PENDING,
  reserveRight = 0,
  mineWorkerId = null,
  showWorker = false,
  stateKey = 'lista',
  emptyText = 'Ninguna habitación coincide con el filtro.',
}: {
  rooms: RoomRow[];
  onPress: (room: RoomRow) => void;
  selectedId?: string | null;
  pendingIds?: Set<string>;
  /** Espacio a la derecha de la búsqueda para un botón flotante (la tuerca). */
  reserveRight?: number;
  /** Quien revisa: con su trabajador aparece "Mis habitaciones" (activo al abrir). */
  mineWorkerId?: string | null;
  /** Recepción: la tarjeta muestra a quién está asignada. */
  showWorker?: boolean;
  /** Nombre de la pantalla, para recordar sus filtros por separado. */
  stateKey?: string;
  emptyText?: string;
}) {
  const memory = keptFor(stateKey);
  const [width, setWidth] = useState(0);
  const [query, setQuery] = useState(memory.query);
  const [active, setActive] = useState<Filter[]>(memory.active);
  const [block, setBlock] = useState<string | null>(memory.block);
  const [mine, setMine] = useState(memory.mine);
  useEffect(() => {
    Object.assign(memory, { query, active, block, mine });
  }, [memory, query, active, block, mine]);
  const toggleFilter = (f: Filter) => setActive((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  // Al volver, la lista queda en el mismo punto donde estaba.
  const list = useRef<FlatList<RoomRow>>(null);
  const restored = useRef(false);
  const onlyMine = !!mineWorkerId && mine;
  const [filtersOpen, setFiltersOpen] = useState(false);

  const counts = useMemo(() => {
    const c = Object.fromEntries(FILTERS.map((x) => [x.key, 0])) as Record<Filter, number>;
    for (const r of rooms) if (!block || r.block_id === block) for (const x of FILTERS) if (matches(r, x.key)) c[x.key]++;
    return c;
  }, [rooms, block]);

  // Bloques en el orden de sus habitaciones, con el código que manda el servidor.
  const blockList = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rooms) if (!m.has(r.block_id)) m.set(r.block_id, r.block_code ?? r.block_name);
    return [...m.entries()].map(([id, code]) => ({ id, code }));
  }, [rooms]);
  const mineCount = useMemo(() => (mineWorkerId ? rooms.filter((r) => r.worker_id === mineWorkerId).length : 0), [rooms, mineWorkerId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rooms.filter(
      (r) =>
        (!onlyMine || r.worker_id === mineWorkerId) &&
        matchesAll(r, active) &&
        (!block || r.block_id === block) &&
        (!q || r.number.toLowerCase().includes(q.replace(/\s/g, '')) || (r.guest_name ?? '').toLowerCase().includes(q))
    );
  }, [rooms, query, active, block, onlyMine, mineWorkerId]);

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
          style={[g.iconBtn, active.length > 0 && { backgroundColor: C.brand, borderColor: C.brand }]}
        >
          <FilterGlyph size={20} color={active.length ? C.onBrand : C.body} />
          {active.length > 1 && (
            <View style={g.filterCount}>
              <Text style={g.filterCountText}>{active.length}</Text>
            </View>
          )}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {mineWorkerId ? <Tab label={`Mis habitaciones · ${mineCount}`} active={onlyMine} onPress={() => setMine(!mine)} /> : null}
        <Tab label="Todos" active={!block} onPress={() => setBlock(null)} />
        {blockList.map((b) => (
          <Tab key={b.id} label={b.code} active={block === b.id} onPress={() => setBlock(block === b.id ? null : b.id)} />
        ))}
      </ScrollView>
      {active.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {FILTERS.filter((x) => active.includes(x.key)).map((x) => (
            <Pressable key={x.key} onPress={() => toggleFilter(x.key)} style={g.activeFilter} accessibilityRole="button" accessibilityLabel={`Quitar filtro ${x.label}`}>
              <View style={[g.dot, { backgroundColor: x.ring }]} />
              <Text style={g.activeFilterText}>{x.label}</Text>
              <Text style={[g.activeFilterText, { color: C.muted }]}>✕</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <FlatList
          ref={list}
          key={columns}
          data={filtered}
          onScroll={(e) => {
            memory.offset = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={64}
          onContentSizeChange={() => {
            if (restored.current) return;
            restored.current = true;
            if (memory.offset > 0) list.current?.scrollToOffset({ offset: memory.offset, animated: false });
          }}
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
              showWorker={showWorker}
              onPress={press}
            />
          )}
        />
      )}

      <Modal visible={filtersOpen} transparent animationType="fade" onRequestClose={() => setFiltersOpen(false)}>
        <Pressable style={g.overlay} onPress={() => setFiltersOpen(false)}>
          <Pressable style={g.sheet} onPress={() => {}}>
            <Text style={g.sheetTitle}>Filtrar</Text>
            <Text style={g.sheetHint}>Puedes elegir varios.</Text>
            {FILTERS.map((x, i) => {
              const on = active.includes(x.key);
              return (
                <Pressable
                  key={x.key}
                  onPress={() => toggleFilter(x.key)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[g.option, on && { backgroundColor: C.bg }, i === STATUSES.length && g.optionSep]}
                >
                  <View style={[g.swatch, { backgroundColor: x.color, borderColor: x.ring }]} />
                  <Text style={[g.optionText, on && { color: C.brand, fontWeight: '700' }]}>{x.label}</Text>
                  <Text style={[g.optionCount, tabular]}>{counts[x.key]}</Text>
                  <View style={[g.check, on && { backgroundColor: C.brand, borderColor: C.brand }]}>
                    {on && <Text style={g.checkMark}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Btn title="Quitar filtros" variant="secondary" disabled={!active.length} onPress={() => setActive([])} style={{ flex: 1 }} />
              <Btn title={`Ver ${filtered.length}`} onPress={() => setFiltersOpen(false)} style={{ flex: 1 }} />
            </View>
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
  showWorker,
  onPress,
}: {
  room: RoomRow;
  width: number;
  selected?: boolean;
  pending?: boolean;
  showWorker?: boolean;
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
          {room.pending_checkout && <Flag text="Por salir" color="#C77D12" />}
          {room.double_cycle && <Flag text="2 ciclos" color={C.brand} />}
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
      {room.type === 'SM' ? (
        <Text style={[g.flight, { fontWeight: '600' }]}>Sin minibar</Text>
      ) : (
        <Text style={g.flight} numberOfLines={1}>
          Vuelo <Text style={[g.flightTime, tabular]}>{room.flight_time ?? '—'}</Text>
          {showWorker && room.worker_name ? <Text style={g.worker}>{` · ${room.worker_name}`}</Text> : null}
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
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.ink },
  sheetHint: { fontSize: 13, color: C.muted, marginBottom: 8 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', lineHeight: 16 },
  filterCount: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterCountText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10 },
  swatch: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5 },
  optionText: { flex: 1, fontSize: 15, color: C.ink },
  optionSep: { marginTop: 6, borderTopWidth: 1, borderTopColor: C.line, borderTopLeftRadius: 0, borderTopRightRadius: 0, paddingTop: 14 },
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
  worker: { fontWeight: '700', color: C.brand },
});
