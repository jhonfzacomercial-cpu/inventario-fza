'use strict';
// Relatórios: cada relatório é um conjunto de seções (tabelas) + um resumo.
// A mesma estrutura alimenta a tela, o PDF e o XLSX.
const inv = require('./inventario');
const { ESTADOS, SITUACOES, SITUACOES_ATIVAS, MOTIVOS_BAIXA, TIPOS_MOV, data, moedaTotal } = require('../util');

const TIPOS = {
  geral: 'Relatório geral',
  inventario: 'Inventário (itens)',
  setor: 'Por setor',
  categoria: 'Por categoria',
  transferencias: 'Transferências',
  baixas: 'Baixas',
};

// Quais filtros cada relatório usa
const FILTROS = {
  geral: ['setor', 'categoria', 'periodo', 'detalhe'],
  inventario: ['busca', 'setor', 'categoria', 'responsavel', 'estado', 'situacao'],
  setor: ['busca', 'setor', 'categoria', 'responsavel', 'estado', 'situacao_ativa'],
  categoria: ['busca', 'setor', 'categoria', 'responsavel', 'estado', 'situacao_ativa'],
  transferencias: ['busca', 'setor', 'categoria', 'periodo'],
  baixas: ['busca', 'setor', 'categoria', 'periodo', 'motivo'],
};

// ---------- Colunas ----------
// tela:false => coluna só no PDF/XLSX (na tela aparece como 2ª linha da descrição)
const COL_EQUIP = [
  { key: 'codigo', titulo: 'Código', peso: 1.25, negrito: true, link: true },
  { key: 'descricao', titulo: 'Descrição', peso: 2.4, sub: ['marca_modelo', 'numero_serie'] },
  { key: 'categoria', titulo: 'Categoria', peso: 1.1 },
  { key: 'marca_modelo', titulo: 'Marca / modelo', peso: 1.6, tela: false },
  { key: 'numero_serie', titulo: 'Nº de série', peso: 1.3, tela: false },
  { key: 'setor', titulo: 'Setor atual', peso: 1.3 },
  { key: 'responsavel', titulo: 'Responsável', peso: 1.3 },
  { key: 'data_aquisicao', titulo: 'Aquisição', tipo: 'data', peso: 0.9 },
  { key: 'estado', titulo: 'Estado', peso: 0.8 },
  { key: 'situacao', titulo: 'Situação', peso: 1.0 },
  { key: 'valor', titulo: 'Valor (R$)', tipo: 'moeda', peso: 1.1 },
];

const COL_GRUPO = (titulo) => [
  { key: 'chave', titulo, peso: 3, negrito: true },
  { key: 'quantidade', titulo: 'Itens', tipo: 'numero', peso: 0.8 },
  { key: 'valor', titulo: 'Valor registrado (R$)', tipo: 'moeda', peso: 1.4 },
  { key: 'sem_valor', titulo: 'Sem valor', tipo: 'numero', peso: 0.9 },
  { key: 'pct_qtd', titulo: '% dos itens', tipo: 'pct', peso: 0.9 },
  { key: 'pct_valor', titulo: '% do valor', tipo: 'pct', peso: 0.9 },
];

const COL_BAIXAS = [
  { key: 'baixa_data', titulo: 'Data da baixa', tipo: 'data', peso: 0.95 },
  { key: 'codigo', titulo: 'Código', peso: 1.2, negrito: true, link: true },
  { key: 'descricao', titulo: 'Descrição', peso: 2.1 },
  { key: 'categoria', titulo: 'Categoria', peso: 1.0 },
  { key: 'setor', titulo: 'Último setor', peso: 1.3 },
  { key: 'motivo', titulo: 'Motivo', peso: 0.9 },
  { key: 'obs', titulo: 'Observações', peso: 2.0 },
  { key: 'usuario', titulo: 'Registrado por', peso: 1.1 },
  { key: 'valor', titulo: 'Valor (R$)', tipo: 'moeda', peso: 1.0 },
];

