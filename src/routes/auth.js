'use strict';
const express = require('express');
const { query } = require('../db');
const { verifyPassword, hashPassword, validarNovaSenha, requireAuth } = require('../auth');

const router = express.Router();

// Limite simples de tentativas por IP+login (memória do processo)
const tentativas = new Map();
const JANELA_MS = 15 * 60 * 1000, MAX_TENTATIVAS = 8;
function chave(req, login) { return `${req.ip}|${String(login || '').toLowerCase()}`; }
function bloqueado(k) {
  const t = tentativas.get(k);
  if (!t) return false;
  if (Date.now() - t.inicio > JANELA_MS) { tentativas.delete(k); return false; }
  return t.n >= MAX_TENTATIVAS;
}
function falhou(k) {
  const t = tentativas.get(k);
  if (!t || Date.now() - t.inicio > JANELA_MS) tentativas.set(k, { n: 1, inicio: Date.now() });
  else t.n += 1;
}

const HASH_FICTICIO = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { erro: null, login: '' });
});

router.post('/login', async (req, res, next) => {
  try {
    const login = String(req.body.login || '').trim();
    const senha = String(req.body.senha || '');
    const k = chave(req, login);
    if (bloqueado(k)) {
      return res.status(429).render('login', { erro: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.', login });
    }
    const { rows } = await query('SELECT * FROM usuarios WHERE lower(login) = lower($1)', [login]);
    const u = rows[0];
    const ok = await verifyPassword(senha, u ? u.senha_hash : HASH_FICTICIO);
    if (!u || !ok || !u.ativo) {
      falhou(k);
      const erro = u && ok && !u.ativo ? 'Usuário desativado. Procure o administrador.' : 'Login ou senha inválidos.';
      return res.status(401).render('login', { erro, login });
    }
    tentativas.delete(k);
    const returnTo = req.session.returnTo;
    req.session.regenerate(async (err) => {
      if (err) return next(err);
      req.session.userId = u.id;
      await query('UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1', [u.id]);
      const destino = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
      if (u.trocar_senha) req.session.returnTo = destino;
      req.session.save(() => res.redirect(u.trocar_senha ? '/trocar-senha' : destino));
    });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('fza.sid');
    res.redirect('/login');
  });
});

router.get('/trocar-senha', requireAuth, (req, res) => {
  res.render('trocar-senha', { erro: null, obrigatoria: req.user.trocar_senha });
});

router.post('/trocar-senha', requireAuth, async (req, res, next) => {
  try {
    const { senha_atual, nova_senha, confirmacao } = req.body;
    const obrigatoria = req.user.trocar_senha;
    const { rows } = await query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.user.id]);
    const render = (erro) => res.status(400).render('trocar-senha', { erro, obrigatoria });
    if (!(await verifyPassword(String(senha_atual || ''), rows[0].senha_hash))) return render('A senha atual está incorreta.');
    if (nova_senha !== confirmacao) return render('A confirmação não confere com a nova senha.');
    const invalida = validarNovaSenha(nova_senha, req.user.login);
    if (invalida) return render(invalida);
    if (await verifyPassword(nova_senha, rows[0].senha_hash)) return render('A nova senha deve ser diferente da atual.');
    await query('UPDATE usuarios SET senha_hash = $1, trocar_senha = FALSE, atualizado_em = now() WHERE id = $2',
      [await hashPassword(nova_senha), req.user.id]);
    await query(`INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES ($1, 'trocar_senha', 'usuario', $1)`, [req.user.id]);
    // Encerra outras sessões do usuário
    await query(`DELETE FROM sessao WHERE sid <> $1 AND (sess->>'userId')::int = $2`, [req.sessionID, req.user.id]);
    const destino = req.session.returnTo || '/';
    delete req.session.returnTo;
    req.session.flash = { tipo: 'sucesso', msg: 'Senha alterada com sucesso.' };
    res.redirect(destino);
  } catch (err) { next(err); }
});

module.exports = router;
