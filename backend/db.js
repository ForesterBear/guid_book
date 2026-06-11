// db.js — PostgreSQL pool з mysql2-сумісним інтерфейсом
// ─────────────────────────────────────────────────────
// Замінює mysql2 без переписування всього index.js:
//  • "?" placeholder автоматично конвертується в "$1, $2 ..."
//  • INSERT автоматично отримує RETURNING id → result.insertId
//  • pool.query(sql, params) повертає [rows] як mysql2
//  • pool.getConnection() повертає { query, release }

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:                   process.env.DB_HOST     || 'localhost',
  port:                   parseInt(process.env.DB_PORT) || 5432,
  user:                   process.env.DB_USER     || 'postgres',
  password:               process.env.DB_PASSWORD,
  database:               process.env.DB_NAME     || 'guid_book',
  max:                    10,
  idleTimeoutMillis:      30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('PG pool error:', err.message);
});

// ── Конвертація ? → $n ───────────────────────────────
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ── Головна обгортка: mysql2-сумісна ─────────────────
async function query(sql, params = []) {
  let pgSql = convertPlaceholders(sql);

  const isInsert = /^\s*INSERT/i.test(pgSql.trimStart());
  if (isInsert && !/RETURNING/i.test(pgSql)) {
    pgSql = pgSql.replace(/;?\s*$/, '') + ' RETURNING id';
  }

  const result = await pool.query(pgSql, params);

  if (isInsert) {
    // Повертаємо mysql2-like ResultSetHeader
    return [{ insertId: result.rows[0]?.id ?? null, affectedRows: result.rowCount }];
  }
  return [result.rows];
}

// ── getConnection для транзакцій (mysql2-сумісна) ────
async function getConnection() {
  const client = await pool.connect();

  async function clientQuery(sql, params = []) {
    let pgSql = convertPlaceholders(sql);
    const isInsert = /^\s*INSERT/i.test(pgSql.trimStart());
    if (isInsert && !/RETURNING/i.test(pgSql)) {
      pgSql = pgSql.replace(/;?\s*$/, '') + ' RETURNING id';
    }
    const result = await client.query(pgSql, params);
    if (isInsert) return [{ insertId: result.rows[0]?.id ?? null, affectedRows: result.rowCount }];
    return [result.rows];
  }

  return {
    query:   clientQuery,
    release: () => client.release(),
    _client: client,
  };
}

module.exports = { query, getConnection, pool };
