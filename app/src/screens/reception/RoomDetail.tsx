// Detalle de una habitación (drawer de recepción). Por defecto es solo lectura: lo
// pendiente y el historial se despliegan al tocarlos. Con el lápiz se pasa a edición
// (huésped, vuelo, tipo, por revisar y lo consumido en revisiones sin surtir).
// Surtir no se hace aquí: eso lo marca quien revisa.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../api';
import type { InspectionWithItems, InventoryLine, RoomRow } from '../../types';
import { CHARGE_LABEL, dayLabel, duration, KIND_LABEL, NOVEDAD_TYPES, REASON_LABEL, money, ROOM_TYPES, STATUS_LABEL, time, TYPE_BY_CODE } from '../../format';
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
  // Registrar desde recepción: revisión, novedad o consumo adicional.
  const [entry, setEntry] = useState<null | 'revision' | 'novedad' | 'consumo'>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
              {r.has_novedad && !(r.charges ?? []).length && <Text style={{ fontSize: 13, fontWeight: '700', color: C.danger }}>· Novedad</Text>}
              {(r.charges ?? []).map((ch) => (
                <Text key={ch} style={{ fontSize: 13, fontWeight: '700', color: C.danger }}>
                  · {CHARGE_LABEL[ch]}
                </Text>
              ))}
            </View>
            <Text style={{ fontSize: 20, fontWeight: '700', color: r.guest_name ? C.ink : C.faint }} numberOfLines={1}>
              {r.guest_name ?? 'Sin huésped'}
            </Text>
            <Text style={[{ fontSize: 14, color: C.muted }, tabular]}>
              Vuelo {r.flight_time ?? '—'}
              {r.worker_name ? <Text style={{ color: C.brand, fontWeight: '700' }}>{` · ${r.worker_name}`}</Text> : null}
            </Text>
            {(r.double_cycle || r.pending_checkout) && (
              <View style={[s.row, { gap: 6, marginTop: 4 }]}>
                {r.pending_checkout && <Tag text="Pendiente por salir" color="#C77D12" />}
                {r.double_cycle && <Tag text="Doble ciclo" color={C.brand} />}
              </View>
            )}
          </View>
        )}

        {!editing && !entry && r.type !== 'SM' && (
          <View style={[s.row, { gap: 8 }]}>
            {r.status === 'revisada' ? (
              <>
                <Btn title="Registrar novedad" onPress={() => setEntry('novedad')} style={{ flex: 1, minHeight: 42 }} />
                <Btn title="Agregar consumo" variant="secondary" onPress={() => setEntry('consumo')} style={{ flex: 1, minHeight: 42 }} />
              </>
            ) : (
              <Btn title="Revisar desde recepción" onPress={() => setEntry('revision')} style={{ flex: 1, minHeight: 42 }} />
            )}
          </View>
        )}

        {notice && (
          <Pressable onPress={() => setNotice(null)} style={st.notice} accessibilityRole="alert">
            <Text style={st.noticeText}>✓ {notice}</Text>
          </Pressable>
        )}

        {entry && (
          <Entry
            kind={entry}
            inventory={data.inventory}
            onCancel={() => setEntry(null)}
            onSave={async (body, label) => {
              await act(() => api.post(`/api/rooms/${roomId}/inspections`, { ...body, kind: entry }));
              setEntry(null);
              setNotice(label);
            }}
          />
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
                .filter((i) => i.finished_at && !i.restocked_at && i.kind !== 'cambio')
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
            title={`${KIND_LABEL[i.kind] ?? 'Revisión'}${i.charge ? ` · ${CHARGE_LABEL[i.charge]}` : ''} · ${dayLabel(i.started_at)} ${time(i.started_at)}`}
            right={i.kind === 'cambio' ? `${i.units} u` : i.units ? money(i.total) : 'Sin consumo'}
            danger={i.kind === 'novedad' || !!i.charge}
            open={!!open[i.id]}
            onPress={() => toggle(i.id)}
          >
            <Receipt
              title={i.inspector}
              subtitle={`${time(i.started_at)} – ${i.finished_at ? time(i.finished_at) : 'en curso'}${
                i.finished_at ? ` · ${duration(i.started_at, i.finished_at)}` : ''
              }${i.restocked_at ? ` · surtida ${time(i.restocked_at)}` : ''}`}
              footer={i.notes ? <Text style={st.note}>Nota: {i.notes}</Text> : undefined}
              lines={i.kind === 'cambio' ? i.items.map((it) => ({ ...it, name: `${it.name} · ${REASON_LABEL[it.reason ?? ''] ?? 'Cambio'}${it.expires_on ? ` (vence ${it.expires_on})` : ''}` })) : i.items}
            />
          </Fold>
        ))}
      </ScrollView>
    </View>
  );
}