const COL_MOV = [
  { key: 'data', titulo: 'Data', tipo: 'data', peso: 0.9 },
  { key: 'tipo', titulo: 'Tipo', peso: 1.1 },
  { key: 'codigo', titulo: 'Código', peso: 1.2, negrito: true, link: true },
  { key: 'descricao', titulo: 'Descrição', peso: 2.1 },
  { key: 'origem', titulo: 'Origem', peso: 1.4 },
  { key: 'destino', titulo: 'Destino', peso: 1.4 },
  { key: 'resp', titulo: 'Responsável (antes → depois)', peso: 1.8 },
  { key: 'usuario', titulo: 'Registrado por', peso: 1.1 },
  { key: 'registrado', titulo: 'Registrado em', tipo: 'datahora', peso: 1.2, tela: false },
  { key: 'valor', titulo: 'Valor (R$)', tipo: 'moeda', peso: 1.0 },
];

// ---------- Conversões ----------
function linhaEquip(e) {
  return {
    id: e.id, codigo: e.codigo, descricao: e.descricao, categoria: e.categoria,
    marca_modelo: [e.marca, e.modelo].filter(Boolean).join(' '),
    numero_serie: e.numero_serie || '',
    setor: `${e.setor_codigo} — ${e.setor_nome}`,
    responsavel: e.responsavel || '',
    data_aquisicao: e.data_aquisicao,
    estado: ESTADOS[e.estado], situacao: SITUACOES[e.situacao],
    valor: e.valor_aquisicao,
    _baixado: e.situacao === 'baixado',
  };
}
function linhaBaixa(e) {
  return {
    id: e.id, baixa_data: e.baixa_data, codigo: e.codigo, descricao: e.descricao, categoria: e.categoria,
    setor: `${e.setor_codigo} — ${e.setor_nome}`, motivo: MOTIVOS_BAIXA[e.baixa_motivo], obs: e.baixa_observacoes || '',
    usuario: e.baixa_usuario || '', valor: e.valor_aquisicao,
  };
}
function linhaMov(m) {
  return {
    id: m.equipamento_id, data: m.data_movimentacao, tipo: TIPOS_MOV[m.tipo], codigo: m.codigo, descricao: m.descricao,
    origem: m.origem_codigo ? `${m.origem_codigo} — ${m.origem_nome}` : '',
    destino: m.destino_codigo ? `${m.destino_codigo} — ${m.destino_nome}` : '',
    resp: (m.responsavel_anterior || '') === (m.responsavel_novo || '') ? (m.responsavel_novo || '') : `${m.responsavel_anterior || '—'} → ${m.responsavel_novo || '—'}`,
    usuario: m.usuario, registrado: m.registrado_em, valor: m.valor_aquisicao,
  };
}

// Tabela de totais agrupados, com percentuais e linha de total
function tabelaGrupo(rows, rotulo, traduzir, ordem) {
  let lista = rows.map((r) => ({ ...r, valor: Number(r.valor), chave: traduzir ? (traduzir[r.chave] || r.chave) : r.chave, _k: r.chave }));
  if (ordem) lista.sort((a, b) => ordem.indexOf(a._k) - ordem.indexOf(b._k));
  const tq = lista.reduce((a, r) => a + r.quantidade, 0);
  const tv = lista.reduce((a, r) => a + r.valor, 0);
  const ts = lista.reduce((a, r) => a + r.sem_valor, 0);
  const linhas = lista.map((r) => ({ ...r, pct_qtd: tq ? r.quantidade / tq : 0, pct_valor: tv ? r.valor / tv : 0 }));
  if (linhas.length) linhas.push({ _tipo: 'total', chave: 'Total', quantidade: tq, valor: tv, sem_valor: ts, pct_qtd: tq ? 1 : 0, pct_valor: tv ? 1 : 0 });
  return { colunas: COL_GRUPO(rotulo), linhas };
}

