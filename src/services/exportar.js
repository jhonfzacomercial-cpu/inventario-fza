'use strict';
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { data, dataHora, moeda, moedaTotal } = require('../util');

const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

function formatar(col, v) {
  if (col.tipo === 'moeda') return moeda(v);
  if (col.tipo === 'data') return v ? data(v) : '';
  if (col.tipo === 'datahora') return v ? dataHora(v) : '';
  if (col.tipo === 'pct') return v === null || v === undefined ? '' : pct.format(v);
  if (col.tipo === 'numero') return v === null || v === undefined ? '' : String(v);
  return v === null || v === undefined ? '' : String(v);
}
function formatarResumo(r) {
  if (r.tipo === 'moeda') return moedaTotal(r.valor);
  return String(r.valor);
}
const direita = (c) => ['moeda', 'numero', 'pct'].includes(c.tipo);

// ---------------- PDF ----------------
function pdf(rel, usuario, saida) {
  const doc = new PDFDocument({
    size: 'A4', layout: 'landscape', margins: { top: 36, bottom: 40, left: 30, right: 30 }, bufferPages: true,
    info: { Title: `${rel.titulo} — Grupo FZA`, Author: 'Grupo FZA' },
  });
  doc.pipe(saida);
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const novaPagina = () => { doc.addPage(); doc.y = doc.page.margins.top; };

  // Cabeçalho
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text(`Grupo FZA — ${rel.titulo}`, L, 36);
  doc.font('Helvetica').fontSize(8.5).fillColor('#4b5563')
    .text(`Gerado em ${dataHora(new Date())} por ${usuario}`, L, doc.y + 2)
    .text(`Filtros: ${rel.filtros}`, L, doc.y + 1, { width: W });
  doc.moveDown(0.6);

  // Quadros de resumo (até 5 por linha)
  const porLinha = Math.min(5, rel.resumo.length || 1);
  const boxW = (W - 8 * (porLinha - 1)) / porLinha;
  let bx = L, by = doc.y, maxH = 0, n = 0;
  for (const r of rel.resumo) {
    if (n && n % porLinha === 0) { bx = L; by += maxH + 6; maxH = 0; }
    const val = formatarResumo(r);
    doc.font('Helvetica').fontSize(7.5);
    const hl = doc.heightOfString(r.label, { width: boxW - 12 });
    const h = hl + 26;
    doc.roundedRect(bx, by, boxW, h, 3).fillAndStroke('#f3f4f6', '#e5e7eb');
    doc.fillColor('#6b7280').font('Helvetica').fontSize(7.5).text(r.label, bx + 6, by + 5, { width: boxW - 12 });
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text(val, bx + 6, by + 7 + hl, { width: boxW - 12, lineBreak: false });
    maxH = Math.max(maxH, h);
    bx += boxW + 8; n++;
  }
  doc.y = by + maxH + 14;

  const FS = 7.5, PADX = 3, PADY = 3;
  for (const sec of rel.secoes) {
    const soma = sec.colunas.reduce((a, c) => a + (c.peso || 1), 0);
    // Tabelas de resumo ocupam no máximo 70% da largura
    const largura = sec.grande ? W : Math.min(W, W * 0.72);
    const cols = sec.colunas.map((c) => ({ ...c, w: (largura * (c.peso || 1)) / soma }));

    const cabecalho = () => {
      let x = L;
      const y = doc.y;
      doc.rect(L, y, largura, 16).fill('#111827');
      doc.font('Helvetica-Bold').fontSize(FS).fillColor('#ffffff');
      for (const c of cols) {
        doc.text(c.titulo, x + PADX, y + 4.5, { width: c.w - 2 * PADX, align: direita(c) ? 'right' : 'left', lineBreak: false, ellipsis: true });
        x += c.w;
      }
      doc.y = y + 16;
    };
    const garantir = (h) => { if (doc.y + h > bottom()) { novaPagina(); cabecalho(); } };

    // Título da seção (lista grande começa em página nova se faltar espaço)
    if (doc.y + (sec.grande ? 120 : 70) > bottom()) novaPagina();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1f3a8a').text(sec.titulo, L, doc.y);
    doc.y += 4;

    if (!sec.linhas.length) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6b7280').text('Nenhum registro.', L, doc.y + 2);
      doc.y += 16;
      continue;
    }
    cabecalho();
    let zebra = false;
    for (const linha of sec.linhas) {
      if (linha._tipo === 'grupo') {
        garantir(34);
        const y = doc.y + 4;
        doc.rect(L, y, largura, 15).fill('#e5e7eb');
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827').text(linha.texto, L + PADX, y + 3.5, { width: largura - 2 * PADX, lineBreak: false });
        doc.y = y + 15; zebra = false;
        continue;
      }
      if (linha._tipo === 'subtotal') {
        garantir(16);
        const y = doc.y;
        doc.moveTo(L, y).lineTo(L + largura, y).lineWidth(0.8).stroke('#111827');
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text(linha.texto, L + PADX, y + 4, { width: largura - 2 * PADX, align: 'right' });
        doc.y = y + 16;
        continue;
      }
      const total = linha._tipo === 'total';
      const textos = cols.map((c) => formatar(c, linha[c.key]));
      const h = Math.max(...cols.map((c, i) => doc.font(c.negrito || total ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS)
        .heightOfString(textos[i] || ' ', { width: c.w - 2 * PADX }))) + 2 * PADY;
      garantir(h);
      const y = doc.y;
      if (total) { doc.moveTo(L, y).lineTo(L + largura, y).lineWidth(0.8).stroke('#111827'); doc.rect(L, y, largura, h).fill('#f3f4f6'); }
      else if (zebra) doc.rect(L, y, largura, h).fill('#f9fafb');
      zebra = !zebra;
      let x = L;
      cols.forEach((c, i) => {
        const semValor = c.tipo === 'moeda' && (linha[c.key] === null || linha[c.key] === undefined);
        doc.font(c.negrito || total ? 'Helvetica-Bold' : semValor ? 'Helvetica-Oblique' : 'Helvetica').fontSize(FS)
          .fillColor(semValor || linha._baixado ? '#6b7280' : '#111827')
          .text(textos[i], x + PADX, y + PADY, { width: c.w - 2 * PADX, align: direita(c) ? 'right' : 'left' });
        x += c.w;
      });
      doc.moveTo(L, y + h).lineTo(L + largura, y + h).lineWidth(0.3).stroke('#e5e7eb');
      doc.y = y + h;
    }
    doc.y += 16;
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
const FMT_MOEDA = '"R$" #,##0.00';

function escreverTabela(ws, sec) {
  const header = ws.addRow(sec.colunas.map((c) => c.titulo));
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
  });
  const iv = sec.colunas.findIndex((c) => c.key === 'valor');
  for (const linha of sec.linhas) {
    if (linha._tipo === 'grupo' || linha._tipo === 'subtotal') {
      const vals = new Array(sec.colunas.length).fill(null);
      vals[0] = linha.texto;
      if (linha._tipo === 'subtotal' && iv >= 0) vals[iv] = linha.valor;
      const row = ws.addRow(vals);
      row.font = { bold: true };
      if (linha._tipo === 'grupo') row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }; });
      if (iv >= 0) row.getCell(iv + 1).numFmt = FMT_MOEDA;
      continue;
    }
    const row = ws.addRow(sec.colunas.map((c) => {
      const v = linha[c.key];
      if (c.tipo === 'moeda') return v === null || v === undefined ? 'Não informado' : Number(v);
      if (c.tipo === 'data') return v ? new Date(`${v}T12:00:00Z`) : null;
      if (c.tipo === 'datahora') return v ? dataHora(v) : null;
      if (c.tipo === 'pct' || c.tipo === 'numero') return v === null || v === undefined ? null : Number(v);
      return v === null || v === undefined ? '' : v;
    }));
    sec.colunas.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.tipo === 'moeda') { cell.numFmt = FMT_MOEDA; cell.alignment = { horizontal: 'right' }; }
      if (c.tipo === 'pct') cell.numFmt = '0.0%';
      if (c.tipo === 'data') cell.numFmt = 'dd/mm/yyyy';
      if (c.negrito) cell.font = { bold: true };
    });
    if (linha._tipo === 'total') row.font = { bold: true };
  }
  return header.number;
}

