'use strict';
const express = require('express');
const { query } = require('../db');
const { requireAdmin, hashPassword, validarNovaSenha } = require('../auth');
const { texto, int } = require('../util');

const router = express.Router();
router.use(requireAdmin);

function flash(req, tipo, msg) { req.session.flash = { tipo, msg }; }

async function listar() {
  const { rows } = await query('SELECT id, login, nome, perfil, ativo, trocar_senha, ultimo_acesso, criado_em FROM usuarios ORDER BY ativo DESC, lower(nome)');
  return rows;
}

router.get('/', async (req, res, next) => {
  try { res.render('usuarios/index', { usuarios: await listar(), erros: [], form: {} }); } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const login = String(req.body.login || '').trim();
    const nome = texto(req.body.nome, 120);
    const perfil = req.body.perfil === 'admin' ? 'admin' : 'operador';
    const senha = String(req.body.senha || '');
    const erros = [];
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(login)) erros.push('O login deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).');
    if (!nome) erros.push('Informe o nome.');
    const inv = validarNovaSenha(senha, login);
    if (inv) erros.push(inv);
    if (!erros.length) {
      const dup = await query('SELECT 1 FROM usuarios WHERE lower(login) = lower($1)', [login]);
      if (dup.rowCount) erros.push('Este login já existe.');
    }
    if (erros.length) return res.status(400).render('usuarios/index', { usuarios: await listar(), erros, form: req.body });
    const r = await query(
      'INSERT INTO usuarios (login, nome, senha_hash, perfil, trocar_senha, criado_por) VALUES ($1,$2,$3,$4,TRUE,$5) RETURNING id',
      [login, nome, await hashPassword(senha), perfil, req.user.id]);
    await query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES ($1,'criar','usuario',$2,$3)`,
      [req.user.id, r.rows[0].id, { login, nome, perfil }]);
    flash(req, 'sucesso', `Usuário ${login} criado. A troca de senha será exigida no primeiro acesso.`);
    res.redirect('/usuarios');
  } catch (err) { next(err); }
});

router.post('/:id(\\d+)/ativo', async (req, res, next) => {
  try {
    const id = int(req.params.id);
    if (id === req.user.id) { flash(req, 'erro', 'Você não pode desativar o próprio usuário.'); return res.redirect('/usuarios'); }
    const ativo = req.body.ativo === 'true';
    if (!ativo) {
      const alvo = await query('SELECT perfil FROM usuarios WHERE id = $1', [id]);
      if (alvo.rows[0] && alvo.rows[0].perfil === 'admin') {
        const n = await query(`SELECT count(*)::int AS n FROM usuarios WHERE perfil = 'admin' AND ativo AND id <> $1`, [id]);
        if (!n.rows[0].n) { flash(req, 'erro', 'É preciso manter pelo menos um administrador ativo.'); return res.redirect('/usuarios'); }
      }
    }
    const r = await query('UPDATE usuarios SET ativo = $2, atualizado_em = now() WHERE id = $1 RETURNING login', [id, ativo]);
    if (r.rowCount) {
      if (!ativo) await query(`DELETE FROM sessao WHERE (sess->>'userId')::int = $1`, [id]);
      await query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES ($1,$2,'usuario',$3)`,
        [req.user.id, ativo ? 'reativar' : 'desativar', id]);
      flash(req, 'sucesso', `Usuário ${r.rows[0].login} ${ativo ? 'reativado' : 'desativado'}.`);
    }
    res.redirect('/usuarios');
  } catch (err) { next(err); }
});

router.post('/:id(\\d+)/senha', async (req, res, next) => {
  try {
    const id = int(req.params.id);
    const senha = String(req.body.senha || '');
    const alvo = await query('SELECT login FROM usuarios WHERE id = $1', [id]);
    if (!alvo.rowCount) return res.redirect('/usuarios');
    const inv = validarNovaSenha(senha, alvo.rows[0].login);
    if (inv) { flash(req, 'erro', inv); return res.redirect('/usuarios'); }
    await query('UPDATE usuarios SET senha_hash = $2, trocar_senha = TRUE, atualizado_em = now() WHERE id = $1', [id, await hashPassword(senha)]);
    if (id !== req.user.id) await query(`DELETE FROM sessao WHERE (sess->>'userId')::int = $1`, [id]);
    await query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES ($1,'redefinir_senha','usuario',$2)`, [req.user.id, id]);
    flash(req, 'sucesso', `Senha de ${alvo.rows[0].login} redefinida. A troca será exigida no próximo acesso.`);
    if (id === req.user.id) return res.redirect('/trocar-senha');
    res.redirect('/usuarios');
  } catch (err) { next(err); }
});

router.post('/:id(\\d+)/perfil', async (req, res, next) => {
  try {
    const id = int(req.params.id);
    const perfil = req.body.perfil === 'admin' ? 'admin' : 'operador';
    if (id === req.user.id) { flash(req, 'erro', 'Você não pode alterar o próprio perfil.'); return res.redirect('/usuarios'); }
    const r = await query('UPDATE usuarios SET perfil = $2, atualizado_em = now() WHERE id = $1 RETURNING login', [id, perfil]);
    if (r.rowCount) {
      await query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES ($1,'alterar_perfil','usuario',$2,$3)`,
        [req.user.id, id, { perfil }]);
      flash(req, 'sucesso', `Perfil de ${r.rows[0].login} alterado.`);
    }
    res.redirect('/usuarios');
  } catch (err) { next(err); }
});

module.exports = router;
