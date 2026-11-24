'use strict';
const express = require('express');
const multer = require('multer');
const { query, transaction } = require('../db');
const { verifyCsrf } = require('../auth');
const inv = require('../services/inventario');
const { criarEquipamentos, tipoImagem, MAX_QTD } = require('../services/cadastro');
const {
  ESTADOS, SITUACOES_ATIVAS, MOTIVOS_BAIXA,
  texto, int, parseValor, parseData, hoje, idsLista,
} = require('../util');

const router = express.Router();
const POR_PAGINA = 50;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

function flash(req, tipo, msg) { req.session.flash = { tipo, msg }; }

async function carregar(id) {
  const { rows } = await query(`${inv.SELECT_EQUIP} WHERE e.id = $1`, [id]);
  return rows[0] || null;
}

// Valida os campos do formulário de cadastro/edição
function validar(body, { novo }) {
  const erros = [];
  const v = {
    descricao: texto(body.descricao, 200),
    categoria_id: int(body.categoria_id),
    marca: texto(body.marca, 100),
    modelo: texto(body.modelo, 100),
    numero_serie: texto(body.numero_serie, 100),
    responsavel: texto(body.responsavel, 120),
    estado: body.estado,
    situacao: body.situacao,
    observacoes: texto(body.observacoes, 2000),
  };
  if (!v.descricao) erros.push('Informe o nome ou a descrição do item.');
  if (!v.categoria_id) erros.push('Selecione a categoria.');
  if (!ESTADOS[v.estado]) erros.push('Selecione o estado de conservação.');
  if (!SITUACOES_ATIVAS.includes(v.situacao)) erros.push('Selecione uma situação patrimonial válida.');

  const dt = parseData(body.data_aquisicao);
  if (dt === undefined) erros.push('Data de aquisição inválida.');
  else if (dt && dt > hoje()) erros.push('A data de aquisição não pode estar no futuro.');
  v.data_aquisicao = dt || null;

  if (body.valor_desconhecido) v.valor_aquisicao = null;
  else {
    const val = parseValor(body.valor_aquisicao);
    if (val === null) erros.push('Informe o valor unitário ou marque "Valor desconhecido".');
    else if (Number.isNaN(val)) erros.push('Valor unitário inválido. Use o formato 1.234,56.');
    v.valor_aquisicao = Number.isNaN(val) ? null : val;
  }

  if (novo) {
    v.setor_id = int(body.setor_id);
    if (!v.setor_id) erros.push('Selecione o setor.');
    v.quantidade = int(body.quantidade) || 1;
    if (v.quantidade < 1 || v.quantidade > MAX_QTD) erros.push(`A quantidade deve estar entre 1 e ${MAX_QTD}.`);
    // Números de série: um por linha quando houver várias unidades
    const series = String(body.numeros_serie || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (v.quantidade > 1) {
      if (series.length > v.quantidade) erros.push(`Foram informados ${series.length} números de série para ${v.quantidade} unidades.`);
      if (new Set(series.map((s) => s.toLowerCase())).size !== series.length) erros.push('Há números de série repetidos.');
      v.series = series.map((s) => s.slice(0, 100));
    } else {
      v.series = v.numero_serie ? [v.numero_serie] : [];
    }
  }
  return { v, erros };
}

async function formOpcoes() {
  const o = await inv.opcoes();
  return { setores: o.setores.filter((s) => s.ativo), categorias: o.categorias, responsaveis: o.responsaveis };
}

// ---------- Lista ----------
router.get('/', async (req, res, next) => {
  try {
    const f = inv.lerFiltros(req.query);
    const pagina = Math.max(1, int(req.query.pagina) || 1);
    const [itens, totais, opcoes] = await Promise.all([
      inv.listar(f, { limit: POR_PAGINA, offset: (pagina - 1) * POR_PAGINA }),
      inv.totais(f),
      inv.opcoes(),
    ]);
    res.render('equipamentos/lista', {
      itens, totais, f, opcoes, pagina, paginas: Math.max(1, Math.ceil(totais.quantidade / POR_PAGINA)),
    });
  } catch (err) { next(err); }
});

// ---------- Cadastro ----------
router.get('/novo', async (req, res, next) => {
  try {
    const opcoes = await formOpcoes();
    if (!opcoes.setores.length) {
      flash(req, 'aviso', 'Cadastre pelo menos um setor antes de cadastrar equipamentos.');
      return res.redirect('/setores');
    }
    res.render('equipamentos/form', {
      novo: true, item: { estado: 'bom', situacao: 'em_uso', quantidade: 1, setor_id: int(req.query.setor) }, erros: [], ...opcoes,
    });
  } catch (err) { next(err); }
});

router.post('/novo', upload.single('foto'), verifyCsrf, async (req, res, next) => {
  try {
    const { v, erros } = validar(req.body, { novo: true });
    let foto = null, fotoTipo = null;
    if (req.file && req.file.size) {
      fotoTipo = tipoImagem(req.file.buffer);
      if (!fotoTipo) erros.push('A foto deve ser JPG, PNG ou WEBP.');
      else foto = req.file.buffer;
    }
    if (erros.length) {
      return res.status(400).render('equipamentos/form', { novo: true, item: { ...req.body, valor_desconhecido: !!req.body.valor_desconhecido }, erros, ...(await formOpcoes()) });
    }

    const criados = await criarEquipamentos(v, { foto, fotoTipo, usuarioId: req.user.id, origem: 'web' })
      .then((l) => l.map((x) => x.id))
      .catch(async (err) => {
        if (err.usuario) {
          res.status(400).render('equipamentos/form', { novo: true, item: req.body, erros: [err.message], ...(await formOpcoes()) });
          return null;
        }
        throw err;
      });
    if (!criados) return;
    if (criados.length === 1) {
      flash(req, 'sucesso', 'Equipamento cadastrado.');
      return res.redirect(`/equipamentos/${criados[0]}`);
    }
    res.redirect(`/equipamentos/lote?ids=${criados.join(',')}`);
  } catch (err) { next(err); }
});

router.get('/lote', async (req, res, next) => {
  try {
    const ids = idsLista(req.query.ids).slice(0, 500);
    const { rows } = await query(`${inv.SELECT_EQUIP} WHERE e.id = ANY($1) ORDER BY e.sequencial`, [ids]);
    res.render('equipamentos/lote', { itens: rows });
  } catch (err) { next(err); }
});

// ---------- Ficha ----------
router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const item = await carregar(req.params.id);
    if (!item) return res.status(404).render('erro', { titulo: 'Item não encontrado', mensagem: 'Equipamento inexistente.' });
    const [hist, extra] = await Promise.all([
      query(`
        SELECT m.*, so.codigo AS origem_codigo, so.nome AS origem_nome, sd.codigo AS destino_codigo, sd.nome AS destino_nome, u.nome AS usuario, u.login AS usuario_login
          FROM movimentacoes m
          LEFT JOIN setores so ON so.id = m.setor_origem_id
          LEFT JOIN setores sd ON sd.id = m.setor_destino_id
          JOIN usuarios u ON u.id = m.usuario_id
         WHERE m.equipamento_id = $1 ORDER BY m.registrado_em DESC, m.id DESC`, [item.id]),
      query(`SELECT e.criado_em, e.atualizado_em, uc.nome AS criado_por, ua.nome AS atualizado_por
               FROM equipamentos e LEFT JOIN usuarios uc ON uc.id = e.criado_por LEFT JOIN usuarios ua ON ua.id = e.atualizado_por
              WHERE e.id = $1`, [item.id]),
    ]);
    res.render('equipamentos/ficha', { item, historico: hist.rows, meta: extra.rows[0] });
  } catch (err) { next(err); }
});

