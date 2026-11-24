'use strict';
// Integração com o WhatsApp Cloud API (Meta): cadastro de equipamentos por mensagem.
const crypto = require('crypto');
const { query } = require('../db');
const inv = require('./inventario');
const { criarEquipamentos, tipoImagem, MAX_QTD } = require('./cadastro');
const { ESTADOS, SITUACOES, parseValor, hoje, moeda, data } = require('../util');

const RASCUNHO_MINUTOS = 30;

function config() {
  return {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    api: (process.env.WHATSAPP_API_URL || 'https://graph.facebook.com').replace(/\/+$/, ''),
    versao: process.env.WHATSAPP_API_VERSION || 'v21.0',
    appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),
  };
}
function configurado() {
  const c = config();
  return Boolean(c.token && c.phoneId && c.verifyToken && c.appSecret);
}

// ---------------- Telefones ----------------
// Normaliza para dígitos com DDI. Números brasileiros sem DDI recebem 55.
function normalizarTelefone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length < 10 || d.length > 15) return undefined;
  return d;
}
// O WhatsApp às vezes entrega celulares brasileiros sem o nono dígito (55 11 8765-4321).
function variantesTelefone(waId) {
  const d = String(waId || '').replace(/\D/g, '');
  const v = new Set([d]);
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') v.add(d.slice(0, 4) + d.slice(5));
  if (d.startsWith('55') && d.length === 12) v.add(d.slice(0, 4) + '9' + d.slice(4));
  return [...v];
}

// ---------------- Interpretação da mensagem ----------------
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();

const CHAVES = {
  descricao: ['descricao', 'nome', 'item', 'produto', 'equipamento', 'nome do item'],
  categoria: ['categoria', 'tipo'],
  setor: ['setor', 'departamento', 'area'],
  marca: ['marca', 'fabricante'],
  modelo: ['modelo'],
  serie: ['serie', 'series', 'numero de serie', 'numeros de serie', 'n de serie', 'n serie', 'no de serie', 'nº de serie', 'num serie', 'ns', 'sn', 's/n'],
  responsavel: ['responsavel', 'resp', 'pessoa responsavel', 'usuario'],
  valor: ['valor', 'preco', 'valor unitario', 'custo', 'valor de aquisicao'],
  data: ['data', 'data de aquisicao', 'data da aquisicao', 'aquisicao', 'data aquisicao', 'compra', 'data da compra', 'data de compra'],
  estado: ['estado', 'conservacao', 'estado de conservacao'],
  situacao: ['situacao', 'status', 'situacao patrimonial'],
  quantidade: ['quantidade', 'qtd', 'qtde', 'quant', 'unidades'],
  observacoes: ['obs', 'observacao', 'observacoes'],
};
const MAPA_CHAVES = {};
for (const [campo, lista] of Object.entries(CHAVES)) for (const k of lista) MAPA_CHAVES[norm(k)] = campo;

const SITUACAO_TEXTO = {
  'em uso': 'em_uso', uso: 'em_uso', 'em estoque': 'disponivel', estoque: 'disponivel', disponivel: 'disponivel',
  manutencao: 'manutencao', 'em manutencao': 'manutencao', emprestado: 'emprestado',
};

function lerCampos(texto) {
  const campos = {}, desconhecidos = [];
  for (const linha of String(texto || '').split(/\r?\n/)) {
    const m = linha.match(/^\s*[-•*]?\s*([^:=]{1,40}?)\s*[:=]\s*(.*)$/);
    if (!m) continue;
    const chave = norm(m[1]).replace(/[.º°]/g, '').trim();
    const valor = m[2].replace(/^[*_]+|[*_]+$/g, '').trim();
    const campo = MAPA_CHAVES[chave];
    if (campo) campos[campo] = valor;
    else desconhecidos.push(m[1].trim());
  }
  return { campos, desconhecidos };
}

function parseDataBR(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  let iso;
  if (m) {
    const ano = m[3].length === 2 ? (Number(m[3]) > 50 ? '19' : '20') + m[3] : m[3];
    iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  } else if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) iso = t;
  else return undefined;
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return undefined;
  return iso;
}

