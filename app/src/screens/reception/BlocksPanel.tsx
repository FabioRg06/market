// Bloques del hotel: código y nombre de cada uno. Los rangos de habitaciones son fijos
// (vienen guardados en la base, desde app/src/catalog.json).
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api } from '../../api';
import { Btn, C, Input, s, tabular } from '../../ui';

interface BlockRow {
  id: string;
  code: string | null;
  name: string;
  first: number;
  last: number;
  rooms: number;
}

export default function BlocksPanel({ onChanged }: { onChanged: () => void }) {
  const [blocks, setBlocks] = useState<BlockRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, { code: string; name: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await api.get<BlockRow[]>('/api/blocks');
      setBlocks(b);
      setDraft(Object.fromEntries(b.map((x) => [x.id, { code: x.code ?? '', name: x.name }])));
    } catch (e: any) {
      setMsg(`No se pudo cargar: ${e.message}`);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!blocks) return;
    const changed = blocks.filter((b) => draft[b.id].code.trim() !== (b.code ?? '') || draft[b.id].name.trim() !== b.name);
    try {
      await Promise.all(changed.map((b) => api.put(`/api/blocks/${b.id}`, draft[b.id])));
      setMsg(changed.length ? `Se guardaron ${changed.length} bloques.` : 'No había cambios.');
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(`No se guardó: ${e.message}`);
    }
  }

  if (!blocks) return <Text style={[s.muted, { padding: 16 }]}>{msg ?? 'Cargando…'}</Text>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      <Text style={s.muted}>Cada bloque tiene un código fijo y un rango de habitaciones. El código es el que se ve en las tarjetas y filtros.</Text>
      <View style={{ backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line }}>
        <View style={[s.row, { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }]}>
          <Text style={[s.label, { width: 110, marginBottom: 0 }]}>Código</Text>
          <Text style={[s.label, { flex: 1, marginBottom: 0 }]}>Nombre</Text>
          <Text style={[s.label, { width: 150, marginBottom: 0, textAlign: 'right' }]}>Habitaciones</Text>
        </View>
        {blocks.map((b) => (
          <View key={b.id} style={[s.row, { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.bg }]}>
            <Input
              value={draft[b.id]?.code ?? ''}
              onChangeText={(t) => setDraft((d) => ({ ...d, [b.id]: { ...d[b.id], code: t.toUpperCase() } }))}
              autoCapitalize="characters"
              maxLength={8}
              style={{ width: 110, paddingVertical: 8 }}
            />
            <Input
              value={draft[b.id]?.name ?? ''}
              onChangeText={(t) => setDraft((d) => ({ ...d, [b.id]: { ...d[b.id], name: t } }))}
              style={{ flex: 1, paddingVertical: 8 }}
            />
            <Text style={[{ width: 150, textAlign: 'right', color: C.body }, tabular]}>
              {b.first}–{b.last} ({b.rooms})
            </Text>
          </View>
        ))}
      </View>
      <Btn title="Guardar bloques" onPress={save} />
      {msg && <Text style={{ color: C.ink }}>{msg}</Text>}
    </ScrollView>
  );
}
