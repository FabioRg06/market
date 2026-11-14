// Facturación automática en Siigo Nube.
//
// Cada revisión terminada que tenga consumo se convierte en una factura de venta en Siigo,
// sola, sin botón: el servidor de recepción revisa cada 30 segundos y envía lo que esté listo.
//   · Se espera 2 minutos desde que se terminó o se corrigió la revisión, para que recepción
//     alcance a corregirla antes de facturar.
//   · No se factura: el cambio de producto (no se cobra) ni las novedades "no reconocido" y
//     "no se acercó a pagar" (el consumo ya se contó en la revisión).
//   · Antes de enviar se comprueba que todo esté configurado (tipo de factura, vendedor, forma
//     de pago, cliente y el código de Siigo de cada producto). Si falta algo, la factura queda
//     "por configurar" y no se envía: Siigo bloquea el acceso si recibe muchas solicitudes con
//     error, así que solo se le manda lo que está completo.
//   · Si no hay internet o Siigo no responde, se reintenta más tarde. Cada factura lleva un
//     "Idempotency-Key" (el id de la revisión), así un reintento nunca crea una factura repetida.
//   · Solo se facturan las revisiones terminadas después de activar la facturación.
//
// La configuración NO está en la pantalla de recepción: se hace por detrás, en el archivo
// siigo.json junto a la base de datos (server/data/siigo.json; en el PC instalado,
// %LOCALAPPDATA%Marketserverdatasiigo.json). Ver server/siigo.ejemplo.json.
// Para probar la conexión y ver los números de Siigo: npm run siigo -- probar
// Documentación: https://developers.siigo.com/docs/siigoapi
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, db } from './db.js';

const BASE = (process.env.SIIGO_URL ?? 'https://api.siigo.com').replace(/\/$/, '');
const PARTNER_ID = 'MarketMinibar';
const WAIT_MS = Number(process.env.SIIGO_WAIT_MS ?? 2 * 60 * 1000);
const TICK_MS = Number(process.env.SIIGO_TICK_MS ?? 30 * 1000);
const PER_TICK = 20;
const KIND_LABEL = { revision: 'Revisión', consumo: 'Consumo', novedad: 'Novedad' };

// ---------- Configuración (archivo siigo.json, por detrás) ----------

export const CONFIG_PATH = path.join(dataDir, 'siigo.json');

// Nombres en el archivo → nombres internos.
const KEYS = {
  activo: 'enabled',
  usuario: 'username',
  accessKey: 'accessKey',
  tipoFactura: 'documentId',
  vendedor: 'sellerId',
  formaPago: 'paymentId',
  bodega: 'warehouseId',
  cliente: 'customer',
  enviarDian: 'stamp',
  preciosConImpuestos: 'taxedPrice',
  productos: 'codes',
};
const DEFAULTS = {
  enabled: false,
  username: '',
  accessKey: '',
  documentId: null,
  sellerId: null,
  paymentId: null,
  warehouseId: null,
  customer: '222222222222', // consumidor final
  stamp: false, // enviar a la DIAN como factura electrónica
  taxedPrice: true, // los precios del minibar ya incluyen impuestos
  codes: {}, // id del producto en Market → código en Siigo
};

