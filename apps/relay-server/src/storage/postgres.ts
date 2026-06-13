/* eslint-disable max-lines -- Postgres storage owns snapshot and forwarding payload persistence together. */
import process from 'node:process'

import postgres from 'postgres'

import { measureJsonPayloadSize, measurePayloadSize } from '../session-forwarding/payloads.js'
import type {
  RelayForwardingPayload,
  RelayForwardingPayloadRepository,
  RelayForwardingResultPayload
} from '../session-forwarding/payloads.js'
import { normalizeRelayStore } from '../store.js'
import type { RelayStore } from '../types.js'
import { sanitizeRelayStorageValue } from './content-boundary.js'
import type { RelayStoreRepository } from './repository.js'

const STORE_ID = 'main'

interface RelayPostgresStoreRow {
  store_json: string
}

interface RelayPostgresPayloadRow {
  payload_json: string
  request_id?: string | null
  size_bytes: number
}

type RelayPostgresSql = postgres.Sql | postgres.TransactionSql

export interface PostgresRelayStoreRepositoryOptions {
  connectionString: string
}

const parseStoreJson = (value: unknown): RelayStore => {
  if (typeof value !== 'string' || value.trim() === '') return normalizeRelayStore(undefined)
  try {
    return normalizeRelayStore(JSON.parse(value))
  } catch {
    return normalizeRelayStore(undefined)
  }
}

const serializeStoreJson = (store: RelayStore) => JSON.stringify(sanitizeRelayStorageValue(store))

const createPostgresClient = (connectionString: string) => {
  if (connectionString.trim() === '') {
    throw new Error(
      'Postgres Relay storage requires ONEWORKS_RELAY_POSTGRES_URL, DATABASE_URL, or --data set to a Postgres URL.'
    )
  }
  return postgres(connectionString, {
    max: Number(process.env.ONEWORKS_RELAY_POSTGRES_POOL_MAX || '3'),
    prepare: false
  })
}

const initializePostgresRelayStore = async (sql: RelayPostgresSql) => {
  await sql`
    CREATE TABLE IF NOT EXISTS relay_store_snapshots (
      id TEXT PRIMARY KEY CHECK (id = 'main'),
      schema_version INTEGER NOT NULL,
      store_json TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS relay_forwarding_payloads (
      job_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('payload', 'result')),
      payload_json TEXT NOT NULL,
      request_id TEXT,
      size_bytes INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (job_id, kind)
    )
  `
}

const ensureStoreRow = async (sql: RelayPostgresSql) => {
  await sql`
    INSERT INTO relay_store_snapshots (id, schema_version, store_json, updated_at)
    VALUES (${STORE_ID}, 1, ${serializeStoreJson(normalizeRelayStore(undefined))}, NOW())
    ON CONFLICT (id) DO NOTHING
  `
}

const writeStoreSnapshot = async (sql: RelayPostgresSql, store: RelayStore) => {
  await sql`
    INSERT INTO relay_store_snapshots (id, schema_version, store_json, updated_at)
    VALUES (${STORE_ID}, 1, ${serializeStoreJson(store)}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      schema_version = EXCLUDED.schema_version,
      store_json = EXCLUDED.store_json,
      updated_at = EXCLUDED.updated_at
  `
}

const readStoreSnapshot = async (sql: RelayPostgresSql) => {
  await initializePostgresRelayStore(sql)
  await ensureStoreRow(sql)
  const rows = await sql<RelayPostgresStoreRow[]>`
    SELECT store_json
    FROM relay_store_snapshots
    WHERE id = ${STORE_ID}
  `
  return parseStoreJson(rows[0]?.store_json)
}

