// Documento para el cliente: cómo se integraría Siigo con Market. Mismo estilo de los
// reportes de la app (encabezado azul noche, azul rey, tarjetas redondeadas).
// Uso: node scripts/pdf-siigo.mjs   → docs/Integracion-Siigo-Market.pdf
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'server', 'package.json'));
const PDFDocument = require('pdfkit');

const NAVY = '#0B1640';
const BRAND = '#1E40AF';
const BRAND_SOFT = '#EEF2FE';
const INK = '#0F172A';
const BODY = '#334155';
const MUTED = '#64748B';
const LINE = '#DCE3F1';
const GREEN = '#2E9E5B';
const GREEN_SOFT = '#E9F7EF';
const YELLOW = '#C99A1E';
const YELLOW_SOFT = '#FFF8E1';
const RED = '#B42318';
const RED_SOFT = '#FDECEC';

const out = path.join(root, 'docs', 'Integracion-Siigo-Market.pdf');
fs.mkdirSync(path.dirname(out), { recursive: true });

const doc = new PDFDocument({
  size: 'LETTER',
  margins: { top: 40, bottom: 56, left: 48, right: 48 },
  bufferPages: true,
  info: { Title: 'Integración de Siigo con Market', Author: 'Pirelix', Subject: 'Propuesta de integración con Siigo Nube' },
});
doc.pipe(fs.createWriteStream(out));

const L = doc.page.margins.left;
const W = doc.page.width - L - doc.page.margins.right;
const bottom = () => doc.page.height - doc.page.margins.bottom;

// ---------- Piezas ----------

function header(title, subtitle) {
  doc.rect(0, 0, doc.page.width, 112).fill(NAVY);
  doc.rect(0, 112, doc.page.width, 4).fill(BRAND);
  // Marca de Market: cuadrado azul con una puerta
  doc.roundedRect(L, 30, 34, 34, 8).fill(BRAND);
  doc.roundedRect(L + 11, 38, 12, 19, 2).lineWidth(1.6).strokeColor('#FFFFFF').stroke();
  doc.circle(L + 20, 48, 1.3).fill('#FFFFFF');
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#9FB0DC').text('MARKET · MINIBAR', L + 46, 34, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#FFFFFF').text(title, L + 46, 50, { lineBreak: false });
  doc.font('Helvetica').fontSize(11).fillColor('#C7D3F5').text(subtitle, L + 46, 82, { lineBreak: false });
  // Nombre de la empresa, solo letras
  const w = 170;
  const x = L + W - w;
  doc.font('Helvetica').fontSize(17).fillColor('#FFFFFF').text('SOLUCIONES', x, 36, { width: w, align: 'right', characterSpacing: 1.2, lineBreak: false });
  doc.moveTo(x + 18, 57).lineTo(x + w, 57).lineWidth(0.6).strokeColor('#9FB0DC').stroke();
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor('#C7D3F5').text('CREATIVAS Y TURÍSTICAS S.A.S', x, 61, { width: w, align: 'right', characterSpacing: 0.8, lineBreak: false });
  doc.x = L;
  doc.y = 140;
}

function ensure(h) {
  if (doc.y + h > bottom()) {
    doc.addPage();
    doc.y = 48;
  }
}

function section(number, title) {
  ensure(170);
  const y = doc.y;
  doc.circle(L + 11, y + 10, 11).fill(BRAND);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF').text(String(number), L, y + 4.5, { width: 22, align: 'center', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(title, L + 32, y + 2, { width: W - 32 });
  doc.y = Math.max(doc.y, y + 22) + 8;
}

function para(text, opts = {}) {
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 10.5).fillColor(opts.color ?? BODY);
  ensure(doc.heightOfString(text, { width: opts.width ?? W }) + 6);
  doc.text(text, opts.x ?? L, doc.y, { width: opts.width ?? W, lineGap: 2.5 });
  doc.y += opts.after ?? 8;
}

