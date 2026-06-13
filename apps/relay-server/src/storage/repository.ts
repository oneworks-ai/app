import process from 'node:process'

import type { RelayForwardingPayloadRepository } from '../session-forwarding/payloads.js'
import { readRelayStore, writeRelayStore } from '../store.js'
import type { RelayServerArgs, RelayStorageDriver, RelayStore } from '../types.js'
import { DEFAULT_RELAY_STORAGE_DRIVER, createUnimplementedStorageDriverError } from './drivers.js'

export interface RelayStoreRepository {
  driver: RelayStorageDriver
  forwardingPayloads?: RelayForwardingPayloadRepository
  location: string
  read: () => Promise<RelayStore>
  withStore?: <T>(
    callback: (store: RelayStore, repository: RelayStoreRepository) => Promise<T>
  ) => Promise<T>
  write: (store: RelayStore) => Promise<void>
}

export const createJsonRelayStoreRepository = (dataPath: string): RelayStoreRepository => {
  let queue = Promise.resolve()
  const repository: RelayStoreRepository = {
    driver: 'json',
    location: dataPath,
    read: async () => await readRelayStore(dataPath),
    withStore: async callback => {
      const run = queue.then(async () => await callback(await repository.read(), repository))
      queue = run.then(() => undefined, () => undefined)
      return await run
    },
    write: async store => {
      await writeRelayStore(dataPath, store)
    }
  }
  return repository
}

const redactConnectionString = (connectionString: string) =>
  connectionString.trim() === ''
    ? 'postgres'
    : connectionString.replace(/:\/\/([^:@]+):([^@]+)@/, '://$1:***@')

const createLazyForwardingPayloadRepository = (
  loadRepository: () => Promise<RelayStoreRepository>
): RelayForwardingPayloadRepository => {
  const loadPayloadRepository = async () => {
    const repository = (await loadRepository()).forwardingPayloads
    if (repository == null) {
      throw new Error('Relay forwarding payload repository is not available for this storage driver.')
    }
    return repository
  }

  return {
    clearPayload: async jobId => {
      await (await loadPayloadRepository()).clearPayload(jobId)
    },
    clearResult: async jobId => {
      await (await loadPayloadRepository()).clearResult(jobId)
    },
    consumePayload: async jobId => await (await loadPayloadRepository()).consumePayload(jobId),
    consumeResult: async jobId => await (await loadPayloadRepository()).consumeResult(jobId),
    getPayload: async jobId => await (await loadPayloadRepository()).getPayload(jobId),
    hasResult: async jobId => await (await loadPayloadRepository()).hasResult(jobId),
    rememberPayload: async (jobId, input) => await (await loadPayloadRepository()).rememberPayload(jobId, input),
    rememberResult: async (jobId, result) => await (await loadPayloadRepository()).rememberResult(jobId, result)
  }
}

const createLazyRelayStoreRepository = (
  options: {
    driver: RelayStorageDriver
    forwardingPayloads?: boolean
    load: () => Promise<RelayStoreRepository>
    location: string
  }
): RelayStoreRepository => {
  let repositoryPromise: Promise<RelayStoreRepository> | undefined
  const loadRepository = async () => {
    repositoryPromise ??= options.load()
    return await repositoryPromise
  }
  return {
    driver: options.driver,
    ...(options.forwardingPayloads === true
      ? { forwardingPayloads: createLazyForwardingPayloadRepository(loadRepository) }
      : {}),
    location: options.location,
    read: async () => await (await loadRepository()).read(),
    withStore: async callback => {
      const repository = await loadRepository()
      if (repository.withStore != null) return await repository.withStore(callback)
      return await callback(await repository.read(), repository)
    },
    write: async store => {
      await (await loadRepository()).write(store)
    }
  }
}

const createSqliteRepository = (dataPath: string): RelayStoreRepository => {
  return createLazyRelayStoreRepository({
    driver: 'sqlite',
    load: async () => {
      const { createSqliteRelayStoreRepository } = await import('./sqlite.js')
      return createSqliteRelayStoreRepository(dataPath)
    },
    location: dataPath
  })
}

const createPostgresRepository = (args: Pick<RelayServerArgs, 'dataPath'>): RelayStoreRepository => {
  const connectionString = process.env.ONEWORKS_RELAY_POSTGRES_URL || process.env.DATABASE_URL || args.dataPath
  return createLazyRelayStoreRepository({
    driver: 'postgres',
    forwardingPayloads: true,
    load: async () => {
      const { createPostgresRelayStoreRepository } = await import('./postgres.js')
      return createPostgresRelayStoreRepository({
        connectionString
      })
    },
    location: redactConnectionString(connectionString)
  })
}

export const createRelayStoreRepository = (
  args: Pick<RelayServerArgs, 'dataPath' | 'storageDriver'>
): RelayStoreRepository => {
  const driver = args.storageDriver ?? DEFAULT_RELAY_STORAGE_DRIVER
  if (driver === 'json') {
    return createJsonRelayStoreRepository(args.dataPath)
  }
  if (driver === 'sqlite') {
    return createSqliteRepository(args.dataPath)
  }
  if (driver === 'postgres') {
    return createPostgresRepository(args)
  }
  if (driver === 'cloudflare-do') {
    throw new Error('Relay storage driver "cloudflare-do" must be created by the Cloudflare Worker adapter.')
  }
  throw createUnimplementedStorageDriverError(driver)
}
