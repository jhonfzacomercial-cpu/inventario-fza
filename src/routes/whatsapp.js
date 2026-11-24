'use strict';
const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { requireAdmin } = require('../auth');
const wa = require('../services/whatsapp');
const inv = require('../services/inventario');
const { baseUrl } = require('../util');

// ---------- Webhook público (autenticado pela assinatura da Meta) ----------
const webhook = express.Router();

// Verificação do webhook (feita uma vez pela Meta ao configurar)
webhook.get('/', (req, res) => {
  const c = wa.config();
  const token = String(req.query['hub.verify_token'] || '');
  const ok = c.verifyToken && token.length === c.verifyToken.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(c.verifyToken));
  if (req.query['hub.mode'] === 'subscribe' && ok) return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  res.sendStatus(403);
});

webhook.post('/', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
  if (!wa.configurado()) return res.sendStatus(503);
  if (!wa.assinaturaValida(req.body, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  let payload;
  try { payload = JSON.parse(req.body.toString('utf8')); } catch { return res.sendStatus(400); }
  res.sendStatus(200); // a Meta exige resposta rápida; o processamento segue em segundo plano

  const mensagens = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of (change.value && change.value.messages) || []) mensagens.push(m);
    }
  }
  (async () => {
    for (const m of mensagens) {
      try {
        await wa.processarMensagem(m, { responder: (t, uid) => wa.enviarTexto(m.from, t, uid) });
      } catch (err) {
        console.error('[whatsapp] erro ao processar mensagem', err);
      }
    }
  })();
});

// ---------- Página de administração ----------
const admin = express.Router();
admin.use(requireAdmin);

async function dadosPagina() {
  const [usuarios, msgs] = await Promise.all([
    query('SELECT id, nome, login, whatsapp, ativo FROM usuarios WHERE whatsapp IS NOT NULL ORDER BY nome'),
    query(`SELECT m.*, u.nome AS usuario FROM whatsapp_mensagens m LEFT JOIN usuarios u ON u.id = m.usuario_id
            ORDER BY m.registrado_em DESC, m.id DESC LIMIT 60`),
  ]);
  return { usuarios: usuarios.rows, mensagens: msgs.rows };
}

admin.get('/', async (req, res, next) => {
  try {
    const c = wa.config();
    res.render('whatsapp/index', {
      ...(await dadosPagina()),
      status: { token: !!c.token, phoneId: !!c.phoneId, verifyToken: !!c.verifyToken, appSecret: !!c.appSecret, appUrl: !!c.appUrl },
      configurado: wa.configurado(),
      webhookUrl: `${c.appUrl || baseUrl(req)}/webhooks/whatsapp`,
      teste: null, textoTeste: '', MODELO: wa.MODELO,
    });
  } catch (err) { next(err); }
});

// Testa a interpretação de uma mensagem sem cadastrar nada
admin.post('/testar', async (req, res, next) => {
  try {
    const c = wa.config();
    const texto = String(req.body.texto || '').slice(0, 4000);
    const r = wa.interpretar(texto, await inv.opcoes());
    res.render('whatsapp/index', {
      ...(await dadosPagina()),
      status: { token: !!c.token, phoneId: !!c.phoneId, verifyToken: !!c.verifyToken, appSecret: !!c.appSecret, appUrl: !!c.appUrl },
      configurado: wa.configurado(),
      webhookUrl: `${c.appUrl || baseUrl(req)}/webhooks/whatsapp`,
      teste: { ...r, resumo: r.erros.length ? null : wa.resumo(r.v, false) }, textoTeste: texto, MODELO: wa.MODELO,
    });
  } catch (err) { next(err); }
});

module.exports = { webhook, admin };
