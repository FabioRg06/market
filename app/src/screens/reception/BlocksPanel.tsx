// Bloques del hotel: cada bloque (C, K, L, BW, R…) tiene series de habitaciones, por
// ejemplo C 101–122, C 201–223 y C 301–323. Al guardar, el servidor crea las habitaciones
// que falten y desactiva las que sobran (su historial se conserva).
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { C, s, tabular } from '../../ui';

type Range = [string, number, number];
interface BlockRow {
  id: string;
  code: string;
  name: string;
  rooms: number;
  ranges: Range[];
}
interface Draft {
  code: string;
  name: string;
  ranges: { prefix: string; from: string; to: string }[];
}

const toDraft = (b: Pick<BlockRow, 'code' | 'name' | 'ranges'>): Draft => ({
  code: b.code,
  name: b.name,
  ranges: b.ranges.map(([prefix, from, to]) => ({ prefix, from: String(from), to: String(to) })),
});
const toRanges = (d: Draft): Range[] =>
  d.ranges.filter((r) => Number(r.from) > 0 && Number(r.to) >= Number(r.from)).map((r) => [r.prefix.trim().toUpperCase(), Number(r.from), Number(r.to)]);
const countOf = (d: Draft) => toRanges(d).reduce((t, [, a, z]) => t + z - a + 1, 0);

export default function BlocksPanel({ onChanged }: { onChanged: () => void }) {
  const [blocks, setBlocks] = useState<BlockRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [adding, setAdding] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await api.get<BlockRow[]>('/api/blocks');
      setBlocks(b);
      setDrafts(Object.fromEntries(b.map((x) => [x.id, toDraft(x)])));
    } catch (e: any) {
      setMsg(`No se pudo cargar: ${e.message}`);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMsg(ok);
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(`No se guardó: ${e.message}`);
    }
  }

  const setDraft = (id: string, fn: (d: Draft) => Draft) => setDrafts((all) => ({ ...all, [id]: fn(all[id]) }));

  if (!blocks) return <Text style={[s.muted, { padding: 28 }]}>{msg ?? 'Cargando…'}</Text>;

  return (
    <ScrollView contentContainerStyle={st.page}>
      <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }]}>
        <Text style={st.lead}>
          {blocks.length} bloques · {blocks.reduce((t, b) => t + b.rooms, 0)} habitaciones
        </Text>
        {!adding && (
          <Pressable onPress={() => setAdding({ code: '', name: '', ranges: [{ prefix: '', from: '', to: '' }] })} style={st.cta} accessibilityRole="button">
            <Text style={st.ctaText}>Nuevo bloque</Text>
          </Pressable>
        )}
      </View>
      {msg && (
        <Pressable onPress={() => setMsg(null)} style={st.msg}>
          <Text style={{ color: C.ink }}>{msg}</Text>
        </Pressable>
      )}

      {adding && (
        <BlockCard
          draft={adding}
          onChange={(fn) => setAdding((d) => fn(d!))}
          saveLabel="Crear bloque"
          onSave={() =>
            run(() => api.post('/api/blocks', { code: adding.code, name: adding.name || adding.code, ranges: toRanges(adding) }), `Bloque ${adding.code} creado.`).then(() =>
              setAdding(null)
            )
          }
          onCancel={() => setAdding(null)}
        />
      )}

      {blocks.map((b) => {
        const d = drafts[b.id];
        if (!d) return null;
        const dirty = JSON.stringify(toDraft(b)) !== JSON.stringify(d);
        return (
          <BlockCard
            key={b.id}
            draft={d}
            rooms={b.rooms}
            dirty={dirty}
            onChange={(fn) => setDraft(b.id, fn)}
            saveLabel="Guardar"
            onSave={() =>
              run(() => api.put(`/api/blocks/${b.id}`, { code: d.code, name: d.name, ranges: toRanges(d) }), `Bloque ${d.code} guardado: ${countOf(d)} habitaciones.`)
            }
            onCancel={dirty ? () => setDraft(b.id, () => toDraft(b)) : undefined}
          />
        );
      })}
    </ScrollView>
  );
}