/** Registrar desde recepción lo que se encontró en la habitación. */
function Entry({
  kind,
  inventory,
  onCancel,
  onSave,
}: {
  kind: 'revision' | 'novedad' | 'consumo';
  inventory: InventoryLine[];
  onCancel: () => void;
  onSave: (body: { items: { product_id: string; quantity: number }[]; charge?: string; notes?: string }, label: string) => Promise<void>;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [type, setType] = useState<'post' | 'no_reconocido' | 'nap'>('post');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const items = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([product_id, quantity]) => ({ product_id, quantity }));
  const total = inventory.reduce((t, l) => t + (qty[l.product_id] ?? 0) * l.price, 0);
  const title = kind === 'novedad' ? 'Registrar novedad' : kind === 'consumo' ? 'Agregar consumo' : 'Revisar desde recepción';

  async function save(empty = false) {
    setSaving(true);
    try {
      await onSave(
        { items: empty ? [] : items, ...(kind === 'novedad' ? { charge: type, notes: note } : note.trim() ? { notes: note } : {}) },
        kind === 'novedad' ? 'Novedad registrada' : kind === 'consumo' ? 'Consumo agregado' : 'Revisada'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[st.card, { gap: 10, borderColor: C.brand, borderWidth: 1.5 }]}>
      <Text style={{ fontSize: 16, fontWeight: '800', color: C.ink }}>{title}</Text>
      {inventory.map((l) => (
        <View key={l.product_id} style={[s.row, { gap: 10 }]}>
          <View style={st.thumb}>
            <ProductPicture id={l.product_id} image={l.image} size={24} fill shrink={/pequeñ/i.test(l.name) ? 0.65 : 1} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, color: C.ink }} numberOfLines={1}>
              {l.name}
            </Text>
            <Text style={[{ fontSize: 12, color: C.muted }, tabular]}>
              {money(l.price)} · hay {l.quantity}
            </Text>
          </View>
          <Stepper value={qty[l.product_id] ?? 0} max={l.quantity} onChange={(v) => setQty((q) => ({ ...q, [l.product_id]: v }))} />
        </View>
      ))}
      {kind === 'novedad' && (
        <View style={{ gap: 6 }}>
          <Text style={s.label}>Tipo de novedad</Text>
          <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
            {NOVEDAD_TYPES.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setType(t.key)}
                accessibilityRole="radio"
                accessibilityState={{ checked: type === t.key }}
                style={[st.typeOpt, type === t.key && { borderColor: C.danger, backgroundColor: '#FDECEC' }]}
              >
                <Text style={{ fontSize: 13, fontWeight: type === t.key ? '700' : '500', color: type === t.key ? C.danger : C.body }}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      <Input
        value={note}
        onChangeText={setNote}
        placeholder={kind === 'novedad' ? 'Nota: describe la novedad' : 'Nota (opcional)'}
        multiline
        style={{ minHeight: 64, textAlignVertical: 'top' }}
      />
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={{ fontSize: 13, color: C.muted }}>{items.reduce((t, i) => t + i.quantity, 0)} productos</Text>
        <Text style={[{ fontSize: 16, fontWeight: '800', color: C.ink }, tabular]}>{money(total)}</Text>
      </View>
      <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
        <Btn title="Cancelar" variant="quiet" onPress={onCancel} style={{ minHeight: 42 }} />
        <View style={{ flex: 1 }} />
        {kind === 'revision' && <Btn title="Sin consumo" variant="secondary" disabled={saving || items.length > 0} onPress={() => save(true)} style={{ minHeight: 42 }} />}
        <Btn
          title={kind === 'revision' ? 'Marcar revisada' : 'Guardar'}
          disabled={saving || (kind !== 'revision' && items.length === 0) || (kind === 'revision' && items.length === 0)}
          onPress={() => save()}
          style={{ minHeight: 42 }}
        />
      </View>
    </View>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ borderRadius: 999, borderWidth: 1, borderColor: color, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color }}>{text}</Text>
    </View>
  );
}

