import type { RelayStorageDriver } from '../types.js'

export const DEFAULT_RELAY_STORAGE_DRIVER: RelayStorageDriver = 'json'

const relayStorageDrivers = new Set<RelayStorageDriver>([
  'json',
  'sqlite',
  'postgres'
])

export const formatRelayStorageDrivers = () => Array.from(relayStorageDrivers).join(', ')

export const parseRelayStorageDriver = (value: string | undefined): RelayStorageDriver => {
  const driver = value?.trim().toLowerCase() ?? ''
  if (driver === '') return DEFAULT_RELAY_STORAGE_DRIVER
  if (relayStorageDrivers.has(driver as RelayStorageDriver)) {
    return driver as RelayStorageDriver
  }
  throw new Error(
    `Unsupported ONEWORKS_RELAY_STORAGE_DRIVER "${value}". Supported values: ${formatRelayStorageDrivers()}.`
  )
}

export const createUnimplementedStorageDriverError = (driver: RelayStorageDriver) =>
  new Error(
    `Relay storage driver "${driver}" is not implemented yet. ` +
      `Set ONEWORKS_RELAY_STORAGE_DRIVER=${DEFAULT_RELAY_STORAGE_DRIVER}, use sqlite for single-node production, or omit it.`
  )
