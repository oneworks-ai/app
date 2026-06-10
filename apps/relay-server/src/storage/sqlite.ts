import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
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
  await mkdir(dirname(dataPath), { recursive: true })
  const database = new DatabaseSync(dataPath)
  initializeSqliteRelayStore(database)
  return database
}

const withSqliteRelayStore = async <T>(
  dataPath: string,
  callback: (database: NodeDatabaseSync) => T
) => {
  const database = await openSqliteRelayStore(dataPath)
  try {
    return callback(database)
  } finally {
    database.close()
  }
}

export const readSqliteRelayStore = async (dataPath: string): Promise<RelayStore> =>
  await withSqliteRelayStore(dataPath, database => {
    const row = database.prepare(`
      SELECT store_json
      FROM relay_store_snapshots
      WHERE id = ?
    `).get(SQLITE_STORE_ID) as StoreRow | undefined

    if (row == null) {
      return normalizeRelayStore(undefined)
    }

    try {
      return normalizeRelayStore(JSON.parse(row.store_json))
    } catch {
      return normalizeRelayStore(undefined)
    }
  })

export const writeSqliteRelayStore = async (dataPath: string, store: RelayStore): Promise<void> => {
  await withSqliteRelayStore(dataPath, database => {
    const storeJson = JSON.stringify(sanitizeRelayStorageValue(store))
    const updatedAt = new Date().toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        INSERT INTO relay_store_snapshots (id, schema_version, store_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          schema_version = excluded.schema_version,
          store_json = excluded.store_json,
          updated_at = excluded.updated_at
      `).run(SQLITE_STORE_ID, SQLITE_SCHEMA_VERSION, storeJson, updatedAt)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  })
}

export const createSqliteRelayStoreRepository = (dataPath: string): RelayStoreRepository => ({
  driver: 'sqlite',
  location: dataPath,
  read: async () => await readSqliteRelayStore(dataPath),
  write: async store => {
    await writeSqliteRelayStore(dataPath, store)
  }
})
