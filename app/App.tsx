import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startAutoSync } from './src/local/sync';
import { getAnyOpenInspection } from './src/local/db';
import RolePicker, { type Role } from './src/screens/RolePicker';
import RoomList from './src/screens/inspector/RoomList';
import InspectRoom from './src/screens/inspector/InspectRoom';
import ReceptionHome from './src/screens/reception/ReceptionHome';
import SettingsScreen from './src/screens/SettingsScreen';

type Route = { name: 'home' } | { name: 'inspect'; inspectionId: string } | { name: 'settings' };

const ROLE_KEY = 'market.role';

export default function App() {
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>({ name: 'home' });

  useEffect(() => {
    // En el PC de recepción el acceso directo abre con ?rol=recepcion y salta la elección.
    const fromUrl =
      typeof window !== 'undefined' && window.location?.search
        ? new URLSearchParams(window.location.search).get('rol')
        : null;
    if (fromUrl === 'recepcion' || fromUrl === 'revision') AsyncStorage.setItem(ROLE_KEY, fromUrl).catch(() => {});
    AsyncStorage.getItem(ROLE_KEY)
      .then((stored) => {
        const r = fromUrl === 'recepcion' || fromUrl === 'revision' ? fromUrl : stored;
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
