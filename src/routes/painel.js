'use strict';
const express = require('express');
const { query } = require('../db');
const inv = require('../services/inventario');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const f = inv.lerFiltros({});
    const [totais, porSetor, recentes, baixados] = await Promise.all([
      inv.totais(f),
      inv.totaisPorSetor(f),
      query(`
        SELECT m.tipo, m.data_movimentacao, m.registrado_em, m.responsavel_anterior, m.responsavel_novo,
               e.id AS equipamento_id, e.codigo, e.descricao,
               so.codigo AS origem_codigo, so.nome AS origem_nome, sd.codigo AS destino_codigo, sd.nome AS destino_nome,
               u.nome AS usuario
          FROM movimentacoes m
          JOIN equipamentos e ON e.id = m.equipamento_id
          LEFT JOIN setores so ON so.id = m.setor_origem_id
          LEFT JOIN setores sd ON sd.id = m.setor_destino_id
          JOIN usuarios u ON u.id = m.usuario_id
         ORDER BY m.registrado_em DESC, m.id DESC LIMIT 8`),
      query(`SELECT count(*)::int AS n FROM equipamentos WHERE situacao = 'baixado'`),
    ]);
    res.render('painel', { totais, porSetor, recentes: recentes.rows, baixados: baixados.rows[0].n });
  } catch (err) { next(err); }
});

// Endereço curto da ficha pelo código (ex.: /e/FZA.01.001)
router.get('/e/:codigo', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id FROM equipamentos WHERE codigo = $1', [String(req.params.codigo).toUpperCase()]);
    if (!rows[0]) return res.status(404).render('erro', { titulo: 'Item não encontrado', mensagem: `Nenhum equipamento com o código ${req.params.codigo}.` });
    res.redirect(`/equipamentos/${rows[0].id}`);
  } catch (err) { next(err); }
});

module.exports = router;