/** Caja de color con título y texto. Devuelve la altura que ocupó. */
function callout({ title, text, color, soft, x = L, w = W, y = doc.y, draw = true }) {
  const pad = 14;
  doc.font('Helvetica-Bold').fontSize(11.5);
  const th = title ? doc.heightOfString(title, { width: w - pad * 2 - 6 }) : 0;
  doc.font('Helvetica').fontSize(10);
  const bh = doc.heightOfString(text, { width: w - pad * 2 - 6, lineGap: 2 });
  const h = pad * 2 + th + (title ? 5 : 0) + bh;
  if (!draw) return h;
  doc.roundedRect(x, y, w, h, 10).fill(soft);
  doc.rect(x, y + 10, 4, h - 20).fill(color);
  let ty = y + pad;
  if (title) {
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(INK).text(title, x + pad + 6, ty, { width: w - pad * 2 - 6 });
    ty += th + 5;
  }
  doc.font('Helvetica').fontSize(10).fillColor(BODY).text(text, x + pad + 6, ty, { width: w - pad * 2 - 6, lineGap: 2 });
  doc.x = L;
  doc.y = y + h;
  return h;
}

/** Tarjetas lado a lado, todas con la misma altura. */
function cards(items, { cols = items.length, gap = 12 } = {}) {
  const cw = (W - gap * (cols - 1)) / cols;
  for (let start = 0; start < items.length; start += cols) {
    const row = items.slice(start, start + cols);
    const h = Math.max(...row.map((it) => cardHeight(it, cw)));
    ensure(h + 10);
    const y = doc.y;
    row.forEach((it, i) => {
      const x = L + i * (cw + gap);
      doc.roundedRect(x, y, cw, h, 10).lineWidth(1).strokeColor(LINE).stroke();
      doc.roundedRect(x + 14, y + 14, 30, 30, 8).fill(it.soft ?? BRAND_SOFT);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(it.color ?? BRAND).text(it.badge, x + 14, y + 22, { width: 30, align: 'center', lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(it.title, x + 14, y + 54, { width: cw - 28 });
      doc.font('Helvetica').fontSize(9.8).fillColor(BODY).text(it.text, x + 14, doc.y + 4, { width: cw - 28, lineGap: 2 });
    });
    doc.x = L;
    doc.y = y + h + gap;
  }
  doc.y += 2;
}
function cardHeight(it, cw) {
  doc.font('Helvetica-Bold').fontSize(12);
  const th = doc.heightOfString(it.title, { width: cw - 28 });
  doc.font('Helvetica').fontSize(9.8);
  return 54 + th + 4 + doc.heightOfString(it.text, { width: cw - 28, lineGap: 2 }) + 16;
}

/** Flujo en pasos con flechas dibujadas. */
function flow(steps) {
  const gap = 22;
  const cw = (W - gap * (steps.length - 1)) / steps.length;
  doc.font('Helvetica').fontSize(9.4);
  const h = Math.max(...steps.map((s) => 46 + doc.heightOfString(s.text, { width: cw - 20, lineGap: 1.5 }))) + 14;
  ensure(h + 10);
  const y = doc.y;
  steps.forEach((s, i) => {
    const x = L + i * (cw + gap);
    const last = i === steps.length - 1;
    doc.roundedRect(x, y, cw, h, 10).fill(last ? BRAND : BRAND_SOFT);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(last ? '#C7D3F5' : BRAND).text(`PASO ${i + 1}`, x + 10, y + 12, { width: cw - 20, characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(last ? '#FFFFFF' : INK).text(s.title, x + 10, y + 25, { width: cw - 20 });
    doc.font('Helvetica').fontSize(9.4).fillColor(last ? '#E5EBFB' : BODY).text(s.text, x + 10, doc.y + 3, { width: cw - 20, lineGap: 1.5 });
    if (!last) {
      const ax = x + cw + 4;
      const ay = y + h / 2;
      doc.moveTo(ax, ay).lineTo(ax + gap - 10, ay).lineWidth(1.6).strokeColor(BRAND).stroke();
      doc.polygon([ax + gap - 8, ay], [ax + gap - 14, ay - 4.5], [ax + gap - 14, ay + 4.5]).fill(BRAND);
    }
  });
  doc.x = L;
  doc.y = y + h + 14;
}

/** Tabla de dos o tres columnas con encabezado azul claro. */
function table(cols, rows) {
  const pad = 8;
  const head = () => {
    ensure(26);
    const y = doc.y;
    doc.rect(L, y, W, 22).fill(BRAND_SOFT);
    let x = L;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BRAND);
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x + pad, y + 7, { width: c.w * W - pad * 2, lineBreak: false, characterSpacing: 0.4 });
      x += c.w * W;
    }
    doc.y = y + 22;
  };
  head();
  for (const r of rows) {
    const hs = cols.map((c, k) => {
      doc.font(k === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.6);
      return doc.heightOfString(r[k], { width: c.w * W - pad * 2, lineGap: 1.5 });
    });
    const h = Math.max(...hs) + pad * 2;
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = 48;
      head();
    }
    const y = doc.y;
    let x = L;
    cols.forEach((c, k) => {
      doc.font(k === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.6).fillColor(k === 0 ? INK : BODY);
      doc.text(r[k], x + pad, y + pad, { width: c.w * W - pad * 2, lineGap: 1.5 });
      x += c.w * W;
    });
    doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.y = y + h;
  }
  doc.x = L;
  doc.y += 14;
}