/** Edición de huésped, vuelo, trabajador, banderas, tipo y "por revisar". */
function EditRoom({ room, onSave }: { room: RoomRow; onSave: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [guest, setGuest] = useState(room.guest_name ?? '');
  const [flight, setFlight] = useState(room.flight_time ?? '');
  const [workers, setWorkers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api.get<{ id: string; name: string }[]>('/api/workers').then(setWorkers).catch(() => {});
  }, []);
  const flightOk = !flight.trim() || TIME_RE.test(flight.trim());
  const put = (body: object) => onSave(() => api.put(`/api/rooms/${room.id}/guest`, body));

  return (
    <View style={[st.card, { gap: 10 }]}>
      <Input value={guest} onChangeText={setGuest} placeholder="Huésped" />
      <Input value={flight} onChangeText={setFlight} placeholder="Vuelo (14:30)" keyboardType="numbers-and-punctuation" maxLength={5} />
      {!flightOk && <Text style={{ color: C.danger }}>Escribe la hora como 14:30.</Text>}
      <Btn title="Guardar huésped" disabled={!flightOk} onPress={() => put({ guest_name: guest, flight_time: flight })} />
      {workers.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={s.label}>Revisa</Text>
          <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
            {[{ id: '', name: 'Nadie' }, ...workers].map((w) => {
              const on = (room.worker_id ?? '') === w.id;
              return (
                <Pressable
                  key={w.id || 'none'}
                  onPress={() => !on && put({ worker_id: w.id || null })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[st.typeOpt, on && { borderColor: C.brand, backgroundColor: '#EEF2FF' }]}
                >
                  <Text style={{ fontSize: 13, fontWeight: on ? '700' : '500', color: on ? C.brand : C.body }}>{w.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      <View style={[s.row, { gap: 8 }]}>
        <Btn
          title={room.pending_checkout ? '✓ Pendiente por salir' : 'Pendiente por salir'}
          variant={room.pending_checkout ? 'primary' : 'secondary'}
          onPress={() => put({ pending_checkout: !room.pending_checkout })}
          style={{ flex: 1, minHeight: 40 }}
        />
        <Btn
          title={room.double_cycle ? '✓ Doble ciclo' : 'Doble ciclo'}
          variant={room.double_cycle ? 'primary' : 'secondary'}
          onPress={() => put({ double_cycle: !room.double_cycle })}
          style={{ flex: 1, minHeight: 40 }}
        />
      </View>
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
      <View style={[s.row, { gap: 6, flexWrap: 'wrap', marginBottom: 4 }]}>
        {(inspection.kind === 'novedad' ? (['post', 'no_reconocido', 'nap'] as const) : ([null, 'nap', 'no_reconocido'] as const)).map((ch) => {
          const on = (inspection.charge ?? null) === ch;
          return (
            <Pressable
              key={ch ?? 'normal'}
              onPress={() => !on && onSave(() => api.put(`/api/inspections/${inspection.id}/charge`, { charge: ch }))}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[st.typeOpt, on && { borderColor: ch ? C.danger : C.brand, backgroundColor: ch ? '#FDECEC' : '#EEF2FF' }]}
            >
              <Text style={{ fontSize: 13, fontWeight: on ? '700' : '500', color: on ? (ch ? C.danger : C.brand) : C.body }}>
                {ch ? CHARGE_LABEL[ch] : 'Cobro normal'}
              </Text>
            </Pressable>
          );
        })}
      </View>
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
  notice: { backgroundColor: '#E9F7EF', borderColor: '#A8DDBE', borderWidth: 1, borderRadius: 10, padding: 12 },
  noticeText: { color: '#1B6B3E', fontWeight: '700', fontSize: 14 },
  note: { fontSize: 13, color: C.body, fontStyle: 'italic' },
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