router.get('/:id(\\d+)/foto', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT foto, foto_tipo FROM equipamentos WHERE id = $1', [req.params.id]);
    if (!rows[0] || !rows[0].foto) return res.status(404).end();
    res.set({ 'Content-Type': rows[0].foto_tipo, 'Cache-Control': 'private, max-age=300' });
    res.send(rows[0].foto);
  } catch (err) { next(err); }
});

// ---------- Edição ----------
router.get('/:id(\\d+)/editar', async (req, res, next) => {
  try {
    const item = await carregar(req.params.id);
    if (!item) return res.status(404).render('erro', { titulo: 'Item não encontrado', mensagem: 'Equipamento inexistente.' });
    if (item.situacao === 'baixado') { flash(req, 'aviso', 'Itens baixados não podem ser editados.'); return res.redirect(`/equipamentos/${item.id}`); }
    const cat = await query('SELECT categoria_id FROM equipamentos WHERE id = $1', [item.id]);
    res.render('equipamentos/form', {
      novo: false,
      item: { ...item, categoria_id: cat.rows[0].categoria_id, valor_desconhecido: item.valor_aquisicao === null,
        valor_aquisicao: item.valor_aquisicao === null ? '' : String(item.valor_aquisicao).replace('.', ',') },
      erros: [], ...(await formOpcoes()),
    });
  } catch (err) { next(err); }
});