function textoSubtotal(t) {
  return `${t.quantidade} ${t.quantidade === 1 ? 'item' : 'itens'} · ${moedaTotal(t.valor)}` + (t.sem_valor ? ` · ${t.sem_valor} sem valor informado` : '');
}

function descreverFiltros(f, opcoes, tipo) {
  const usa = FILTROS[tipo];
  const partes = [];
  const setor = opcoes.setores.find((s) => s.id === f.setor);
  const cat = opcoes.categorias.find((c) => c.id === f.categoria);
  if (f.busca && usa.includes('busca')) partes.push(`Busca: "${f.busca}"`);
  if (setor) partes.push(`Setor: ${setor.codigo} — ${setor.nome}`);
  if (cat) partes.push(`Categoria: ${cat.nome}`);
  if (f.responsavel && usa.includes('responsavel')) partes.push(`Responsável: ${f.responsavel}`);
  if (f.estado && usa.includes('estado')) partes.push(`Estado: ${ESTADOS[f.estado]}`);
  if (usa.includes('situacao') || usa.includes('situacao_ativa')) {
    partes.push(`Situação: ${f.situacao === 'ativos' ? 'itens ativos' : f.situacao === 'todos' ? 'todos, inclusive baixados' : SITUACOES[f.situacao]}`);
  }
  if (f.motivo && usa.includes('motivo')) partes.push(`Motivo: ${MOTIVOS_BAIXA[f.motivo]}`);
  if ((f.inicio || f.fim) && usa.includes('periodo')) partes.push(`Período: ${f.inicio ? data(f.inicio) : 'início'} a ${f.fim ? data(f.fim) : 'hoje'}`);
  return partes.join(' · ') || 'Sem filtros (todo o inventário)';
}

const R = {
  qtd: (label, valor) => ({ label, valor, tipo: 'numero' }),
  val: (label, valor) => ({ label, valor: Number(valor), tipo: 'moeda' }),
};

