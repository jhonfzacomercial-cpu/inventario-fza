'use strict';
/*
 * Teste da integração com WhatsApp usando uma API da Meta simulada (mock local).
 * Rode DEPOIS de test/e2e.js (precisa dos setores 01 e 02 e do usuário Adm).
 * O servidor do inventário deve estar rodando com:
 *   WHATSAPP_API_URL=http://localhost:3999  WHATSAPP_TOKEN=tk  WHATSAPP_PHONE_NUMBER_ID=123
 *   WHATSAPP_VERIFY_TOKEN=verifica  WHATSAPP_APP_SECRET=segredo
 */
require('dotenv').config({ quiet: true });
const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const { Pool } = require('pg');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SECRET = process.env.WHATSAPP_APP_SECRET || 'segredo';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ok = (m) => console.log('  ✔ ' + m);

// ---- API da Meta simulada ----
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let enviadas = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer tk') { res.writeHead(401); return res.end(); }
    if (req.method === 'POST' && req.url === '/v21.0/123/messages') {
      enviadas.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ messages: [{ id: 'wamid.out' }] }));
    }
    if (req.url === '/v21.0/MIDIA1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ url: 'http://localhost:3999/arquivo/MIDIA1', mime_type: 'image/png', file_size: PNG.length }));
    }
    if (req.url === '/arquivo/MIDIA1') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
    res.writeHead(404); res.end();
  });
});

