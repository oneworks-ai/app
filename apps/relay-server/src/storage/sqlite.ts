import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite'

import { normalizeRelayStore } from '../store.js'
import type { RelayStore } from '../types.js'
import { sanitizeRelayStorageValue } from './content-boundary.js'
import type { RelayStoreRepository } from './repository.js'

const nodeRequire = createRequire(__filename)
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite')

const SQLITE_SCHEMA_VERSION = 1
const SQLITE_STORE_ID = 'main'

interface StoreRow {
  store_json: string
}

const sqliteOperationQueues = new Map<string, Promise<void>>()

const normalizeSqliteDataPath = (dataPath: string) => (
  dataPath === ':memory:' ? dataPath : resolve(dataPath)
)

const withSqliteOperationQueue = async <T>(dataPath: string, callback: () => Promise<T>) => {
  const queueKey = normalizeSqliteDataPath(dataPath)
  const previous = sqliteOperationQueues.get(queueKey) ?? Promise.resolve()
  const operation = previous.then(callback)
  const settled = operation.then(() => undefined, () => undefined)
  sqliteOperationQueues.set(queueKey, settled)
  void settled.finally(() => {
    if (sqliteOperationQueues.get(queueKey) === settled) sqliteOperationQueues.delete(queueKey)
  })
  return await operation
}

const initializeSqliteRelayStore = (database: NodeDatabaseSync) => {
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS relay_store_snapshots (
      id TEXT PRIMARY KEY CHECK (id = 'main'),
      schema_version INTEGER NOT NULL,
      store_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

const openSqliteRelayStore = async (dataPath: string) => {
  const normalizedDataPath = normalizeSqliteDataPath(dataPath)
  if (normalizedDataPath !== ':memory:') {
    await mkdir(dirname(normalizedDataPath), { recursive: true })
  }
  const database = new DatabaseSync(normalizedDataPath)
  initializeSqliteRelayStore(database)
  return database
}

const withSqliteRelayStore = async <T>(
  dataPath: string,
  callback: (database: NodeDatabaseSync) => Promise<T> | T
) => {
  const database = await openSqliteRelayStore(dataPath)
  try {
    return await callback(database)
  } finally {
    database.close()
  }
}

const readStoreFromDatabase = (database: NodeDatabaseSync): RelayStore => {
  const row = database.prepare(`
    SELECT store_json
    FROM relay_store_snapshots
    WHERE id = ?
  `).get(SQLITE_STORE_ID) as StoreRow | undefined

  if (row == null) return normalizeRelayStore(undefined)
  try {
    return normalizeRelayStore(JSON.parse(row.store_json))
  } catch {
    return normalizeRelayStore(undefined)
  }
}

const writeStoreToDatabase = (database: NodeDatabaseSync, store: RelayStore) => {
  const storeJson = JSON.stringify(sanitizeRelayStorageValue(store))
  const updatedAt = new Date().toISOString()
  database.prepare(`
    INSERT INTO relay_store_snapshots (id, schema_version, store_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      schema_version = excluded.schema_version,
      store_json = excluded.store_json,
      updated_at = excluded.updated_at
  `).run(SQLITE_STORE_ID, SQLITE_SCHEMA_VERSION, storeJson, updatedAt)
}

export const readSqliteRelayStore = async (dataPath: string): Promise<RelayStore> =>
  await withSqliteOperationQueue(dataPath, async () => (
    await withSqliteRelayStore(dataPath, readStoreFromDatabase)
  ))

export const writeSqliteRelayStore = async (dataPath: string, store: RelayStore): Promise<void> => {
  await withSqliteOperationQueue(dataPath, async () => {
    await withSqliteRelayStore(dataPath, database => {
      database.exec('BEGIN IMMEDIATE')
      try {
        writeStoreToDatabase(database, store)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    })
  })
}

export const createSqliteRelayStoreRepository = (dataPath: string): RelayStoreRepository => {
  const memoryDatabase = dataPath === ':memory:' ? new DatabaseSync(':memory:') : undefined
  if (memoryDatabase != null) initializeSqliteRelayStore(memoryDatabase)
  const queueKey = memoryDatabase == null
    ? normalizeSqliteDataPath(dataPath)
    : `:memory:${randomUUID()}`
  const withRepositoryDatabase = async <T>(callback: (database: NodeDatabaseSync) => Promise<T> | T) => (
    memoryDatabase == null
      ? await withSqliteRelayStore(dataPath, callback)
      : await callback(memoryDatabase)
  )
  const repository: RelayStoreRepository = {
    driver: 'sqlite',
    location: dataPath,
    read: async () =>
      await withSqliteOperationQueue(queueKey, async () => (
        await withRepositoryDatabase(readStoreFromDatabase)
      )),
    withStore: async callback =>
      await withSqliteOperationQueue(queueKey, async () => {
        const database = memoryDatabase ?? await openSqliteRelayStore(dataPath)
        database.exec('BEGIN IMMEDIATE')
        try {
          let currentStore = readStoreFromDatabase(database)
          const scopedRepository: RelayStoreRepository = {
            driver: 'sqlite',
            location: dataPath,
            read: async () => currentStore,
            write: async store => {
              writeStoreToDatabase(database, store)
              currentStore = store
            }
          }
          const result = await callback(currentStore, scopedRepository)
          database.exec('COMMIT')
          return result
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        } finally {
          if (memoryDatabase == null) database.close()
        }
      }),
    write: async store => {
      await withSqliteOperationQueue(queueKey, async () => {
        await withRepositoryDatabase(async (database) => {
          database.exec('BEGIN IMMEDIATE')
          try {
            writeStoreToDatabase(database, store)
            database.exec('COMMIT')
          } catch (error) {
            database.exec('ROLLBACK')
            throw error
          }
        })
      })
    }
  }
  return repository
}
