'use strict';
require('dotenv').config({ quiet: true });
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { pool, query } = require('./db');
const { runMigrations, seedAdmin } = require('./migrate');
const { requireAuth, csrfToken, csrfGlobal } = require('./auth');
const util = require('./util');

const app = express();
const PROD = process.env.NODE_ENV === 'production';

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL (veja .env.example).');
  process.exit(1);
}
let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (PROD) { console.error('Defina SESSION_SECRET em produção.'); process.exit(1); }
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('[aviso] SESSION_SECRET não definido; usando segredo temporário (sessões caem ao reiniciar).');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
if (process.env.TRUST_PROXY !== 'false') app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

app.get('/healthz', async (req, res) => {
  try { await query('SELECT 1'); res.json({ ok: true }); } catch { res.status(500).json({ ok: false }); }
});

// Webhook do WhatsApp: público, autenticado pela assinatura da Meta (precisa do corpo bruto)
const whatsapp = require('./routes/whatsapp');
app.use('/webhooks/whatsapp', whatsapp.webhook);

app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: PROD ? '7d' : 0 }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  store: new PgSession({ pool, tableName: 'sessao' }),
  name: 'fza.sid',
  secret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : PROD,
    maxAge: parseInt(process.env.SESSION_HOURS || '10', 10) * 3600 * 1000,
  },
}));

// Carrega o usuário a cada requisição (usuário desativado perde o acesso na hora)
app.use(async (req, res, next) => {
  try {
    if (req.session.userId) {
      const { rows } = await query('SELECT id, login, nome, perfil, ativo, trocar_senha FROM usuarios WHERE id = $1', [req.session.userId]);
      if (rows[0] && rows[0].ativo) req.user = rows[0];
      else req.session.userId = null;
    }
    res.locals.user = req.user || null;
    res.locals.csrf = csrfToken(req);
    res.locals.u = util;
    res.locals.path = req.path;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    next();
  } catch (err) { next(err); }
});

app.use(csrfGlobal);

app.use(require('./routes/auth'));
app.use(requireAuth);
app.use(require('./routes/painel'));
app.use('/equipamentos', require('./routes/equipamentos'));
app.use('/setores', require('./routes/setores'));
app.use('/relatorios', require('./routes/relatorios'));
app.use('/usuarios', require('./routes/usuarios'));
app.use('/whatsapp', whatsapp.admin);
app.use('/api', require('./routes/api'));

app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/')) return res.status(404).json({ erro: 'Não encontrado.' });
  res.status(404).render('erro', { titulo: 'Página não encontrada', mensagem: 'O endereço acessado não existe.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'A foto excede o tamanho máximo de 5 MB.' : 'Ocorreu um erro inesperado. Tente novamente.';
  if (req.originalUrl.startsWith('/api/')) return res.status(500).json({ erro: msg });
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 400 : 500).render('erro', { titulo: 'Erro', mensagem: msg });
});

const PORT = parseInt(process.env.PORT || '3000', 10);

(async () => {
  try {
    await runMigrations();
    await seedAdmin();
  } catch (err) {
    console.error('[inicialização] ' + err.message);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`Inventário Grupo FZA disponível em http://localhost:${PORT}`));
})();

module.exports = app;
