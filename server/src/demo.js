// Datos de prueba para el flujo del día: tipos de habitación, salidas "por revisar"
// (como si se hubiera cargado el Excel), revisadas con y sin consumo, novedades y surtidas.
// Uso: npm run demo   (conviene después de `npm run reset`)
import { randomUUID } from 'node:crypto';
import { db, nextRev, transaction } from './db.js';
import { ensureCatalog, catalog } from './seed.js';
import { setGuest, setRoomType } from './reception.js';

ensureCatalog();

const NAMES = ['Laura Gómez', 'Andrés Restrepo', 'Camila Ríos', 'John Miller', 'Valentina Cruz', 'Santiago Mejía',
  'Sofía Herrera', 'Mateo Vargas', 'Isabella Torres', 'Daniel Ortiz', 'Mariana López', 'Felipe Castro',
  'Emma Wilson', 'Juan Pablo Ruiz', 'Natalia Pérez', 'Carlos Duarte', 'Ana María Silva', 'Lucas Fernández'];
const INSPECTORS = ['María', 'Yuliana', 'Sandra', 'Kelly'];
const TYPE_WEIGHTS = [['CM', 0.6], ['SS', 0.15], ['SM', 0.12], ['PR', 0.05], ['VIP', 0.08]];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pad = (n) => String(n).padStart(2, '0');
const MIN = 60e3;

function randomType() {
  let r = Math.random();
  for (const [t, w] of TYPE_WEIGHTS) if ((r -= w) <= 0) return t;
  return 'CM';
}

const prices = Object.fromEntries(db.prepare(`SELECT id, price FROM products`).all().map((p) => [p.id, p.price]));
const insertInsp = db.prepare(
  `INSERT INTO inspections (id, room_id, inspector, device_id, kind, started_at, finished_at, restocked_at, restocked_by, updated_at, rev)
   VALUES (?, ?, ?, 'demo', ?, ?, ?, ?, ?, ?, ?)`
);
const insertItem = db.prepare(
  `INSERT INTO inspection_items (id, inspection_id, product_id, quantity, unit_price, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

function inspection(roomId, type, startedAt, { kind = 'revision', consumed = 0, restockedAt = null } = {}) {
  const id = randomUUID();
  const started = Math.round(startedAt);
  const finished = Math.round(started + (3 + Math.random() * 9) * MIN + Math.random() * 59e3);
  insertInsp.run(id, roomId, pick(INSPECTORS), kind, started, finished, restockedAt, restockedAt ? pick(INSPECTORS) : null, Date.now(), nextRev());
  const available = Object.keys(catalog.typeInventory[type] ?? {});
  for (const productId of available.sort(() => Math.random() - 0.5).slice(0, consumed))
    insertItem.run(`${id}:${productId}`, id, productId, 1, prices[productId], Date.now(), nextRev());
  return finished;
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const t0 = today.getTime();
const now = Date.now();
const elapsed = Math.max(60 * MIN, now - t0);

transaction(() => {
  const rooms = db.prepare(`SELECT id FROM rooms ORDER BY CAST(number AS INTEGER)`).all();
  for (const { id } of rooms) {
    const type = randomType();
    setRoomType(id, type);
    if (Math.random() > 0.45) continue; // el resto queda surtida, como amanece el hotel
    // Salida del día: llegó en el Excel → por revisar.
    const hour = 5 + Math.floor(Math.random() * 18);
    setGuest(id, { guest_name: pick(NAMES), flight_time: `${pad(hour)}:${pick(['00', '15', '30', '45'])}`, review: true });
    // El Excel se "cargó" temprano; las revisiones vienen después.
    const reviewAt = Math.round(now - elapsed * 0.8);
    db.prepare(`UPDATE guests SET review_at = ? WHERE room_id = ?`).run(reviewAt, id);
    const roll = Math.random();
    if (roll < 0.35) continue; // sigue por revisar
    const start = reviewAt + Math.random() * Math.max(0, now - reviewAt - 60 * MIN);
    if (roll < 0.6) {
      inspection(id, type, start, { consumed: 1 + Math.floor(Math.random() * 3) }); // revisada, falta surtir
    } else if (roll < 0.72) {
      inspection(id, type, start, { consumed: 0 }); // sin consumo: falta confirmar
    } else if (roll < 0.8) {
      const end = inspection(id, type, start, { consumed: 0 });
      inspection(id, type, end + 20 * MIN, { kind: 'novedad', consumed: 1 }); // novedad al confirmar
    } else {
      const end = inspection(id, type, start, { consumed: 1 + Math.floor(Math.random() * 2), restockedAt: null });
      db.prepare(`UPDATE inspections SET restocked_at = ?, restocked_by = ? WHERE room_id = ? AND restocked_at IS NULL`).run(
        Math.min(now, end + 25 * MIN), pick(INSPECTORS), id
      ); // ya surtida
    }
  }
});

console.log('Datos de prueba cargados: tipos, salidas por revisar, revisadas, novedades y surtidas.');
