import { randomUUID } from 'node:crypto'

import type { ClaudeCodeMarketplacePluginSource } from '@oneworks/types'

export type MarketplacePluginVersionSourceMap = Map<string, ClaudeCodeMarketplacePluginSource>

interface ManifestLocation {
  immutable: boolean
  url: string
}

type VersionLookupResult =
  | { status: 'missing' }
  | { status: 'resolved'; version: string }
  | { status: 'retryable' }

interface VersionCacheEntry {
  expiresAt: number
  result: Promise<VersionLookupResult>
}

interface VersionRequestItem {
  marketplace: string
  plugin: string
}

const versionSnapshots = new Map<string, ReadonlyMap<string, ClaudeCodeMarketplacePluginSource>>()
const versionCache = new Map<string, VersionCacheEntry>()
const MOVABLE_REF_CACHE_TTL_MS = 5 * 60_000
const MAX_VERSION_SNAPSHOTS = 4

export const getMarketplacePluginVersionKey = (marketplace: string, plugin: string) => (
  JSON.stringify([marketplace, plugin])
)

const mapWithConcurrency = async <T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) => {
  const results: R[] = []
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

const parseGitHubRepo = (value: string) => {
  const normalized = value.trim().replace(/\.git$/u, '')
  if (/^[\w.-]+\/[\w.-]+$/u.test(normalized)) return normalized
  try {
    const url = new URL(normalized)
    if (url.hostname !== 'github.com') return undefined
    const [owner, repo] = url.pathname.split('/').filter(Boolean)
    return owner != null && repo != null ? `${owner}/${repo}` : undefined
  } catch {
    return undefined
  }
}

const getGitHubManifestLocation = (source: ClaudeCodeMarketplacePluginSource): ManifestLocation | undefined => {
  if (typeof source === 'string' || source.source === 'npm') return undefined
  const repo = source.source === 'github' ? parseGitHubRepo(source.repo) : parseGitHubRepo(source.url)
  const revision = source.sha?.trim() || source.ref?.trim()
  const pluginPath = source.source === 'git-subdir' ? source.path : ''
  if (repo == null || revision == null || revision === '' || pluginPath.split('/').includes('..')) return undefined
  const normalizedPath = pluginPath
    .replace(/^\/+|\/+$/gu, '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  return {
    immutable: typeof source.sha === 'string' && source.sha.trim() !== '',
    url: `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(revision)}/${
      normalizedPath === '' ? '' : `${normalizedPath}/`
    }.claude-plugin/plugin.json`
  }
}

const isRetryableStatus = (status: number) =>
  status === 403 || status === 408 || status === 425 ||
  status === 429 || status >= 500

const fetchManifestVersion = (source: ClaudeCodeMarketplacePluginSource) => {
  const location = getGitHubManifestLocation(source)
  if (location == null) return Promise.resolve<VersionLookupResult>({ status: 'missing' })
  const cached = versionCache.get(location.url)
  if (cached != null && cached.expiresAt > Date.now()) return cached.result

  const result = fetch(location.url, { signal: AbortSignal.timeout(8_000) })
    .then(async (response): Promise<VersionLookupResult> => {
      if (!response.ok) return { status: isRetryableStatus(response.status) ? 'retryable' : 'missing' }
      try {
        const manifest = await response.json() as { version?: unknown }
        const version = typeof manifest.version === 'string' ? manifest.version.trim() : ''
        return version !== '' && version.length <= 128
          ? { status: 'resolved', version }
          : { status: 'missing' }
      } catch {
        return { status: 'retryable' }
      }
    })
    .catch((): VersionLookupResult => ({ status: 'retryable' }))
  versionCache.set(location.url, {
    expiresAt: location.immutable ? Number.POSITIVE_INFINITY : Date.now() + MOVABLE_REF_CACHE_TTL_MS,
    result
  })
  void result.then((value) => {
    if (value.status === 'retryable' && versionCache.get(location.url)?.result === result) {
      versionCache.delete(location.url)
    }
  })
  return result
}

export const publishMarketplacePluginVersionSources = (sources: MarketplacePluginVersionSourceMap) => {
  const generation = randomUUID()
  versionSnapshots.set(generation, new Map(sources))
  while (versionSnapshots.size > MAX_VERSION_SNAPSHOTS) {
    const oldestGeneration = versionSnapshots.keys().next().value as string | undefined
    if (oldestGeneration == null) break
    versionSnapshots.delete(oldestGeneration)
  }
  return generation
}

export const resolvePluginMarketplaceVersions = async (
  generation: string,
  items: VersionRequestItem[]
) => {
  const sources = versionSnapshots.get(generation)
  if (sources == null) return { found: false as const, retryable: [], versions: [] }
  const uniqueItems = Array.from(new Map(
    items.slice(0, 50).map(item => [getMarketplacePluginVersionKey(item.marketplace, item.plugin), item])
  ).values())
  const results = await mapWithConcurrency(uniqueItems, 6, async (item) => {
    const source = sources.get(getMarketplacePluginVersionKey(item.marketplace, item.plugin))
    return { item, result: source == null ? { status: 'missing' as const } : await fetchManifestVersion(source) }
  })
  return {
    found: true as const,
    retryable: results.filter(entry => entry.result.status === 'retryable').map(entry => entry.item),
    versions: results.flatMap(({ item, result }) =>
      result.status === 'resolved'
        ? [{ ...item, version: result.version }]
        : []
    )
  }
}
