'use strict';
const { query } = require('../db');
const { SITUACOES, ESTADOS, MOTIVOS_BAIXA, int, parseData, texto } = require('../util');

// Normaliza filtros vindos da query string
function lerFiltros(q = {}) {
  const f = {
    busca: texto(q.busca, 120) || '',
    setor: int(q.setor) || '',
    categoria: int(q.categoria) || '',
    responsavel: texto(q.responsavel, 120) || '',
    estado: ESTADOS[q.estado] ? q.estado : '',
    // 'ativos' (padrão) | 'todos' | uma situação específica
    situacao: q.situacao === 'todos' || SITUACOES[q.situacao] ? q.situacao : 'ativos',
    motivo: MOTIVOS_BAIXA[q.motivo] ? q.motivo : '',
    inicio: parseData(q.inicio) || '',
    fim: parseData(q.fim) || '',
  };
  return f;
}

function whereEquipamentos(f, opts = {}) {
  const cond = [], params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (f.busca) {
    const t = p(`%${f.busca.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    cond.push(`(e.codigo ILIKE ${t} OR e.descricao ILIKE ${t} OR e.numero_serie ILIKE ${t} OR e.marca ILIKE ${t} OR e.modelo ILIKE ${t})`);
  }
  if (f.setor) cond.push(`e.setor_id = ${p(f.setor)}`);
  if (f.categoria) cond.push(`e.categoria_id = ${p(f.categoria)}`);
  if (f.responsavel) cond.push(`e.responsavel ILIKE ${p(f.responsavel.replace(/[\\%_]/g, (m) => '\\' + m))}`);
  if (f.estado) cond.push(`e.estado = ${p(f.estado)}`);
  const situacao = opts.forcarSituacao || f.situacao;
  if (situacao === 'ativos') cond.push(`e.situacao <> 'baixado'`);
  else if (situacao && situacao !== 'todos') cond.push(`e.situacao = ${p(situacao)}`);
  if (opts.baixas) {
    if (f.motivo) cond.push(`e.baixa_motivo = ${p(f.motivo)}`);
    if (f.inicio) cond.push(`e.baixa_data >= ${p(f.inicio)}`);
    if (f.fim) cond.push(`e.baixa_data <= ${p(f.fim)}`);
  }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
}

const SELECT_EQUIP = `
  SELECT e.id, e.codigo, e.descricao, e.marca, e.modelo, e.numero_serie, e.responsavel,
         e.data_aquisicao, e.valor_aquisicao, e.estado, e.situacao, e.observacoes,
         e.baixa_data, e.baixa_motivo, e.baixa_observacoes, e.baixa_registrada_em,
         (e.foto IS NOT NULL) AS tem_foto,
         c.nome AS categoria, s.id AS setor_id, s.codigo AS setor_codigo, s.nome AS setor_nome,
         so.codigo AS setor_origem_codigo, so.nome AS setor_origem_nome,
         ub.nome AS baixa_usuario
    FROM equipamentos e
    JOIN categorias c ON c.id = e.categoria_id
    JOIN setores s ON s.id = e.setor_id
    JOIN setores so ON so.id = e.setor_origem_id
    LEFT JOIN usuarios ub ON ub.id = e.baixa_usuario_id`;

const ORDENACAO = 'ORDER BY so.codigo, e.sequencial';

async function listar(f, { limit, offset, baixas, forcarSituacao, ordem } = {}) {
  const { where, params } = whereEquipamentos(f, { baixas, forcarSituacao });
  let sql = `${SELECT_EQUIP} ${where} ${ordem || ORDENACAO}`;
  if (limit) { params.push(limit, offset || 0); sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`; }
  const { rows } = await query(sql, params);
  return rows;
}

async function totais(f, { baixas, forcarSituacao } = {}) {
  const { where, params } = whereEquipamentos(f, { baixas, forcarSituacao });
  const { rows } = await query(`
    SELECT count(*)::int AS quantidade,
           COALESCE(sum(e.valor_aquisicao), 0) AS valor,
           count(*) FILTER (WHERE e.valor_aquisicao IS NULL)::int AS sem_valor
      FROM equipamentos e ${where}`, params);
  return rows[0];
}

async function totaisPorSetor(f, opts = {}) {
  const { where, params } = whereEquipamentos(f, opts);
  const { rows } = await query(`
    SELECT s.id, s.codigo, s.nome, s.responsavel,
           count(*)::int AS quantidade,
           COALESCE(sum(e.valor_aquisicao), 0) AS valor,
           count(*) FILTER (WHERE e.valor_aquisicao IS NULL)::int AS sem_valor
      FROM equipamentos e JOIN setores s ON s.id = e.setor_id
      ${where}
     GROUP BY s.id ORDER BY s.codigo`, params);
  return rows;
}

// Movimentações (transferências / trocas de responsável) com filtro de período
async function listarMovimentacoes(f, { tipos = ['transferencia', 'responsavel'], limit } = {}) {
  const cond = ['m.tipo = ANY($1)'], params = [tipos];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (f.inicio) cond.push(`m.data_movimentacao >= ${p(f.inicio)}`);
  if (f.fim) cond.push(`m.data_movimentacao <= ${p(f.fim)}`);
  if (f.setor) { const s = p(f.setor); cond.push(`(m.setor_origem_id = ${s} OR m.setor_destino_id = ${s})`); }
  if (f.categoria) cond.push(`e.categoria_id = ${p(f.categoria)}`);
  if (f.busca) {
    const t = p(`%${f.busca.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    cond.push(`(e.codigo ILIKE ${t} OR e.descricao ILIKE ${t} OR e.numero_serie ILIKE ${t})`);
  }
  let sql = `
    SELECT m.id, m.tipo, m.data_movimentacao, m.registrado_em, m.responsavel_anterior, m.responsavel_novo, m.observacoes,
           e.id AS equipamento_id, e.codigo, e.descricao, e.valor_aquisicao,
           so.codigo AS origem_codigo, so.nome AS origem_nome,
           sd.codigo AS destino_codigo, sd.nome AS destino_nome,
           u.nome AS usuario
      FROM movimentacoes m
      JOIN equipamentos e ON e.id = m.equipamento_id
      LEFT JOIN setores so ON so.id = m.setor_origem_id
      LEFT JOIN setores sd ON sd.id = m.setor_destino_id
      JOIN usuarios u ON u.id = m.usuario_id
     WHERE ${cond.join(' AND ')}
     ORDER BY m.data_movimentacao DESC, m.registrado_em DESC`;
  if (limit) { params.push(limit); sql += ` LIMIT $${params.length}`; }
  const { rows } = await query(sql, params);
  return rows;
}

async function opcoes() {
  const [setores, categorias, responsaveis] = await Promise.all([
    query('SELECT id, codigo, nome, ativo FROM setores ORDER BY codigo'),
    query('SELECT id, nome, ativo FROM categorias ORDER BY nome'),
    query(`SELECT DISTINCT responsavel FROM equipamentos WHERE responsavel IS NOT NULL ORDER BY responsavel`),
  ]);
  return { setores: setores.rows, categorias: categorias.rows, responsaveis: responsaveis.rows.map((r) => r.responsavel) };
}

module.exports = { lerFiltros, listar, totais, totaisPorSetor, listarMovimentacoes, opcoes, SELECT_EQUIP };
