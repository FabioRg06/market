// Filtros (estado, bloque, búsqueda) y cuadrícula de habitaciones. Lo usan las dos vistas.
// Pensado para 700 tarjetas: altura fija, filtros en memoria y solo se dibuja lo visible.
import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RoomRow, RoomStatus } from './types';
import { STATUS_LABEL } from './format';
import { C, Empty, Input, tabular } from './ui';
import { CloudPending, DoorGlyph } from './icons';
import catalog from './catalog.json';

const CARD_H = 112;
const GAP = 10;
const STATUSES: RoomStatus[] = ['sin_revisar', 'en_revision', 'revisada', 'surtida'];
const NO_PENDING = new Set<string>();

export default function RoomGrid({
  rooms,
  onPress,
  selectedId,
  pendingIds = NO_PENDING,
  emptyText = 'Ninguna habitación coincide con el filtro.',
}: {
  rooms: RoomRow[];
  onPress: (room: RoomRow) => void;
  selectedId?: string | null;
  pendingIds?: Set<string>;
  emptyText?: string;
}) {
  const [width, setWidth] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<RoomStatus | null>(null);
  const [block, setBlock] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<RoomStatus, number> = { sin_revisar: 0, en_revision: 0, revisada: 0, surtida: 0 };
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
  const columns = Math.max(2, Math.floor((width - pad * 2 + GAP) / (minCard + GAP)));
  const cardW = width ? (width - pad * 2 - GAP * (columns - 1)) / columns : 0;
  const press = useCallback((r: RoomRow) => onPress(r), [onPress]);

  return (
    <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={[g.filters, { paddingHorizontal: pad }]}>
        <Input
          placeholder="Buscar por número o huésped"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          style={{ paddingVertical: 10 }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {STATUSES.map((st) => {
            const active = status === st;
            return (
              <Pressable
                key={st}
                onPress={() => setStatus(active ? null : st)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[g.chip, active && { borderColor: C.ink, backgroundColor: C.surface }]}
              >
                <View style={[g.dot, { backgroundColor: C.status[st].solid }]} />
                <Text style={[g.chipText, active && { color: C.ink }]}>{STATUS_LABEL[st]}</Text>
                <Text style={[g.chipCount, tabular]}>{counts[st]}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
          <Tab label="Todos" active={!block} onPress={() => setBlock(null)} />
          {catalog.blocks.map((b) => (
            <Tab key={b.id} label={b.name} active={block === b.id} onPress={() => setBlock(block === b.id ? null : b.id)} />
          ))}
        </ScrollView>
      </View>

      {width > 0 && (
        <FlatList
          key={columns}
          data={filtered}
          numColumns={columns}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: 24, gap: GAP }}
          columnWrapperStyle={{ gap: GAP }}
          initialNumToRender={columns * 7}
          maxToRenderPerBatch={columns * 4}
          windowSize={7}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          getItemLayout={(_, index) => {
            const row = Math.floor(index / columns);
            return { length: CARD_H + GAP, offset: (CARD_H + GAP) * row, index };
          }}
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
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[g.tab, active && g.tabActive]}>
      <Text style={[g.tabText, active && { color: C.ink, fontWeight: '600' }]}>{label}</Text>
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
          borderColor: selected ? C.ink : c.border,
          borderWidth: selected ? 1.5 : 1,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      {pending && (
        <View style={g.pending}>
          <CloudPending size={15} color={C.muted} />
        </View>
      )}
      <View style={g.numberRow}>
        <DoorGlyph size={20} color={c.solid} fill={room.status === 'sin_revisar' ? undefined : c.border} />
        <Text style={[g.number, tabular]}>{room.number}</Text>
      </View>
      <Text style={[g.guest, !room.guest_name && { color: C.faint }]} numberOfLines={1}>
        {room.guest_name ?? 'Sin huésped'}
      </Text>
      <Text style={g.flight} numberOfLines={1}>
        Vuelo <Text style={[g.flightTime, tabular]}>{room.flight_time ?? '—'}</Text>
      </Text>
    </Pressable>
  );
});

const g = StyleSheet.create({
  filters: { paddingTop: 12, paddingBottom: 12, gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 13, fontWeight: '500', color: C.body },
  chipCount: { fontSize: 13, fontWeight: '600', color: C.muted },
  tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  tabActive: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  tabText: { fontSize: 13, color: C.muted, fontWeight: '500' },
  card: {
    height: CARD_H,
    borderRadius: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  pending: { position: 'absolute', top: 8, right: 8 },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  number: { fontSize: 26, fontWeight: '700', color: C.ink, letterSpacing: -0.5 },
  guest: { fontSize: 13, fontWeight: '500', color: C.body, maxWidth: '100%' },
  flight: { fontSize: 12, color: C.muted },
  flightTime: { fontWeight: '600', color: C.body },
});

