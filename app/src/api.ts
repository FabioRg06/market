// Llamadas al servidor de recepción.
import { getSettings } from './settings';

export async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { serverUrl } = await getSettings();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 10000);
  try {
    const res = await fetch(serverUrl + path, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
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
};
