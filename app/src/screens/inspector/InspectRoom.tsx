// Revisión en curso: lo primero son los productos. Cada toque suma uno, el "−" quita
// por si fue un error. Abajo, fijas, las tres formas de salir: no hay otra.
import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as local from '../../local/db';
import { requestSync } from '../../local/sync';
import type { Inspection, InventoryLine } from '../../types';
import { KIND_LABEL, money, NOVEDAD_TYPES, time } from '../../format';
import { Btn, C, Confirm, Empty, Input, ProductPicture, Receipt, Screen, tabular, TypeBadge } from '../../ui';

/** "31/12/2026" → "2026-12-31" (o null si no es una fecha válida). */
function parseDate(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? `20${m[3]}` : m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

type Ask = null | 'finish' | 'none' | 'cancel' | 'leave';

export default function InspectRoom({ inspectionId, onExit }: { inspectionId: string; onExit: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const phone = width < 600;
  const wide = width >= 960; // tablet horizontal o computador: factura al lado
  const [insp] = useState<Inspection | null>(() => local.getInspection(inspectionId));
  const [room] = useState(() => (insp ? local.getRoom(insp.room_id) : null));
  const [inventory] = useState<InventoryLine[]>(() => (insp ? local.getInventory(insp.room_id).filter((l) => l.quantity > 0) : []));
  const [consumed, setConsumed] = useState<Record<string, number>>(() => (insp ? local.getConsumption(insp.id) : {}));
  const [ask, setAsk] = useState<Ask>(null);
  const [gridW, setGridW] = useState(0);
  // Cambio de producto: motivo y fecha de vencimiento.
  const [reason, setReason] = useState<'vencido' | 'danado'>('vencido');
  const [expiry, setExpiry] = useState('');
  const [expiryError, setExpiryError] = useState(false);
  const isChange = insp?.kind === 'cambio';
  // Novedad: tipo y nota con la descripción.
  const [novedadType, setNovedadType] = useState<'post' | 'no_reconocido' | 'nap'>('post');
  const [note, setNote] = useState('');
  const isNovedad = insp?.kind === 'novedad';

  // El botón "atrás" de Android no saca de la revisión: avisa que hay que terminarla.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setAsk('leave');
      return true;
    });
    // En el navegador, cerrar o recargar la pestaña pide confirmación (la revisión queda guardada).
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    if (Platform.OS === 'web') window.addEventListener('beforeunload', warn);
    return () => {
      sub.remove();
      if (Platform.OS === 'web') window.removeEventListener('beforeunload', warn);
    };
  }, []);

  const change = useCallback(
    (line: InventoryLine, delta: number) => {
      setConsumed((c) => {
        const next = Math.max(0, Math.min(line.quantity, (c[line.product_id] ?? 0) + delta));
        if (next === (c[line.product_id] ?? 0)) return c;
        // En un cambio no se cobra: el producto se reemplaza.
        local.setConsumed(insp!.id, line.product_id, next, insp!.kind === 'cambio' ? 0 : line.price);
        return { ...c, [line.product_id]: next };
      });
    },
    [insp]
  );

  if (!insp || !room) {
    return (
      <Screen>
        <Empty text="Esta revisión ya no existe." />
        <Btn title="Volver" onPress={onExit} style={{ margin: 20 }} />
      </Screen>
    );
  }

  const units = Object.values(consumed).reduce((a, b) => a + b, 0);
  const total = isChange ? 0 : inventory.reduce((sum, l) => sum + (consumed[l.product_id] ?? 0) * l.price, 0);
  const lines = inventory
    .filter((l) => (consumed[l.product_id] ?? 0) > 0)
    .map((l) => ({ product_id: l.product_id, name: l.name, quantity: consumed[l.product_id], unit_price: l.price }));
  // "Sin consumo" solo aplica a la revisión normal; consumo y novedad existen para registrar algo.
  const allowEmpty = insp.kind === 'revision';

  function confirm() {
    const action = ask;
    setAsk(null);
    if (action === 'leave') return setAsk('finish');
    if (action === 'finish' && isChange) {
      const iso = parseDate(expiry);
      if (reason === 'vencido' && !iso) {
        setExpiryError(true);
        return setAsk('finish');
      }
      local.setChangeDetails(insp!.id, reason, iso);
    }
    if (action === 'finish' && isNovedad) local.setInspectionCharge(insp!.id, novedadType);
    if (action === 'finish') local.finishInspection(insp!.id, isNovedad ? note : '');
    if (action === 'none') local.finishWithoutConsumption(insp!.id, '');
    if (action === 'cancel') local.cancelInspection(insp!.id);
    requestSync();
    onExit();
  }

  const pad = phone ? 12 : 20;
  const gap = phone ? 10 : 14;
  // En web la barra de desplazamiento ocupa espacio; en el teléfono va encima.
  const inner = (gridW || width) - pad * 2 - (Platform.OS === 'web' ? 16 : 0);
  const columns = phone ? 2 : Math.max(3, Math.floor((inner + gap) / (200 + gap)));
  const tileW = Math.floor((inner - gap * (columns - 1)) / columns);

  return (
    <Screen>
      <View style={[st.head, { paddingHorizontal: pad }]}>
        <Text style={[st.number, tabular]}>{room.number}</Text>
        <TypeBadge type={room.type} size="md" color={C.onBrandMuted} />
        <View style={{ flex: 1 }}>
          {insp.kind !== 'revision' && <Text style={st.kind}>{KIND_LABEL[insp.kind]}</Text>}
          <Text style={st.guest} numberOfLines={1}>
            {room.guest_name ?? 'Sin huésped'}
          </Text>
          <Text style={st.flight}>
            Vuelo <Text style={[st.flightTime, tabular]}>{room.flight_time ?? '—'}</Text>
          </Text>
        </View>
      </View>

      <View style={{ flex: 1, flexDirection: 'row' }}>
      <ScrollView
        style={{ flex: 1 }}
        onLayout={(e) => setGridW(e.nativeEvent.layout.width)}
        contentContainerStyle={{ padding: pad, flexDirection: 'row', flexWrap: 'wrap', gap }}
      >
        {inventory.length === 0 && <Empty text="Esta habitación no tiene productos en el minibar." />}
        {inventory.map((l) => {
          const q = consumed[l.product_id] ?? 0;
          const full = q >= l.quantity;
          return (
            <Pressable
              key={l.product_id}
              onPress={() => change(l, 1)}
              accessibilityRole="button"
              accessibilityLabel={`${l.name}: ${q} consumidos de ${l.quantity}. Toca para sumar uno.`}
              style={({ pressed }) => [
                st.tile,
                { width: tileW },
                q > 0 && st.tileOn,
                pressed && !full && { transform: [{ scale: 0.98 }] },
              ]}
            >
              <View style={[st.imageBox, phone && { height: 96 }]}>
                <ProductPicture id={l.product_id} image={l.image} size={phone ? 68 : 84} color={q > 0 ? C.ink : C.body} fill shrink={/pequeñ/i.test(l.name) ? 0.62 : 1} />
              </View>
              <Text style={st.name} numberOfLines={2}>
                {l.name}
              </Text>
              <Text style={[st.meta, tabular]}>
                {money(l.price)} · hay {l.quantity}
              </Text>

              {q > 0 && (
                <>
                  <View style={st.badge}>
                    <Text style={[st.badgeText, tabular]}>{q}</Text>
                  </View>
                  <Pressable
                    onPress={() => change(l, -1)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar un ${l.name}`}
                    style={st.minus}
                  >
                    <Text style={st.minusText}>−</Text>
                  </Pressable>
                </>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      {wide && (
        <ScrollView style={st.side} contentContainerStyle={{ padding: 16 }}>
          <Receipt
            title={`Habitación ${room.number}`}
            subtitle={`Entrada ${time(insp.started_at)} · ${insp.inspector}`}
            lines={lines}
          />
        </ScrollView>
      )}
      </View>

      <View style={[st.bar, { paddingHorizontal: pad, paddingBottom: 12 + insets.bottom }]}>
        <View style={[st.summary]}>
          <Text style={st.summaryText}>{units === 0 ? 'Nada marcado' : units === 1 ? '1 producto' : `${units} productos`}</Text>
          <Text style={[st.summaryTotal, tabular]}>{money(total)}</Text>
        </View>
        <View style={[st.actions, phone && { flexDirection: 'column-reverse' }]}>
          <View style={[st.actions, { flex: phone ? undefined : 1 }]}>
            <Btn title="Cancelar" variant="quiet" onPress={() => setAsk('cancel')} style={{ flex: 1 }} />
            {allowEmpty && (
              <Btn title="Sin consumo" variant="secondary" disabled={units > 0} onPress={() => setAsk('none')} style={{ flex: 1 }} />
            )}
          </View>
          <Btn
            title={isChange ? 'Guardar cambio' : insp.kind === 'novedad' ? 'Guardar novedad' : insp.kind === 'consumo' ? 'Guardar consumo' : 'Terminar revisión'}
            disabled={units === 0}
            onPress={() => setAsk('finish')}
            style={{ flex: phone ? undefined : 1 }}
          />
        </View>
      </View>

      <Confirm
        visible={ask === 'leave'}
        title="La revisión sigue abierta"
        message={allowEmpty ? 'Para salir, termínala, márcala sin consumo o cancélala.' : 'Para salir, guárdala o cancélala.'}
        confirmText="Terminar"
        cancelText="Seguir revisando"
        onConfirm={confirm}
        onCancel={() => setAsk(null)}
      />
      <Confirm
        visible={ask === 'finish'}
        title={
          isChange
            ? '¿Guardar el cambio?'
            : insp.kind === 'novedad'
              ? '¿Guardar la novedad?'
              : insp.kind === 'consumo'
                ? '¿Guardar el consumo?'
                : '¿Terminar la revisión?'
        }
        message={
          isChange
            ? `${units} ${units === 1 ? 'producto' : 'productos'} · cambio del ${new Date().toLocaleDateString('es-CO')}`
            : `${units} ${units === 1 ? 'producto' : 'productos'} · ${money(total)}\nEntrada ${time(insp.started_at)} · salida ${time(Date.now())}`
        }
        confirmText={isChange ? 'Guardar cambio' : 'Terminar'}
        cancelText="Volver"
        onConfirm={confirm}
        onCancel={() => setAsk(null)}
      >
        {isNovedad && (
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: C.muted }}>Tipo de novedad</Text>
            {NOVEDAD_TYPES.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setNovedadType(t.key)}
                accessibilityRole="radio"
                accessibilityState={{ checked: novedadType === t.key }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: novedadType === t.key ? C.danger : C.line,
                  backgroundColor: novedadType === t.key ? '#FDECEC' : C.surface,
                }}
              >
                <View
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    borderWidth: 2,
                    borderColor: novedadType === t.key ? C.danger : C.faint,
                    backgroundColor: novedadType === t.key ? C.danger : 'transparent',
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink }}>{t.label}</Text>
                  <Text style={{ fontSize: 12, color: C.muted }}>{t.hint}</Text>
                </View>
              </Pressable>
            ))}
            <Input value={note} onChangeText={setNote} placeholder="Nota: describe la novedad (opcional)" multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
          </View>
        )}
        {isChange && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['vencido', 'danado'] as const).map((r) => (
                <Btn
                  key={r}
                  title={r === 'vencido' ? 'Vencido' : 'Dañado'}
                  variant={reason === r ? 'primary' : 'secondary'}
                  onPress={() => setReason(r)}
                  style={{ flex: 1, minHeight: 40 }}
                />
              ))}
            </View>
            <Input
              value={expiry}
              onChangeText={(t) => {
                setExpiry(t);
                setExpiryError(false);
              }}
              placeholder={reason === 'vencido' ? 'Fecha de vencimiento (dd/mm/aaaa)' : 'Fecha de vencimiento (opcional)'}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            {expiryError && <Text style={{ color: C.danger, fontSize: 13 }}>Escribe la fecha de vencimiento como 31/12/2026.</Text>}
          </View>
        )}
      </Confirm>
      <Confirm
        visible={ask === 'none'}
        title="¿Terminar sin consumo?"
        message="El minibar está completo."
        confirmText="Sin consumo"
        cancelText="Volver"
        onConfirm={confirm}
        onCancel={() => setAsk(null)}
      />
      <Confirm
        visible={ask === 'cancel'}
        title="¿Cancelar la revisión?"
        message="No queda registro de esta entrada."
        confirmText="Cancelar revisión"
        cancelText="Volver"
        onConfirm={confirm}
        onCancel={() => setAsk(null)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
    backgroundColor: C.brand,
  },
  number: { fontSize: 34, fontWeight: '700', color: C.onBrand, letterSpacing: -1 },
  guest: { fontSize: 16, fontWeight: '600', color: C.onBrand },
  flight: { fontSize: 13, color: C.onBrandMuted, marginTop: 2 },
  flightTime: { fontWeight: '600', color: C.onBrand },
  kind: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: '#FFD9D9', marginBottom: 1 },
  side: { width: 340, flexGrow: 0, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: C.line },
  tile: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    padding: 10,
    paddingBottom: 14,
  },
  tileOn: { borderColor: C.brand, borderWidth: 2 },
  imageBox: {
    height: 116,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: C.line,
    padding: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  name: { fontSize: 17, fontWeight: '600', color: C.ink, letterSpacing: -0.2, minHeight: 22 },
  meta: { fontSize: 13, color: C.muted, marginTop: 3 },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 8,
    backgroundColor: C.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  minus: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minusText: { fontSize: 20, lineHeight: 22, color: C.ink },
  bar: {
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
    paddingTop: 12,
    gap: 10,
  },
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  summaryText: { fontSize: 14, color: C.muted },
  summaryTotal: { fontSize: 18, fontWeight: '700', color: C.ink },
  actions: { flexDirection: 'row', gap: 10 },
});
