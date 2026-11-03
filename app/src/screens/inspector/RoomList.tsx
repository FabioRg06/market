// Vista de revisión: las habitaciones. Tocar una pregunta si se va a revisar.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import * as local from '../../local/db';
import { requestSync, useSyncState } from '../../local/sync';
import { getSettings } from '../../settings';
import type { RoomRow } from '../../types';
import { money, time } from '../../format';
import RoomGrid from '../../RoomGrid';
import { GearGlyph } from '../../icons';
import { Btn, C, Confirm, Header, Screen } from '../../ui';

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
  const [restocking, setRestocking] = useState<RoomRow | null>(null);
  const [needName, setNeedName] = useState(false);

  const load = useCallback(() => {
    setRooms(local.listRooms());
    setPending(local.pendingRoomIds());
  }, []);
  useEffect(load, [load, sync.version, sync.pending]);

  const onRoomPress = useCallback(
    (room: RoomRow) => {
      const open = local.getAnyOpenInspection();
      if (open) return onOpenInspection(open.id); // hay una revisión sin terminar: primero esa
      if (room.status === 'revisada') return setRestocking(room);
      setAsking(room);
    },
    [onOpenInspection]
  );

  async function startReview(room: RoomRow) {
    setAsking(null);
    setRestocking(null);
    const { inspectorName, deviceId } = await getSettings();
    if (!inspectorName.trim()) return setNeedName(true);
    onOpenInspection(local.startInspection(room.id, inspectorName.trim(), deviceId));
  }

  async function restock() {
    const room = restocking!;
    setRestocking(null);
    const { inspectorName } = await getSettings();
    if (room.last) local.markRestocked(room.last.id, inspectorName || 'Sin nombre');
    requestSync();
    load();
  }

  return (
    <Screen>
      <Header
        eyebrow="Revisión de minibar"
        title="Habitaciones"
        right={
          <Pressable onPress={onSettings} hitSlop={12} accessibilityRole="button" accessibilityLabel="Ajustes">
            <GearGlyph size={22} color={C.body} />
          </Pressable>
        }
      />
      <RoomGrid rooms={rooms} onPress={onRoomPress} pendingIds={pending} />

      <Confirm
        visible={!!asking}
        title={`¿Revisar la habitación ${asking?.number ?? ''}?`}
        message={asking?.guest_name ? `${asking.guest_name}${asking.flight_time ? ` · vuelo ${asking.flight_time}` : ''}` : undefined}
        confirmText="Revisar"
        cancelText="Cancelar"
        onConfirm={() => startReview(asking!)}
        onCancel={() => setAsking(null)}
      />
      <Confirm
        visible={!!restocking}
        title={`¿Ya se surtió la ${restocking?.number ?? ''}?`}
        message={
          restocking?.last
            ? `Se consumieron ${restocking.last.units} productos (${money(restocking.last.total)}). Queda surtida a las ${time(Date.now())}.`
            : ''
        }
        confirmText="Marcar surtida"
        cancelText="Todavía no"
        onConfirm={restock}
        onCancel={() => setRestocking(null)}
      >
        <Btn title="Revisar otra vez" variant="quiet" onPress={() => startReview(restocking!)} />
      </Confirm>
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
