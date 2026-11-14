// Llamadas al servidor de recepción.
import { Platform } from 'react-native';
import { getSettings } from './settings';

// Sesión de recepción: el servidor la pide en todo menos sincronizar. En el navegador se
// guarda mientras la ventana esté abierta, para que recargar no saque al usuario.
const KEY = 'market.sesion';
let token: string | null = null;
try {
  if (Platform.OS === 'web') token = window.sessionStorage.getItem(KEY);
} catch {}
const listeners = new Set<() => void>();

export const session = {
  get token() {
    return token;
  },
  set(next: string | null) {
    token = next;
    try {
      if (Platform.OS === 'web') next ? window.sessionStorage.setItem(KEY, next) : window.sessionStorage.removeItem(KEY);
    } catch {}
    listeners.forEach((fn) => fn());
  },
  /** Avisa cuando la sesión cambia (entró, salió o el servidor la dio por vencida). */
  onChange(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** Para abrir un PDF en otra ventana: ahí no viaja la cabecera, la sesión va en la dirección. */
export const withSession = (url: string) => (token ? `${url}${url.includes('?') ? '&' : '?'}t=${token}` : url);

export async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { serverUrl } = await getSettings();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 10000);
  try {
    const res = await fetch(serverUrl + path, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
    });
    if (res.status === 401) {
      session.set(null);
      throw new Error('La sesión venció. Vuelve a entrar.');
    }
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
    return (await res.json()) as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Sin respuesta del servidor');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
