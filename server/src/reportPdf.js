// Reporte del día en PDF: resumen y tablas de revisadas, sin revisar, surtidas y falta surtir.
import PDFDocument from 'pdfkit';
import { dayReport } from './reception.js';

const BRAND = '#1E40AF';
const INK = '#0F172A';
const MUTED = '#64748B';
const LINE = '#DCE3F1';
const KIND = { revision: 'Revisión', consumo: 'Consumo', novedad: 'Novedad', confirmacion: 'Confirmación' };

const money = (v) => '$ ' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const time = (ms) => (ms ? new Date(ms).toLocaleTimeString('es-CO', { hour12: false }) : '—');
const dateText = (ms) =>
  new Date(ms).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Escribe el PDF en `stream` (la respuesta HTTP). */
export function writeDayReportPdf(range, stream) {
  const rep = dayReport(range);
  const doc = new PDFDocument({ size: 'LETTER', margin: 40, info: { Title: 'Reporte del día · Market' } });
  doc.pipe(stream);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  // Encabezado
  doc.rect(0, 0, doc.page.width, 78).fill(BRAND);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('Reporte del día', left, 22);
  doc.font('Helvetica').fontSize(11).fillColor('#C7D3F5').text(`Market · minibar · ${dateText(range.from)}`, left, 48);
  doc.y = 98;

  // Resumen
  const stats = [
    ['Revisadas', rep.counts.revisadas],
    ['Sin revisar', rep.counts.por_revisar],
    ['Surtidas', rep.counts.surtidas],
    ['Falta surtir', rep.counts.por_surtir],
    ['Novedades', rep.counts.novedades],
    ['Consumo', money(rep.counts.total)],
  ];
  const boxW = (width - 5 * 8) / 6;
  const top = doc.y; // misma fila para todas las casillas (doc.text mueve doc.y)
  stats.forEach(([label, value], i) => {
    const x = left + i * (boxW + 8);
    doc.roundedRect(x, top, boxW, 46, 6).lineWidth(1).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, x + 8, top + 8, { width: boxW - 16, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(String(value), x + 8, top + 22, { width: boxW - 16, lineBreak: false });
  });
  doc.y = top + 66;

  function table(title, columns, rows) {
    if (doc.y > bottom() - 80) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(`${title} (${rows.length})`, left, doc.y);
    doc.moveDown(0.4);
    const header = () => {
      let x = left;
      const y = doc.y;
      doc.rect(left, y - 3, width, 16).fill('#EDF1FA');
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
      for (const c of columns) {
        doc.text(c.label, x + 3, y, { width: c.w * width - 6, align: c.align ?? 'left' });
        x += c.w * width;
      }
      doc.y = y + 16;
    };
    header();
    if (!rows.length) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Nada para mostrar.', left + 3, doc.y + 2);
      doc.y += 22;
      return;
    }
    for (const r of rows) {
      doc.font('Helvetica').fontSize(9);
      const h = Math.max(
        14,
        ...columns.map((c, i) => doc.heightOfString(String(r[i] ?? ''), { width: c.w * width - 6 }) + 5)
      );
      if (doc.y + h > bottom()) {
        doc.addPage();
        header();
      }
      let x = left;
      const y = doc.y;
      columns.forEach((c, i) => {
        doc.fillColor(c.color?.(r) ?? INK).text(String(r[i] ?? ''), x + 3, y + 2, { width: c.w * width - 6, align: c.align ?? 'left' });
        x += c.w * width;
      });
      doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + h;
    }
    doc.y += 16;
  }

  table(
    'Revisadas',
    [
      { label: 'Hab.', w: 0.07 },
      { label: 'Tipo', w: 0.06 },
      { label: 'Clase', w: 0.12, color: (r) => (r[2] === 'Novedad' ? '#B42318' : INK) },
      { label: 'Quién', w: 0.11 },
      { label: 'Entrada', w: 0.1 },
      { label: 'Salida', w: 0.1 },
      { label: 'Consumo', w: 0.32 },
      { label: 'Total', w: 0.12, align: 'right' },
    ],
    rep.reviewed.map((i) => [
      i.room_number,
      i.room_type,
      KIND[i.kind] ?? 'Revisión',
      i.inspector,
      time(i.started_at),
      time(i.finished_at),
      i.units ? i.items.map((it) => `${it.quantity} ${it.name}`).join(', ') : 'Sin consumo',
      money(i.total),
    ])
  );
  table(
    'Sin revisar',
    [
      { label: 'Hab.', w: 0.1 },
      { label: 'Bloque', w: 0.12 },
      { label: 'Huésped', w: 0.58 },
      { label: 'Vuelo', w: 0.2 },
    ],
    rep.pendingReview.map((r) => [r.room_number, r.block_code, r.guest_name ?? '—', r.flight_time ?? '—'])
  );
  table(
    'Surtidas',
    [
      { label: 'Hab.', w: 0.1 },
      { label: 'Bloque', w: 0.12 },
      { label: 'Quién surtió', w: 0.53 },
      { label: 'Hora', w: 0.25 },
    ],
    rep.restocked.map((r) => [r.room_number, r.block_code, r.restocked_by ?? '—', time(r.restocked_at)])
  );
  table(
    'Falta surtir',
    [
      { label: 'Hab.', w: 0.1 },
      { label: 'Bloque', w: 0.12 },
      { label: 'Pendiente', w: 0.53 },
      { label: 'Total', w: 0.25, align: 'right' },
    ],
    rep.pendingRestock.map((r) => [r.room_number, r.block_code, r.units ? `${r.units} productos` : 'Sin consumo', money(r.total)])
  );

  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Generado ${new Date().toLocaleString('es-CO', { hour12: false })}`, left, doc.y);
  doc.end();
}
