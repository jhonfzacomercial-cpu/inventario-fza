'use strict';

const TZ = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

const ESTADOS = {
  novo: 'Novo', bom: 'Bom', regular: 'Regular', ruim: 'Ruim', inservivel: 'Inservível',
};
const SITUACOES = {
  em_uso: 'Em uso', disponivel: 'Em estoque', manutencao: 'Em manutenção', emprestado: 'Emprestado', baixado: 'Baixado',
};
const SITUACOES_ATIVAS = ['em_uso', 'disponivel', 'manutencao', 'emprestado'];
const MOTIVOS_BAIXA = {
  descarte: 'Descarte', venda: 'Venda', doacao: 'Doação', perda: 'Perda', furto: 'Furto / roubo', outro: 'Outro',
};
const TIPOS_MOV = {
  cadastro: 'Cadastro', edicao: 'Edição', transferencia: 'Transferência', responsavel: 'Troca de responsável', baixa: 'Baixa',
};
const CAMPOS_LABEL = {
  descricao: 'Descrição', categoria: 'Categoria', marca: 'Marca', modelo: 'Modelo', numero_serie: 'Nº de série',
  responsavel: 'Responsável', data_aquisicao: 'Data de aquisição', valor_aquisicao: 'Valor de aquisição',
  estado: 'Estado', situacao: 'Situação', observacoes: 'Observações', foto: 'Foto',
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function moeda(v) {
  if (v === null || v === undefined || v === '') return 'Não informado';
  return brl.format(Number(v));
}
function moedaTotal(v) {
  return brl.format(Number(v || 0));
}
function data(d) {
  if (!d) return '—';
  const s = typeof d === 'string' ? d : d.toISOString().slice(0, 10);
  const [y, m, dd] = s.slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}
function dataHora(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ts));
}
function hoje() {
  // YYYY-MM-DD no fuso configurado
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Converte "1.234,56", "1234.56", "R$ 1.234" -> "1234.56" (string) | null | NaN
function parseValor(input) {
  if (input === undefined || input === null) return null;
  let s = String(input).trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const n = Number(s);
  if (!Number.isFinite(n) || n > 999999999999) return NaN;
  return n.toFixed(2);
}

function parseData(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return undefined;
  return s;
}

function texto(v, max = 500) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function int(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function idsLista(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  return [...new Set(arr.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0))];
}

function formatarCodigo(codigoSetor, seq) {
  return `FZA.${codigoSetor}.${String(seq).padStart(3, '0')}`;
}

function descreverValor(k, x) {
  if (x === null || x === undefined || x === '') return '—';
  if (k === 'valor_aquisicao') return moeda(x);
  if (k === 'data_aquisicao') return data(x);
  if (k === 'estado') return ESTADOS[x] || x;
  if (k === 'situacao') return SITUACOES[x] || x;
  return String(x);
}

function qs(obj, extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...obj, ...extra })) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = {
  TZ, ESTADOS, SITUACOES, SITUACOES_ATIVAS, MOTIVOS_BAIXA, TIPOS_MOV, CAMPOS_LABEL,
  moeda, moedaTotal, data, dataHora, hoje, parseValor, parseData, texto, int, idsLista, formatarCodigo, qs, baseUrl, descreverValor,
};
