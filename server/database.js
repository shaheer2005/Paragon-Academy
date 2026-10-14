import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import pg from 'pg'

const transactionStorage = new AsyncLocalStorage()
const { Pool, types } = pg

types.setTypeParser(20, Number)

export function postgresSql(sql) {
  let index = 0
  const ignoreConflicts = /\bINSERT OR IGNORE INTO\b/i.test(sql)
  const statement = sql
    .replace(/\bINSERT OR IGNORE INTO\b/gi, 'INSERT INTO')
    .replace(/\s+COLLATE NOCASE\b/gi, '')
    .replace(/\bMAX\(lesson_progress\.watched_seconds, excluded\.watched_seconds\)/gi, 'GREATEST(lesson_progress.watched_seconds, excluded.watched_seconds)')
    .replace(/\bMAX\(lesson_progress\.completed, excluded\.completed\)/gi, 'GREATEST(lesson_progress.completed, excluded.completed)')
    .replace(/\?/g, () => `$${++index}`)
  return ignoreConflicts && !/\bON CONFLICT\b/i.test(statement)
    ? `${statement.trimEnd()} ON CONFLICT DO NOTHING`
    : statement
}

export function createDatabase({
  dataDir,
  databaseUrl = process.env.DATABASE_URL,
  PoolClass = Pool,
} = {}) {
  if (databaseUrl) {
    const pool = new PoolClass({ connectionString: databaseUrl })
    const query = async (sql, parameters = []) => {
      const client = transactionStorage.getStore()
      return (client || pool).query(postgresSql(sql), parameters)
    }

    return {
      isPostgres: true,
      prepare(sql) {
        return {
          get: async (...parameters) => (await query(sql, parameters)).rows[0],
          all: async (...parameters) => (await query(sql, parameters)).rows,
          run: async (...parameters) => ({ changes: (await query(sql, parameters)).rowCount }),
        }
      },
      exec: async (sql) => { await query(sql) },
      pragma: () => undefined,
      transaction(callback) {
        return async (...args) => {
          const client = await pool.connect()
          try {
            await client.query('BEGIN')
            const result = await transactionStorage.run(client, callback, ...args)
            await client.query('COMMIT')
            return result
          } catch (error) {
            await client.query('ROLLBACK')
            throw error
          } finally {
            client.release()
          }
        }
      },
      close: () => pool.end(),
    }
  }

  if (process.env.NODE_ENV === 'production' && process.env.DB_DRIVER !== 'test-sqlite') {
    throw new Error('DATABASE_URL must be configured for production.')
  }

  const resolvedDataDir = path.resolve(dataDir)
  fs.mkdirSync(resolvedDataDir, { recursive: true })
  const sqlite = new Database(path.join(resolvedDataDir, 'lessonwell.sqlite'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  return {
    isPostgres: false,
    prepare: (sql) => sqlite.prepare(sql),
    exec: (sql) => sqlite.exec(sql),
    pragma: (sql) => sqlite.pragma(sql),
    transaction(callback) {
      return async (...args) => {
        sqlite.exec('BEGIN')
        try {
          const result = await callback(...args)
          sqlite.exec('COMMIT')
          return result
        } catch (error) {
          sqlite.exec('ROLLBACK')
          throw error
        }
      }
    },
    close: () => sqlite.close(),
  }
}
