// Datos de prueba: huéspedes con vuelo y revisiones de hoy y de ayer en varios estados.
// Uso: npm run demo   (con el servidor apagado o encendido, da igual)
import { randomUUID } from 'node:crypto';
import { db, nextRev, transaction } from './db.js';
import { ensureCatalog, catalog } from './seed.js';
import { setGuest } from './reception.js';

ensureCatalog();

const NAMES = ['Laura Gómez', 'Andrés Restrepo', 'Camila Ríos', 'John Miller', 'Valentina Cruz', 'Santiago Mejía',
  'Sofía Herrera', 'Mateo Vargas', 'Isabella Torres', 'Daniel Ortiz', 'Mariana López', 'Felipe Castro',
  'Emma Wilson', 'Juan Pablo Ruiz', 'Natalia Pérez', 'Carlos Duarte', 'Ana María Silva', 'Lucas Fernández'];
const INSPECTORS = ['María', 'Yuliana', 'Sandra', 'Kelly'];
const H = 3600e3;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pad = (n) => String(n).padStart(2, '0');

const prices = Object.fromEntries(db.prepare(`SELECT id, price FROM products`).all().map((p) => [p.id, p.price]));
const insertInsp = db.prepare(
  `INSERT INTO inspections (id, room_id, inspector, device_id, started_at, finished_at, restocked_at, restocked_by, updated_at, rev)
   VALUES (?, ?, ?, 'demo', ?, ?, ?, ?, ?, ?)`
);
const insertItem = db.prepare(
  `INSERT INTO inspection_items (id, inspection_id, product_id, quantity, unit_price, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

function inspection(roomId, startedAtRaw, { open = false, consumed = 0, restocked = false } = {}) {
  const id = randomUUID();
  const startedAt = Math.round(startedAtRaw);
  const finished = open ? null : Math.round(startedAt + (4 + Math.random() * 8) * 60e3);
  insertInsp.run(id, roomId, pick(INSPECTORS), startedAt, finished,
    restocked ? finished + 30 * 60e3 : null, restocked ? pick(INSPECTORS) : null, Date.now(), nextRev());
  const products = [...catalog.products].sort(() => Math.random() - 0.5).slice(0, consumed);
  for (const p of products)
    insertItem.run(`${id}:${p.id}`, id, p.id, 1 + (Math.random() < 0.3 ? 1 : 0), prices[p.id], Date.now(), nextRev());
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const t0 = today.getTime();
const nowH = Math.max(1, (Date.now() - t0) / H);

transaction(() => {
  const roomIds = db.prepare(`SELECT id FROM rooms ORDER BY CAST(number AS INTEGER)`).all().map((r) => r.id);
  roomIds.forEach((roomId, i) => {
    if (Math.random() < 0.55) {
      const hour = 5 + Math.floor(Math.random() * 18);
      setGuest(roomId, pick(NAMES), `${pad(hour)}:${pick(['00', '15', '30', '45'])}`);
    }
    if (i % 3 === 0) inspection(roomId, t0 - 24 * H + Math.random() * 10 * H, { consumed: i % 2 ? 2 : 0, restocked: true });
    const roll = Math.random();
    const at = t0 + Math.random() * nowH * 0.9 * H;
    if (roll < 0.04) inspection(roomId, Date.now() - 5 * 60e3, { open: true });
    else if (roll < 0.22) inspection(roomId, at, { consumed: 1 + Math.floor(Math.random() * 3) });
    else if (roll < 0.36) inspection(roomId, at, { consumed: 2, restocked: true });
    else if (roll < 0.5) inspection(roomId, at);
  });
});

console.log('Datos de prueba cargados: huéspedes, vuelos y revisiones de hoy y ayer.');