/** Converte o texto da mensagem nos dados do cadastro. */
function interpretar(texto, opcoes) {
  const { campos, desconhecidos } = lerCampos(texto);
  const erros = [], avisos = [];
  const v = {
    descricao: (campos.descricao || '').slice(0, 200) || null,
    marca: (campos.marca || '').slice(0, 100) || null,
    modelo: (campos.modelo || '').slice(0, 100) || null,
    responsavel: (campos.responsavel || '').slice(0, 120) || null,
    observacoes: (campos.observacoes || '').slice(0, 2000) || null,
  };
  if (!v.descricao) erros.push('Informe a *Descrição* do item.');

  // Categoria (por nome, sem diferenciar acentos/maiúsculas, aceita plural)
  const cats = opcoes.categorias.filter((c) => c.ativo);
  if (!campos.categoria) erros.push('Informe a *Categoria*.');
  else {
    const alvo = norm(campos.categoria);
    const cat = cats.find((c) => norm(c.nome) === alvo) || cats.find((c) => norm(c.nome) === alvo.replace(/s$/, '') || norm(c.nome).replace(/s$/, '') === alvo);
    if (cat) { v.categoria_id = cat.id; v.categoria_nome = cat.nome; } else erros.push(`Categoria "${campos.categoria}" não encontrada. Opções: ${cats.map((c) => c.nome).join(', ')}.`);
  }

  // Setor (código de 2 dígitos ou nome)
  const setores = opcoes.setores.filter((s) => s.ativo);
  if (!campos.setor) erros.push('Informe o *Setor* (código, ex.: 01).');
  else {
    const t = campos.setor.trim();
    const cod = (t.match(/^(\d{1,2})\b/) || [])[1];
    const s = cod ? setores.find((x) => x.codigo === cod.padStart(2, '0')) : setores.find((x) => norm(x.nome) === norm(t));
    if (s) { v.setor_id = s.id; v.setor_nome = `${s.codigo} — ${s.nome}`; } else erros.push(`Setor "${t}" não encontrado. Envie *SETORES* para ver a lista.`);
  }

  // Quantidade
  v.quantidade = 1;
  if (campos.quantidade) {
    const q = parseInt(campos.quantidade, 10);
    if (!Number.isInteger(q) || q < 1 || q > MAX_QTD) erros.push(`*Quantidade* deve ser um número de 1 a ${MAX_QTD}.`);
    else v.quantidade = q;
  }

  // Números de série (vários separados por vírgula ou ponto e vírgula)
  v.series = campos.serie ? campos.serie.split(/[;,]/).map((s) => s.trim().slice(0, 100)).filter(Boolean) : [];
  if (v.series.length > v.quantidade) erros.push(`Foram informados ${v.series.length} números de série para ${v.quantidade} unidade(s).`);
  if (new Set(v.series.map((s) => s.toLowerCase())).size !== v.series.length) erros.push('Há números de série repetidos.');

  // Valor — ausente ou "desconhecido" fica como não informado (nunca R$ 0,00)
  const tv = norm(campos.valor);
  if (!tv || /^(desconhecido|nao sei|nao informado|sem valor|n\/?a|-|\?)$/.test(tv)) {
    v.valor_aquisicao = null;
    if (!tv) avisos.push('Valor não informado: o item ficará como "valor desconhecido".');
  } else {
    const val = parseValor(campos.valor);
    if (val === null || Number.isNaN(val)) erros.push(`*Valor* inválido: "${campos.valor}". Use o formato 1.234,56 ou escreva "desconhecido".`);
    else v.valor_aquisicao = val;
  }

  // Data de aquisição
  v.data_aquisicao = null;
  if (campos.data) {
    const d = parseDataBR(campos.data);
    if (!d) erros.push(`*Data* inválida: "${campos.data}". Use DD/MM/AAAA.`);
    else if (d > hoje()) erros.push('A data de aquisição não pode estar no futuro.');
    else v.data_aquisicao = d;
  }

  // Estado de conservação
  v.estado = 'bom';
  if (campos.estado) {
    const e = Object.keys(ESTADOS).find((k) => norm(ESTADOS[k]) === norm(campos.estado) || k === norm(campos.estado));
    if (e) v.estado = e; else erros.push(`*Estado* inválido. Opções: ${Object.values(ESTADOS).join(', ')}.`);
  }

  // Situação patrimonial
  v.situacao = 'em_uso';
  if (campos.situacao) {
    const s = SITUACAO_TEXTO[norm(campos.situacao)];
    if (s) v.situacao = s; else erros.push('*Situação* inválida. Opções: Em uso, Em estoque, Em manutenção, Emprestado.');
  }

  if (desconhecidos.length) avisos.push(`Campos ignorados: ${desconhecidos.join(', ')}.`);
  return { v, erros, avisos };
}

