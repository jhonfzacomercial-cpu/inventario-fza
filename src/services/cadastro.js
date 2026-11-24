'use strict';
// Criação de equipamentos — usada pelo formulário web.
const { transaction } = require('../db');
const { hoje, formatarCodigo } = require('../util');

const MAX_QTD = 200;

function tipoImagem(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

class ErroUsuario extends Error {
  constructor(msg) { super(msg); this.usuario = true; }
}

/**
 * Cria `v.quantidade` fichas, cada uma com seu código FZA.<setor>.<seq>.
 * v: { setor_id, quantidade, series[], descricao, categoria_id, marca, modelo, responsavel,
 *      data_aquisicao, valor_aquisicao, estado, situacao, observacoes }
 * Retorna [{ id, codigo }].
 */
async function criarEquipamentos(v, { foto = null, fotoTipo = null, usuarioId, origem = 'web' }) {
  return transaction(async (c) => {
    // O UPDATE trava a linha do setor até o COMMIT: cadastros simultâneos
    // no mesmo setor são serializados e nunca recebem o mesmo número.
    const r = await c.query(
      `UPDATE setores SET ultimo_sequencial = ultimo_sequencial + $2, atualizado_em = now()
        WHERE id = $1 AND ativo RETURNING codigo, ultimo_sequencial`, [v.setor_id, v.quantidade]);
    if (!r.rowCount) throw new ErroUsuario('Setor inválido ou inativo.');
    const cat = await c.query('SELECT 1 FROM categorias WHERE id = $1', [v.categoria_id]);
    if (!cat.rowCount) throw new ErroUsuario('Categoria inválida.');
    const { codigo: codSetor, ultimo_sequencial: ultimo } = r.rows[0];
    const primeiro = ultimo - v.quantidade + 1;
    const criados = [];
    for (let i = 0; i < v.quantidade; i++) {
      const seq = primeiro + i;
      const codigo = formatarCodigo(codSetor, seq);
      const ins = await c.query(
        `INSERT INTO equipamentos (codigo, setor_origem_id, sequencial, descricao, categoria_id, marca, modelo, numero_serie,
           setor_id, responsavel, data_aquisicao, valor_aquisicao, estado, situacao, observacoes, foto, foto_tipo, criado_por, atualizado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$2,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING id`,
        [codigo, v.setor_id, seq, v.descricao, v.categoria_id, v.marca, v.modelo, (v.series || [])[i] || null,
          v.responsavel, v.data_aquisicao, v.valor_aquisicao, v.estado, v.situacao, v.observacoes, foto, fotoTipo, usuarioId]);
      const id = ins.rows[0].id;
      criados.push({ id, codigo });
      await c.query(
        `INSERT INTO movimentacoes (equipamento_id, tipo, data_movimentacao, setor_destino_id, responsavel_novo, usuario_id, detalhes)
         VALUES ($1, 'cadastro', $2, $3, $4, $5, $6)`,
        [id, hoje(), v.setor_id, v.responsavel, usuarioId,
          { codigo, origem, lote: v.quantidade > 1 ? `${i + 1}/${v.quantidade}` : undefined }]);
    }
    return criados;
  });
}

module.exports = { criarEquipamentos, tipoImagem, ErroUsuario, MAX_QTD };
