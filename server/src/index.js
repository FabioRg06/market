import express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPush, pullSince } from './sync.js';
import * as reception from './reception.js';
import { ensureCatalog } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4000);

ensureCatalog();

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Rango de un día: el cliente manda from/to en milisegundos (su día local).
function range(req) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const from = Number(req.query.from ?? start);
  const to = Number(req.query.to ?? from + 24 * 60 * 60 * 1000);
  return { from, to };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

// ---- Sincronización (teléfonos) ----
app.post('/api/sync', (req, res) => {
  const { deviceId, since = 0, changes } = req.body ?? {};
  applyPush(changes, deviceId);
  res.json(pullSince(Number(since)));
});

// ---- Recepción ----
app.get('/api/rooms', (req, res) => res.json(reception.listRooms(range(req))));

app.get('/api/rooms/:id', (req, res) => {
  const detail = reception.roomDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Habitación no encontrada' });
  res.json(detail);
});

app.get('/api/day', (req, res) => res.json(reception.daySummary(range(req))));

app.post('/api/inspections/:id/restock', (req, res) => {
  const ok = reception.markRestocked(req.params.id, req.body?.by);
  res.json({ ok });
});

app.put('/api/rooms/:id/guest', (req, res) => {
  reception.setGuest(req.params.id, req.body?.guest_name, req.body?.flight_time);
  res.json({ ok: true });
});

// ---- Productos (lista fija: solo se ajusta precio y cantidad estándar) ----
app.get('/api/products', (_req, res) => res.json(reception.products()));

app.put('/api/products/:id', (req, res) => {
  res.json({ ok: reception.updateProduct(req.params.id, req.body ?? {}) });
});

// ---- Vista web de recepción (build de la app con `npm run build:web`) ----
const webDir = path.join(__dirname, '..', '..', 'app', 'dist');
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nMarket - servidor de recepción en el puerto ${PORT}`);
  console.log(`  En este computador:  http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets ?? [])
      if (n.family === 'IPv4' && !n.internal)
        console.log(`  Para los teléfonos:  http://${n.address}:${PORT}`);
  if (!fs.existsSync(webDir))
    console.log('\n  (La vista web aún no está compilada: en /app ejecuta `npm run build:web`)');
});
