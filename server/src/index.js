import express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPush, pullSince } from './sync.js';
import * as reception from './reception.js';
import { ensureCatalog } from './seed.js';
import { writeCheckoutsPdf, writeDayReportPdf } from './reportPdf.js';
import * as auth from './auth.js';
import * as siigo from './siigo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4000);

ensureCatalog();

const app = express();
// Las fotos de productos y el Excel llegan en base64 dentro del JSON.
app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
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

// Recepción entra con usuario y contraseña; las tablets siguen sincronizando sin cuenta.
app.use(auth.guard);
auth.routes(app);

// `app` permite que las tablets encuentren solas este servidor en la red.
app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'market', time: Date.now() }));

// ---- Sincronización (tablets) ----
app.post('/api/sync', (req, res) => {
  const { deviceId, since = 0, changes } = req.body ?? {};
  applyPush(changes, deviceId);
  res.json(pullSince(Number(since)));
});

// ---- Habitaciones ----
app.get('/api/rooms', (_req, res) => res.json(reception.listRooms()));

app.get('/api/rooms/:id', (req, res) => {
  const detail = reception.roomDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Habitación no encontrada' });
  res.json(detail);
});

app.post('/api/rooms/:id/restock', (req, res) => {
  res.json({ ok: reception.restockRoom(req.params.id, req.body?.by) });
});

app.put('/api/inspections/:id/items', (req, res) => {
  res.json({ ok: reception.setInspectionItems(req.params.id, req.body?.items ?? []) });
});

app.put('/api/rooms/:id/guest', (req, res) => {
  reception.setGuest(req.params.id, req.body ?? {});
  res.json({ ok: true });
});

// ---- Trabajadores ----
app.get('/api/workers', (_req, res) => res.json(reception.workers()));

app.post('/api/workers', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Falta el nombre' });
  res.json({ id: reception.createWorker(name) });
});

app.put('/api/workers/:id', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Falta el nombre' });
  res.json({ ok: reception.updateWorker(req.params.id, { name }) });
});

app.delete('/api/workers/:id', (req, res) => res.json({ ok: reception.deleteWorker(req.params.id) }));

app.put('/api/assign', (req, res) => {
  res.json({ ok: reception.assignRooms(req.body?.worker_id ?? null, req.body?.room_ids ?? []) });
});

app.post('/api/rooms/:id/inspections', (req, res) => {
  const id = reception.createInspection(req.params.id, req.body ?? {});
  if (!id) return res.status(400).json({ error: 'No se pudo registrar' });
  res.json({ id });
});

app.put('/api/inspections/:id/notes', (req, res) => {
  res.json({ ok: reception.setNotes(req.params.id, req.body?.notes ?? null) });
});

app.put('/api/inspections/:id/charge', (req, res) => {
  res.json({ ok: reception.setCharge(req.params.id, req.body?.charge ?? null) });
});

app.put('/api/rooms/:id/type', (req, res) => {
  res.json({ ok: reception.setRoomType(req.params.id, req.body?.type) });
});

// ---- Excel de salidas: marca las habitaciones "por revisar" ----
app.post('/api/import', (req, res) => {
  try {
    const buffer = Buffer.from(String(req.body?.file ?? ''), 'base64');
    if (!buffer.length) return res.status(400).json({ ok: false, error: 'No llegó ningún archivo.' });
    res.json(reception.importSheet(buffer));
  } catch (e) {
    res.status(400).json({ ok: false, error: 'No se pudo leer el archivo. Usa un Excel (.xlsx) o CSV.' });
  }
});

// ---- Reporte del día ----
app.get('/api/report', (req, res) => res.json(reception.dayReport(range(req))));

app.get('/api/analytics', (req, res) => res.json(reception.analytics(range(req))));

app.get('/api/report.pdf', (req, res) => {
  const { from } = range(req);
  const d = new Date(from);
  const name = `reporte-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.pdf`;
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${name}"`);
  writeDayReportPdf(range(req), res);
});

// Lista en PDF de las salidas que hay que revisar ese día, por trabajador.
app.get('/api/salidas.pdf', (req, res) => {
  const { from } = range(req);
  const d = new Date(from);
  const name = `salidas-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.pdf`;
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${name}"`);
  writeCheckoutsPdf(range(req), res);
});

// ---- Inventario global y por tipo ----
app.get('/api/products', (_req, res) => res.json(reception.products()));

app.post('/api/products', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Falta el nombre' });
  res.json({ id: reception.createProduct(name, Number(req.body?.price ?? 0)) });
});

app.put('/api/products/:id', (req, res) => {
  res.json({ ok: reception.updateProduct(req.params.id, req.body ?? {}) });
});

app.get('/api/type-inventory', (_req, res) => res.json(reception.typeInventory()));

app.put('/api/type-inventory/:type', (req, res) => {
  res.json({ ok: reception.setTypeInventory(req.params.type, req.body?.items ?? []) });
});

// ---- Bloques ----
app.get('/api/blocks', (_req, res) => res.json(reception.blocks()));

app.post('/api/blocks', (req, res) => {
  const code = String(req.body?.code ?? '').trim();
  if (!code) return res.status(400).json({ error: 'Falta el código' });
  const id = reception.createBlock(req.body);
  if (!id) return res.status(400).json({ error: 'Ya existe un bloque con ese código' });
  res.json({ id });
});

app.put('/api/blocks/:id', (req, res) => {
  res.json({ ok: reception.updateBlock(req.params.id, req.body ?? {}) });
});

// ---- Vista web (build de la app con `npm run build:web`) ----
const webDir = path.join(__dirname, '..', '..', 'app', 'dist');
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
}

// Facturación en Siigo: corre por detrás según server/data/siigo.json (apagada si no existe).
siigo.start();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nMarket - servidor de recepción en el puerto ${PORT}`);
  console.log(`  En este computador:  http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets ?? [])
      if (n.family === 'IPv4' && !n.internal)
        console.log(`  Para las tablets:    http://${n.address}:${PORT}`);
  if (!fs.existsSync(webDir))
    console.log('\n  (La vista web aún no está compilada: en /app ejecuta `npm run build:web`)');
});
