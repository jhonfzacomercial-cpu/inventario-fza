'use strict';
const { Pool, types } = require('pg');

// DATE -> string 'YYYY-MM-DD' (evita deslocamento de fuso)
types.setTypeParser(1082, (v) => v);
// BIGINT (count) -> number
types.setTypeParser(20, (v) => parseInt(v, 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
});

async function query(text, params) {
  return pool.query(text, params);
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaction };
