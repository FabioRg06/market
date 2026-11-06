// Detalle de una habitación (drawer de recepción). Por defecto es solo lectura: lo
// pendiente y el historial se despliegan al tocarlos. Con el lápiz se pasa a edición
// (huésped, vuelo, tipo, por revisar y lo consumido en revisiones sin surtir).
// Surtir no se hace aquí: eso lo marca quien revisa.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../api';
import type { InspectionWithItems, InventoryLine, RoomRow } from '../../types';
import { dayLabel, duration, KIND_LABEL, money, ROOM_TYPES, STATUS_LABEL, time, TYPE_BY_CODE } from '../../format';
import { Btn, C, Empty, Input, ProductPicture, Receipt, s, Stepper, tabular } from '../../ui';
import { ChevronGlyph, PencilGlyph } from '../../icons';

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
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

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
        <Top title="Habitación" onClose={onClose} />
        <Empty text={error ? `No se pudo cargar (${error}).` : 'Cargando…'} />
      </View>
    );

  const r = data.room;
  const c = C.status[r.status];
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <View style={{ flex: 1 }}>
      <Top
        title={`Habitación ${r.number}`}
        subtitle={TYPE_BY_CODE[r.type]?.name}
        editing={editing}
        onEdit={() => setEditing((e) => !e)}
        onClose={onClose}
      />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {editing ? (
          <EditRoom room={r} onSave={act} />
        ) : (
          <View style={[st.card, { gap: 4 }]}>
            <View style={[s.row, { gap: 8 }]}>
              <View style={[st.dot, { backgroundColor: c.solid }]} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: c.ink }}>
                {STATUS_LABEL[r.status]}
                {r.needs_confirm ? ' · falta confirmar' : ''}
              </Text>
              {r.has_novedad && <Text style={{ fontSize: 13, fontWeight: '700', color: C.danger }}>· Novedad</Text>}
            </View>
            <Text style={{ fontSize: 20, fontWeight: '700', color: r.guest_name ? C.ink : C.faint }} numberOfLines={1}>
              {r.guest_name ?? 'Sin huésped'}
            </Text>
            <Text style={[{ fontSize: 14, color: C.muted }, tabular]}>Vuelo {r.flight_time ?? '—'}</Text>
          </View>
        )}

        {r.status === 'revisada' && (
          <Fold
            title="Falta por reponer"
            right={money(r.total)}
            open={!!open.pending || editing}
            onPress={() => toggle('pending')}
          >
            {editing ? (
              data.inspections
                .filter((i) => i.finished_at && !i.restocked_at)
                .map((i) => <EditItems key={i.id} inspection={i} inventory={data.inventory} onSave={act} />)
            ) : (
              <Receipt
                title={r.units ? `${r.units} ${r.units === 1 ? 'producto' : 'productos'}` : 'Sin consumo'}
                subtitle={`Revisada por ${r.reviewed_by ?? '—'} · ${time(r.reviewed_at)}`}
                lines={r.missing}
              />
            )}
          </Fold>
        )}

        <Fold title="Minibar" right={`${data.inventory.reduce((t, l) => t + l.quantity, 0)} productos`} open={!!open.minibar} onPress={() => toggle('minibar')}>
          <View style={st.grid}>
            {data.inventory.map((l) => (
              <View key={l.product_id} style={st.item}>
                <View style={st.thumb}>
                  <ProductPicture id={l.product_id} image={l.image} size={26} fill shrink={/pequeñ/i.test(l.name) ? 0.65 : 1} />
                </View>
                <Text style={{ flex: 1, fontSize: 13, color: C.ink }} numberOfLines={2}>
                  {l.name}
                </Text>
                <Text style={[{ fontSize: 13, fontWeight: '700', color: C.ink }, tabular]}>×{l.quantity}</Text>
              </View>
            ))}
          </View>
        </Fold>

        <Text style={[s.label, { marginTop: 4 }]}>Historial</Text>
        {data.inspections.length === 0 && <Empty text="Todavía no hay revisiones." />}
        {data.inspections.map((i) => (
          <Fold
            key={i.id}
            title={`${KIND_LABEL[i.kind] ?? 'Revisión'} · ${dayLabel(i.started_at)} ${time(i.started_at)}`}
            right={i.units ? money(i.total) : 'Sin consumo'}
            danger={i.kind === 'novedad'}
            open={!!open[i.id]}
            onPress={() => toggle(i.id)}
          >
            <Receipt
              title={i.inspector}
              subtitle={`${time(i.started_at)} – ${i.finished_at ? time(i.finished_at) : 'en curso'}${
                i.finished_at ? ` · ${duration(i.started_at, i.finished_at)}` : ''
              }${i.restocked_at ? ` · surtida ${time(i.restocked_at)}` : ''}`}
              lines={i.items}
            />
          </Fold>
        ))}
      </ScrollView>
    </View>
  );
}

/** Edición de huésped, vuelo, tipo y "por revisar". */
function EditRoom({ room, onSave }: { room: RoomRow; onSave: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [guest, setGuest] = useState(room.guest_name ?? '');
  const [flight, setFlight] = useState(room.flight_time ?? '');
  const flightOk = !flight.trim() || TIME_RE.test(flight.trim());
  const put = (body: object) => onSave(() => api.put(`/api/rooms/${room.id}/guest`, body));

  return (
    <View style={[st.card, { gap: 10 }]}>
      <Input value={guest} onChangeText={setGuest} placeholder="Huésped" />
      <Input value={flight} onChangeText={setFlight} placeholder="Vuelo (14:30)" keyboardType="numbers-and-punctuation" maxLength={5} />
      {!flightOk && <Text style={{ color: C.danger }}>Escribe la hora como 14:30.</Text>}
      <Btn title="Guardar huésped" disabled={!flightOk} onPress={() => put({ guest_name: guest, flight_time: flight })} />
      <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
        {ROOM_TYPES.map((t) => (
          <Pressable
            key={t.code}
            onPress={() => t.code !== room.type && onSave(() => api.put(`/api/rooms/${room.id}/type`, { type: t.code }))}
            accessibilityRole="button"
            accessibilityState={{ selected: t.code === room.type }}
            style={[st.typeOpt, t.code === room.type && { borderColor: C.brand, backgroundColor: '#EEF2FF' }]}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: t.code === room.type ? C.brand : C.body }}>{t.code}</Text>
            <Text style={{ fontSize: 12, color: C.muted }}>{t.name}</Text>
          </Pressable>
        ))}
      </View>
      {room.status === 'por_revisar' ? (
        <Btn title="Quitar de por revisar" variant="secondary" onPress={() => put({ guest_name: guest, flight_time: flight, review: false })} />
      ) : room.status === 'surtida' ? (
        <Btn title="Marcar por revisar" variant="secondary" onPress={() => put({ guest_name: guest, flight_time: flight, review: true })} />
      ) : null}
    </View>
  );
}

/** Corregir lo consumido en una revisión sin surtir. */
function EditItems({
  inspection,
  inventory,
  onSave,
}: {
  inspection: InspectionWithItems;
  inventory: InventoryLine[];
  onSave: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(inspection.items.map((it) => [it.product_id, it.quantity])));
  const products = inventory.length ? inventory : [];
  return (
    <View style={[st.card, { gap: 6 }]}>
      <Text style={{ fontSize: 13, color: C.muted }}>
        {KIND_LABEL[inspection.kind] ?? 'Revisión'} · {inspection.inspector} · {time(inspection.finished_at)}
      </Text>
      {products.map((p) => (
        <View key={p.product_id} style={[s.row, { justifyContent: 'space-between' }]}>
          <Text style={{ flex: 1, fontSize: 14, color: (qty[p.product_id] ?? 0) > 0 ? C.ink : C.faint }}>{p.name}</Text>
          <Stepper value={qty[p.product_id] ?? 0} max={p.quantity} onChange={(v) => setQty((q) => ({ ...q, [p.product_id]: v }))} />
        </View>
      ))}
      <Btn
        title="Guardar consumo"
        onPress={() =>
          onSave(() =>
            api.put(`/api/inspections/${inspection.id}/items`, {
              items: products.map((p) => ({ product_id: p.product_id, quantity: qty[p.product_id] ?? 0 })),
            })
          )
        }
      />
    </View>
  );
}

function Fold({
  title,
  right,
  open,
  onPress,
  danger,
  children,
}: {
  title: string;
  right?: string;
  open: boolean;
  onPress: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: open }} style={st.foldHead}>
        <Text style={[st.foldTitle, danger && { color: C.danger }]} numberOfLines={1}>
          {title}
        </Text>
        {right ? <Text style={[st.foldRight, tabular]}>{right}</Text> : null}
        <ChevronGlyph open={open} />
      </Pressable>
      {open && children}
    </View>
  );
}

function Top({
  title,
  subtitle,
  editing,
  onEdit,
  onClose,
}: {
  title: string;
  subtitle?: string;
  editing?: boolean;
  onEdit?: () => void;
  onClose: () => void;
}) {
  return (
    <View style={[s.header, { gap: 14 }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.eyebrow}>{subtitle}</Text> : null}
      </View>
      {onEdit && (
        <Pressable
          onPress={onEdit}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Terminar de editar' : 'Editar'}
          style={[st.iconBtn, editing && { backgroundColor: C.onBrand }]}
        >
          <PencilGlyph size={18} color={editing ? C.brand : C.onBrand} />
        </Pressable>
      )}
      <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cerrar">
        <Text style={{ fontSize: 22, color: C.onBrand }}>✕</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  foldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  foldTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: C.ink },
  foldRight: { fontSize: 14, color: C.body },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    padding: 8,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  typeOpt: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5, borderColor: C.line, alignItems: 'center' },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
});