/** Lista con viñeta de círculo azul. */
function bullets(items) {
  for (const it of items) {
    const [lead, rest] = Array.isArray(it) ? it : [null, it];
    doc.font('Helvetica').fontSize(10.3);
    const text = lead ? `${lead} ${rest}` : rest;
    ensure(doc.heightOfString(text, { width: W - 18, lineGap: 2 }) + 6);
    const y = doc.y;
    doc.circle(L + 4, y + 6, 2.6).fill(BRAND);
    if (lead) {
      doc.font('Helvetica-Bold').fillColor(INK).text(lead + ' ', L + 16, y, { width: W - 16, continued: true, lineGap: 2 });
      doc.font('Helvetica').fillColor(BODY).text(rest, { lineGap: 2 });
    } else doc.font('Helvetica').fillColor(BODY).text(rest, L + 16, y, { width: W - 16, lineGap: 2 });
    doc.y += 5;
  }
  doc.y += 6;
}

// ---------- Contenido ----------

header('Integración con Siigo', 'Cómo conectar el minibar con la contabilidad del hotel');

// Respuesta corta
{
  const y = doc.y;
  const h = 86;
  doc.roundedRect(L, y, W, h, 12).fill(GREEN_SOFT);
  doc.circle(L + 30, y + h / 2, 17).fill(GREEN);
  doc.moveTo(L + 22, y + h / 2).lineTo(L + 28, y + h / 2 + 6).lineTo(L + 39, y + h / 2 - 7).lineWidth(3).strokeColor('#FFFFFF').stroke();
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text('Sí, hoy es posible integrarlo.', L + 60, y + 16, { width: W - 76 });
  doc.font('Helvetica').fontSize(10.3).fillColor(BODY).text(
    'Siigo tiene una conexión oficial para otros programas (Siigo API). Con ella, cada revisión con consumo genera su factura en Siigo sola, sin botones y sin volver a digitar nada. Y Market lleva el conteo del inventario.',
    L + 60,
    doc.y + 4,
    { width: W - 76, lineGap: 2 }
  );
  doc.y = y + h + 18;
}

callout({
  title: 'Antes de empezar, una pregunta clave',
  text: '¿Cómo se factura hoy el consumo del minibar en el hotel? De esa respuesta depende cómo se conecta Siigo. En el punto 5 explicamos las tres posibilidades.',
  color: YELLOW,
  soft: YELLOW_SOFT,
});
doc.y += 22;

section(1, 'Lo que Market hace hoy');
flow([
  { title: 'Excel de salidas', text: 'Recepción carga las habitaciones que salen y quedan "por revisar".' },
  { title: 'Revisión', text: 'Quien revisa marca en la tablet lo que se consumió, aunque no haya internet.' },
  { title: 'Reporte del día', text: 'Recepción ve en vivo lo consumido, las novedades y el valor.' },
  { title: 'Surtido', text: 'Se repone lo que falta y la habitación vuelve a quedar lista.' },
]);
para('Hoy el consumo queda registrado en Market y en el reporte del día, pero llevarlo a la contabilidad se hace por fuera de la app.', { color: MUTED, size: 10 });

