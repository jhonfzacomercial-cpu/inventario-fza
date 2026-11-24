'use strict';
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { data, dataHora, moeda, moedaTotal } = require('../util');

function formatar(col, v) {
  if (col.tipo === 'moeda') return moeda(v);
  if (col.tipo === 'data') return v ? data(v) : '';
  if (col.tipo === 'datahora') return v ? dataHora(v) : '';
  return v === null || v === undefined ? '' : String(v);
}

function formatarResumo(r) {
  if (r.tipo === 'moeda') return moedaTotal(r.valor);
  return String(r.valor);
}

// ---------------- PDF ----------------
function pdf(rel, usuario, saida) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 36, bottom: 40, left: 30, right: 30 }, bufferPages: true,
    info: { Title: `${rel.titulo} — Grupo FZA`, Author: 'Grupo FZA' } });
  doc.pipe(saida);
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  // Cabeçalho
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text(`Grupo FZA — ${rel.titulo}`, L, 36);
  doc.font('Helvetica').fontSize(8.5).fillColor('#4b5563')
    .text(`Gerado em ${dataHora(new Date())} por ${usuario}`, L, doc.y + 2)
    .text(`Filtros: ${rel.filtros}`, L, doc.y + 1, { width: W });
  doc.moveDown(0.6);

  // Resumo
  const boxW = Math.min(170, (W - 8 * (rel.resumo.length - 1)) / rel.resumo.length);
  let bx = L, by = doc.y, maxH = 0;
  for (const r of rel.resumo) {
    if (bx + boxW > L + W + 0.1) { bx = L; by += maxH + 6; maxH = 0; }
    const val = formatarResumo(r);
    doc.font('Helvetica-Bold').fontSize(r.tipo === 'texto' ? 8.5 : 12);
    const hv = doc.heightOfString(val, { width: boxW - 12 });
    doc.font('Helvetica').fontSize(7.5);
    const hl = doc.heightOfString(r.label, { width: boxW - 12 });
    const h = hv + hl + 12;
    doc.roundedRect(bx, by, boxW, h, 3).fillAndStroke('#f3f4f6', '#e5e7eb');
    doc.fillColor('#6b7280').font('Helvetica').fontSize(7.5).text(r.label, bx + 6, by + 5, { width: boxW - 12 });
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(r.tipo === 'texto' ? 8.5 : 12).text(val, bx + 6, by + 6 + hl, { width: boxW - 12 });
    maxH = Math.max(maxH, h);
    bx += boxW + 8;
  }
  doc.y = by + maxH + 12;

  // Tabela
  const soma = rel.colunas.reduce((a, c) => a + (c.peso || 1), 0);
  const cols = rel.colunas.map((c) => ({ ...c, w: (W * (c.peso || 1)) / soma }));
  const FS = 7.5, PADX = 3, PADY = 3;

  const cabecalho = () => {
    let x = L;
    const y = doc.y;
    doc.rect(L, y, W, 16).fill('#111827');
    doc.font('Helvetica-Bold').fontSize(FS).fillColor('#ffffff');
    for (const c of cols) {
      doc.text(c.titulo, x + PADX, y + 4.5, { width: c.w - 2 * PADX, align: c.tipo === 'moeda' ? 'right' : 'left', lineBreak: false, ellipsis: true });
      x += c.w;
    }
    doc.y = y + 16;
  };
  const garantir = (h) => {
    if (doc.y + h > bottom()) { doc.addPage(); doc.y = doc.page.margins.top; cabecalho(); }
  };

  if (!rel.linhas.length) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#6b7280').text('Nenhum registro encontrado para os filtros aplicados.', L, doc.y + 10);
  } else {
    cabecalho();
    let zebra = false;
    for (const linha of rel.linhas) {
      if (linha._tipo === 'grupo') {
        garantir(34);
        const y = doc.y + 4;
        doc.rect(L, y, W, 15).fill('#e5e7eb');
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827').text(linha.texto, L + PADX, y + 3.5, { width: W - 2 * PADX, lineBreak: false });
        doc.y = y + 15; zebra = false;
        continue;
      }
      if (linha._tipo === 'subtotal') {
        garantir(16);
        const y = doc.y;
        doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.8).stroke('#111827');
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text(linha.texto, L + PADX, y + 4, { width: W - 2 * PADX, align: 'right' });
        doc.y = y + 16;
        continue;
      }
      doc.font('Helvetica').fontSize(FS);
      const textos = cols.map((c) => formatar(c, linha[c.key]));
      const h = Math.max(...cols.map((c, i) => doc.font(c.negrito ? 'Helvetica-Bold' : 'Helvetica').heightOfString(textos[i] || ' ', { width: c.w - 2 * PADX }))) + 2 * PADY;
      garantir(h);
      const y = doc.y;
      if (zebra) doc.rect(L, y, W, h).fill('#f9fafb');
      zebra = !zebra;
      let x = L;
      cols.forEach((c, i) => {
        const semValor = c.tipo === 'moeda' && (linha[c.key] === null || linha[c.key] === undefined);
        doc.font(c.negrito ? 'Helvetica-Bold' : semValor ? 'Helvetica-Oblique' : 'Helvetica').fontSize(FS)
          .fillColor(semValor ? '#6b7280' : '#111827')
          .text(textos[i], x + PADX, y + PADY, { width: c.w - 2 * PADX, align: c.tipo === 'moeda' ? 'right' : 'left' });
        x += c.w;
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.3).stroke('#e5e7eb');
      doc.y = y + h;
    }
  }

  // Rodapé com numeração
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const old = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280')
      .text(`Grupo FZA · Inventário patrimonial · ${rel.titulo}`, L, doc.page.height - 26, { width: W / 2, lineBreak: false })
      .text(`Página ${i + 1} de ${range.count}`, L + W / 2, doc.page.height - 26, { width: W / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = old;
  }
  doc.end();
}