const createPostgresForwardingPayloadRepository = (sql: postgres.Sql): RelayForwardingPayloadRepository => {
  const readPayload = async (jobId: string, kind: 'payload' | 'result') => {
    await initializePostgresRelayStore(sql)
    const rows = await sql<RelayPostgresPayloadRow[]>`
      SELECT payload_json, request_id, size_bytes
      FROM relay_forwarding_payloads
      WHERE job_id = ${jobId} AND kind = ${kind}
    `
    return rows[0]
  }

  const deletePayload = async (jobId: string, kind: 'payload' | 'result') => {
    await initializePostgresRelayStore(sql)
    await sql`
      DELETE FROM relay_forwarding_payloads
      WHERE job_id = ${jobId} AND kind = ${kind}
    `
  }

  return {
    clearPayload: async jobId => {
      await deletePayload(jobId, 'payload')
    },
    clearResult: async jobId => {
      await deletePayload(jobId, 'result')
    },
    consumePayload: async jobId =>
      await sql.begin(async tx => {
        await initializePostgresRelayStore(tx)
        const rows = await tx<RelayPostgresPayloadRow[]>`
          SELECT payload_json, request_id, size_bytes
          FROM relay_forwarding_payloads
          WHERE job_id = ${jobId} AND kind = 'payload'
          FOR UPDATE
        `
        await tx`
          DELETE FROM relay_forwarding_payloads
          WHERE job_id = ${jobId} AND kind = 'payload'
        `
        const row = rows[0]
        if (row == null) return undefined
        const parsed = JSON.parse(row.payload_json) as { message?: unknown }
        if (typeof parsed.message !== 'string') return undefined
        return {
          message: parsed.message,
          payloadSize: row.size_bytes,
          requestId: row.request_id ?? undefined
        } satisfies RelayForwardingPayload
      }),
    consumeResult: async jobId =>
      await sql.begin(async tx => {
        await initializePostgresRelayStore(tx)
        const rows = await tx<RelayPostgresPayloadRow[]>`
          SELECT payload_json, size_bytes
          FROM relay_forwarding_payloads
          WHERE job_id = ${jobId} AND kind = 'result'
          FOR UPDATE
        `
        await tx`
          DELETE FROM relay_forwarding_payloads
          WHERE job_id = ${jobId} AND kind = 'result'
        `
        const row = rows[0]
        if (row == null) return undefined
        return {
          result: JSON.parse(row.payload_json).result,
          resultSize: row.size_bytes
        } satisfies RelayForwardingResultPayload
      }),
    getPayload: async jobId => {
      const row = await readPayload(jobId, 'payload')
      if (row == null) return undefined
      const parsed = JSON.parse(row.payload_json) as { message?: unknown }
      if (typeof parsed.message !== 'string') return undefined
      return {
        message: parsed.message,
        payloadSize: row.size_bytes,
        requestId: row.request_id ?? undefined
      }
    },
    hasResult: async jobId => (await readPayload(jobId, 'result')) != null,
    rememberPayload: async (jobId, input) => {
      await initializePostgresRelayStore(sql)
      const payloadSize = measurePayloadSize(input.message)
      await sql`
        INSERT INTO relay_forwarding_payloads (job_id, kind, payload_json, request_id, size_bytes, created_at)
        VALUES (${jobId}, 'payload', ${JSON.stringify({ message: input.message })}, ${
        input.requestId ?? null
      }, ${payloadSize}, NOW())
        ON CONFLICT (job_id, kind) DO UPDATE SET
          payload_json = EXCLUDED.payload_json,
          request_id = EXCLUDED.request_id,
          size_bytes = EXCLUDED.size_bytes,
          created_at = EXCLUDED.created_at
      `
      return {
        message: input.message,
        payloadSize,
        requestId: input.requestId
      }
    },
    rememberResult: async (jobId, result) => {
      await initializePostgresRelayStore(sql)
      const resultSize = measureJsonPayloadSize(result)
      await sql`
        INSERT INTO relay_forwarding_payloads (job_id, kind, payload_json, request_id, size_bytes, created_at)
        VALUES (${jobId}, 'result', ${JSON.stringify({ result })}, NULL, ${resultSize}, NOW())
        ON CONFLICT (job_id, kind) DO UPDATE SET
          payload_json = EXCLUDED.payload_json,
          request_id = EXCLUDED.request_id,
          size_bytes = EXCLUDED.size_bytes,
          created_at = EXCLUDED.created_at
      `
      return {
        result,
        resultSize
      }
    }
  }
}

export const createPostgresRelayStoreRepository = (
  options: PostgresRelayStoreRepositoryOptions
): RelayStoreRepository => {
  const sql = createPostgresClient(options.connectionString)
  const forwardingPayloads = createPostgresForwardingPayloadRepository(sql)
  return {
    driver: 'postgres',
    forwardingPayloads,
    location: options.connectionString.replace(/:\/\/([^:@]+):([^@]+)@/, '://$1:***@'),
    read: async () => await readStoreSnapshot(sql),
    withStore: async <T>(callback: (store: RelayStore, repository: RelayStoreRepository) => Promise<T>) => {
      const result = await sql.begin(async tx => {
        await initializePostgresRelayStore(tx)
        await ensureStoreRow(tx)
        const rows = await tx<RelayPostgresStoreRow[]>`
          SELECT store_json
          FROM relay_store_snapshots
          WHERE id = ${STORE_ID}
          FOR UPDATE
        `
        let currentStore = parseStoreJson(rows[0]?.store_json)
        const scopedRepository: RelayStoreRepository = {
          driver: 'postgres',
          forwardingPayloads,
          location: options.connectionString,
          read: async () => currentStore,
          write: async store => {
            currentStore = store
            await writeStoreSnapshot(tx, store)
          }
        }
        return await callback(currentStore, scopedRepository)
      })
      return result as T
    },
    write: async store => {
      await initializePostgresRelayStore(sql)
      await writeStoreSnapshot(sql, store)
    }
  }
}
