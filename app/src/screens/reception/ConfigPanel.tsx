// Productos del minibar: la lista es fija; aquí se ajusta precio y cantidad estándar.
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api } from '../../api';
import { money } from '../../format';
import { Btn, C, Card, Input, Stepper, s } from '../../ui';

interface ProductRow {
  id: string;
  name: string;
  price: number;
  std_qty: number;
}

export default function ConfigPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<ProductRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, { price: string; std_qty: number }>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.get<ProductRow[]>('/api/products');
      setRows(list);
      setDraft(Object.fromEntries(list.map((p) => [p.id, { price: String(p.price), std_qty: p.std_qty }])));
    } catch (e: any) {
      setMsg(`No se pudo cargar: ${e.message}`);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!rows) return;
    const changed = rows.filter((p) => Number(draft[p.id].price) !== p.price || draft[p.id].std_qty !== p.std_qty);
    try {
      await Promise.all(
        changed.map((p) => api.put(`/api/products/${p.id}`, { price: Number(draft[p.id].price || 0), std_qty: draft[p.id].std_qty }))
      );
      setMsg(changed.length ? `Guardados ${changed.length} cambios. Las tablets los reciben al sincronizar.` : 'No había cambios.');
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(`No se guardó: ${e.message}`);
    }
  }

  if (!rows) return <Text style={[s.muted, { padding: 16 }]}>{msg ?? 'Cargando…'}</Text>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 760 }}>
      <Text style={s.muted}>
        «Cantidad» es lo que debe tener el minibar de cada habitación. Una habitación puntual se ajusta desde la tablet, en la pestaña Inventario.
      </Text>
      <Card style={{ gap: 0, padding: 0 }}>
        {rows.map((p, idx) => (
          <View
            key={p.id}
            style={[s.row, { padding: 12, paddingHorizontal: 16, borderTopWidth: idx ? 1 : 0, borderTopColor: C.line }]}
          >
            <Text style={[s.h2, { flex: 1 }]}>{p.name}</Text>
            <View style={{ width: 130 }}>
              <Input
                value={draft[p.id].price}
                onChangeText={(t) => setDraft((d) => ({ ...d, [p.id]: { ...d[p.id], price: t.replace(/\D/g, '') } }))}
                keyboardType="numeric"
                style={{ paddingVertical: 8, textAlign: 'right' }}
                accessibilityLabel={`Precio de ${p.name}`}
              />
            </View>
            <Stepper value={draft[p.id].std_qty} onChange={(v) => setDraft((d) => ({ ...d, [p.id]: { ...d[p.id], std_qty: v } }))} />
          </View>
        ))}
      </Card>
      <Text style={s.muted}>Total de un minibar completo: {money(rows.reduce((t, p) => t + Number(draft[p.id].price || 0) * draft[p.id].std_qty, 0))}</Text>
      <Btn title="Guardar cambios" onPress={save} />
      {msg && <Text style={{ color: C.ink }}>{msg}</Text>}
    </ScrollView>
  );
}