// ---------------- XLSX ----------------
async function xlsx(rel, usuario, saida) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grupo FZA — Inventário';
  wb.created = new Date();
  const ws = wb.addWorksheet(rel.titulo.slice(0, 31), { views: [{ state: 'frozen', ySplit: 0 }] });
  const ncol = rel.colunas.length;

  ws.addRow([`Grupo FZA — ${rel.titulo}`]).font = { bold: true, size: 14 };
  ws.addRow([`Gerado em ${dataHora(new Date())} por ${usuario}`]).font = { color: { argb: 'FF6B7280' } };
  ws.addRow([`Filtros: ${rel.filtros}`]).font = { color: { argb: 'FF6B7280' } };
  ws.addRow([]);
  for (const r of rel.resumo) {
    const row = ws.addRow([r.label, r.valor]);
    row.getCell(1).font = { bold: true };
    if (r.tipo === 'moeda') row.getCell(2).numFmt = '"R$" #,##0.00';
    row.getCell(2).alignment = { horizontal: 'left' };
  }
  ws.addRow([]);

  const header = ws.addRow(rel.colunas.map((c) => c.titulo));
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    cell.alignment = { vertical: 'middle' };
  });
  const headerRow = header.number;
  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  for (const linha of rel.linhas) {
    if (linha._tipo === 'grupo' || linha._tipo === 'subtotal') {
      const vals = new Array(ncol).fill(null);
      vals[0] = linha.texto;
      const iv = rel.colunas.findIndex((c) => c.key === 'valor');
      if (linha._tipo === 'subtotal' && iv >= 0) vals[iv] = linha.valor;
      const row = ws.addRow(vals);
      row.font = { bold: true };
      if (linha._tipo === 'grupo') row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }; });
      if (iv >= 0) row.getCell(iv + 1).numFmt = '"R$" #,##0.00';
      continue;
    }
    const row = ws.addRow(rel.colunas.map((c) => {
      const v = linha[c.key];
      if (c.tipo === 'moeda') return v === null || v === undefined ? 'Não informado' : Number(v);
      if (c.tipo === 'data') return v ? new Date(`${v}T12:00:00Z`) : null;
      if (c.tipo === 'datahora') return v ? dataHora(v) : null;
      return v === null || v === undefined ? '' : v;
    }));
    rel.colunas.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.tipo === 'moeda') { cell.numFmt = '"R$" #,##0.00'; cell.alignment = { horizontal: 'right' }; }
      if (c.tipo === 'data') cell.numFmt = 'dd/mm/yyyy';
      if (c.negrito) cell.font = { bold: true };
    });
  }
  rel.colunas.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(10, Math.round((c.peso || 1) * 12));
  });
  if (rel.linhas.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: ncol } };
  const buf = await wb.xlsx.writeBuffer();
  saida.end(Buffer.from(buf));
}

module.exports = { pdf, xlsx, formatar, formatarResumo };