function larguras(ws, colunas, min = 10) {
  colunas.forEach((c, i) => {
    const atual = ws.getColumn(i + 1).width || 0;
    ws.getColumn(i + 1).width = Math.max(atual, min, Math.round((c.peso || 1) * 12));
  });
}

async function xlsx(rel, usuario, saida) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grupo FZA — Inventário';
  wb.created = new Date();
  const nomes = new Set();
  const nomeAba = (n) => {
    let base = n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), nome = base, i = 2;
    while (nomes.has(nome)) nome = `${base.slice(0, 28)} ${i++}`;
    nomes.add(nome);
    return nome;
  };

  // Aba "Resumo": cabeçalho, quadros e as tabelas pequenas
  const ws = wb.addWorksheet(nomeAba('Resumo'));
  ws.addRow([`Grupo FZA — ${rel.titulo}`]).font = { bold: true, size: 14 };
  ws.addRow([`Gerado em ${dataHora(new Date())} por ${usuario}`]).font = { color: { argb: 'FF6B7280' } };
  ws.addRow([`Filtros: ${rel.filtros}`]).font = { color: { argb: 'FF6B7280' } };
  ws.addRow([]);
  for (const r of rel.resumo) {
    const row = ws.addRow([r.label, r.valor]);
    row.getCell(1).font = { bold: true };
    if (r.tipo === 'moeda') row.getCell(2).numFmt = FMT_MOEDA;
    row.getCell(2).alignment = { horizontal: 'right' };
  }
  ws.getColumn(1).width = 42;
  ws.getColumn(2).width = 18;

  for (const sec of rel.secoes) {
    if (sec.grande) {
      const aba = wb.addWorksheet(nomeAba(sec.aba || sec.titulo));
      aba.addRow([sec.titulo]).font = { bold: true, size: 12 };
      const h = escreverTabela(aba, sec);
      aba.views = [{ state: 'frozen', ySplit: h }];
      if (sec.linhas.length) aba.autoFilter = { from: { row: h, column: 1 }, to: { row: h, column: sec.colunas.length } };
      larguras(aba, sec.colunas);
    } else {
      ws.addRow([]);
      ws.addRow([sec.titulo]).font = { bold: true, size: 12, color: { argb: 'FF1F3A8A' } };
      if (!sec.linhas.length) { ws.addRow(['Nenhum registro.']).font = { italic: true }; continue; }
      escreverTabela(ws, sec);
      larguras(ws, sec.colunas, 12);
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  saida.end(Buffer.from(buf));
}

module.exports = { pdf, xlsx, formatar, formatarResumo, direita };
