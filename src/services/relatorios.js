'use strict';
const inv = require('./inventario');
const { query } = require('../db');
const { ESTADOS, SITUACOES, MOTIVOS_BAIXA, TIPOS_MOV, data, moedaTotal } = require('../util');

const TIPOS = {
  geral: 'Inventário geral',
  setor: 'Inventário por setor',
  transferencias: 'Transferências',
  baixas: 'Baixas patrimoniais',
};

const COL_EQUIP = [
  { key: 'codigo', titulo: 'Código', peso: 1.25, negrito: true },
  { key: 'descricao', titulo: 'Descrição', peso: 2.4 },
  { key: 'categoria', titulo: 'Categoria', peso: 1.1 },
  { key: 'marca_modelo', titulo: 'Marca / modelo', peso: 1.6 },
  { key: 'numero_serie', titulo: 'Nº de série', peso: 1.3 },
  { key: 'setor', titulo: 'Setor atual', peso: 1.3 },
  { key: 'responsavel', titulo: 'Responsável', peso: 1.3 },
  { key: 'data_aquisicao', titulo: 'Aquisição', tipo: 'data', peso: 0.9 },
  { key: 'estado', titulo: 'Estado', peso: 0.8 },
  { key: 'situacao', titulo: 'Situação', peso: 1.0 },
  { key: 'valor', titulo: 'Valor (R$)', tipo: 'moeda', peso: 1.1 },
];

function linhaEquip(e) {
  return {
    id: e.id,
    codigo: e.codigo,
    descricao: e.descricao,
    categoria: e.categoria,
    marca_modelo: [e.marca, e.modelo].filter(Boolean).join(' ') || '',
    numero_serie: e.numero_serie || '',
    setor: `${e.setor_codigo} — ${e.setor_nome}`,
    responsavel: e.responsavel || '',
    data_aquisicao: e.data_aquisicao,
    estado: ESTADOS[e.estado],
    situacao: SITUACOES[e.situacao],
    valor: e.valor_aquisicao,
  };
}

function descreverFiltros(f, opcoes, tipo) {
  const partes = [];
  const setor = opcoes.setores.find((s) => s.id === f.setor);
  const cat = opcoes.categorias.find((c) => c.id === f.categoria);
  if (f.busca) partes.push(`Busca: "${f.busca}"`);
  if (setor) partes.push(`Setor: ${setor.codigo} — ${setor.nome}`);
  if (cat) partes.push(`Categoria: ${cat.nome}`);
  if (f.responsavel) partes.push(`Responsável: ${f.responsavel}`);
  if (f.estado) partes.push(`Estado: ${ESTADOS[f.estado]}`);
  if (tipo === 'geral' || tipo === 'setor') {
    partes.push(`Situação: ${f.situacao === 'ativos' ? 'itens ativos' : f.situacao === 'todos' ? 'todos' : SITUACOES[f.situacao]}`);
  }
  if (f.motivo) partes.push(`Motivo: ${MOTIVOS_BAIXA[f.motivo]}`);
  if (f.inicio || f.fim) partes.push(`Período: ${f.inicio ? data(f.inicio) : 'início'} a ${f.fim ? data(f.fim) : 'hoje'}`);
  return partes.join(' · ') || 'Sem filtros';
}

function resumoTotais(t) {
  return [
    { label: 'Quantidade de itens', valor: t.quantidade, tipo: 'numero' },
    { label: 'Valor de aquisição registrado', valor: Number(t.valor), tipo: 'moeda' },
    { label: 'Itens sem valor informado', valor: t.sem_valor, tipo: 'numero' },
  ];
}

function textoSubtotal(t) {
  return `${t.quantidade} ${t.quantidade === 1 ? 'item' : 'itens'} · ${moedaTotal(t.valor)}` + (t.sem_valor ? ` · ${t.sem_valor} sem valor informado` : '');
}

