import { resolve } from 'node:path'

import type {
  AdapterCtx,
  UsageObservation,
  UsageQuery,
  UsageResourceDescriptor,
  UsageSourceResult
} from '@oneworks/types'

import { resolveRealCodexHome } from './real-home'
import { listCodexSessionFiles } from './usage-history-files'
import { parseCodexSessionUsage } from './usage-history-parser'

const DEFAULT_RANGE_DAYS = 365
const CACHE_TTL_MS = 5_000
const SOURCE_ID = 'adapter:codex-local-history'
const SOURCE_LABEL = 'Codex local history'

interface CachedUsage {
  expiresAt: number
  result: UsageSourceResult
}

const usageCache = new Map<string, CachedUsage>()

export const collectCodexUsage = async (
  ctx: Pick<AdapterCtx, 'env'>,
  query: UsageQuery = {}
): Promise<UsageSourceResult> => {
  const to = query.to ?? Date.now()
  const from = query.from ?? to - (DEFAULT_RANGE_DAYS - 1) * 24 * 60 * 60 * 1_000
  const sessionsRoot = resolve(resolveRealCodexHome(ctx.env), 'sessions')
  const cacheKey = `${sessionsRoot}:${from}:${to}`
  const cached = usageCache.get(cacheKey)
  if (cached != null && cached.expiresAt > Date.now()) return cached.result

  const observations: UsageObservation[] = []
  const resources = new Map<string, UsageResourceDescriptor>()
  let failedFiles = 0
  let unknownOriginatorFiles = 0
  let files: string[] = []
  try {
    files = await listCodexSessionFiles(sessionsRoot, from, to)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ENOENT') throw error
  }

  for (const filePath of files) {
    try {
      const parsed = await parseCodexSessionUsage(filePath, { from, to })
      observations.push(...parsed.observations)
      if (parsed.skippedUnknownOriginator) unknownOriginatorFiles += 1
      for (const resource of parsed.resources) {
        resources.set(`${resource.kind}:${resource.id}`, resource)
      }
    } catch {
      failedFiles += 1
    }
  }

  const incompleteFiles = failedFiles + unknownOriginatorFiles
  const result: UsageSourceResult = {
    coverage: {
      id: SOURCE_ID,
      kind: 'local',
      label: SOURCE_LABEL,
      ...(incompleteFiles === 0
        ? { status: 'available' }
        : {
          message: `${incompleteFiles} Codex history file(s) could not be safely attributed.`,
          status: 'partial'
        })
    },
    observations,
    resources: [...resources.values()]
  }
  const now = Date.now()
  for (const [key, value] of usageCache) {
    if (value.expiresAt <= now) usageCache.delete(key)
  }
  usageCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, result })
  return result
}

export const clearCodexUsageCache = () => {
  usageCache.clear()
}
