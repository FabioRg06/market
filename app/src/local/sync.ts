// Motor de sincronización: cada vez que hay red (y cada 20 s) manda al servidor lo
// pendiente y trae lo nuevo. Si no hay red no pasa nada: los datos esperan en el teléfono.
import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { api } from '../api';
import { getSettings } from '../settings';
import { discoverServer } from '../discovery';
import type { SyncPayload } from '../types';
import * as local from './db';

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSync: number | null;
  error: string | null;
  /** Sube cada vez que llegan datos nuevos, para refrescar pantallas. */
  version: number;
}

let state: SyncState = { online: false, syncing: false, pending: 0, lastSync: null, error: null, version: 0 };
const listeners = new Set<(s: SyncState) => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function useSyncState() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

export async function syncNow(): Promise<boolean> {
  if (!local.localDbAvailable || state.syncing) return false;
  setState({ syncing: true, pending: local.pendingCount() });
  try {
    const { deviceId } = await getSettings();
    const changes = local.getDirty();
    const since = Number(local.getMeta('last_rev') ?? 0);
    const data = await api.post<SyncPayload>('/api/sync', { deviceId, since, changes });
    local.markClean(changes);
    local.applyPull(data);
    setState({ online: true, lastSync: Date.now(), error: null, version: state.version + 1 });
    return true;
  } catch (err: any) {
    setState({ online: false, error: err?.message ?? 'Error de conexión' });
    lookForServer();
    return false;
  } finally {
    setState({ syncing: false, pending: local.pendingCount() });
  }
}

// Si no se llega al servidor, se busca solo en la red (como mucho una vez por minuto).
let lastLook = 0;
function lookForServer() {
  if (Date.now() - lastLook < 60000) return;
  lastLook = Date.now();
  discoverServer().then((url) => {
    if (url) syncNow();
  });
}

let debounce: ReturnType<typeof setTimeout> | null = null;

/** Llamar después de guardar algo: intenta enviarlo en cuanto se pueda. */
export function requestSync() {
  setState({ pending: local.pendingCount() });
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(syncNow, 800);
}

let started = false;

export function startAutoSync() {
  if (started || !local.localDbAvailable) return;
  started = true;
  setState({ pending: local.pendingCount() });
  NetInfo.addEventListener((net) => {
    if (net.isConnected) syncNow();
    else setState({ online: false });
  });
  setInterval(syncNow, 20000);
  syncNow();
}
