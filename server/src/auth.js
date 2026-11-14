// Usuario y contraseña de recepción.
// La primera vez que se abre recepción se crean; después todo lo de recepción pide sesión.
// Las tablets no entran con esta cuenta: solo usan /api/sync y /api/health, que quedan abiertos
// para que sigan sincronizando solas en la red del hotel.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const getMeta = (key) => db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key)?.value ?? null;
const setMeta = (key, value) =>
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));

const hash = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
function matches(password, stored) {
  const [salt, digest] = String(stored).split(':');
  const a = Buffer.from(digest, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Sesiones abiertas: duran mientras el servidor esté encendido, máximo 16 horas.
const SESSION_MS = 16 * 60 * 60 * 1000;
const sessions = new Map();
function open(user) {
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { user, until: Date.now() + SESSION_MS });
  return token;
}

export const isConfigured = () => !!getMeta('recepcion_pass');

/** Primera vez: crea la cuenta de recepción. */
export function setup(user, password) {
  if (isConfigured()) return { ok: false, error: 'Recepción ya tiene usuario.' };
  const name = String(user ?? '').trim();
  if (name.length < 3) return { ok: false, error: 'El usuario debe tener al menos 3 letras.' };
  if (String(password ?? '').length < 6) return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
  setMeta('recepcion_user', name);
  setMeta('recepcion_pass', hash(String(password)));
  return { ok: true, token: open(name), user: name };
}

// Tras varios intentos fallidos seguidos se hace esperar un minuto.
let failures = 0;
let lockedUntil = 0;

export function login(user, password) {
  if (Date.now() < lockedUntil) return { ok: false, error: 'Demasiados intentos. Espera un minuto.' };
  const name = getMeta('recepcion_user');
  const good =
    isConfigured() &&
    String(user ?? '').trim().toLowerCase() === String(name).toLowerCase() &&
    matches(String(password ?? ''), getMeta('recepcion_pass'));
  if (!good) {
    if (++failures >= 5) {
      failures = 0;
      lockedUntil = Date.now() + 60 * 1000;
    }
    return { ok: false, error: 'Usuario o contraseña incorrectos.' };
  }
  failures = 0;
  return { ok: true, token: open(name), user: name };
}

export function changePassword(token, current, next) {
  const s = session(token);
  if (!s) return { ok: false, error: 'Sesión vencida.' };
  if (!matches(String(current ?? ''), getMeta('recepcion_pass'))) return { ok: false, error: 'La contraseña actual no es correcta.' };
  if (String(next ?? '').length < 6) return { ok: false, error: 'La contraseña nueva debe tener al menos 6 caracteres.' };
  setMeta('recepcion_pass', hash(String(next)));
  return { ok: true };
}

export function session(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.until < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

export const logout = (token) => sessions.delete(token);

const tokenOf = (req) => (req.get('Authorization') ?? '').replace(/^Bearer\s+/i, '') || String(req.query.t ?? '');

/** Todo /api salvo salud, sincronización y el propio inicio de sesión pide sesión de recepción. */
export function guard(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/health' || req.path === '/api/sync' || req.path.startsWith('/api/auth/')) return next();
  // Hasta que se cree la cuenta no hay a quién pedirle sesión.
  if (!isConfigured()) return next();
  if (!session(tokenOf(req))) return res.status(401).json({ error: 'Inicia sesión en recepción.' });
  next();
}

export function routes(app) {
  app.get('/api/auth/status', (req, res) => res.json({ configured: isConfigured(), signedIn: !!session(tokenOf(req)) }));
  app.post('/api/auth/setup', (req, res) => res.json(setup(req.body?.user, req.body?.password)));
  app.post('/api/auth/login', (req, res) => res.json(login(req.body?.user, req.body?.password)));
  app.post('/api/auth/logout', (req, res) => res.json({ ok: logout(tokenOf(req)) }));
  app.post('/api/auth/password', (req, res) => res.json(changePassword(tokenOf(req), req.body?.current, req.body?.next)));
}
