// Encontrar el servidor de recepción sin escribir ninguna dirección: la tablet mira su
// propia IP en el wifi (p. ej. 192.168.1.37) y pregunta a las demás de esa red
// (192.168.1.1 … 254) en el puerto 4000 si alguna es Market.
import { Platform } from 'react-native';
import * as Network from 'expo-network';
import { getSettings, saveSettings } from './settings';

const PORT = 4000;

async function isMarket(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    const body = await res.json();
    return body?.app === 'market';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let running: Promise<string | null> | null = null;

/** Busca el servidor en la red local; si lo encuentra, queda guardado en Ajustes. */
export function discoverServer(): Promise<string | null> {
  if (Platform.OS === 'web') return Promise.resolve(null); // en el navegador ya lo sirve el propio servidor
  running ??= (async () => {
    try {
      const { serverUrl } = await getSettings();
      if (await isMarket(serverUrl, 1500)) return serverUrl;
      const ip = await Network.getIpAddressAsync();
      const m = ip?.match(/^(\d+\.\d+\.\d+)\.(\d+)$/);
      if (!m) return null;
      const prefix = m[1];
      const hosts = Array.from({ length: 254 }, (_, i) => i + 1).filter((h) => String(h) !== m[2]);
      // De a 32 a la vez, cada una con poco tiempo de espera: unos segundos en total.
      for (let i = 0; i < hosts.length; i += 32) {
        const batch = hosts.slice(i, i + 32).map((h) => `http://${prefix}.${h}:${PORT}`);
        const found = await Promise.all(batch.map(async (url) => ((await isMarket(url, 900)) ? url : null)));
        const url = found.find(Boolean);
        if (url) {
          await saveSettings({ serverUrl: url });
          return url;
        }
      }
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
}