section(2, 'Qué aportaría Siigo');
cards([
  { badge: '$', title: 'Factura automática', text: 'Lo consumido en cada revisión se convierte solo en factura de venta en Siigo. Si se quiere, Siigo la envía a la DIAN.' },
  { badge: 'P', title: 'Productos', text: 'Cada producto del minibar queda enlazado a su código en Siigo, con el mismo nombre y precio.', soft: GREEN_SOFT, color: GREEN },
  { badge: 'B', title: 'Inventario en Market', text: 'Market lleva el conteo de la bodega: lo que sale al surtir se descuenta solo, y cuadra con Siigo.', soft: YELLOW_SOFT, color: YELLOW },
]);

section(3, 'Cómo funcionaría');
flow([
  { title: 'Se revisa', text: 'Como hoy: la tablet registra lo consumido en cada habitación.' },
  { title: 'Se arma la factura', text: 'Market arma la factura con lo consumido: productos, cantidades y precios.' },
  { title: 'Se envía sola', text: 'Sin ningún botón: a los pocos minutos sale automáticamente a Siigo.' },
  { title: 'Siigo factura', text: 'Siigo crea la factura y, si se activa, la envía a la DIAN.' },
]);
bullets([
  ['Sin botones:', 'nadie tiene que enviar nada; cada revisión con consumo genera su factura sola.'],
  ['Tiempo para corregir:', 'la factura espera unos minutos antes de salir, por si recepción necesita corregir la revisión.'],
  ['Sin internet:', 'si el computador de recepción se queda sin internet, las facturas esperan y salen cuando vuelva.'],
  ['Una sola vez:', 'cada consumo se factura una única vez; Siigo tiene una protección para no crear facturas repetidas.'],
  ['Qué no se factura:', 'las revisiones sin consumo, los cambios de producto (vencido o dañado) y las novedades "no reconocido" o "no se acercó a pagar".'],
]);

ensure(250);
para('Qué se conecta con qué', { bold: true, color: INK, size: 12, after: 6 });
table(
  [
    { label: 'En Market', w: 0.3 },
    { label: 'En Siigo', w: 0.22 },
    { label: 'Qué pasaría', w: 0.48 },
  ],
  [
    ['Productos y precios', 'Productos', 'Cada producto queda enlazado a su código de Siigo. Es necesario: Siigo solo factura productos que ya existan allá.'],
    ['Cada revisión con consumo', 'Factura de venta', 'Se genera y se envía sola, según la forma de facturar que el hotel elija (punto 5).'],
    ['Surtido', 'Bodega', 'Market descuenta de su bodega lo que sale al surtir; la factura indica la bodega para que Siigo cuadre.'],
    ['Novedad "no reconocido"', 'Nota crédito', 'Si el huésped no reconoce un consumo ya facturado, se reversa con una nota crédito.'],
    ['No se acercó a pagar (NAP)', 'Según el contador', 'Puede quedar como cuenta por cobrar o como pérdida; lo define el contador.'],
    ['Cambio de producto (vencido o dañado)', 'No se factura', 'Market lo descuenta de su bodega con el motivo. En Siigo, el ajuste de inventario se registra como hoy.'],
  ]
);

section(4, 'El inventario lo lleva Market');
para('Además de facturar, Market lleva el conteo de la bodega del minibar, para saber siempre cuánto hay y qué falta:', { after: 10 });
cards(
  [
    { badge: '+', title: 'Entradas', text: 'Lo que llega del proveedor se suma a la bodega.' },
    { badge: '-', title: 'Salidas al surtir', text: 'Cada habitación surtida descuenta de la bodega sola.', soft: GREEN_SOFT, color: GREEN },
    { badge: '!', title: 'Alertas', text: 'Aviso cuando un producto está por acabarse, y los vencidos o dañados con su motivo.', soft: YELLOW_SOFT, color: YELLOW },
  ]
);