// ---------- Montagem ----------
async function montar(tipo, f, { detalhe = 'completo' } = {}) {
  const opcoes = await inv.opcoes();
  if (FILTROS[tipo].includes('situacao_ativa') && !SITUACOES_ATIVAS.includes(f.situacao)) f.situacao = 'ativos';
  const base = { tipo, titulo: TIPOS[tipo], filtros: descreverFiltros(f, opcoes, tipo), opcoes, secoes: [] };
  // filtros só de setor/categoria (o relatório geral ignora os demais)
  const fBase = { ...inv.lerFiltros({}), setor: f.setor, categoria: f.categoria, inicio: f.inicio, fim: f.fim };

  if (tipo === 'geral') {
    const fAtivos = { ...fBase, situacao: 'ativos' };
    const [tAtivos, tBaixAll, tBaixPer, porSetor, porCat, porSit, porEst, porMotivo, movs, itens, baixados] = await Promise.all([
      inv.totais(fAtivos),
      inv.totais({ ...fBase, inicio: '', fim: '' }, { forcarSituacao: 'baixado' }),
      inv.totais(fBase, { baixas: true, forcarSituacao: 'baixado' }),
      inv.agrupar(fAtivos, 'setor'),
      inv.agrupar(fAtivos, 'categoria'),
      inv.agrupar(fAtivos, 'situacao'),
      inv.agrupar(fAtivos, 'estado'),
      inv.agrupar(fBase, 'motivo', { baixas: true, forcarSituacao: 'baixado' }),
      inv.listarMovimentacoes(fBase),
      detalhe === 'completo' ? inv.listar(fAtivos) : [],
      detalhe === 'completo' ? inv.listar(fBase, { baixas: true, forcarSituacao: 'baixado', ordem: 'ORDER BY e.baixa_data DESC, so.codigo, e.sequencial' }) : [],
    ]);
    const periodo = f.inicio || f.fim;
    const transf = movs.filter((m) => m.tipo === 'transferencia').length;
    base.resumo = [
      R.qtd('Itens ativos', tAtivos.quantidade),
      R.val('Valor de aquisição dos ativos', tAtivos.valor),
      R.qtd('Ativos sem valor informado', tAtivos.sem_valor),
      R.qtd('Itens baixados (total)', tBaixAll.quantidade),
      R.val('Valor dos itens baixados (total)', tBaixAll.valor),
      R.qtd(periodo ? 'Baixas no período' : 'Baixas registradas', tBaixPer.quantidade),
      R.qtd(periodo ? 'Transferências no período' : 'Transferências registradas', transf),
    ];
    base.secoes.push({ titulo: 'Itens ativos por setor', aba: 'Por setor', ...tabelaGrupo(porSetor, 'Setor') });
    base.secoes.push({ titulo: 'Itens ativos por categoria', aba: 'Por categoria', ...tabelaGrupo(porCat, 'Categoria') });
    base.secoes.push({ titulo: 'Itens ativos por situação', aba: 'Por situação', ...tabelaGrupo(porSit, 'Situação', SITUACOES, SITUACOES_ATIVAS) });
    base.secoes.push({ titulo: 'Itens ativos por estado de conservação', aba: 'Por estado', ...tabelaGrupo(porEst, 'Estado de conservação', ESTADOS, Object.keys(ESTADOS)) });
    base.secoes.push({ titulo: `Baixas por motivo${periodo ? ' (período)' : ''}`, aba: 'Baixas por motivo', ...tabelaGrupo(porMotivo, 'Motivo', MOTIVOS_BAIXA, Object.keys(MOTIVOS_BAIXA)) });
    if (detalhe === 'completo') {
      base.secoes.push({ titulo: `Lista de itens ativos (${itens.length})`, aba: 'Itens ativos', grande: true, colunas: COL_EQUIP, linhas: itens.map(linhaEquip) });
      base.secoes.push({ titulo: `Itens baixados${periodo ? ' no período' : ''} (${baixados.length})`, aba: 'Itens baixados', grande: true, colunas: COL_BAIXAS, linhas: baixados.map(linhaBaixa) });
      base.secoes.push({ titulo: `Transferências e trocas de responsável${periodo ? ' no período' : ''} (${movs.length})`, aba: 'Movimentações', grande: true, colunas: COL_MOV, linhas: movs.map(linhaMov) });
    }
    return base;
  }

  if (tipo === 'inventario') {
    const ordem = f.situacao === 'baixado' ? 'ORDER BY e.baixa_data DESC, so.codigo, e.sequencial' : undefined;
    const [itens, tAtivos, tBaix] = await Promise.all([
      inv.listar(f, { ordem }),
      f.situacao === 'baixado' ? null : inv.totais(f.situacao === 'todos' ? { ...f, situacao: 'ativos' } : f),
      f.situacao === 'todos' || f.situacao === 'baixado' ? inv.totais(f, { forcarSituacao: 'baixado' }) : null,
    ]);
    base.resumo = [];
    if (tAtivos) base.resumo.push(R.qtd('Itens ativos', tAtivos.quantidade), R.val('Valor de aquisição registrado', tAtivos.valor), R.qtd('Sem valor informado', tAtivos.sem_valor));
    if (tBaix) base.resumo.push(R.qtd('Itens baixados', tBaix.quantidade), R.val('Valor dos itens baixados', tBaix.valor));
    base.secoes.push({ titulo: `Itens (${itens.length})`, aba: 'Itens', grande: true, colunas: COL_EQUIP, linhas: itens.map(linhaEquip) });
    return base;
  }

  if (tipo === 'setor' || tipo === 'categoria') {
    const porSetor = tipo === 'setor';
    const ordem = porSetor ? 'ORDER BY s.codigo, so.codigo, e.sequencial' : 'ORDER BY c.nome, so.codigo, e.sequencial';
    const [itens, t, grupos] = await Promise.all([inv.listar(f, { ordem }), inv.totais(f), inv.agrupar(f, tipo)]);
    const chaveItem = (e) => (porSetor ? `${e.setor_codigo} — ${e.setor_nome}` : e.categoria);
    const linhas = [];
    for (const g of grupos) {
      const resp = porSetor ? (opcoes.setores.find((s) => `${s.codigo} — ${s.nome}` === g.chave) || {}).responsavel : null;
      linhas.push({ _tipo: 'grupo', texto: `${g.chave}${resp ? ` (responsável: ${resp})` : ''}` });
      for (const e of itens.filter((i) => chaveItem(i) === g.chave)) linhas.push(linhaEquip(e));
      linhas.push({ _tipo: 'subtotal', texto: `Subtotal ${g.chave}: ${textoSubtotal(g)}`, valor: Number(g.valor), quantidade: g.quantidade });
    }
    const rotulo = porSetor ? 'Setor' : 'Categoria';
    base.resumo = [
      R.qtd('Itens', t.quantidade), R.val('Valor de aquisição registrado', t.valor), R.qtd('Sem valor informado', t.sem_valor),
      R.qtd(porSetor ? 'Setores com itens' : 'Categorias com itens', grupos.length),
    ];
    base.secoes.push({ titulo: `Resumo ${porSetor ? 'por setor' : 'por categoria'}`, aba: 'Resumo por ' + rotulo.toLowerCase(), ...tabelaGrupo(grupos, rotulo) });
    base.secoes.push({ titulo: 'Itens', aba: 'Itens', grande: true, colunas: COL_EQUIP.filter((c) => c.key !== (porSetor ? 'setor' : 'categoria')), linhas });
    return base;
  }

  if (tipo === 'transferencias') {
    const movs = await inv.listarMovimentacoes(f);
    const distintos = new Map(movs.map((m) => [m.equipamento_id, m.valor_aquisicao]));
    const valores = [...distintos.values()];
    base.resumo = [
      R.qtd('Movimentações', movs.length),
      R.qtd('Transferências entre setores', movs.filter((m) => m.tipo === 'transferencia').length),
      R.qtd('Trocas de responsável', movs.filter((m) => m.tipo === 'responsavel').length),
      R.qtd('Itens movimentados', distintos.size),
      R.val('Valor dos itens movimentados', valores.reduce((a, v) => a + Number(v || 0), 0)),
    ];
    base.secoes.push({ titulo: 'Movimentações', aba: 'Movimentações', grande: true, colunas: COL_MOV, linhas: movs.map(linhaMov) });
    return base;
  }

  if (tipo === 'baixas') {
    const ordem = 'ORDER BY e.baixa_data DESC, so.codigo, e.sequencial';
    const [itens, t, porMotivo] = await Promise.all([
      inv.listar(f, { baixas: true, forcarSituacao: 'baixado', ordem }),
      inv.totais(f, { baixas: true, forcarSituacao: 'baixado' }),
      inv.agrupar(f, 'motivo', { baixas: true, forcarSituacao: 'baixado' }),
    ]);
    base.resumo = [R.qtd('Itens baixados', t.quantidade), R.val('Valor de aquisição baixado', t.valor), R.qtd('Sem valor informado', t.sem_valor)];
    base.secoes.push({ titulo: 'Baixas por motivo', aba: 'Por motivo', ...tabelaGrupo(porMotivo, 'Motivo', MOTIVOS_BAIXA, Object.keys(MOTIVOS_BAIXA)) });
    base.secoes.push({ titulo: 'Itens baixados', aba: 'Itens baixados', grande: true, colunas: COL_BAIXAS, linhas: itens.map(linhaBaixa) });
    return base;
  }
  return null;
}

module.exports = { TIPOS, FILTROS, montar };
