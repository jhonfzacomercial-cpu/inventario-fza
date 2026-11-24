'use strict';
const express = require('express');
const { query } = require('../db');
const { texto, int } = require('../util');

const router = express.Router();

function flash(req, tipo, msg) { req.session.flash = { tipo, msg }; }

async function dados() {
  const [setores, categorias] = await Promise.all([
    query(`SELECT s.*, (SELECT count(*) FROM equipamentos e WHERE e.setor_id = s.id AND e.situacao <> 'baixado')::int AS ativos,
                  (SELECT count(*) FROM equipamentos e WHERE e.setor_origem_id = s.id)::int AS emitidos
             FROM setores s ORDER BY s.codigo`),
    query(`SELECT c.*, (SELECT count(*) FROM equipamentos e WHERE e.categoria_id = c.id)::int AS itens FROM categorias c ORDER BY c.nome`),
  ]);
  return { setores: setores.rows, categorias: categorias.rows };
}

router.get('/', async (req, res, next) => {
  try {
    res.render('setores/index', { ...(await dados()), erros: [], form: {}, editar: int(req.query.editar) });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const codigo = String(req.body.codigo || '').trim().padStart(2, '0');
    const nome = texto(req.body.nome, 80);
    const responsavel = texto(req.body.responsavel, 120);
    const erros = [];
    if (!/^\d{2}$/.test(codigo) || codigo === '00') erros.push('O código do setor deve ter dois dígitos (01 a 99).');
    if (!nome) erros.push('Informe o nome do setor.');
    if (!erros.length) {
      const dup = await query('SELECT codigo, nome FROM setores WHERE codigo = $1 OR lower(nome) = lower($2)', [codigo, nome]);
      if (dup.rowCount) erros.push(dup.rows[0].codigo === codigo ? `O código ${codigo} já pertence ao setor ${dup.rows[0].nome}.` : 'Já existe um setor com esse nome.');
    }
    if (erros.length) return res.status(400).render('setores/index', { ...(await dados()), erros, form: req.body, editar: null });
    const r = await query('INSERT INTO setores (codigo, nome, responsavel, criado_por, atualizado_por) VALUES ($1,$2,$3,$4,$4) RETURNING id',
      [codigo, nome, responsavel, req.user.id]);
    await query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES ($1,'criar','setor',$2,$3)`,
      [req.user.id, r.rows[0].id, { codigo, nome, responsavel }]);
    flash(req, 'sucesso', `Setor ${codigo} — ${nome} cadastrado.`);
    res.redirect('/setores');
  } catch (err) {
    if (err.code === '23505') { flash(req, 'erro', 'Código ou nome de setor já cadastrado.'); return res.redirect('/setores'); }
    next(err);
  }
});

router.post('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = int(req.params.id);
    const nome = texto(req.body.nome, 80);
    const responsavel = texto(req.body.responsavel, 120);
    const ativo = req.body.ativo === 'on' || req.body.ativo === 'true';
    if (!nome) { flash(req, 'erro', 'Informe o nome do setor.'); return res.redirect(`/setores?editar=${id}`); }
    const dup = await query('SELECT 1 FROM setores WHERE lower(nome) = lower($1) AND id <> $2', [nome, id]);
    if (dup.rowCount) { flash(req, 'erro', 'Já existe um setor com esse nome.'); return res.redirect(`/setores?editar=${id}`); }
    const old = await query('SELECT nome, responsavel, ativo FROM setores WHERE id = $1', [id]);
    if (!old.rowCount) return res.redirect('/setores');
    await query('UPDATE setores SET nome=$2, responsavel=$3, ativo=$4, atualizado_em=now(), atualizado_por=$5 WHERE id=$1',
      [id, nome, responsavel, ativo, req.user.id]);
    await query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES ($1,'editar','setor',$2,$3)`,
      [req.user.id, id, { de: old.rows[0], para: { nome, responsavel, ativo } }]);
    flash(req, 'sucesso', 'Setor atualizado.');
    res.redirect('/setores');
  } catch (err) { next(err); }
});

router.post('/categorias', async (req, res, next) => {
  try {
    const nome = texto(req.body.nome, 60);
    if (!nome) { flash(req, 'erro', 'Informe o nome da categoria.'); return res.redirect('/setores#categorias'); }
    const dup = await query('SELECT 1 FROM categorias WHERE lower(nome) = lower($1)', [nome]);
    if (dup.rowCount) { flash(req, 'erro', 'Categoria já cadastrada.'); return res.redirect('/setores#categorias'); }
    const r = await query('INSERT INTO categorias (nome) VALUES ($1) RETURNING id', [nome]);
    await query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES ($1,'criar','categoria',$2,$3)`,
      [req.user.id, r.rows[0].id, { nome }]);
    flash(req, 'sucesso', `Categoria "${nome}" criada.`);
    res.redirect('/setores#categorias');
  } catch (err) { next(err); }
});

router.post('/categorias/:id(\\d+)/alternar', async (req, res, next) => {
  try {
    const r = await query('UPDATE categorias SET ativo = NOT ativo WHERE id = $1 RETURNING nome, ativo', [req.params.id]);
    if (r.rowCount) {
      await query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES ($1,'alternar','categoria',$2,$3)`,
        [req.user.id, int(req.params.id), r.rows[0]]);
      flash(req, 'sucesso', `Categoria "${r.rows[0].nome}" ${r.rows[0].ativo ? 'reativada' : 'desativada'}.`);
    }
    res.redirect('/setores#categorias');
  } catch (err) { next(err); }
});

module.exports = router;
