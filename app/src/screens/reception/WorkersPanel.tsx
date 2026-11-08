// Trabajadores: quiénes revisan y qué habitaciones tiene cada uno. Se eligen habitaciones
// tocándolas, o arrastrando de una a otra para tomar todo el rango, y se asignan de una vez. El Excel de salidas también asigna,
// si trae una columna "Trabajador" con el nombre tal como está aquí.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import type { RoomRow } from '../../types';
import { C, Confirm, Input, s, tabular } from '../../ui';
import { PencilGlyph } from '../../icons';
import { PALETTE, TINT } from '../../charts';

interface WorkerRow {
  id: string;
  name: string;
  assigned: number;
}

type Show = 'por_revisar' | 'todas';

export default function WorkersPanel({ onChanged }: { onChanged: () => void }) {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [show, setShow] = useState<Show>('por_revisar');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<WorkerRow | null>(null);
  const [editName, setEditName] = useState('');
  const [removing, setRemoving] = useState<WorkerRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, r] = await Promise.all([api.get<WorkerRow[]>('/api/workers'), api.get<RoomRow[]>('/api/rooms')]);
      setWorkers(w);
      setRooms(r);
      setCurrent((c) => c ?? w[0]?.id ?? null);
    } catch (e: any) {
      setMsg(`No se pudo cargar: ${e.message}`);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(`No se guardó: ${e.message}`);
    }
  }

  const colorOf = useMemo(() => {
    const m = new Map<string, number>();
    workers.forEach((w, i) => m.set(w.id, i % PALETTE.length));
    return m;
  }, [workers]);

  const worker = workers.find((w) => w.id === current) ?? null;
  const visible = rooms.filter((r) => (show === 'todas' ? r.type !== 'SM' : r.status === 'por_revisar'));
  const byBlock = useMemo(() => {
    const m = new Map<string, RoomRow[]>();
    for (const r of visible) {
      const k = r.block_code ?? r.block_name;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()];
  }, [visible]);
  const mine = rooms.filter((r) => r.worker_id === current);
  const toggle = (id: string) =>
    setSelected((sel) => {
      const n = new Set(sel);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // Arrastrar para elegir un rango: desde la habitación donde se empezó hasta donde está el
  // mouse, en el orden de la lista. Si se empezó sobre una ya elegida, el arrastre la quita.
  // Shift + clic toma el rango desde la última habitación tocada.
  const order = useMemo(() => visible.map((r) => r.id), [visible]);
  const drag = useRef<{ anchor: number; adding: boolean; base: Set<string> } | null>(null);
  const last = useRef<number | null>(null);
  const applyRange = (anchor: number, to: number, adding: boolean, base: Set<string>) => {
    const n = new Set(base);
    for (const id of order.slice(Math.min(anchor, to), Math.max(anchor, to) + 1)) adding ? n.add(id) : n.delete(id);
    setSelected(n);
  };
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const up = () => (drag.current = null);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  const chipMouse = (idx: number, id: string) =>
    Platform.OS === 'web'
      ? {
          onMouseDown: (e: any) => {
            e.preventDefault();
            if (e.shiftKey && last.current != null) {
              applyRange(last.current, idx, true, selected);
              last.current = idx;
              return;
            }
            const adding = !selected.has(id);
            drag.current = { anchor: idx, adding, base: new Set(selected) };
            last.current = idx;
            applyRange(idx, idx, adding, selected);
          },
          onMouseEnter: () => {
            const d = drag.current;
            if (d) applyRange(d.anchor, idx, d.adding, d.base);
          },
        }
      : { onPress: () => toggle(id) };

  return (
    <View style={st.wrap}>
      {/* Lista de trabajadores */}
      <View style={st.list}>
        <View style={[s.row, { gap: 8 }]}>
          <Input placeholder="Nuevo trabajador" value={newName} onChangeText={setNewName} style={{ flex: 1, minWidth: 0, width: 0, paddingVertical: 9 }} />
          <Pressable
            disabled={!newName.trim()}
            onPress={() => run(() => api.post('/api/workers', { name: newName }), `${newName.trim()} agregado.`).then(() => setNewName(''))}
            accessibilityRole="button"
            style={[st.add, !newName.trim() && { opacity: 0.4 }]}
          >
            <Text style={st.addText}>Agregar</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: 6, paddingTop: 12 }}>
          {workers.length === 0 && <Text style={st.empty}>Agrega a las personas que revisan habitaciones.</Text>}
          {workers.map((w) => {
            const on = w.id === current;
            const i = colorOf.get(w.id) ?? 0;
            return (
              <Pressable
                key={w.id}
                onPress={() => {
                  setCurrent(w.id);
                  setSelected(new Set());
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ hovered }: any) => [st.worker, on ? st.workerOn : hovered && { backgroundColor: '#F5F7FC' }]}
              >
                <View style={[st.avatar, { backgroundColor: TINT[i] }]}>
                  <Text style={[st.avatarText, { color: PALETTE[i] }]}>{w.name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.workerName} numberOfLines={1}>
                    {w.name}
                  </Text>
                  <Text style={[st.workerMeta, tabular]}>{w.assigned ? `${w.assigned} habitaciones` : 'sin habitaciones'}</Text>
                </View>
                {on && (
                  <Pressable
                    onPress={() => {
                      setEditing(w);
                      setEditName(w.name);
                    }}
                    hitSlop={8}
                    accessibilityLabel={`Editar a ${w.name}`}
                    style={st.iconBtn}
                  >
                    <PencilGlyph size={15} color={C.body} />
                  </Pressable>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Habitaciones del trabajador */}
      <View style={{ flex: 1 }}>
        {!worker ? (
          <Text style={[st.empty, { marginTop: 60 }]}>Elige un trabajador para asignarle habitaciones.</Text>
        ) : (
          <>
            <View style={st.head}>
              <View style={{ flex: 1 }}>
                <Text style={st.title}>{worker.name}</Text>
                <Text style={st.sub}>
                  {mine.length ? `Tiene ${mine.map((r) => r.number).slice(0, 12).join(', ')}${mine.length > 12 ? '…' : ''}` : 'Todavía no tiene habitaciones.'}
                </Text>
              </View>
              <View style={st.segment}>
                {(['por_revisar', 'todas'] as Show[]).map((k) => (
                  <Pressable key={k} onPress={() => setShow(k)} style={[st.segItem, show === k && st.segOn]} accessibilityRole="tab">
                    <Text style={[st.segText, show === k && { color: C.ink, fontWeight: '700' }]}>{k === 'por_revisar' ? 'Por revisar' : 'Todas'}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={st.bar}>
              <Text style={st.barText}>
                {selected.size ? `${selected.size} seleccionadas` : 'Toca las habitaciones o arrastra de una a otra para elegir un rango'}
              </Text>
              <Pressable
                disabled={!selected.size}
                onPress={() => run(() => api.put('/api/assign', { worker_id: worker.id, room_ids: [...selected] }), `Asignadas a ${worker.name}.`).then(() => setSelected(new Set()))}
                style={[st.cta, !selected.size && { opacity: 0.4 }]}
                accessibilityRole="button"
              >
                <Text style={st.ctaText}>Asignar a {worker.name}</Text>
              </Pressable>
              <Pressable
                disabled={!selected.size}
                onPress={() => run(() => api.put('/api/assign', { worker_id: null, room_ids: [...selected] }), 'Asignación quitada.').then(() => setSelected(new Set()))}
                style={[st.ghost, !selected.size && { opacity: 0.4 }]}
                accessibilityRole="button"
              >
                <Text style={st.ghostText}>Quitar asignación</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
              {byBlock.length === 0 && <Text style={st.empty}>No hay habitaciones por revisar. Carga el Excel de salidas o cambia a “Todas”.</Text>}
              {byBlock.map(([block, list]) => (
                <View key={block} style={{ gap: 8 }}>
                  <Text style={st.block}>
                    {block} <Text style={{ color: C.muted, fontWeight: '500' }}>· {list.length}</Text>
                  </Text>
                  <View style={st.chips}>
                    {list.map((r) => {
                      const idx = order.indexOf(r.id);
                      const sel = selected.has(r.id);
                      const mineRoom = r.worker_id === worker.id;
                      const other = r.worker_id && !mineRoom ? colorOf.get(r.worker_id) : undefined;
                      return (
                        <Pressable
                          key={r.id}
                          {...(chipMouse(idx, r.id) as any)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: sel }}
                          accessibilityLabel={`${r.number}${r.worker_name ? `, asignada a ${r.worker_name}` : ''}`}
                          style={[
                            st.chip,
                            mineRoom && { backgroundColor: TINT[colorOf.get(worker.id) ?? 0], borderColor: PALETTE[colorOf.get(worker.id) ?? 0] },
                            sel && { borderColor: C.brand, borderWidth: 2, backgroundColor: '#DCE5FF' },
                          ]}
                        >
                          <Text style={[st.chipText, tabular]}>{r.number}</Text>
                          {other !== undefined && <View style={[st.chipDot, { backgroundColor: PALETTE[other] }]} />}
                          {r.status === 'por_revisar' && show === 'todas' && <View style={[st.chipDot, { backgroundColor: C.status.por_revisar.solid }]} />}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
              <Text style={st.hint}>
                Arrastra de una habitación a otra para elegir todas las del medio (o Shift + clic). Con color: ya son de {worker.name}. Punto de color: asignada a otra persona. El Excel de salidas puede traer una columna “Trabajador” y se asignan solas.
              </Text>
            </ScrollView>
          </>
        )}
        {msg && (
          <Pressable onPress={() => setMsg(null)} style={st.toast}>
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>{msg}</Text>
          </Pressable>
        )}
      </View>

      <Confirm
        visible={!!editing}
        title="Editar trabajador"
        confirmText="Guardar"
        cancelText="Cancelar"
        onConfirm={() => {
          const w = editing!;
          setEditing(null);
          run(() => api.put(`/api/workers/${w.id}`, { name: editName }), 'Nombre actualizado.');
        }}
        onCancel={() => setEditing(null)}
      >
        <TextInput value={editName} onChangeText={setEditName} style={st.editInput} />
        <Pressable
          onPress={() => {
            setRemoving(editing);
            setEditing(null);
          }}
          style={{ alignSelf: 'flex-start', paddingVertical: 6 }}
        >
          <Text style={{ color: C.danger, fontWeight: '600' }}>Eliminar trabajador</Text>
        </Pressable>
      </Confirm>
      <Confirm
        visible={!!removing}
        title={`¿Eliminar a ${removing?.name ?? ''}?`}
        message="Sus habitaciones quedan sin asignar. Su historial de revisiones se conserva."
        confirmText="Eliminar"
        cancelText="Cancelar"
        onConfirm={() => {
          const w = removing!;
          setRemoving(null);
          if (current === w.id) setCurrent(null);
          run(() => api.delete(`/api/workers/${w.id}`), `${w.name} eliminado.`);
        }}
        onCancel={() => setRemoving(null)}
      />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, flexDirection: 'row' },
  list: { width: 300, padding: 18, borderRightWidth: 1, borderRightColor: C.line, backgroundColor: C.surface },
  add: { backgroundColor: C.brand, borderRadius: 10, paddingHorizontal: 14, height: 40, justifyContent: 'center' },
  addText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  empty: { color: C.muted, fontSize: 14, textAlign: 'center', padding: 16, lineHeight: 20 },
  worker: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12 },
  workerOn: { backgroundColor: '#EEF2FF' },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '800' },
  workerName: { fontSize: 15, fontWeight: '600', color: C.ink },
  workerMeta: { fontSize: 12, color: C.muted },
  iconBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 18 },
  title: { fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 },
  sub: { fontSize: 13, color: C.muted, marginTop: 2 },
  segment: { flexDirection: 'row', backgroundColor: '#E4E9F4', borderRadius: 10, padding: 3 },
  segItem: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  segOn: { backgroundColor: C.surface },
  segText: { fontSize: 13, color: C.muted, fontWeight: '500' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginTop: 14, padding: 10, paddingLeft: 16, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  barText: { flex: 1, fontSize: 14, color: C.body },
  cta: { backgroundColor: C.brand, borderRadius: 10, paddingHorizontal: 16, height: 40, justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  ghost: { borderRadius: 10, paddingHorizontal: 14, height: 40, justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  ghostText: { color: C.body, fontWeight: '600', fontSize: 14 },
  block: { fontSize: 14, fontWeight: '800', color: C.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, ...(Platform.OS === 'web' ? ({ userSelect: 'none' } as any) : null) },
  chip: {
    minWidth: 74,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  chipText: { fontSize: 14, fontWeight: '700', color: C.ink },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  hint: { fontSize: 12, color: C.muted, lineHeight: 18 },
  toast: { position: 'absolute', bottom: 18, alignSelf: 'center', backgroundColor: C.ink, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  editInput: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink },
});
