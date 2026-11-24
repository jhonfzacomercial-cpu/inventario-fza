'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

// scrypt (N=2^15, r=8, p=1) com sal aleatório de 16 bytes
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const [alg, n, r, p, saltB64, keyB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const key = await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
      N: parseInt(n, 10), r: parseInt(r, 10), p: parseInt(p, 10), maxmem: MAXMEM,
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

function validarNovaSenha(senha, login) {
  if (!senha || senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (senha.length > 200) return 'A senha é longa demais.';
  if (login && senha.toLowerCase() === String(login).toLowerCase()) return 'A senha não pode ser igual ao login.';
  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/[0-9]/.test(senha)) return 'A senha deve conter letras e números.';
  return null;
}

function wantsJson(req) {
  return req.originalUrl.startsWith('/api/');
}

function requireAuth(req, res, next) {
  if (req.user) {
    if (req.user.trocar_senha && !['/trocar-senha', '/logout'].includes(req.path)) {
      if (wantsJson(req)) return res.status(403).json({ erro: 'Troca de senha obrigatória.' });
      return res.redirect('/trocar-senha');
    }
    return next();
  }
  if (wantsJson(req)) return res.status(401).json({ erro: 'Autenticação necessária.' });
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.perfil === 'admin') return next();
  if (wantsJson(req)) return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
  return res.status(403).render('erro', { titulo: 'Acesso negado', mensagem: 'Esta área é exclusiva do administrador.' });
}

// CSRF: token por sessão, exigido em todo POST
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}
function verifyCsrf(req, res, next) {
  const sent = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
  const expected = (req.session && req.session.csrf) || '';
  if (!expected || sent.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return res.status(403).render('erro', { titulo: 'Formulário expirado', mensagem: 'O formulário expirou. Volte, recarregue a página e tente novamente.' });
  }
  next();
}
function csrfGlobal(req, res, next) {
  if (req.method !== 'POST') return next();
  // formulários multipart são verificados após o multer
  if ((req.get('content-type') || '').startsWith('multipart/form-data')) return next();
  return verifyCsrf(req, res, next);
}

module.exports = { hashPassword, verifyPassword, validarNovaSenha, requireAuth, requireAdmin, csrfToken, verifyCsrf, csrfGlobal };
