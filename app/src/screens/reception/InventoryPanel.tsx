// Inventario: el global (todo lo que ofrece Market, con foto y precio) y lo que lleva
// el minibar de cada tipo de habitación (CM, SS, SM, PR, VIP).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '../../api';
import type { RoomType } from '../../types';
import { money, ROOM_TYPES } from '../../format';
import { Btn, C, Input, ProductPicture, s, Stepper, TypeBadge } from '../../ui';
import { canPickFiles, imageToSmallDataUrl, pickFile } from '../../webfile';

interface ProductRow {
  id: string;
  name: string;
  price: number;
  presentation: string | null;
  image: string | null;
  active: number;
  /** La foto viene con el programa y no se cambia. */
  fixed_image?: boolean;
}

export default function InventoryPanel() {
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [typeInv, setTypeInv] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, { name: string; price: string; presentation: string }>>({});
  const [type, setType] = useState<RoomType>('CM');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([
        api.get<ProductRow[]>('/api/products'),
        api.get<{ type: string; product_id: string; quantity: number }[]>('/api/type-inventory'),
      ]);
      setProducts(p);
      setDraft(Object.fromEntries(p.map((x) => [x.id, { name: x.name, price: String(x.price), presentation: x.presentation ?? '' }])));
      setTypeInv(Object.fromEntries(t.map((x) => [`${x.type}:${x.product_id}`, x.quantity])));
    } catch (e: any) {
      setMsg(`No se pudo cargar: ${e.message}`);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (products) setQty(Object.fromEntries(products.map((p) => [p.id, typeInv[`${type}:${p.id}`] ?? 0])));
  }, [type, typeInv, products]);

  const active = useMemo(() => (products ?? []).filter((p) => p.active), [products]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e: any) {
      setMsg(`No se guardó: ${e.message}`);
    }
  }

  async function savePrices() {
    const changed = (products ?? []).filter(
      (p) => draft[p.id].name.trim() !== p.name || Number(draft[p.id].price || 0) !== p.price || draft[p.id].presentation.trim() !== (p.presentation ?? '')
    );
    await run(
      () => Promise.all(changed.map((p) => api.put(`/api/products/${p.id}`, { name: draft[p.id].name, price: Number(draft[p.id].price || 0), presentation: draft[p.id].presentation }))),
      changed.length ? `Se guardaron ${changed.length} productos.` : 'No había cambios.'
    );
  }

  async function uploadPhoto(p: ProductRow) {
    const file = await pickFile('image/*');
    if (!file) return;
    const image = await imageToSmallDataUrl(file);
    await run(() => api.put(`/api/products/${p.id}`, { image }), `Foto de ${p.name} actualizada.`);
  }

  if (!products) return <Text style={[s.muted, { padding: 16 }]}>{msg ?? 'Cargando…'}</Text>;

  const typeTotal = active.reduce((t, p) => t + (qty[p.id] ?? 0) * p.price, 0);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 18, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
      {msg && (
        <View style={{ backgroundColor: C.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.line }}>
          <Text style={{ color: C.ink }}>{msg}</Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        {/* Inventario global */}
        <View style={[panel, { flexGrow: 3, flexBasis: 480 }]}>
          <Text style={title}>Inventario global</Text>
          <Text style={[s.muted, { marginBottom: 6 }]}>
            Todo lo que ofrece Market. Las fotos de los productos vienen fijas con el programa.{canPickFiles ? ' Si un producto no tiene foto, toca el recuadro para subirla.' : ''}
          </Text>
          {products.map((p) => (
            <View key={p.id} style={[s.row, { paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.bg, opacity: p.active ? 1 : 0.5 }]}>
              <Pressable
                onPress={() => uploadPhoto(p)}
                disabled={!canPickFiles || !!p.fixed_image}
                accessibilityRole={p.fixed_image ? 'image' : 'button'}
                accessibilityLabel={p.fixed_image ? p.name : `Subir foto de ${p.name}`}
                style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}
              >
                <ProductPicture id={p.id} image={p.image} size={34} />
              </Pressable>
              <Input
                value={draft[p.id]?.name ?? ''}
                onChangeText={(t) => setDraft((d) => ({ ...d, [p.id]: { ...d[p.id], name: t } }))}
                style={{ flex: 1, paddingVertical: 8 }}
              />
              <Input
                value={draft[p.id]?.presentation ?? ''}
                onChangeText={(t) => setDraft((d) => ({ ...d, [p.id]: { ...d[p.id], presentation: t } }))}
                placeholder="400 ml"
                style={{ width: 90, paddingVertical: 8 }}
                accessibilityLabel={`Presentación de ${p.name}`}
              />
              <Input
                value={draft[p.id]?.price ?? ''}
                onChangeText={(t) => setDraft((d) => ({ ...d, [p.id]: { ...d[p.id], price: t.replace(/\D/g, '') } }))}
                keyboardType="numeric"
                style={{ width: 100, paddingVertical: 8, textAlign: 'right' }}
                accessibilityLabel={`Precio de ${p.name}`}
              />
              <Btn
                title={p.active ? 'Ocultar' : 'Activar'}
                variant="quiet"
                onPress={() => run(() => api.put(`/api/products/${p.id}`, { active: !p.active }), p.active ? `${p.name} ya no se ofrece.` : `${p.name} se ofrece otra vez.`)}
                style={{ minHeight: 36, paddingHorizontal: 8 }}
              />
            </View>
          ))}
          <View style={[s.row, { paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line }]}>
            <Input placeholder="Nuevo producto" value={newName} onChangeText={setNewName} style={{ flex: 1, paddingVertical: 8 }} />
            <Input
              placeholder="Precio"
              value={newPrice}
              onChangeText={(t) => setNewPrice(t.replace(/\D/g, ''))}
              keyboardType="numeric"
              style={{ width: 100, paddingVertical: 8 }}
            />
            <Btn
              title="Agregar"
              disabled={!newName.trim()}
              onPress={() =>
                run(() => api.post('/api/products', { name: newName, price: Number(newPrice || 0) }), `${newName} agregado al inventario global.`).then(() => {
                  setNewName('');
                  setNewPrice('');
                })
              }
              style={{ minHeight: 40 }}
            />
          </View>
          <Btn title="Guardar productos" onPress={savePrices} style={{ marginTop: 8 }} />
        </View>

        {/* Inventario por tipo */}
        <View style={[panel, { flexGrow: 2, flexBasis: 360 }]}>
          <Text style={title}>Minibar por tipo de habitación</Text>
          <View style={[s.row, { flexWrap: 'wrap', gap: 6, marginBottom: 6 }]}>
            {ROOM_TYPES.map((t) => (
              <Pressable
                key={t.code}
                onPress={() => setType(t.code)}
                accessibilityRole="tab"
                accessibilityState={{ selected: type === t.code }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: type === t.code ? C.brand : C.line,
                }}
              >
                <TypeBadge type={t.code} />
                <Text style={{ fontSize: 13, color: C.body }}>{t.name}</Text>
              </Pressable>
            ))}
          </View>
          {active.map((p) => (
            <View key={p.id} style={[s.row, { justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.bg }]}>
              <Text style={{ flex: 1, color: (qty[p.id] ?? 0) > 0 ? C.ink : C.faint, fontSize: 14 }}>{p.name}</Text>
              <Stepper value={qty[p.id] ?? 0} onChange={(v) => setQty((q) => ({ ...q, [p.id]: v }))} />
            </View>
          ))}
          <Text style={[s.muted, { marginTop: 6 }]}>Minibar completo: {money(typeTotal)}</Text>
          <Btn
            title={`Guardar minibar ${type}`}
            onPress={() =>
              run(
                () => api.put(`/api/type-inventory/${type}`, { items: active.map((p) => ({ product_id: p.id, quantity: qty[p.id] ?? 0 })) }),
                `Minibar ${type} guardado. Las tablets lo reciben al sincronizar.`
              )
            }
            style={{ marginTop: 6 }}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const panel = { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 16, gap: 4 };
const title = { fontSize: 16, fontWeight: '700' as const, color: C.ink };