// Monta um relatório (mesma estrutura para HTML, PDF e XLSX)
async function montar(tipo, f) {
  const opcoes = await inv.opcoes();
  const base = { tipo, titulo: TIPOS[tipo], filtros: descreverFiltros(f, opcoes, tipo), opcoes };

  if (tipo === 'geral') {
    if (f.situacao === 'baixado' || f.situacao === 'todos') f.situacao = 'ativos';
    const [itens, t] = await Promise.all([inv.listar(f), inv.totais(f)]);
    base.filtros = descreverFiltros(f, opcoes, tipo);
    return { ...base, colunas: COL_EQUIP, linhas: itens.map(linhaEquip), resumo: resumoTotais(t) };
  }

  if (tipo === 'setor') {
    if (f.situacao === 'baixado' || f.situacao === 'todos') f.situacao = 'ativos';
    const [itens, t, grupos] = await Promise.all([inv.listar(f, { ordem: 'ORDER BY s.codigo, so.codigo, e.sequencial' }), inv.totais(f), inv.totaisPorSetor(f)]);
    base.filtros = descreverFiltros(f, opcoes, tipo);
    const linhas = [];
    for (const g of grupos) {
      linhas.push({ _tipo: 'grupo', texto: `${g.codigo} — ${g.nome}${g.responsavel ? ` (responsável: ${g.responsavel})` : ''}` });
      for (const e of itens.filter((i) => i.setor_id === g.id)) linhas.push(linhaEquip(e));
      linhas.push({ _tipo: 'subtotal', texto: `Subtotal ${g.codigo} — ${g.nome}: ${textoSubtotal(g)}`, valor: Number(g.valor), quantidade: g.quantidade });
    }
    const colunas = COL_EQUIP.filter((c) => c.key !== 'setor');
    return { ...base, colunas, linhas, resumo: [...resumoTotais(t), { label: 'Setores com itens', valor: grupos.length, tipo: 'numero' }], grupos };
  }

  if (tipo === 'transferencias') {
    const movs = await inv.listarMovimentacoes(f);
    const distintos = new Map(movs.map((m) => [m.equipamento_id, m.valor_aquisicao]));
    const valores = [...distintos.values()];
    const transf = movs.filter((m) => m.tipo === 'transferencia').length;
    return {
      ...base,
      colunas: [
        { key: 'data', titulo: 'Data', tipo: 'data', peso: 0.9 },
        { key: 'tipo', titulo: 'Tipo', peso: 1.1 },
        { key: 'codigo', titulo: 'Código', peso: 1.2, negrito: true },
        { key: 'descricao', titulo: 'Descrição', peso: 2.1 },
        { key: 'origem', titulo: 'Origem', peso: 1.4 },
        { key: 'destino', titulo: 'Destino', peso: 1.4 },
        { key: 'resp_ant', titulo: 'Resp. anterior', peso: 1.2 },
        { key: 'resp_novo', titulo: 'Resp. novo', peso: 1.2 },
        { key: 'usuario', titulo: 'Registrado por', peso: 1.1 },
        { key: 'registrado', titulo: 'Registrado em', tipo: 'datahora', peso: 1.2 },
        { key: 'valor', titulo: 'Valor (R$)', tipo: 'moeda', peso: 1.0 },
      ],
      linhas: movs.map((m) => ({
        id: m.equipamento_id,
        data: m.data_movimentacao, tipo: TIPOS_MOV[m.tipo], codigo: m.codigo, descricao: m.descricao,
        origem: m.origem_codigo ? `${m.origem_codigo} — ${m.origem_nome}` : '',
        destino: m.destino_codigo ? `${m.destino_codigo} — ${m.destino_nome}` : '',
        resp_ant: m.responsavel_anterior || '', resp_novo: m.responsavel_novo || '', usuario: m.usuario, registrado: m.registrado_em,
        valor: m.valor_aquisicao,
      })),
      resumo: [
        { label: 'Movimentações no período', valor: movs.length, tipo: 'numero' },
        { label: 'Transferências entre setores', valor: transf, tipo: 'numero' },
        { label: 'Itens movimentados', valor: distintos.size, tipo: 'numero' },
        { label: 'Valor de aquisição dos itens movimentados', valor: valores.reduce((a, v) => a + Number(v || 0), 0), tipo: 'moeda' },
        { label: 'Itens movimentados sem valor informado', valor: valores.filter((v) => v === null).length, tipo: 'numero' },
      ],
    };
  }

  if (tipo === 'baixas') {
    const ordem = 'ORDER BY e.baixa_data DESC, so.codigo, e.sequencial';
    const [itens, t] = await Promise.all([
      inv.listar(f, { baixas: true, forcarSituacao: 'baixado', ordem }),
      inv.totais(f, { baixas: true, forcarSituacao: 'baixado' }),
    ]);
    const porMotivo = {};
    for (const r of itens) {
      const m = porMotivo[r.baixa_motivo] = porMotivo[r.baixa_motivo] || { quantidade: 0, valor: 0, sem_valor: 0 };
      m.quantidade++;
      if (r.valor_aquisicao === null) m.sem_valor++;
      else m.valor += Number(r.valor_aquisicao);
    }
    return {
      ...base,
      colunas: [
        { key: 'baixa_data', titulo: 'Data da baixa', tipo: 'data', peso: 0.95 },
        { key: 'codigo', titulo: 'Código', peso: 1.2, negrito: true },
        { key: 'descricao', titulo: 'Descrição', peso: 2.1 },
        { key: 'categoria', titulo: 'Categoria', peso: 1.0 },
        { key: 'setor', titulo: 'Último setor', peso: 1.3 },
        { key: 'motivo', titulo: 'Motivo', peso: 0.9 },
        { key: 'obs', titulo: 'Observações', peso: 2.0 },
        { key: 'usuario', titulo: 'Registrado por', peso: 1.1 },
        { key: 'registrado', titulo: 'Registrado em', tipo: 'datahora', peso: 1.2 },
        { key: 'valor', titulo: 'Valor (R$)', tipo: 'moeda', peso: 1.0 },
      ],
      linhas: itens.map((e) => ({
        id: e.id,
        baixa_data: e.baixa_data, codigo: e.codigo, descricao: e.descricao, categoria: e.categoria,
        setor: `${e.setor_codigo} — ${e.setor_nome}`, motivo: MOTIVOS_BAIXA[e.baixa_motivo], obs: e.baixa_observacoes || '',
        usuario: e.baixa_usuario || '', registrado: e.baixa_registrada_em, valor: e.valor_aquisicao,
      })),
      resumo: [
        ...resumoTotais(t).map((r, i) => (i === 0 ? { ...r, label: 'Itens baixados' } : i === 1 ? { ...r, label: 'Valor de aquisição baixado' } : r)),
        ...Object.entries(porMotivo).map(([k, v]) => ({ label: `${MOTIVOS_BAIXA[k]}`, valor: textoSubtotal(v), tipo: 'texto' })),
      ],
    };
  }
  return null;
}

async function ultimaAtualizacao() {
  const { rows } = await query('SELECT max(registrado_em) AS t FROM movimentacoes');
  return rows[0].t;
}

module.exports = { TIPOS, montar, ultimaAtualizacao };