function resumo(v, temFoto) {
  const l = [
    `*Descrição:* ${v.descricao}`,
    `*Categoria:* ${v.categoria_nome}`,
    `*Setor:* ${v.setor_nome}`,
  ];
  if (v.marca) l.push(`*Marca:* ${v.marca}`);
  if (v.modelo) l.push(`*Modelo:* ${v.modelo}`);
  if (v.series.length) l.push(`*Nº de série:* ${v.series.join(', ')}`);
  l.push(`*Responsável:* ${v.responsavel || '—'}`);
  l.push(`*Valor unitário:* ${v.valor_aquisicao === null ? 'não informado (desconhecido)' : moeda(v.valor_aquisicao)}`);
  l.push(`*Data de aquisição:* ${v.data_aquisicao ? data(v.data_aquisicao) : '—'}`);
  l.push(`*Estado:* ${ESTADOS[v.estado]} · *Situação:* ${SITUACOES[v.situacao]}`);
  l.push(`*Quantidade:* ${v.quantidade}${v.quantidade > 1 ? ' (um código para cada unidade)' : ''}`);
  if (v.observacoes) l.push(`*Obs.:* ${v.observacoes}`);
  l.push(`*Foto:* ${temFoto ? 'anexada' : 'sem foto'}`);
  return l.join('\n');
}

const MODELO = `Descrição:
Categoria:
Setor:
Marca:
Modelo:
Série:
Responsável:
Valor:
Data:
Estado: bom
Quantidade: 1
Obs: `;

const AJUDA = `*Inventário Grupo FZA* 📦

Para cadastrar um equipamento, envie uma mensagem neste formato (obrigatórios: *Descrição*, *Categoria* e *Setor*):

Descrição: Notebook Dell Latitude 5440
Categoria: Notebook
Setor: 01
Marca: Dell
Modelo: Latitude 5440
Série: ABC123
Responsável: Carla Mendes
Valor: 6.890,00
Data: 10/03/2024
Estado: bom
Quantidade: 1
Obs: com carregador

Dicas:
• Valor desconhecido: *Valor: desconhecido*
• Várias unidades iguais: *Quantidade: 3* e *Série: A1, A2, A3*
• Para anexar foto, envie a foto com o texto na legenda (ou envie a foto antes de responder SIM)

Comandos: *MODELO* (formulário em branco), *SETORES* (setores e categorias), *CONSULTAR FZA.01.001*, *CANCELAR*.`;

// ---------------- Cliente da API ----------------
async function registrar(direcao, telefone, usuarioId, tipo, texto, waId, status) {
  const r = await query(
    `INSERT INTO whatsapp_mensagens (direcao, telefone, usuario_id, tipo, texto, wa_message_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
    [direcao, telefone, usuarioId || null, tipo, texto ? String(texto).slice(0, 4000) : null, waId || null, status || null]);
  return r.rows[0] ? r.rows[0].id : null;
}

async function enviarTexto(para, texto, usuarioId) {
  const c = config();
  const corpo = String(texto).slice(0, 4000);
  let status = 'enviada';
  try {
    const resp = await fetch(`${c.api}/${c.versao}/${c.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'text', text: { preview_url: false, body: corpo } }),
    });
    if (!resp.ok) status = `erro ${resp.status}: ${(await resp.text()).slice(0, 300)}`;
  } catch (err) {
    status = `erro: ${err.message}`;
  }
  if (status !== 'enviada') console.error(`[whatsapp] falha ao enviar para ${para}: ${status}`);
  await registrar('saida', para, usuarioId, 'texto', corpo, null, status);
  return status === 'enviada';
}

