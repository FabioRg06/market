// Facturación en Siigo, por detrás (no hay pantalla para esto).
//   npm run siigo -- probar        prueba la conexión con siigo.json y muestra los números
//                                  de Siigo (tipos de factura, vendedores, formas de pago,
//                                  bodegas y productos) para completar el archivo
//   npm run siigo -- estado        cuántas facturas hay enviadas, en espera o con problema
//   npm run siigo -- reintentar    vuelve a intentar las que Siigo rechazó
import fs from 'node:fs';
import { CONFIG_PATH, readConfig, retryRejected, summary, testConnection } from './siigo.js';

const cmd = process.argv[2] ?? 'estado';
const cfg = readConfig();
console.log(`Archivo: ${CONFIG_PATH}${fs.existsSync(CONFIG_PATH) ? '' : '  (no existe: copia server/siigo.ejemplo.json ahí)'}`);
console.log(`Facturación automática: ${cfg.enabled ? 'ACTIVA' : 'apagada'}${cfg.since ? ` · desde ${new Date(cfg.since).toLocaleString('es-CO')}` : ''}\n`);

if (cmd === 'probar') {
  const r = await testConnection();
  if (!r.ok) {
    console.log('No se pudo conectar:', r.error);
    process.exit(1);
  }
  const show = (title, list, fmt) => {
    console.log(title);
    for (const x of list) console.log('  ' + fmt(x));
    if (!list.length) console.log('  (ninguno)');
    console.log('');
  };
  show('tipoFactura (tipos de factura de venta):', r.documents, (d) => `${d.id}  ${d.name}${d.electronic ? '  · electrónica' : ''}`);
  show('vendedor:', r.users, (u) => `${u.id}  ${u.name}`);
  show('formaPago:', r.payments, (p) => `${p.id}  ${p.name}`);
  show('bodega (opcional):', r.warehouses, (w) => `${w.id}  ${w.name}`);
  show('productos en Siigo (código → nombre):', r.products, (p) => `${p.code}  ${p.name}`);
} else if (cmd === 'reintentar') {
  console.log(`${retryRejected()} facturas vuelven a la fila; el servidor las envía en el próximo ciclo.`);
} else {
  const { counts, problems } = summary();
  console.log(`Enviadas: ${counts.sent ?? 0} · En espera: ${counts.pending ?? 0} · Falta configurar: ${counts.setup ?? 0} · Rechazadas: ${counts.error ?? 0}`);
  for (const p of problems) console.log(`  ${p.room_number}  ${p.status === 'setup' ? 'falta configurar' : 'rechazada'}  ${p.error ?? ''}`);
}
