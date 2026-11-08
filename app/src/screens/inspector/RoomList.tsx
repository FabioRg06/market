// Vista de revisión: las habitaciones.
//  · Surtida o por revisar → "¿Revisar la habitación?"
//  · En revisión → vuelve a la revisión abierta.
//  · Revisada → muestra lo que falta y deja confirmar sin consumo, agregar consumo
//    (el huésped sigue), reportar una novedad (el huésped ya se fue) o marcar surtida.
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as local from '../../local/db';
import { requestSync, useSyncState } from '../../local/sync';
import { getSettings } from '../../settings';
import type { InspectionKind, RoomRow } from '../../types';
import { time, TYPE_BY_CODE } from '../../format';
import RoomGrid from '../../RoomGrid';
import { GearGlyph } from '../../icons';
import { Btn, C, Confirm, Receipt, Screen, s, TypeBadge } from '../../ui';

export default function RoomList({
  onOpenInspection,
  onSettings,
}: {
  onOpenInspection: (inspectionId: string) => void;
  onSettings: () => void;
}) {
  const sync = useSyncState();
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<RoomRow | null>(null);
  const [actions, setActions] = useState<RoomRow | null>(null);
  const [needName, setNeedName] = useState(false);
  const [noMinibar, setNoMinibar] = useState<RoomRow | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);

  const load = useCallback(() => {
    setRooms(local.listRooms());
    setPending(local.pendingRoomIds());
  }, []);
  useEffect(load, [load, sync.version, sync.pending]);
  useEffect(() => {
    getSettings().then((st) => setWorkerId(st.workerId));
  }, [sync.version]);

  const onRoomPress = useCallback(
    (room: RoomRow) => {
      const open = local.getAnyOpenInspection();
      if (open) return onOpenInspection(open.id); // hay una revisión sin terminar: primero esa
      if (room.type === 'SM') return setNoMinibar(room);
      if (room.status === 'revisada') return setActions(room);
      setAsking(room);
    },
    [onOpenInspection]
  );

  async function who() {
    const st = await getSettings();
    if (!st.inspectorName.trim()) {
      setNeedName(true);
      return null;
    }
    return st;
  }

  async function start(room: RoomRow, kind: InspectionKind) {
    setAsking(null);
    setActions(null);
    const st = await who();
    if (!st) return;
    onOpenInspection(local.startInspection(room.id, st.inspectorName.trim(), st.deviceId, kind));
  }

  async function confirmEmpty(room: RoomRow) {
    setActions(null);
    const st = await who();
    if (!st) return;
    local.confirmNoConsumption(room.id, st.inspectorName.trim(), st.deviceId);
    requestSync();
    load();
  }

  async function restock(room: RoomRow) {
    setActions(null);
    const st = await getSettings();
    local.restockRoom(room.id, st.inspectorName || 'Sin nombre');
    requestSync();
    load();
  }

  return (
    <Screen>
      <RoomGrid rooms={rooms} onPress={onRoomPress} pendingIds={pending} reserveRight={52} mineWorkerId={workerId} />
      {/* Ajustes: botón flotante en la esquina, por encima de las habitaciones. */}
      <Pressable
        onPress={onSettings}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Ajustes"
        style={({ pressed }) => [st.gear, pressed && { opacity: 0.85 }]}
      >
        <GearGlyph size={22} color={C.onBrand} />
      </Pressable>

      <Confirm
        visible={!!asking}
        title={`¿Revisar la habitación ${asking?.number ?? ''}?`}
        message={
          asking
            ? [
                [asking.guest_name, asking.flight_time && `vuelo ${asking.flight_time}`, TYPE_BY_CODE[asking.type]?.name].filter(Boolean).join(' · '),
                asking.pending_checkout && 'El huésped todavía no ha salido.',
                asking.double_cycle && 'Doble ciclo: se revisa dos veces.',
              ]
                .filter(Boolean)
                .join('\n')
            : undefined
        }
        confirmText="Revisar"
        cancelText="Cancelar"
        onConfirm={() => start(asking!, 'revision')}
        onCancel={() => setAsking(null)}
      >
        <Btn title="Cambio de producto (vencido o dañado)" variant="quiet" onPress={() => start(asking!, 'cambio')} />
      </Confirm>

      <Confirm
        visible={!!noMinibar}
        title={`La ${noMinibar?.number ?? ''} no tiene minibar`}
        message="Está marcada como Sin minibar (SM): no hay nada que revisar."
        confirmText="Entendido"
        cancelText="Cerrar"
        onConfirm={() => setNoMinibar(null)}
        onCancel={() => setNoMinibar(null)}
      />

      <Modal visible={!!actions} transparent animationType="fade" onRequestClose={() => setActions(null)}>
        <Pressable style={st.overlay} onPress={() => setActions(null)}>
          {actions && (
            <Pressable style={st.sheet} onPress={() => {}}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={st.sheetTitle}>Habitación {actions.number}</Text>
                <TypeBadge type={actions.type} size="md" />
              </View>
              <Receipt
                title={actions.units ? 'Lo que falta reponer' : 'Revisada sin consumo'}
                subtitle={`${actions.reviewed_by ?? ''} · ${time(actions.reviewed_at)}`}
                lines={actions.missing}
              />
              {actions.needs_confirm && (
                <Btn title="Confirmar: no consumió nada" onPress={() => confirmEmpty(actions)} />
              )}
              <View style={[s.row, { gap: 8 }]}>
                <Btn title="Agregar consumo" variant="secondary" onPress={() => start(actions, 'consumo')} style={{ flex: 1 }} />
                <Btn title="Reportar novedad" variant="secondary" onPress={() => start(actions, 'novedad')} style={{ flex: 1 }} />
              </View>
              <Text style={st.hint}>Consumo: el huésped sigue en la habitación. Novedad: post, no reconocido o no se acercó a pagar.</Text>
              <Btn title="Cambio de producto (vencido o dañado)" variant="secondary" onPress={() => start(actions, 'cambio')} />
              <Btn title="Marcar surtida" variant={actions.needs_confirm ? 'secondary' : 'primary'} onPress={() => restock(actions)} />
              <Btn title="Cerrar" variant="quiet" onPress={() => setActions(null)} />
            </Pressable>
          )}
        </Pressable>
      </Modal>

      <Confirm
        visible={needName}
        title="Falta tu nombre"
        message="Escríbelo en Ajustes para que quede en cada revisión."
        confirmText="Ir a Ajustes"
        cancelText="Cerrar"
        onConfirm={() => {
          setNeedName(false);
          onSettings();
        }}
        onCancel={() => setNeedName(false)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  gear: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: C.bg, borderRadius: 16, padding: 18, gap: 10, width: '100%', maxWidth: 440, alignSelf: 'center' },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: C.ink },
  hint: { fontSize: 12, color: C.muted, textAlign: 'center' },
});
