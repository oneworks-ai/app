import { measureJsonPayloadSize, measurePayloadSize } from '../session-forwarding/payloads.js'
import type { RelayForwardingPayloadRepository } from '../session-forwarding/payloads.js'
import { normalizeRelayStore } from '../store.js'
import type { RelayStore } from '../types.js'
import { sanitizeRelayStorageValue } from './content-boundary.js'
import type { RelayStoreRepository } from './repository.js'

interface DurableObjectTransaction {
  get: <T = unknown>(key: string) => Promise<T | undefined>
  put: (key: string, value: unknown) => Promise<void>
}

export interface RelayDurableObjectStorage {
  delete: (key: string) => Promise<boolean>
  get: <T = unknown>(key: string) => Promise<T | undefined>
  put: (key: string, value: unknown) => Promise<void>
  transaction: <T>(callback: (transaction: DurableObjectTransaction) => Promise<T>) => Promise<T>
}

const STORE_KEY = 'relay:store'
const payloadKey = (jobId: string) => `relay:payload:${jobId}`
const resultKey = (jobId: string) => `relay:result:${jobId}`

const readStore = async (storage: Pick<RelayDurableObjectStorage, 'get'>) =>
  normalizeRelayStore(await storage.get(STORE_KEY))

const writeStore = async (
  storage: Pick<RelayDurableObjectStorage, 'put'>,
  store: RelayStore
) => {
  await storage.put(STORE_KEY, sanitizeRelayStorageValue(store))
}

const createDurableObjectPayloadRepository = (
  storage: RelayDurableObjectStorage
): RelayForwardingPayloadRepository => ({
  clearPayload: async jobId => {
    await storage.delete(payloadKey(jobId))
  },
  clearResult: async jobId => {
    await storage.delete(resultKey(jobId))
  },
  consumePayload: async jobId => {
    const key = payloadKey(jobId)
    const payload = await storage.get<{
      message?: unknown
      payloadSize?: unknown
      requestId?: unknown
    }>(key)
    await storage.delete(key)
    if (typeof payload?.message !== 'string' || typeof payload.payloadSize !== 'number') return undefined
    return {
      message: payload.message,
      payloadSize: payload.payloadSize,
      requestId: typeof payload.requestId === 'string' ? payload.requestId : undefined
    }
  },
  consumeResult: async jobId => {
    const key = resultKey(jobId)
    const payload = await storage.get<{
      result?: unknown
      resultSize?: unknown
    }>(key)
    await storage.delete(key)
    if (payload == null || typeof payload.resultSize !== 'number') return undefined
    return {
      result: payload.result,
      resultSize: payload.resultSize
    }
  },
  getPayload: async jobId => {
    const payload = await storage.get<{
      message?: unknown
      payloadSize?: unknown
      requestId?: unknown
    }>(payloadKey(jobId))
    if (typeof payload?.message !== 'string' || typeof payload.payloadSize !== 'number') return undefined
    return {
      message: payload.message,
      payloadSize: payload.payloadSize,
      requestId: typeof payload.requestId === 'string' ? payload.requestId : undefined
    }
  },
  hasResult: async jobId => (await storage.get(resultKey(jobId))) != null,
  rememberPayload: async (jobId, input) => {
    const payloadSize = measurePayloadSize(input.message)
    const payload = {
      message: input.message,
      payloadSize,
      requestId: input.requestId
    }
    await storage.put(payloadKey(jobId), payload)
    return payload
  },
  rememberResult: async (jobId, result) => {
    const payload = {
      result,
      resultSize: measureJsonPayloadSize(result)
    }
    await storage.put(resultKey(jobId), payload)
    return payload
  }
})

export const createDurableObjectRelayStoreRepository = (
  storage: RelayDurableObjectStorage
): RelayStoreRepository => {
  const forwardingPayloads = createDurableObjectPayloadRepository(storage)
  return {
    driver: 'cloudflare-do',
    forwardingPayloads,
    location: 'cloudflare-durable-object',
    read: async () => await readStore(storage),
    withStore: async callback =>
      await storage.transaction(async transaction => {
        let currentStore = await readStore(transaction)
        const scopedRepository: RelayStoreRepository = {
          driver: 'cloudflare-do',
          forwardingPayloads,
          location: 'cloudflare-durable-object',
          read: async () => currentStore,
          write: async store => {
            currentStore = store
            await writeStore(transaction, store)
          }
        }
        return await callback(currentStore, scopedRepository)
      }),
    write: async store => {
      await writeStore(storage, store)
    }
  }
}