router.post('/:id(\\d+)/editar', upload.single('foto'), verifyCsrf, async (req, res, next) => {
  try {
    const id = int(req.params.id);
    const { v, erros } = validar(req.body, { novo: false });
    let foto, fotoTipo;
    if (req.file && req.file.size) {
      fotoTipo = tipoImagem(req.file.buffer);
      if (!fotoTipo) erros.push('A foto deve ser JPG, PNG ou WEBP.');
      else foto = req.file.buffer;
    }
    const atual = await carregar(id);
    if (!atual) return res.status(404).render('erro', { titulo: 'Item não encontrado', mensagem: 'Equipamento inexistente.' });
    if (erros.length) {
      return res.status(400).render('equipamentos/form', {
        novo: false, item: { ...atual, ...req.body, valor_desconhecido: !!req.body.valor_desconhecido }, erros, ...(await formOpcoes()),
      });
    }
    const resultado = await transaction(async (c) => {
      const { rows } = await c.query('SELECT * FROM equipamentos WHERE id = $1 FOR UPDATE', [id]);
      const old = rows[0];
      if (old.situacao === 'baixado') return 'baixado';
      const campos = ['descricao', 'categoria_id', 'marca', 'modelo', 'numero_serie', 'responsavel', 'data_aquisicao', 'valor_aquisicao', 'estado', 'situacao', 'observacoes'];
      const mudancas = {};
      const norm = (k, x) => (x === null || x === undefined ? null : k === 'valor_aquisicao' ? Number(x).toFixed(2) : String(x));
      for (const k of campos) {
        if (norm(k, old[k]) !== norm(k, v[k])) mudancas[k] = { de: old[k], para: v[k] };
      }
      if (mudancas.categoria_id) {
        const cs = await c.query('SELECT id, nome FROM categorias WHERE id = ANY($1)', [[old.categoria_id, v.categoria_id]]);
        const nome = Object.fromEntries(cs.rows.map((r) => [r.id, r.nome]));
        if (!nome[v.categoria_id]) { const e = new Error('Categoria inválida.'); e.usuario = true; throw e; }
        mudancas.categoria = { de: nome[old.categoria_id], para: nome[v.categoria_id] };
        delete mudancas.categoria_id;
      }
      const removerFoto = !!req.body.remover_foto && !foto;
      if (foto) mudancas.foto = { de: old.foto ? 'foto anterior' : null, para: 'nova foto' };
      else if (removerFoto && old.foto) mudancas.foto = { de: 'foto', para: null };
      if (!Object.keys(mudancas).length) return 'sem_mudancas';

      await c.query(
        `UPDATE equipamentos SET descricao=$2, categoria_id=$3, marca=$4, modelo=$5, numero_serie=$6, responsavel=$7,
           data_aquisicao=$8, valor_aquisicao=$9, estado=$10, situacao=$11, observacoes=$12,
           foto = CASE WHEN $13::bytea IS NOT NULL THEN $13::bytea WHEN $15 THEN NULL ELSE foto END,
           foto_tipo = CASE WHEN $13::bytea IS NOT NULL THEN $14 WHEN $15 THEN NULL ELSE foto_tipo END,
           atualizado_em = now(), atualizado_por = $16
         WHERE id = $1`,
        [id, v.descricao, v.categoria_id, v.marca, v.modelo, v.numero_serie, v.responsavel, v.data_aquisicao, v.valor_aquisicao,
          v.estado, v.situacao, v.observacoes, foto || null, fotoTipo || null, removerFoto, req.user.id]);
      await c.query(
        `INSERT INTO movimentacoes (equipamento_id, tipo, data_movimentacao, setor_origem_id, setor_destino_id, responsavel_anterior, responsavel_novo, usuario_id, detalhes)
         VALUES ($1, 'edicao', $2, $3, $3, $4, $5, $6, $7)`,
        [id, hoje(), old.setor_id, mudancas.responsavel ? old.responsavel : null, mudancas.responsavel ? v.responsavel : null, req.user.id, { campos: mudancas }]);
      return 'ok';
    });
    if (resultado === 'baixado') flash(req, 'aviso', 'Itens baixados não podem ser editados.');
    else if (resultado === 'sem_mudancas') flash(req, 'info', 'Nenhuma alteração foi feita.');
    else flash(req, 'sucesso', 'Ficha atualizada.');
    res.redirect(`/equipamentos/${id}`);
  } catch (err) {
    if (err.usuario) { flash(req, 'erro', err.message); return res.redirect(`/equipamentos/${req.params.id}/editar`); }
    next(err);
  }
});

