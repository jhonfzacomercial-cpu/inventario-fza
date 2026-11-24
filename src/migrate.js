'use strict';
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { pool, transaction } = require('./db');
const { hashPassword } = require('./auth');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function runMigrations() {
  const client = await pool.connect();
  try {
    // Lock consultivo: evita duas instâncias migrando ao mesmo tempo
    await client.query('SELECT pg_advisory_lock(834201)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      nome TEXT PRIMARY KEY, aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const { rows } = await client.query('SELECT nome FROM schema_migrations');
    const done = new Set(rows.map((r) => r.nome));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migração] aplicada: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${file}: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(834201)').catch(() => {});
    client.release();
  }
}

// Cria o administrador inicial "Adm" uma única vez.
async function seedAdmin() {
  await transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(834202)');
    const flag = await c.query("SELECT valor FROM sistema WHERE chave = 'admin_inicial_criado'");
    if (flag.rowCount > 0) return;
    const existing = await c.query("SELECT id FROM usuarios WHERE lower(login) = 'adm'");
    if (existing.rowCount === 0) {
      const senha = process.env.ADMIN_INITIAL_PASSWORD;
      if (!senha || senha.length < 8) {
        throw new Error('Defina ADMIN_INITIAL_PASSWORD (mínimo de 8 caracteres) para criar o usuário Adm no primeiro início.');
      }
      await c.query(
        `INSERT INTO usuarios (login, nome, senha_hash, perfil, trocar_senha) VALUES ('Adm', 'Administrador', $1, 'admin', TRUE)`,
        [await hashPassword(senha)]
      );
      await c.query(`INSERT INTO auditoria (acao, entidade, detalhes) VALUES ('criar', 'usuario', $1)`,
        [{ login: 'Adm', origem: 'inicializacao' }]);
      console.log('[inicialização] usuário administrador "Adm" criado. A troca de senha será exigida no primeiro acesso.');
    }
    await c.query("INSERT INTO sistema (chave, valor) VALUES ('admin_inicial_criado', now()::text)");
  });
}

module.exports = { runMigrations, seedAdmin };

if (require.main === module) {
  runMigrations()
    .then(seedAdmin)
    .then(() => { console.log('Banco de dados atualizado.'); return pool.end(); })
    .catch((err) => { console.error(err.message); process.exit(1); });
}