let seq = 0;
function evento(from, msg) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: '123' },
    contacts: [{ wa_id: from, profile: { name: 'Teste' } }],
    messages: [{ from, id: msg.id || `wamid.in.${Date.now()}.${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), ...msg }],
  } }] }] };
}
async function postar(payload, { assinar = true } = {}) {
  const corpo = JSON.stringify(payload);
  const headers = { 'content-type': 'application/json' };
  if (assinar) headers['x-hub-signature-256'] = 'sha256=' + crypto.createHmac('sha256', SECRET).update(corpo).digest('hex');
  return fetch(`${BASE}/webhooks/whatsapp`, { method: 'POST', headers, body: corpo });
}
// Envia uma mensagem e espera as respostas do bot
async function conversa(from, msg, esperar = 1) {
  enviadas = [];
  const r = await postar(evento(from, msg));
  assert.strictEqual(r.status, 200);
  for (let i = 0; i < 50 && enviadas.length < esperar; i++) await new Promise((ok2) => setTimeout(ok2, 100));
  await new Promise((ok2) => setTimeout(ok2, 150));
  return enviadas.map((e) => e.text.body).join('\n---\n').replace(/\u00a0/g, ' ');
}

(async () => {
  await new Promise((r) => mock.listen(3999, r));
  const NUM = '5511987654321';

  console.log('1. Segurança do webhook');
  let r = await fetch(`${BASE}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=4242`);
  assert.strictEqual(await r.text(), '4242'); ok('Verificação da Meta responde o challenge');
  r = await fetch(`${BASE}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`);
  assert.strictEqual(r.status, 403); ok('Token de verificação errado → 403');
  r = await postar(evento(NUM, { type: 'text', text: { body: 'oi' } }), { assinar: false });
  assert.strictEqual(r.status, 401); ok('Mensagem sem assinatura válida → 401 (ignorada)');

  console.log('2. Número não autorizado');
  await pool.query('UPDATE usuarios SET whatsapp = NULL');
  let resp = await conversa(NUM, { type: 'text', text: { body: 'oi' } });
  assert.ok(resp.includes('não está autorizado')); ok('Número sem vínculo é recusado');
  await pool.query("UPDATE usuarios SET whatsapp = $1 WHERE login = 'Adm'", [NUM]);

  console.log('3. Ajuda e consultas');
  resp = await conversa(NUM, { type: 'text', text: { body: 'Oi' } });
  assert.ok(resp.includes('Para cadastrar um equipamento')); ok('"Oi" → instruções');
  resp = await conversa(NUM, { type: 'text', text: { body: 'setores' } });
  assert.ok(resp.includes('01 — Criação') && resp.includes('Notebook')); ok('SETORES → lista de setores e categorias');
  resp = await conversa(NUM, { type: 'text', text: { body: 'MODELO' } }, 2);
  assert.ok(resp.includes('Descrição:') && resp.includes('Categoria:')); ok('MODELO → formulário em branco');

  console.log('4. Validação');
  resp = await conversa(NUM, { type: 'text', text: { body: 'Descrição: Tablet\nCategoria: Geladeira\nSetor: 09\nValor: abc' } });
  assert.ok(resp.includes('Categoria "Geladeira" não encontrada') && resp.includes('Setor "09" não encontrado') && resp.includes('Valor* inválido'));
  ok('Erros de categoria, setor e valor são explicados');

  console.log('5. Cadastro com foto e confirmação');
  const legenda = '*CADASTRO*\nDescrição: Câmera Canon EOS R6\nCategoria: câmeras\nSetor: 01\nMarca: Canon\nModelo: EOS R6\nSérie: CN-001, CN-002\nResponsável: Paula Reis\nValor: R$ 15.999,90\nData: 05/02/2025\nEstado: novo\nQuantidade: 2\nObs: kit com bateria extra';
  const idImg = 'wamid.img.1';
  resp = await conversa(NUM, { id: idImg, type: 'image', image: { id: 'MIDIA1', mime_type: 'image/png', caption: legenda } });
  assert.ok(resp.includes('Confira os dados') && resp.includes('Câmera Canon EOS R6') && resp.includes('R$ 15.999,90') && resp.includes('Foto:* anexada') && resp.includes('Quantidade:* 2'));
  ok('Foto + legenda → resumo para confirmação (categoria "câmeras" reconhecida)');
  const antes = (await pool.query('SELECT count(*)::int n FROM equipamentos')).rows[0].n;
  resp = await conversa(NUM, { id: idImg, type: 'image', image: { id: 'MIDIA1', caption: legenda } }, 0);
  assert.strictEqual(enviadas.length, 0); ok('Mensagem reenviada pela Meta (mesmo ID) é ignorada');
  assert.strictEqual((await pool.query('SELECT count(*)::int n FROM equipamentos')).rows[0].n, antes); ok('Nada é gravado antes do SIM');
  resp = await conversa(NUM, { type: 'text', text: { body: 'sim' } });
  const codigos = resp.match(/FZA\.01\.\d{3,}/g);
  assert.ok(resp.includes('2 equipamentos cadastrados') && codigos && codigos.length === 2);
  const { rows } = await pool.query(`SELECT e.codigo, e.numero_serie, e.valor_aquisicao, e.foto IS NOT NULL AS foto, e.responsavel, m.detalhes->>'origem' AS origem, u.login
      FROM equipamentos e JOIN movimentacoes m ON m.equipamento_id = e.id AND m.tipo = 'cadastro' JOIN usuarios u ON u.id = m.usuario_id
      WHERE e.codigo = ANY($1) ORDER BY e.codigo`, [codigos]);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map((x) => x.numero_serie), ['CN-001', 'CN-002']);
  assert.ok(rows.every((x) => x.foto && x.valor_aquisicao === '15999.90' && x.origem === 'whatsapp' && x.login === 'Adm' && x.responsavel === 'Paula Reis'));
  ok(`SIM → ${codigos.join(' e ')} gravados com foto, séries, valor e autoria do usuário`);
  resp = await conversa(NUM, { type: 'text', text: { body: 'sim' } });
  assert.ok(resp.includes('Não há cadastro pendente')); ok('SIM repetido não duplica o cadastro');

  console.log('6. Valor desconhecido, cancelamento e consulta');
  resp = await conversa(NUM, { type: 'text', text: { body: 'Descrição: Mesa de som antiga\nCategoria: Áudio\nSetor: Administrativo' } });
  assert.ok(resp.includes('não informado (desconhecido)') && resp.includes('02 — Administrativo')); ok('Sem valor → "desconhecido"; setor aceito pelo nome');
  resp = await conversa(NUM, { type: 'text', text: { body: 'cancelar' } });
  assert.ok(resp.includes('Cadastro cancelado')); ok('CANCELAR descarta o rascunho');
  resp = await conversa('551187654321', { type: 'text', text: { body: `consultar ${codigos[0].toLowerCase()}` } });
  assert.ok(resp.includes(codigos[0]) && resp.includes('Paula Reis')); ok('Consulta por código (número recebido sem o nono dígito também é reconhecido)');

  await pool.end();
  mock.close();
  console.log('\nIntegração WhatsApp verificada.');
})().catch((err) => { console.error('\n✘ FALHA:', err); process.exit(1); });
