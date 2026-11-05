// Id único. En el navegador, `crypto.randomUUID` solo existe con HTTPS o localhost; en la
// red del hotel la página se abre por http://<ip>, así que se arma con getRandomValues.
import { getRandomValues } from 'expo-crypto';

export function uuid(): string {
  const b = getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
