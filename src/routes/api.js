'use strict';
// API JSON somente leitura (exige sessão autenticada, como todo o sistema)
const express = require('express');
const { query } = require('../db');
const inv = require('../services/inventario');
const { int } = require('../util');

const router = express.Router();

function publico(e) {
  const { tem_foto, ...resto } = e;
  return { ...resto, valor_aquisicao: e.valor_aquisicao === null ? null : Number(e.valor_aquisicao), foto_url: tem_foto ? `/equipamentos/${e.id}/foto` : null };
}

router.get('/equipamentos', async (req, res, next) => {
  try {
    const f = inv.lerFiltros(req.query);
    const limite = Math.min(500, Math.max(1, int(req.query.limite) || 100));
    const offset = Math.max(0, int(req.query.offset) || 0);
    const [itens, totais] = await Promise.all([inv.listar(f, { limit: limite, offset }), inv.totais(f)]);
    res.json({ totais: { ...totais, valor: Number(totais.valor) }, itens: itens.map(publico) });
  } catch (err) { next(err); }
});

router.get('/equipamentos/:codigo', async (req, res, next) => {
  try {
    const { rows } = await query(`${inv.SELECT_EQUIP} WHERE e.codigo = $1`, [String(req.params.codigo).toUpperCase()]);
    if (!rows[0]) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
    const hist = await query(`SELECT m.tipo, m.data_movimentacao, m.registrado_em, so.codigo AS origem, sd.codigo AS destino,
        m.responsavel_anterior, m.responsavel_novo, m.observacoes, u.login AS usuario
        FROM movimentacoes m LEFT JOIN setores so ON so.id = m.setor_origem_id LEFT JOIN setores sd ON sd.id = m.setor_destino_id
        JOIN usuarios u ON u.id = m.usuario_id WHERE m.equipamento_id = $1 ORDER BY m.registrado_em DESC`, [rows[0].id]);
    res.json({ ...publico(rows[0]), historico: hist.rows });
  } catch (err) { next(err); }
});

router.get('/setores', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, codigo, nome, responsavel, ativo, ultimo_sequencial FROM setores ORDER BY codigo');
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/resumo', async (req, res, next) => {
  try {
    const t = await inv.totais(inv.lerFiltros({}));
    res.json({ itens_ativos: t.quantidade, valor_aquisicao_ativos: Number(t.valor), ativos_sem_valor: t.sem_valor });
  } catch (err) { next(err); }
});

module.exports = router;