// ---------- Transferência ----------
router.get('/:id(\\d+)/transferir', async (req, res, next) => {
  try {
    const item = await carregar(req.params.id);
    if (!item) return res.status(404).render('erro', { titulo: 'Item não encontrado', mensagem: 'Equipamento inexistente.' });
    if (item.situacao === 'baixado') { flash(req, 'aviso', 'Itens baixados não podem ser transferidos.'); return res.redirect(`/equipamentos/${item.id}`); }
    const o = await formOpcoes();
    res.render('equipamentos/transferir', { item, setores: o.setores, responsaveis: o.responsaveis, erros: [], form: { data: hoje(), setor_destino_id: '', responsavel: item.responsavel || '' } });
  } catch (err) { next(err); }
});

router.post('/:id(\\d+)/transferir', async (req, res, next) => {
  try {
    const id = int(req.params.id);
    const item = await carregar(id);
    if (!item) return res.status(404).render('erro', { titulo: 'Item não encontrado', mensagem: 'Equipamento inexistente.' });
    const destino = int(req.body.setor_destino_id);
    const responsavel = texto(req.body.responsavel, 120);
    const dt = parseData(req.body.data);
    const obs = texto(req.body.observacoes, 1000);
    const erros = [];
    if (!destino) erros.push('Selecione o setor de destino.');
    if (!dt) erros.push('Informe uma data válida.');
    else if (dt > hoje()) erros.push('A data da transferência não pode estar no futuro.');
    if (destino === item.setor_id && (responsavel || null) === (item.responsavel || null)) {
      erros.push('Selecione outro setor ou informe um novo responsável.');
    }
    if (erros.length) {
      const o = await formOpcoes();
      return res.status(400).render('equipamentos/transferir', { item, setores: o.setores, responsaveis: o.responsaveis, erros, form: { ...req.body } });
    }
    const r = await transaction(async (c) => {
      const { rows } = await c.query('SELECT setor_id, responsavel, situacao FROM equipamentos WHERE id = $1 FOR UPDATE', [id]);
      const old = rows[0];
      if (old.situacao === 'baixado') return 'Itens baixados não podem ser transferidos.';
      const s = await c.query('SELECT id FROM setores WHERE id = $1 AND ativo', [destino]);
      if (!s.rowCount) return 'Setor de destino inválido ou inativo.';
      const tipo = destino !== old.setor_id ? 'transferencia' : 'responsavel';
      await c.query('UPDATE equipamentos SET setor_id = $2, responsavel = $3, atualizado_em = now(), atualizado_por = $4 WHERE id = $1',
        [id, destino, responsavel, req.user.id]);
      await c.query(
        `INSERT INTO movimentacoes (equipamento_id, tipo, data_movimentacao, setor_origem_id, setor_destino_id, responsavel_anterior, responsavel_novo, observacoes, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, tipo, dt, old.setor_id, destino, old.responsavel, responsavel, obs, req.user.id]);
      return tipo;
    });
    if (r !== 'transferencia' && r !== 'responsavel') { flash(req, 'erro', r); return res.redirect(`/equipamentos/${id}`); }
    flash(req, 'sucesso', r === 'transferencia'
      ? `Transferência registrada. O código ${item.codigo} foi mantido.`
      : 'Responsável atualizado.');
    res.redirect(`/equipamentos/${id}`);
  } catch (err) { next(err); }
});

// ---------- Baixa ----------
router.get('/:id(\\d+)/baixa', async (req, res, next) => {
  try {
    const item = await carregar(req.params.id);
    if (!item) return res.status(404).render('erro', { titulo: 'Item não encontrado', mensagem: 'Equipamento inexistente.' });
    if (item.situacao === 'baixado') { flash(req, 'aviso', 'Este item já foi baixado.'); return res.redirect(`/equipamentos/${item.id}`); }
    res.render('equipamentos/baixa', { item, erros: [], form: { data: hoje() }, MOTIVOS_BAIXA });
  } catch (err) { next(err); }
});

router.post('/:id(\\d+)/baixa', async (req, res, next) => {
  try {
    const id = int(req.params.id);
    const item = await carregar(id);
    if (!item) return res.status(404).render('erro', { titulo: 'Item não encontrado', mensagem: 'Equipamento inexistente.' });
    const dt = parseData(req.body.data);
    const motivo = MOTIVOS_BAIXA[req.body.motivo] ? req.body.motivo : null;
    const obs = texto(req.body.observacoes, 2000);
    const erros = [];
    if (!dt) erros.push('Informe a data da baixa.');
    else if (dt > hoje()) erros.push('A data da baixa não pode estar no futuro.');
    if (!motivo) erros.push('Selecione o motivo da baixa.');
    if (motivo === 'outro' && !obs) erros.push('Descreva o motivo nas observações.');
    if (req.body.confirmar !== 'sim') erros.push('Confirme que deseja registrar a baixa.');
    if (erros.length) return res.status(400).render('equipamentos/baixa', { item, erros, form: req.body, MOTIVOS_BAIXA });

    const ok = await transaction(async (c) => {
      const { rows } = await c.query('SELECT situacao, setor_id, responsavel FROM equipamentos WHERE id = $1 FOR UPDATE', [id]);
      if (rows[0].situacao === 'baixado') return false;
      await c.query(
        `UPDATE equipamentos SET situacao = 'baixado', baixa_data = $2, baixa_motivo = $3, baixa_observacoes = $4,
           baixa_registrada_em = now(), baixa_usuario_id = $5, atualizado_em = now(), atualizado_por = $5 WHERE id = $1`,
        [id, dt, motivo, obs, req.user.id]);
      await c.query(
        `INSERT INTO movimentacoes (equipamento_id, tipo, data_movimentacao, setor_origem_id, responsavel_anterior, observacoes, usuario_id, detalhes)
         VALUES ($1, 'baixa', $2, $3, $4, $5, $6, $7)`,
        [id, dt, rows[0].setor_id, rows[0].responsavel, obs, req.user.id,
          { motivo, situacao_anterior: rows[0].situacao, valor: item.valor_aquisicao }]);
      return true;
    });
    flash(req, ok ? 'sucesso' : 'aviso', ok ? `Baixa do item ${item.codigo} registrada.` : 'Este item já havia sido baixado.');
    res.redirect(`/equipamentos/${id}`);
  } catch (err) { next(err); }
});

module.exports = router;
