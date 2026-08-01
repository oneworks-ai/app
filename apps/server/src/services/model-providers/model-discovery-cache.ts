import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type { ProviderModelInfo } from '@oneworks/types'
import { resolveProjectSharedCachePath } from '@oneworks/utils/project-cache-path'

const MODEL_DISCOVERY_CACHE_SCHEMA_VERSION = 1
const MODEL_DISCOVERY_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000

interface ModelDiscoveryCacheRecord {
  schemaVersion: 1
  scopeHash: string
  fetchedAt: string
  models: ProviderModelInfo[]
}

export interface ModelDiscoveryCacheScope {
  apiBaseUrl: string
  apiKey: string
  provider?: string
  serviceKey?: string
  source?: string
}

export interface ModelDiscoveryCacheOptions {
  cacheDir?: string
  now?: () => number
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

const resolveScopeHash = (scope: ModelDiscoveryCacheScope) =>
  hash(JSON.stringify({
    apiBaseUrl: scope.apiBaseUrl.replace(/\/+$/u, '').toLowerCase(),
    credentialFingerprint: hash(scope.apiKey),
    provider: scope.provider ?? '',
    serviceKey: scope.serviceKey ?? '',
    source: scope.source ?? ''
  }))

const resolveCachePath = (scope: ModelDiscoveryCacheScope, options: ModelDiscoveryCacheOptions) => {
  const scopeHash = resolveScopeHash(scope)
  const cacheDir = options.cacheDir ?? resolveProjectSharedCachePath(
    process.cwd(),
    process.env,
    'model-providers',
    'models'
  )
  return { cachePath: path.join(cacheDir, `${scopeHash}.json`), scopeHash }
}

const isModel = (value: unknown): value is ProviderModelInfo => (
  value != null && typeof value === 'object' && !Array.isArray(value) &&
  typeof (value as { id?: unknown }).id === 'string' && (value as { id: string }).id.trim() !== ''
)

export const readModelDiscoveryCache = async (
  scope: ModelDiscoveryCacheScope,
  options: ModelDiscoveryCacheOptions = {}
) => {
  const { cachePath, scopeHash } = resolveCachePath(scope, options)
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8')) as Partial<ModelDiscoveryCacheRecord>
    if (
      parsed.schemaVersion !== MODEL_DISCOVERY_CACHE_SCHEMA_VERSION ||
      parsed.scopeHash !== scopeHash ||
      typeof parsed.fetchedAt !== 'string' ||
      !Array.isArray(parsed.models) ||
      !parsed.models.every(isModel)
    ) return undefined

    const fetchedAtMs = Date.parse(parsed.fetchedAt)
    const now = options.now?.() ?? Date.now()
    if (!Number.isFinite(fetchedAtMs) || now - fetchedAtMs > MODEL_DISCOVERY_MAX_STALE_MS) return undefined
    return { fetchedAt: parsed.fetchedAt, models: parsed.models }
  } catch {
    return undefined
  }
}

export const writeModelDiscoveryCache = async (
  scope: ModelDiscoveryCacheScope,
  models: ProviderModelInfo[],
  options: ModelDiscoveryCacheOptions = {}
) => {
  const { cachePath, scopeHash } = resolveCachePath(scope, options)
  const record: ModelDiscoveryCacheRecord = {
    schemaVersion: MODEL_DISCOVERY_CACHE_SCHEMA_VERSION,
    scopeHash,
    fetchedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
    models
  }
  const tempPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  await rename(tempPath, cachePath)
  return record.fetchedAt
}