async function baixarMidia(mediaId) {
  const c = config();
  const h = { Authorization: `Bearer ${c.token}` };
  const meta = await fetch(`${c.api}/${c.versao}/${encodeURIComponent(mediaId)}`, { headers: h });
  if (!meta.ok) throw new Error(`mídia ${mediaId}: HTTP ${meta.status}`);
  const { url, file_size: tamanho } = await meta.json();
  if (tamanho && tamanho > 5 * 1024 * 1024) throw new Error('foto maior que 5 MB');
  const arq = await fetch(url, { headers: h });
  if (!arq.ok) throw new Error(`download da mídia: HTTP ${arq.status}`);
  const buf = Buffer.from(await arq.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('foto maior que 5 MB');
  const tipo = tipoImagem(buf);
  if (!tipo) throw new Error('formato de imagem não suportado (use JPG, PNG ou WEBP)');
  return { foto: buf, fotoTipo: tipo };
}

// Confere a assinatura X-Hub-Signature-256 enviada pela Meta
function assinaturaValida(corpoBruto, cabecalho) {
  const c = config();
  if (!c.appSecret || !cabecalho || !Buffer.isBuffer(corpoBruto)) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', c.appSecret).update(corpoBruto).digest('hex');
  const a = Buffer.from(String(cabecalho)), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------- Conversa ----------------
async function usuarioPorTelefone(waId) {
  const { rows } = await query('SELECT id, login, nome, perfil, ativo FROM usuarios WHERE whatsapp = ANY($1)', [variantesTelefone(waId)]);
  return rows[0] || null;
}

async function rascunhoAtual(usuarioId) {
  const { rows } = await query(
    `SELECT dados, foto_tipo, (foto IS NOT NULL) AS tem_foto, criado_em > now() - ($2 || ' minutes')::interval AS valido
       FROM whatsapp_rascunhos WHERE usuario_id = $1`, [usuarioId, String(RASCUNHO_MINUTOS)]);
  return rows[0] || null;
}

async function consultar(codigo) {
  const { rows } = await query(`${inv.SELECT_EQUIP} WHERE e.codigo = $1`, [codigo.toUpperCase()]);
  const e = rows[0];
  if (!e) return `Nenhum equipamento com o código ${codigo.toUpperCase()}.`;
  const l = [
    `*${e.codigo}* — ${e.descricao}`,
    `Categoria: ${e.categoria}`,
    `Setor atual: ${e.setor_codigo} — ${e.setor_nome}`,
    `Responsável: ${e.responsavel || '—'}`,
    `Situação: ${SITUACOES[e.situacao]} · Estado: ${ESTADOS[e.estado]}`,
    `Valor: ${moeda(e.valor_aquisicao)}`,
  ];
  if (e.numero_serie) l.splice(2, 0, `Nº de série: ${e.numero_serie}`);
  if (e.situacao === 'baixado') l.push(`Baixado em ${data(e.baixa_data)}.`);
  const url = config().appUrl;
  if (url) l.push(`Ficha: ${url}/e/${e.codigo}`);
  return l.join('\n');
}

/**
 * Processa uma mensagem recebida. `responder(texto)` envia a resposta.
 * msg: { id, from, type, text?: { body }, image?: { id, caption } }
 */
async function processarMensagem(msg, { responder, baixar = baixarMidia } = {}) {
  const de = String(msg.from || '');
  const texto = msg.type === 'text' ? (msg.text && msg.text.body) || '' : msg.type === 'image' ? (msg.image && msg.image.caption) || '' : '';
  const usuario = await usuarioPorTelefone(de);
  const novo = await registrar('entrada', de, usuario && usuario.id, msg.type, texto || `[${msg.type}]`, msg.id, null);
  if (!novo) return; // mensagem repetida (a Meta reenviou)
  const enviar = (t) => responder(t, usuario && usuario.id);

  if (!usuario || !usuario.ativo) {
    return enviar('Este número não está autorizado a usar o Inventário Grupo FZA. Peça ao administrador para vincular seu WhatsApp ao seu usuário no sistema.');
  }
  if (!['text', 'image'].includes(msg.type)) {
    return enviar('Envie os dados do equipamento em texto (ou uma foto com os dados na legenda). Mande *AJUDA* para ver o formato.');
  }

  const cmd = norm(texto);
  const rasc = await rascunhoAtual(usuario.id);

  // Foto: baixa e guarda (anexa ao rascunho atual ou ao cadastro da legenda)
  let foto = null, erroFoto = null;
  if (msg.type === 'image' && msg.image && msg.image.id) {
    try { foto = await baixar(msg.image.id); } catch (err) { erroFoto = err.message; }
  }

  if (msg.type === 'image' && !lerCampos(texto).campos.descricao) {
    if (erroFoto) return enviar(`Não consegui salvar a foto: ${erroFoto}.`);
    if (rasc && rasc.valido) {
      await query('UPDATE whatsapp_rascunhos SET foto = $2, foto_tipo = $3 WHERE usuario_id = $1', [usuario.id, foto.foto, foto.fotoTipo]);
      return enviar('📷 Foto anexada ao cadastro pendente. Responda *SIM* para confirmar ou *CANCELAR*.');
    }
    return enviar('Recebi a foto, mas não há cadastro pendente. Envie a foto com os dados do equipamento na legenda (mande *AJUDA* para ver o formato).');
  }

  if (/^(sim|s|confirmar|confirmo|ok)$/.test(cmd)) {
    if (!rasc || !rasc.valido) return enviar('Não há cadastro pendente de confirmação. Envie os dados do equipamento (mande *AJUDA* para ver o formato).');
    const { rows } = await query('DELETE FROM whatsapp_rascunhos WHERE usuario_id = $1 RETURNING dados, foto, foto_tipo', [usuario.id]);
    if (!rows[0]) return enviar('Este cadastro já foi processado.');
    const v = rows[0].dados;
    try {
      const criados = await criarEquipamentos(v, { foto: rows[0].foto, fotoTipo: rows[0].foto_tipo, usuarioId: usuario.id, origem: 'whatsapp' });
      const url = config().appUrl;
      const linhas = criados.map((c) => `• *${c.codigo}*`);
      return enviar(`✅ ${criados.length === 1 ? 'Equipamento cadastrado' : `${criados.length} equipamentos cadastrados`}!\n\n${v.descricao}\nSetor ${v.setor_nome}\n\n${criados.length === 1 ? 'Código' : 'Códigos'} patrimonial(is) para a etiqueta:\n${linhas.join('\n')}`
        + (url && criados.length === 1 ? `\n\nFicha: ${url}/e/${criados[0].codigo}` : ''));
    } catch (err) {
      if (err.usuario) return enviar(`Não foi possível cadastrar: ${err.message}`);
      console.error('[whatsapp] erro no cadastro', err);
      return enviar('Ocorreu um erro ao cadastrar. Tente novamente em instantes.');
    }
  }

  if (/^(cancelar|cancela|nao|n)$/.test(cmd)) {
    const r = await query('DELETE FROM whatsapp_rascunhos WHERE usuario_id = $1', [usuario.id]);
    return enviar(r.rowCount ? 'Cadastro cancelado. Nada foi salvo.' : 'Não havia cadastro pendente.');
  }

  if (/^(oi|ola|menu|ajuda|help|inicio|comandos|\?)\b/.test(cmd) && !lerCampos(texto).campos.descricao) {
    return enviar(AJUDA);
  }
  if (/^(modelo|formulario|template)$/.test(cmd)) {
    await enviar('Copie a mensagem abaixo, preencha e envie:');
    return enviar(MODELO);
  }
  if (/^(setores|categorias)$/.test(cmd)) {
    const o = await inv.opcoes();
    return enviar(`*Setores*\n${o.setores.filter((s) => s.ativo).map((s) => `${s.codigo} — ${s.nome}`).join('\n') || '(nenhum)'}\n\n*Categorias*\n${o.categorias.filter((c) => c.ativo).map((c) => c.nome).join(', ')}`);
  }
  const mc = cmd.match(/^(?:consultar|consulta|buscar)?\s*(fza\.\d{2}\.\d{3,})$/);
  if (mc) return enviar(await consultar(mc[1]));

  // Cadastro
  const { campos } = lerCampos(texto);
  if (!Object.keys(campos).length) {
    return enviar('Não entendi. Mande *AJUDA* para ver como cadastrar, ou *MODELO* para receber o formulário em branco.');
  }
  const { v, erros, avisos } = interpretar(texto, await inv.opcoes());
  if (erros.length) {
    return enviar(`⚠️ Não consegui cadastrar:\n${erros.map((e) => `• ${e}`).join('\n')}\n\nCorrija e envie a mensagem completa novamente.`);
  }
  let fotoFinal = foto;
  if (!fotoFinal && rasc && rasc.valido && rasc.tem_foto) {
    const r = await query('SELECT foto, foto_tipo FROM whatsapp_rascunhos WHERE usuario_id = $1', [usuario.id]);
    if (r.rows[0]) fotoFinal = { foto: r.rows[0].foto, fotoTipo: r.rows[0].foto_tipo };
  }
  await query(
    `INSERT INTO whatsapp_rascunhos (usuario_id, telefone, dados, foto, foto_tipo, criado_em) VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (usuario_id) DO UPDATE SET telefone = EXCLUDED.telefone, dados = EXCLUDED.dados, foto = EXCLUDED.foto, foto_tipo = EXCLUDED.foto_tipo, criado_em = now()`,
    [usuario.id, de, v, fotoFinal ? fotoFinal.foto : null, fotoFinal ? fotoFinal.fotoTipo : null]);
  const extras = [...avisos];
  if (erroFoto) extras.push(`A foto não foi salva: ${erroFoto}.`);
  if (rasc && rasc.valido) extras.push('Este cadastro substitui o anterior que estava pendente.');
  return enviar(`📋 Confira os dados:\n\n${resumo(v, Boolean(fotoFinal))}${extras.length ? `\n\n${extras.map((a) => `ℹ️ ${a}`).join('\n')}` : ''}\n\nResponda *SIM* para cadastrar ou *CANCELAR*. (válido por ${RASCUNHO_MINUTOS} min)`);
}

module.exports = {
  config, configurado, normalizarTelefone, variantesTelefone, interpretar, resumo, lerCampos,
  processarMensagem, enviarTexto, baixarMidia, assinaturaValida, AJUDA, MODELO,
};
