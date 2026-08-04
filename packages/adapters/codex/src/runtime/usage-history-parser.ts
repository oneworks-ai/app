import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'

import type { UsageObservation, UsageResourceDescriptor, UsageTokenCounts } from '@oneworks/types'

import { classifyCodexUsageLine, readCodexUsageMetadataProperty } from './usage-history-record'

const CODEX_TOOL_ID = 'codex'
const CODEX_TOOL_LABEL = 'Codex'

interface CodexTokenCounts {
  cacheCreation: number
  cacheRead: number
  input: number
  output: number
  reasoning: number
  total: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readCount = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
)

const readTokenCounts = (value: unknown): CodexTokenCounts | undefined => {
  if (!isRecord(value)) return undefined
  const total = readCount(value.total_tokens)
  if (total === 0) return undefined
  return {
    cacheCreation: readCount(value.cache_write_input_tokens),
    cacheRead: readCount(value.cached_input_tokens),
    input: readCount(value.input_tokens),
    output: readCount(value.output_tokens),
    reasoning: readCount(value.reasoning_output_tokens),
    total
  }
}

const subtractCounts = (
  current: CodexTokenCounts,
  previous: CodexTokenCounts | undefined
): UsageTokenCounts => {
  const base = previous != null && current.total >= previous.total ? previous : undefined
  return {
    cacheCreation: Math.max(0, current.cacheCreation - (base?.cacheCreation ?? 0)),
    cacheRead: Math.max(0, current.cacheRead - (base?.cacheRead ?? 0)),
    input: Math.max(0, current.input - (base?.input ?? 0)),
    output: Math.max(0, current.output - (base?.output ?? 0)),
    reasoning: Math.max(0, current.reasoning - (base?.reasoning ?? 0)),
    total: Math.max(0, current.total - (base?.total ?? 0))
  }
}

const isOneworksOriginator = (value: unknown) => {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replaceAll(/[\s_-]+/gu, '')
    : undefined
  return normalized?.includes('oneworks') === true
}

const addResource = (
  resources: Map<string, UsageResourceDescriptor>,
  resource: UsageResourceDescriptor
) => {
  resources.set(`${resource.kind}:${resource.id}`, resource)
}

export const parseCodexSessionUsage = async (
  filePath: string,
  query: { from: number; to: number }
): Promise<{
  observations: UsageObservation[]
  resources: UsageResourceDescriptor[]
  skippedUnknownOriginator: boolean
}> => {
  const observations: UsageObservation[] = []
  const resources = new Map<string, UsageResourceDescriptor>()
  let sessionId: string | undefined
  let model: string | undefined
  let modelService = 'openai'
  let previousCounts: CodexTokenCounts | undefined
  let originator: string | undefined

  const fileStats = await lstat(filePath)
  if (!fileStats.isFile()) {
    return { observations, resources: [], skippedUnknownOriginator: true }
  }

  const input = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      const classified = classifyCodexUsageLine(line)
      if (classified?.kind === 'session_meta') {
        sessionId = readCodexUsageMetadataProperty(classified.payloadSource, 'id') ?? sessionId
        modelService = readCodexUsageMetadataProperty(classified.payloadSource, 'model_provider') ?? modelService
        originator = readCodexUsageMetadataProperty(classified.payloadSource, 'originator') ?? originator
        continue
      }
      if (classified?.kind === 'turn_context') {
        model = readCodexUsageMetadataProperty(classified.payloadSource, 'model') ?? model
        continue
      }
      if (classified?.kind !== 'token_count') continue

      let entry: unknown
      try {
        entry = JSON.parse(line) as unknown
      } catch {
        continue
      }
      if (!isRecord(entry) || !isRecord(entry.payload) || !isRecord(entry.payload.info)) continue
      const currentCounts = readTokenCounts(entry.payload.info.total_token_usage)
      if (currentCounts == null) continue
      const tokens = subtractCounts(currentCounts, previousCounts)
      previousCounts = currentCounts
      if (tokens.total === 0) continue

      const observedAt = Date.parse(String(entry.timestamp ?? ''))
      if (!Number.isFinite(observedAt) || observedAt < query.from || observedAt > query.to) continue
      const resolvedSessionId = sessionId ?? basename(filePath, '.jsonl')
      observations.push({
        aggregationMode: 'delta',
        id: `codex-history:${resolvedSessionId}:${observedAt}:${currentCounts.total}`,
        observedAt,
        provenance: {
          deviceId: 'local',
          deviceLabel: 'This device',
          origin: 'local'
        },
        quality: 'provider_reported',
        sessionId: resolvedSessionId,
        tokens,
        toolId: CODEX_TOOL_ID,
        toolLabel: CODEX_TOOL_LABEL,
        modelServiceId: modelService,
        modelServiceLabel: modelService === 'openai' ? 'OpenAI' : modelService,
        ...(model == null ? {} : { modelId: model, modelLabel: model })
      })
    }
  } finally {
    lines.close()
    input.destroy()
  }

  if (originator == null || isOneworksOriginator(originator)) {
    return {
      observations: [],
      resources: [],
      skippedUnknownOriginator: originator == null
    }
  }
  addResource(resources, { id: CODEX_TOOL_ID, kind: 'tool', label: CODEX_TOOL_LABEL })
  for (const observation of observations) {
    if (observation.modelServiceId != null) {
      addResource(resources, {
        id: observation.modelServiceId,
        kind: 'model-service',
        label: observation.modelServiceLabel ?? observation.modelServiceId
      })
    }
    if (observation.modelId != null) {
      addResource(resources, {
        id: observation.modelId,
        kind: 'model',
        label: observation.modelLabel ?? observation.modelId,
        ...(observation.modelServiceId == null
          ? {}
          : { parent: { id: observation.modelServiceId, kind: 'model-service' } })
      })
    }
  }
  return {
    observations,
    resources: [...resources.values()],
    skippedUnknownOriginator: false
  }
}
