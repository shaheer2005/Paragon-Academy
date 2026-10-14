import assert from 'node:assert/strict'
import test from 'node:test'
import { createDatabase, postgresSql } from '../server/database.js'

test('translates SQLite placeholders and case-insensitive syntax for PostgreSQL', () => {
  assert.equal(
    postgresSql('SELECT * FROM coupons WHERE code = ? COLLATE NOCASE AND active = ?'),
    'SELECT * FROM coupons WHERE code = $1 AND active = $2',
  )
})

test('translates SQLite ignore-conflicts and scalar MAX to PostgreSQL syntax', () => {
  assert.equal(
    postgresSql('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)'),
    'INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING',
  )
  assert.equal(
    postgresSql(`UPDATE lesson_progress SET watched_seconds = MAX(lesson_progress.watched_seconds, excluded.watched_seconds)
      WHERE student_email = ?`),
    `UPDATE lesson_progress SET watched_seconds = GREATEST(lesson_progress.watched_seconds, excluded.watched_seconds)
      WHERE student_email = $1`,
  )
})

test('PostgreSQL adapter awaits query results and runs callbacks in a transaction', async () => {
  const queries = []
  const transactionClient = {
    async query(sql, parameters) {
      queries.push({ sql, parameters })
      return { rows: [{ email: 'student@example.invalid' }], rowCount: 1 }
    },
    release() {},
  }
  class TestPool {
    constructor(options) {
      assert.equal(options.connectionString, 'postgres://example.invalid/test')
    }

    async query(sql, parameters) {
      queries.push({ sql, parameters })
      return { rows: [{ email: 'student@example.invalid' }], rowCount: 1 }
    }

    async connect() {
      return transactionClient
    }

    async end() {}
  }

  const db = createDatabase({ databaseUrl: 'postgres://example.invalid/test', PoolClass: TestPool })
  const row = await db.prepare('SELECT email FROM users WHERE email = ?').get('student@example.invalid')
  assert.equal(row.email, 'student@example.invalid')
  assert.deepEqual(queries[0], {
    sql: 'SELECT email FROM users WHERE email = $1',
    parameters: ['student@example.invalid'],
  })

  await db.transaction(async () => {
    await db.prepare('INSERT INTO sessions (token_hash) VALUES (?)').run('token-hash')
  })()
  assert.deepEqual(queries.slice(1).map(({ sql }) => sql), [
    'BEGIN',
    'INSERT INTO sessions (token_hash) VALUES ($1)',
    'COMMIT',
  ])
})

test('PostgreSQL transactions roll back when their callback fails', async () => {
  const queries = []
  const transactionClient = {
    async query(sql) {
      queries.push(sql)
      return { rows: [], rowCount: 0 }
    },
    release() {},
  }
  class TestPool {
    async connect() {
      return transactionClient
    }

    async end() {}
  }

  const db = createDatabase({ databaseUrl: 'postgres://example.invalid/test', PoolClass: TestPool })
  await assert.rejects(db.transaction(async () => {
    throw new Error('transaction failure')
  })(), /transaction failure/)
  assert.deepEqual(queries, ['BEGIN', 'ROLLBACK'])
})
