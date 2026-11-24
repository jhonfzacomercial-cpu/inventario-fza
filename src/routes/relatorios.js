'use strict';
const express = require('express');
const inv = require('../services/inventario');
const rel = require('../services/relatorios');
const exp = require('../services/exportar');
const { hoje } = require('../util');

const router = express.Router();

router.get('/', (req, res) => res.redirect('/relatorios/geral'));

router.get('/:tipo(geral|inventario|setor|categoria|transferencias|baixas)', async (req, res, next) => {
  try {
    const tipo = req.params.tipo;
    const f = inv.lerFiltros(req.query);
    const detalhe = req.query.detalhe === 'resumo' ? 'resumo' : 'completo';
    const r = await rel.montar(tipo, f, { detalhe });
    const formato = req.query.formato;
    const usuario = `${req.user.nome} (${req.user.login})`;
    const nome = `relatorio-${tipo}-${hoje()}`;
    if (formato === 'pdf') {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nome}.pdf"` });
      return exp.pdf(r, usuario, res);
    }
    if (formato === 'xlsx') {
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nome}.xlsx"`,
      });
      return await exp.xlsx(r, usuario, res);
    }
    res.render('relatorios/index', { r, f, tipo, detalhe, TIPOS: rel.TIPOS, usa: rel.FILTROS[tipo], exp, query: req.query });
  } catch (err) { next(err); }
});

module.exports = router;