function BlockCard({
  draft,
  rooms,
  dirty,
  onChange,
  onSave,
  onCancel,
  saveLabel,
}: {
  draft: Draft;
  rooms?: number;
  dirty?: boolean;
  onChange: (fn: (d: Draft) => Draft) => void;
  onSave: () => void;
  onCancel?: () => void;
  saveLabel: string;
}) {
  const setRange = (i: number, patch: Partial<Draft['ranges'][number]>) =>
    onChange((d) => ({ ...d, ranges: d.ranges.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
  const total = countOf(draft);
  return (
    <View style={st.card}>
      <View style={[s.row, { gap: 12, flexWrap: 'wrap' }]}>
        <TextInput
          value={draft.code}
          onChangeText={(t) => onChange((d) => ({ ...d, code: t.toUpperCase() }))}
          placeholder="Código"
          placeholderTextColor={C.faint}
          maxLength={8}
          style={[st.input, st.code]}
          accessibilityLabel="Código del bloque"
        />
        <TextInput
          value={draft.name}
          onChangeText={(t) => onChange((d) => ({ ...d, name: t }))}
          placeholder="Nombre"
          placeholderTextColor={C.faint}
          style={[st.input, { flex: 1, minWidth: 160 }]}
          accessibilityLabel="Nombre del bloque"
        />
        <Text style={[st.count, tabular]}>
          {total} hab.{rooms != null && rooms !== total ? <Text style={{ color: C.muted, fontWeight: '500' }}>{`  (hoy ${rooms})`}</Text> : null}
        </Text>
      </View>

      <View style={{ gap: 8, marginTop: 14 }}>
        {draft.ranges.map((r, i) => (
          <View key={i} style={st.range}>
            <Text style={st.rangeLabel}>Serie</Text>
            <TextInput value={r.prefix} onChangeText={(t) => setRange(i, { prefix: t.toUpperCase() })} placeholder="Prefijo" placeholderTextColor={C.faint} style={[st.input, { width: 80 }]} accessibilityLabel="Prefijo" />
            <TextInput value={r.from} onChangeText={(t) => setRange(i, { from: t.replace(/\D/g, '') })} placeholder="Desde" placeholderTextColor={C.faint} keyboardType="numeric" style={[st.input, { width: 90 }]} accessibilityLabel="Desde" />
            <Text style={{ color: C.muted }}>a</Text>
            <TextInput value={r.to} onChangeText={(t) => setRange(i, { to: t.replace(/\D/g, '') })} placeholder="Hasta" placeholderTextColor={C.faint} keyboardType="numeric" style={[st.input, { width: 90 }]} accessibilityLabel="Hasta" />
            <Text style={[st.rangeInfo, tabular]} numberOfLines={1}>
              {Number(r.from) > 0 && Number(r.to) >= Number(r.from) ? `${r.prefix}${r.from} – ${r.prefix}${r.to} · ${Number(r.to) - Number(r.from) + 1}` : 'Completa la serie'}
            </Text>
            <Pressable onPress={() => onChange((d) => ({ ...d, ranges: d.ranges.filter((_, k) => k !== i) }))} hitSlop={8} accessibilityLabel="Quitar serie">
              <Text style={{ color: C.danger, fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          onPress={() => onChange((d) => ({ ...d, ranges: [...d.ranges, { prefix: d.ranges[0]?.prefix ?? d.code, from: '', to: '' }] }))}
          style={{ alignSelf: 'flex-start', paddingVertical: 4 }}
          accessibilityRole="button"
        >
          <Text style={{ color: C.brand, fontWeight: '700' }}>+ Agregar serie</Text>
        </Pressable>
      </View>

      {(dirty || !rooms) && (
        <View style={[s.row, { gap: 10, marginTop: 14, justifyContent: 'flex-end' }]}>
          {onCancel && (
            <Pressable onPress={onCancel} style={st.ghost} accessibilityRole="button">
              <Text style={st.ghostText}>Cancelar</Text>
            </Pressable>
          )}
          <Pressable onPress={onSave} disabled={!draft.code.trim() || !total} style={[st.cta, (!draft.code.trim() || !total) && { opacity: 0.4 }]} accessibilityRole="button">
            <Text style={st.ctaText}>{saveLabel}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  page: { padding: 28, gap: 14, maxWidth: 980, width: '100%', alignSelf: 'center' },
  lead: { fontSize: 15, color: C.muted, fontWeight: '600' },
  msg: { backgroundColor: C.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.line },
  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 18 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: C.ink, backgroundColor: C.surface },
  code: { width: 110, fontWeight: '800', fontSize: 17 },
  count: { fontSize: 15, fontWeight: '800', color: C.ink },
  range: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  rangeLabel: { width: 40, fontSize: 12, color: C.muted, fontWeight: '600' },
  rangeInfo: { flex: 1, minWidth: 140, fontSize: 13, color: C.body },
  cta: { backgroundColor: C.brand, borderRadius: 10, paddingHorizontal: 16, height: 40, justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  ghost: { borderRadius: 10, paddingHorizontal: 14, height: 40, justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  ghostText: { color: C.body, fontWeight: '600', fontSize: 14 },
});