let fileError = null;
export function readConfig() {
  let raw = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    fileError = null;
  } catch (e) {
    if (fileError !== e.message) console.error(`Siigo: no se pudo leer ${CONFIG_PATH}: ${e.message}`);
    fileError = e.message;
    return { ...DEFAULTS };
  }
  const cfg = { ...DEFAULTS };
  for (const [k, v] of Object.entries(raw)) if (KEYS[k]) cfg[KEYS[k]] = v;
  cfg.customer = String(cfg.customer ?? '').replace(/D/g, '');
  // Desde cuándo se factura: la primera vez que se encuentra activo (no se factura el historial).
  const meta = db.prepare(`SELECT value FROM meta WHERE key = 'siigo_since'`);
  let since = Number(meta.get()?.value) || null;
  if (cfg.enabled && !since) {
    since = Date.now();
    db.prepare(`INSERT INTO meta (key, value) VALUES ('siigo_since', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(since));
  }
  cfg.since = since;
  // Si cambiaron las credenciales, se pide un permiso nuevo.
  const who = `${cfg.username}:${cfg.accessKey}`;
  if (who !== lastWho) {
    token = null;
    lastWho = who;
  }
  return cfg;
}
let lastWho = '';

// ---------- Conexión ----------

let token = null;
let tokenUntil = 0;

class SiigoError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function siigoMessage(body, fallback) {
  const e = body?.Errors?.[0] ?? body?.errors?.[0];
  return e?.Message ?? e?.message ?? body?.message ?? fallback;
}

async function authenticate(cfg) {
  if (token && tokenUntil > Date.now() + 60_000) return token;
  if (!cfg.username || !cfg.accessKey) throw new SiigoError('Faltan el usuario API y la Access Key de Siigo.', 400);
  const res = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Partner-Id': PARTNER_ID },
    body: JSON.stringify({ username: cfg.username, access_key: cfg.accessKey }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token)
    throw new SiigoError(res.status === 401 || res.status === 400 ? 'Siigo no aceptó el usuario API o la Access Key.' : siigoMessage(body, `Siigo respondió ${res.status}`), res.status);
  token = body.access_token;
  tokenUntil = Date.now() + (Number(body.expires_in) || 86400) * 1000;
  return token;
}

async function call(cfg, method, path, payload, extraHeaders = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await authenticate(cfg);
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Partner-Id': PARTNER_ID, Authorization: `Bearer ${t}`, ...extraHeaders },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    // Token vencido: se pide otro una vez.
    if (res.status === 401 && attempt === 0) {
      token = null;
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new SiigoError(siigoMessage(body, `Siigo respondió ${res.status}`), res.status);
    return body;
  }
}

const listOf = (b) => (Array.isArray(b) ? b : Array.isArray(b?.results) ? b.results : []);

/** Prueba la conexión y trae los números para configurar (tipos de factura, vendedores…). */
export async function testConnection() {
  const cfg = readConfig();
  try {
    token = null;
    await authenticate(cfg);
    const safe = (p) => p.then(listOf).catch(() => []);
    const [documents, users, payments, warehouses, products] = await Promise.all([
      safe(call(cfg, 'GET', '/v1/document-types?type=FV')),
      safe(call(cfg, 'GET', '/v1/users?page_size=100')),
      safe(call(cfg, 'GET', '/v1/payment-types?document_type=FV')),
      safe(call(cfg, 'GET', '/v1/warehouses')),
      safe(call(cfg, 'GET', '/v1/products?page_size=100')),
    ]);
    return {
      ok: true,
      documents: documents.map((d) => ({ id: d.id, name: [d.code, d.name].filter(Boolean).join(' · '), electronic: !!d.electronic_type })),
      users: users.map((u) => ({ id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id) })),
      payments: payments.filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name })),
      warehouses: warehouses.filter((w) => w.active !== false).map((w) => ({ id: w.id, name: w.name })),
      products: products.filter((p) => p.active !== false).map((p) => ({ code: p.code, name: p.name })),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------- Qué se factura ----------

function billable(i) {
  if (!['revision', 'consumo', 'novedad'].includes(i.kind)) return false;
  if (i.kind === 'novedad' && (i.charge === 'nap' || i.charge === 'no_reconocido')) return false;
  return true;
}

function linesOf(inspectionId, codes = readConfig().codes) {
  const rows = db
    .prepare(
      `SELECT ii.product_id, p.name, ii.quantity, ii.unit_price, ii.updated_at
         FROM inspection_items ii JOIN products p ON p.id = ii.product_id
        WHERE ii.inspection_id = ? AND ii.quantity > 0 AND ii.unit_price > 0 ORDER BY p.sort`
    )
    .all(inspectionId);
  return rows.map((r) => ({ ...r, siigo_code: codes?.[r.product_id] ? String(codes[r.product_id]) : null }));
}

/** Pone en la fila las revisiones nuevas con consumo. */
function enqueue(cfg) {
  const fresh = db
    .prepare(
      `SELECT i.* FROM inspections i LEFT JOIN siigo_invoices s ON s.inspection_id = i.id
        WHERE s.inspection_id IS NULL AND i.finished_at IS NOT NULL AND i.finished_at >= ?`
    )
    .all(cfg.since ?? Number.MAX_SAFE_INTEGER);
  const ins = db.prepare(`INSERT INTO siigo_invoices (inspection_id, status, total, created_at, updated_at) VALUES (?, 'pending', ?, ?, ?)`);
  const now = Date.now();
  for (const i of fresh) {
    if (!billable(i)) continue;
    const lines = linesOf(i.id, cfg.codes);
    if (!lines.length) continue; // sin consumo no hay factura
    ins.run(i.id, lines.reduce((t, l) => t + l.quantity * l.unit_price, 0), now, now);
  }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function missingSetup(cfg, lines) {
  const miss = [];
  if (!cfg.username || !cfg.accessKey) miss.push('usuario API y Access Key');
  if (!cfg.documentId) miss.push('tipo de factura');
  if (!cfg.sellerId) miss.push('vendedor');
  if (!cfg.paymentId) miss.push('forma de pago');
  if (!cfg.customer) miss.push('cliente');
  const noCode = lines.filter((l) => !l.siigo_code).map((l) => l.name);
  if (noCode.length) miss.push(`código de Siigo de ${noCode.join(', ')}`);
  return miss;
}

/** Arma la factura de una revisión. */
function invoiceFor(cfg, i, lines) {
  const total = lines.reduce((t, l) => t + l.quantity * l.unit_price, 0);
  const when = new Date(i.finished_at).toLocaleString('es-CO', { hour12: false });
  return {
    total,
    body: {
      document: { id: cfg.documentId },
      date: today(),
      customer: { identification: cfg.customer, branch_office: 0 },
      seller: cfg.sellerId,
      stamp: { send: !!cfg.stamp },
      mail: { send: false },
      observations: [`Minibar · Habitación ${i.room_number} · ${KIND_LABEL[i.kind] ?? 'Revisión'} de ${i.inspector} · ${when}`, i.notes]
        .filter(Boolean)
        .join('\n')
        .slice(0, 4000),
      items: lines.map((l) => ({
        code: l.siigo_code,
        description: l.name,
        quantity: l.quantity,
        ...(cfg.taxedPrice ? { taxed_price: l.unit_price } : { price: l.unit_price }),
        ...(cfg.warehouseId ? { warehouse: cfg.warehouseId } : {}),
      })),
      payments: [{ id: cfg.paymentId, value: total, due_date: today() }],
    },
  };
}

// Siigo pide un identificador sin guiones de máximo 30 caracteres.
const idempotencyKey = (id) => id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 30);

async function sendOne(cfg, row) {
  const i = db
    .prepare(`SELECT i.*, r.number AS room_number FROM inspections i JOIN rooms r ON r.id = i.room_id WHERE i.id = ?`)
    .get(row.inspection_id);
  const set = db.prepare(
    `UPDATE siigo_invoices SET status = ?, total = ?, attempts = ?, next_try = ?, error = ?, siigo_id = ?, siigo_name = ?, sent_at = ?, updated_at = ? WHERE inspection_id = ?`
  );
  const now = Date.now();
  const lines = i ? linesOf(i.id, cfg.codes) : [];
  if (!i || !billable(i) || !lines.length) {
    // La corrigieron y ya no tiene consumo que facturar.
    db.prepare(`DELETE FROM siigo_invoices WHERE inspection_id = ?`).run(row.inspection_id);
    return;
  }
  // Se espera a que la revisión quede quieta: recepción puede corregirla unos minutos.
  // (Solo cuenta lo consumido: surtir también toca la revisión y no cambia la factura.)
  const changed = Math.max(i.finished_at ?? 0, ...lines.map((l) => l.updated_at ?? 0));
  if (now - changed < WAIT_MS) {
    set.run('pending', row.total, row.attempts, changed + WAIT_MS, null, null, null, null, now, row.inspection_id);
    return;
  }
  const miss = missingSetup(cfg, lines);
  if (miss.length) {
    set.run('setup', row.total, row.attempts, 0, `Falta configurar: ${miss.join('; ')}.`, null, null, null, now, row.inspection_id);
    return;
  }
  const { body, total } = invoiceFor(cfg, i, lines);
  try {
    const res = await call(cfg, 'POST', '/v1/invoices', body, { 'Idempotency-Key': idempotencyKey(i.id) });
    set.run('sent', total, row.attempts + 1, 0, null, res?.id ?? null, res?.name ?? null, Date.now(), Date.now(), row.inspection_id);
  } catch (e) {
    const attempts = row.attempts + 1;
    // Sin conexión, Siigo saturado o caído: se vuelve a intentar más tarde, cada vez más espaciado.
    const transient = !e.status || e.status === 408 || e.status === 429 || e.status >= 500;
    if (transient) {
      const wait = Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.min(attempts, 6));
      set.run('pending', total, attempts, Date.now() + wait, `Sin respuesta de Siigo (${e.message}). Se reintenta sola.`, null, null, null, Date.now(), row.inspection_id);
    } else {
      // Siigo la rechazó: no se reintenta sola, para no acumular errores.
      set.run('error', total, attempts, 0, e.message, null, null, null, Date.now(), row.inspection_id);
    }
  }
}

let running = false;
let lastMtime = 0;
export async function tick() {
  if (running) return;
  running = true;
  try {
    const cfg = readConfig();
    if (!cfg.enabled) return;
    // Si alguien corrigió siigo.json, las rechazadas vuelven a intentarse con lo nuevo.
    const mtime = fs.existsSync(CONFIG_PATH) ? fs.statSync(CONFIG_PATH).mtimeMs : 0;
    if (lastMtime && mtime !== lastMtime) retryRejected();
    lastMtime = mtime;
    enqueue(cfg);
    const due = db
      .prepare(`SELECT * FROM siigo_invoices WHERE status IN ('pending', 'setup') AND next_try <= ? ORDER BY created_at LIMIT ?`)
      .all(Date.now(), PER_TICK);
    for (const row of due) {
      await sendOne(cfg, row);
      await new Promise((r) => setTimeout(r, 700)); // muy por debajo del límite de Siigo
    }
  } catch (e) {
    console.error('Siigo:', e.message);
  } finally {
    running = false;
  }
}

export function start() {
  setInterval(tick, TICK_MS);
  setTimeout(tick, 5000);
}

// ---------- Por detrás (npm run siigo) ----------

/** Resumen de la fila de facturas, para revisar desde la consola. */
export function summary() {
  const counts = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) AS n FROM siigo_invoices GROUP BY status`).all().map((r) => [r.status, r.n]));
  const problems = db
    .prepare(
      `SELECT s.status, s.error, s.total, r.number AS room_number, i.finished_at FROM siigo_invoices s
         JOIN inspections i ON i.id = s.inspection_id JOIN rooms r ON r.id = i.room_id
        WHERE s.status IN ('setup', 'error') ORDER BY s.created_at DESC LIMIT 50`
    )
    .all();
  return { counts, problems };
}

/** Vuelve a poner en la fila las rechazadas (después de corregir la configuración). */
export function retryRejected() {
  return db.prepare(`UPDATE siigo_invoices SET status = 'pending', next_try = 0, error = NULL, updated_at = ? WHERE status = 'error'`).run(Date.now()).changes;
}
