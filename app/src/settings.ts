// Ajustes del dispositivo: dirección del servidor de recepción, nombre de quien revisa
// y un id único del dispositivo. Se guardan en el propio teléfono / navegador.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { uuid } from './uuid';

export interface Settings {
  serverUrl: string;
  inspectorName: string;
  deviceId: string;
}

const KEY = 'market.settings';

function defaultServerUrl() {
  // En el computador de recepción la página la sirve el mismo servidor
  // (salvo en desarrollo, donde Expo la sirve desde el puerto 8081).
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.port !== '8081')
    return window.location.origin;
  return 'http://localhost:4000';
}

let cache: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  let stored: Partial<Settings> = {};
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {}
  cache = {
    serverUrl: stored.serverUrl || defaultServerUrl(),
    inspectorName: stored.inspectorName ?? '',
    deviceId: stored.deviceId || uuid(),
  };
  if (!stored.deviceId) await saveSettings({});
  return cache;
}

export async function saveSettings(patch: Partial<Settings>) {
  const current = cache ?? (await getSettings());
  cache = { ...current, ...patch, serverUrl: (patch.serverUrl ?? current.serverUrl).trim().replace(/\/+$/, '') };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
  listeners.forEach((l) => l(cache!));
  return cache;
}

export function onSettingsChange(fn: (s: Settings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
