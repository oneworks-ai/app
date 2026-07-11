import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'

import { resolveGlobalOneWorksPath } from '@oneworks/utils/ai-path'

import { isRecord, normalizeRemoteBaseUrl, parseJson, toString } from './utils.js'

const SERVICE_INFO_STORE_PATH = ['relay', 'service-info-cache.json']

export interface RelayCachedServiceInfo {
  avatarUrl?: string
  lastSuccessfulAt: string
  name?: string
}

const readJsonFile = async (filePath: string) => {
  const content = await readFile(filePath, 'utf8').catch(() => undefined)
  return content == null ? undefined : parseJson(content)
}

const normalizeCachedServiceInfo = (value: unknown): RelayCachedServiceInfo | undefined => {
  if (!isRecord(value)) return undefined
  const avatarUrl = toString(value.avatarUrl)
  const lastSuccessfulAt = toString(value.lastSuccessfulAt)
  const name = toString(value.name)
  if (lastSuccessfulAt === '') return undefined
  return {
    ...(avatarUrl === '' ? {} : { avatarUrl }),
    lastSuccessfulAt,
    ...(name === '' ? {} : { name })
  }
}

const normalizeServiceInfoStore = (value: unknown): Record<string, RelayCachedServiceInfo> => {
  if (!isRecord(value)) return {}
  const services: Record<string, RelayCachedServiceInfo> = {}
  for (const [remoteBaseUrl, raw] of Object.entries(value)) {
    const key = normalizeRemoteBaseUrl(remoteBaseUrl)
    const info = normalizeCachedServiceInfo(raw)
    if (key === '' || info == null) continue
    services[key] = info
  }
  return services
}

export const createRelayServiceInfoStore = () => {
  const storePath = resolveGlobalOneWorksPath(process.env, ...SERVICE_INFO_STORE_PATH)
  let writeQueue: Promise<void> = Promise.resolve()
  const readStore = async () => {
    const parsed = await readJsonFile(storePath)
    return normalizeServiceInfoStore(isRecord(parsed) ? parsed.services : undefined)
  }
  const writeServiceInfo = async (remoteBaseUrl: string, info: RelayCachedServiceInfo) => {
    const key = normalizeRemoteBaseUrl(remoteBaseUrl)
    if (key === '') return
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      const services = await readStore()
      await mkdir(dirname(storePath), { recursive: true })
      await writeFile(storePath, `${JSON.stringify({ services: { ...services, [key]: info } }, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
    })
    await writeQueue
  }
  return { readStore, storePath, writeServiceInfo }
}
