import { readRelayStore, writeRelayStore } from '../store.js'
import type { RelayServerArgs, RelayStorageDriver, RelayStore } from '../types.js'
import { DEFAULT_RELAY_STORAGE_DRIVER, createUnimplementedStorageDriverError } from './drivers.js'
import { createSqliteRelayStoreRepository } from './sqlite.js'

export interface RelayStoreRepository {
  driver: RelayStorageDriver
  location: string
  read: () => Promise<RelayStore>
  write: (store: RelayStore) => Promise<void>
}

export const createJsonRelayStoreRepository = (dataPath: string): RelayStoreRepository => ({
  driver: 'json',
  location: dataPath,
  read: async () => await readRelayStore(dataPath),
  write: async store => {
    await writeRelayStore(dataPath, store)
  }
})

export const createRelayStoreRepository = (
  args: Pick<RelayServerArgs, 'dataPath' | 'storageDriver'>
): RelayStoreRepository => {
  const driver = args.storageDriver ?? DEFAULT_RELAY_STORAGE_DRIVER
  if (driver === 'json') {
    return createJsonRelayStoreRepository(args.dataPath)
  }
  if (driver === 'sqlite') {
    return createSqliteRelayStoreRepository(args.dataPath)
  }
  if (driver === 'postgres') {
    throw createUnimplementedStorageDriverError(driver)
  }
  throw createUnimplementedStorageDriverError(driver)
}
