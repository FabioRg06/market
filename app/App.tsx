import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startAutoSync } from './src/local/sync';
import { getAnyOpenInspection } from './src/local/db';
import { Card, C, Screen, s } from './src/ui';
import { DoorGlyph } from './src/icons';
import RoomList from './src/screens/inspector/RoomList';
import InspectRoom from './src/screens/inspector/InspectRoom';
import ReceptionHome from './src/screens/reception/ReceptionHome';
import SettingsScreen from './src/screens/SettingsScreen';

type Role = 'revision' | 'recepcion';
type Route = { name: 'home' } | { name: 'inspect'; inspectionId: string } | { name: 'settings' };

const ROLE_KEY = 'market.role';

export default function App() {
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>({ name: 'home' });

  useEffect(() => {
    AsyncStorage.getItem(ROLE_KEY)
      .then((r) => {
        setRole((r as Role) ?? null);
        // Si la app se cerró con una revisión abierta, se vuelve directo a ella.
        const open = r === 'revision' ? getAnyOpenInspection() : null;
        if (open) setRoute({ name: 'inspect', inspectionId: open.id });
      })
      .catch(() => setRole(null));
  }, []);

  // Solo quien revisa guarda datos locales y los sincroniza.
  useEffect(() => {
    if (role === 'revision') startAutoSync();
  }, [role]);

  function chooseRole(r: Role | null) {
    setRole(r);
    setRoute({ name: 'home' });
    if (r) AsyncStorage.setItem(ROLE_KEY, r).catch(() => {});
    else AsyncStorage.removeItem(ROLE_KEY).catch(() => {});
  }

  let content: React.ReactNode = null;
  if (role === null) content = <RolePicker onPick={chooseRole} />;
  else if (route.name === 'settings')
    content = (
      <SettingsScreen
        onBack={() => setRoute({ name: 'home' })}
        onChangeRole={() => chooseRole(null)}
      />
    );
  else if (role === 'recepcion') content = <ReceptionHome onSettings={() => setRoute({ name: 'settings' })} />;
  else if (role === 'revision')
    content =
      route.name === 'inspect' ? (
        <InspectRoom inspectionId={route.inspectionId} onExit={() => setRoute({ name: 'home' })} />
      ) : (
        <RoomList
          onOpenInspection={(inspectionId) => setRoute({ name: 'inspect', inspectionId })}
          onSettings={() => setRoute({ name: 'settings' })}
        />
      );

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {content}
    </SafeAreaProvider>
  );
}

function RolePicker({ onPick }: { onPick: (r: Role) => void }) {
  const option = (role: Role, title: string, text: string) => (
    <Card onPress={() => onPick(role)} style={{ flexDirection: 'row', gap: 16, alignItems: 'center', padding: 18 }}>
      <DoorGlyph size={28} color={C.body} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: C.ink }}>{title}</Text>
        <Text style={s.muted}>{text}</Text>
      </View>
      <Text style={{ fontSize: 22, color: C.faint }}>›</Text>
    </Card>
  );
  return (
    <Screen style={{ justifyContent: 'center', padding: 20 }}>
      <View style={{ gap: 12, maxWidth: 480, width: '100%', alignSelf: 'center' }}>
        <Text style={{ fontSize: 30, fontWeight: '700', color: C.ink, letterSpacing: -0.8 }}>Market</Text>
        <Text style={[s.muted, { fontSize: 15, marginBottom: 12 }]}>Control de minibar. ¿Cómo vas a usar este dispositivo?</Text>
        {option('revision', 'Revisar habitaciones', 'Marcar lo consumido en cada minibar. Funciona sin señal.')}
        {option('recepcion', 'Recepción', 'Consumos, habitaciones revisadas y surtidas.')}
      </View>
    </Screen>
  );
}