section(5, '¿Cómo se factura hoy el minibar?');
para('Esta es la decisión más importante. Según cómo lo hagan hoy, la integración cambia:', { after: 10 });
{
  const opts = [
    {
      title: 'A. El hotel ya lo factura en otro sistema',
      text: 'Si el consumo ya se cobra y factura desde el sistema hotelero o en recepción, Market no debe facturar: se duplicarían las facturas. En ese caso Siigo solo serviría para el inventario, o no haría falta.',
      color: RED,
      soft: RED_SOFT,
    },
    {
      title: 'B. A nombre de cada huésped',
      text: 'Cada revisión se factura sola a nombre del huésped de esa habitación. Para eso hay que pedir la cédula o NIT y la dirección del huésped, datos que Market hoy no guarda.',
      color: YELLOW,
      soft: YELLOW_SOFT,
    },
    {
      title: 'C. A nombre de "consumidor final"',
      text: 'Cada revisión se factura sola a nombre de "consumidor final", sin pedir datos al huésped. Es lo más sencillo de operar, pero el contador debe confirmar que aplica para el hotel.',
      color: GREEN,
      soft: GREEN_SOFT,
    },
  ];
  for (const o of opts) {
    const h = callout({ ...o, draw: false });
    ensure(h + 10);
    callout(o);
    doc.y += 10;
  }
}
doc.y += 4;

section(6, 'Qué necesita el hotel');
cards(
  [
    { badge: '1', title: 'Siigo Nube con conexión API', text: 'Confirmar con Siigo que el plan del hotel incluye la API.' },
    { badge: '2', title: 'Credenciales', text: 'Se generan en Siigo Nube y nuestro equipo las configura en recepción. No se envían por chat ni correo.' },
    { badge: '3', title: 'Visto bueno del contador', text: 'Elegir la forma de facturar (A, B o C, punto 5) y cómo registrar los NAP.' },
    { badge: '4', title: 'Empresa de prueba', text: 'Probar primero en una empresa de prueba de Siigo, para no facturar nada real mientras se ajusta.' },
  ],
  { cols: 4, gap: 10 }
);

ensure(140);
para('Lo que hay que tener en cuenta', { bold: true, color: INK, size: 12, after: 6 });
bullets([
  ['Límite de envíos:', 'Siigo permite alrededor de 100 envíos por minuto por empresa. Market enviaría pocas facturas al día, así que sobra.'],
  ['Errores:', 'si muchas solicitudes salen con error, Siigo bloquea la conexión por un tiempo. Por eso Market revisará cada factura antes de enviarla.'],
  ['Fecha:', 'las facturas electrónicas no pueden tener fecha anterior al día en que se envían; conviene enviar el mismo día.'],
]);

section(7, 'Próximos pasos');
flow([
  { title: 'Definir', text: 'El hotel y su contador eligen la forma de facturar.' },
  { title: 'Activar', text: 'Se habilita la API en Siigo Nube y se crea la empresa de prueba.' },
  { title: 'Configurar', text: 'Nosotros conectamos Market con Siigo y enlazamos los productos con sus códigos.' },
  { title: 'Probar y salir', text: 'Se prueba con la empresa de prueba y luego se activa en la real.' },
]);

ensure(92);
callout({
  title: 'En resumen',
  text: 'La integración es posible hoy: cada revisión con consumo se factura sola en Siigo, sin botones ni digitación, y Market lleva el conteo de la bodega. Para empezar solo necesitamos saber cómo se factura hoy el minibar y que el plan de Siigo incluya la API.',
  color: BRAND,
  soft: BRAND_SOFT,
});
doc.y += 10;
ensure(24);
doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
  'Fuente: documentación oficial de Siigo API (developers.siigo.com) y guías de integración publicadas. Planes, precios y límites pueden cambiar; confirmar con Siigo.',
  L,
  doc.y,
  { width: W }
);

// Pie de página en todas las hojas
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  doc.page.margins.bottom = 0;
  const y = doc.page.height - 38;
  doc.moveTo(L, y - 8).lineTo(L + W, y - 8).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Market · Desarrollado por Pirelix', L, y, { width: W / 2, lineBreak: false });
  doc.text(`Página ${i + 1} de ${range.count}`, L + W / 2, y, { width: W / 2, align: 'right', lineBreak: false });
}
doc.end();
console.log('PDF:', path.relative(root, out));
