// Reporte del día en PDF, con el mismo orden del reporte en papel:
// Sí / No (revisadas y sin revisar), Pendiente (lo que falta surtir), Novedades y el detalle.
import PDFDocument from 'pdfkit';
import { checkouts, dayReport } from './reception.js';

const BRAND = '#1E40AF';
const NAVY = '#0B1640';
const INK = '#0F172A';
const MUTED = '#64748B';
const LINE = '#DCE3F1';
const RED = '#B42318';
const KIND = { revision: 'Revisión', consumo: 'Consumo', novedad: 'Novedad', confirmacion: 'Confirmación', cambio: 'Cambio' };
const CHARGE = { post: 'Post', nap: 'NAP', no_reconocido: 'No reconocido' };

const money = (v) => '$ ' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const time = (ms) => (ms ? new Date(ms).toLocaleTimeString('es-CO', { hour12: false }) : '—');
const dateText = (ms) =>
  new Date(ms).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const itemsText = (items) => items.map((it) => `${it.quantity} ${it.name}`).join(', ');

/** Escribe el PDF en `stream` (la respuesta HTTP). */
export function writeDayReportPdf(range, stream) {
  const rep = dayReport(range);
  const doc = new PDFDocument({ size: 'LETTER', margin: 40, info: { Title: 'Reporte del día · Market' } });
  doc.pipe(stream);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  // Encabezado
  doc.rect(0, 0, doc.page.width, 84).fill(NAVY);
  doc.rect(0, 84, doc.page.width, 4).fill(BRAND);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text('Reporte del día', left, 24, { lineBreak: false });
  doc.font('Helvetica').fontSize(11).fillColor('#C7D3F5').text(dateText(range.from), left, 54, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF').text('MARKET', left, 30, { width, align: 'right', lineBreak: false });

  // Resumen: una fila, todas las casillas a la misma altura.
  const top = 108;
  const stats = [
    ['Sí · revisadas', String(rep.counts.revisadas), INK],
    ['No · sin revisar', String(rep.counts.por_revisar), INK],
    ['Pendiente', String(rep.counts.por_surtir), INK],
    ['Novedades', String(rep.counts.novedades), rep.counts.novedades ? RED : INK],
    ['Consumo', money(rep.counts.total), INK],
  ];
  const gap = 10;
  const boxW = (width - gap * (stats.length - 1)) / stats.length;
  stats.forEach(([label, value, color], i) => {
    const x = left + i * (boxW + gap);
    doc.roundedRect(x, top, boxW, 54, 6).lineWidth(1).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label.toUpperCase(), x + 10, top + 10, { width: boxW - 20, lineBreak: false });
    // La cifra se achica si no cabe en la casilla (p. ej. "$ 1.727.000").
    let size = 17;
    doc.font('Helvetica-Bold');
    while (size > 9 && doc.fontSize(size).widthOfString(value) > boxW - 20) size--;
    doc.fontSize(size).fillColor(color).text(value, x + 10, top + 26 + (17 - size) / 2, { width: boxW - 20, lineBreak: false });
  });
  doc.x = left;
  doc.y = top + 78;

  function heading(text, count) {
    ensure(40);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(text, left, doc.y, { continued: count != null });
    if (count != null) doc.font('Helvetica').fillColor(MUTED).text(`  ${count}`);
    doc.moveTo(left, doc.y + 3).lineTo(left + width, doc.y + 3).lineWidth(1).strokeColor(BRAND).stroke();
    doc.y += 10;
  }

  // Lista "habitación — detalle", como en el papel.
  function list(rows, empty, color = INK) {
    if (!rows.length) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(empty, left, doc.y);
      doc.y += 14;
      return;
    }
    for (const [room, detail, right] of rows) {
      doc.font('Helvetica').fontSize(10);
      const h = Math.max(16, doc.heightOfString(detail, { width: width - 160 }) + 6);
      ensure(h);
      const y = doc.y;
      doc.font('Helvetica-Bold').fillColor(color).text(room, left, y, { width: 70, lineBreak: false });
      doc.font('Helvetica').fillColor(INK).text(detail, left + 76, y, { width: width - 160 });
      if (right) doc.fillColor(MUTED).text(right, left + width - 80, y, { width: 80, align: 'right', lineBreak: false });
      doc.y = y + h;
    }
    doc.y += 10;
  }

  heading('Pendiente por surtir', rep.pendingRestock.length);
  list(
    rep.pendingRestock.map((r) => [r.room_number, r.units ? itemsText(r.missing) : 'Sin consumo', r.units ? money(r.total) : '']),
    'Todo lo revisado está surtido.'
  );

  const novedades = rep.reviewed.filter((i) => i.kind === 'novedad');
  heading('Novedades', novedades.length);
  list(
    novedades.map((i) => [
      i.room_number,
      [`${CHARGE[i.charge] ?? 'Post'} · ${itemsText(i.items) || 'sin consumo'}`, i.notes && `Nota: ${i.notes}`].filter(Boolean).join('\n'),
      time(i.finished_at),
    ]),
    'Sin novedades.',
    RED
  );

  const charged = rep.reviewed.filter((i) => i.charge && i.kind !== 'novedad');
  if (charged.length) {
    heading('Cobros', charged.length);
    list(
      charged.map((i) => [i.room_number, `${CHARGE[i.charge]} · ${itemsText(i.items) || 'sin consumo'}`, money(i.total)]),
      '',
      RED
    );
  }

  heading('Cambios de producto', rep.changes.length);
  list(
    rep.changes.map((i) => [
      i.room_number,
      i.items.map((it) => `${it.quantity} ${it.name} · ${it.reason === 'danado' ? 'dañado' : 'vencido'}${it.expires_on ? ` (vence ${it.expires_on})` : ''}`).join(', '),
      time(i.finished_at),
    ]),
    'Sin cambios.'
  );

  heading('Sin revisar', rep.pendingReview.length);
  list(
    rep.pendingReview.map((r) => [
      r.room_number,
      [r.guest_name ?? '—', r.worker_name && `asignada a ${r.worker_name}`, r.pending_checkout && 'pendiente por salir'].filter(Boolean).join(' · '),
      r.flight_time ? `vuelo ${r.flight_time}` : '',
    ]),
    'No quedan habitaciones por revisar.'
  );

  // Detalle de revisiones
  heading('Revisiones del día', rep.reviewed.length);
  const cols = [
    { label: 'Hab.', w: 0.09 },
    { label: 'Clase', w: 0.12 },
    { label: 'Quién', w: 0.13 },
    { label: 'Entrada', w: 0.11 },
    { label: 'Salida', w: 0.11 },
    { label: 'Consumo', w: 0.32 },
    { label: 'Total', w: 0.12, align: 'right' },
  ];
  const header = () => {
    ensure(20);
    const y = doc.y;
    doc.rect(left, y - 3, width, 17).fill('#EDF1FA');
    let x = left;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x + 4, y + 1, { width: c.w * width - 8, align: c.align ?? 'left', lineBreak: false });
      x += c.w * width;
    }
    doc.y = y + 18;
  };
  if (!rep.reviewed.length) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Nadie ha revisado habitaciones este día.', left, doc.y);
  } else {
    header();
    for (const i of rep.reviewed) {
      const cells = [
        i.room_number,
        [KIND[i.kind] ?? 'Revisión', CHARGE[i.charge]].filter(Boolean).join(' · '),
        i.inspector,
        time(i.started_at),
        time(i.finished_at),
        i.units ? itemsText(i.items) : 'Sin consumo',
        money(i.total),
      ];
      doc.font('Helvetica').fontSize(9);
      const h = Math.max(16, ...cols.map((c, k) => doc.heightOfString(String(cells[k]), { width: c.w * width - 8 }) + 6));
      if (doc.y + h > bottom()) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      let x = left;
      cols.forEach((c, k) => {
        doc.fillColor(k === 1 && i.kind === 'novedad' ? RED : INK).text(String(cells[k]), x + 4, y + 3, { width: c.w * width - 8, align: c.align ?? 'left' });
        x += c.w * width;
      });
      doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + h;
    }
  }

  doc.y += 16;
  ensure(20);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Generado ${new Date().toLocaleString('es-CO', { hour12: false })}`, left, doc.y);
  doc.end();
}

/** Reporte de salidas: todas las habitaciones que salen ese día, en orden, con casilla para marcar. */
export function writeCheckoutsPdf(range, stream) {
  const rooms = checkouts(range);
  const doc = new PDFDocument({ size: 'LETTER', margin: 40, info: { Title: 'Reporte de salidas · Market' } });
  doc.pipe(stream);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  doc.rect(0, 0, doc.page.width, 84).fill(NAVY);
  doc.rect(0, 84, doc.page.width, 4).fill(BRAND);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text('Reporte de salidas', left, 24, { lineBreak: false });
  doc.font('Helvetica').fontSize(11).fillColor('#C7D3F5').text(dateText(range.from), left, 54, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF').text(`${rooms.length} habitaciones`, left, 30, { width, align: 'right', lineBreak: false });
  doc.x = left;
  doc.y = 108;

  if (!rooms.length) {
    doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('No hay salidas para revisar este día.', left, doc.y);
    doc.end();
    return;
  }

  const cols = [
    { label: '', w: 0.05 },
    { label: 'Hab.', w: 0.1 },
    { label: 'Tipo', w: 0.07 },
    { label: 'Huésped', w: 0.3 },
    { label: 'Vuelo', w: 0.1 },
    { label: 'Observaciones', w: 0.38 },
  ];
  const header = () => {
    const y = doc.y;
    doc.rect(left, y - 3, width, 17).fill('#EDF1FA');
    let x = left;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x + 4, y + 1, { width: c.w * width - 8, lineBreak: false });
      x += c.w * width;
    }
    doc.y = y + 18;
  };

  header();
  {
    for (const r of rooms) {
      const notes = [
        r.status === 'revisada' ? 'Ya revisada' : r.status === 'surtida' ? 'Ya surtida' : null,
        r.pending_checkout && 'Pendiente por salir',
        r.double_cycle && 'Doble ciclo',
      ].filter(Boolean).join(' · ');
      const cells = [null, r.number, r.type, r.guest_name ?? '—', r.flight_time ?? '—', notes];
      doc.font('Helvetica').fontSize(10);
      const h = Math.max(20, ...cols.map((c, k) => (cells[k] ? doc.heightOfString(String(cells[k]), { width: c.w * width - 8 }) + 8 : 0)));
      if (doc.y + h > bottom()) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      let x = left;
      cols.forEach((c, k) => {
        if (k === 0) doc.rect(x + 6, y + 4, 11, 11).lineWidth(1).strokeColor(MUTED).stroke();
        else
          doc
            .font(k === 1 ? 'Helvetica-Bold' : 'Helvetica')
            .fillColor(k === 5 ? MUTED : INK)
            .text(String(cells[k]), x + 4, y + 5, { width: c.w * width - 8 });
        x += c.w * width;
      });
      doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + h;
    }
    doc.y += 16;
  }
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Generado ${new Date().toLocaleString('es-CO', { hour12: false })}`, left, Math.min(doc.y, bottom() - 12));
  doc.end();
}
