// Deja el hotel como al empezar el día: todo surtido y algunas habitaciones al azar
// "por revisar" (como si se hubiera cargado el Excel de salidas). No borra nada: las
// revisiones viejas quedan en el historial y las tablets reciben el cambio al sincronizar.
// Uso: npm run inicio-dia [cantidad por revisar, por defecto 25]
import { db, nextRev, transaction } from './db.js';
import { ensureCatalog } from './seed.js';
import { setGuest } from './reception.js';

ensureCatalog();

const NAMES = ['Laura Gómez', 'Andrés Restrepo', 'Camila Ríos', 'John Miller', 'Valentina Cruz', 'Santiago Mejía',
  'Sofía Herrera', 'Mateo Vargas', 'Isabella Torres', 'Daniel Ortiz', 'Mariana López', 'Felipe Castro'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pad = (n) => String(n).padStart(2, '0');
const count = Number(process.argv[2] ?? 25);
const now = Date.now();

transaction(() => {
  // Todo lo pendiente queda surtido y nada queda abierto ni por revisar.
  db.prepare(
    `UPDATE inspections SET restocked_at = ?, restocked_by = 'Inicio de día', updated_at = ?, rev = ?
      WHERE finished_at IS NOT NULL AND restocked_at IS NULL`
  ).run(now, now, nextRev());
  // Las revisiones que quedaron abiertas no cuentan: se borran.
  db.exec(`DELETE FROM inspection_items WHERE inspection_id IN (SELECT id FROM inspections WHERE finished_at IS NULL)`);
  db.exec(`DELETE FROM inspections WHERE finished_at IS NULL`);
  for (const { room_id } of db.prepare(`SELECT room_id FROM guests`).all())
    setGuest(room_id, { guest_name: null, flight_time: null, review: false });

  const rooms = db.prepare(`SELECT id FROM rooms ORDER BY RANDOM() LIMIT ?`).all(count);
  for (const { id } of rooms)
    setGuest(id, { guest_name: pick(NAMES), flight_time: `${pad(6 + Math.floor(Math.random() * 16))}:${pick(['00', '15', '30', '45'])}`, review: true });
});

console.log(`Inicio de día listo: todas surtidas y ${count} habitaciones por revisar.`);
