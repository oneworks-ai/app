/* eslint-disable max-lines -- the usage ledger keeps normalization and aggregation beside its SQL mapping. */
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import process from 'node:process'

import type {
  AdapterUsageData,
  MessageTokenUsage,
  Session,
  UsageActivityBucket,
  UsageFacetKey,
  UsageFacetOption,
  UsageObservation,
  UsageQuery,
  UsageReport,
  UsageResourceDescriptor,
  UsageSummary,
  UsageTokenCounts
} from '@oneworks/types'

import type { SqliteDatabase } from '../sqlite'

interface UsageObservationRow {
  accountId: string | null
  accountLabel: string | null
  aggregationMode: 'cumulative' | 'delta'
  authorityPluginId: string | null
  authorityPluginLabel: string | null
  authorityPluginScope: string | null
  cacheCreationTokens: number
  cacheReadTokens: number
  costUsd: number | null
  deviceId: string | null
  deviceLabel: string | null
  id: string
  inputTokens: number
  modelId: string | null
  modelLabel: string | null
  modelServiceId: string | null
  modelServiceLabel: string | null
  observedAt: number
  origin: 'local' | 'plugin'
  outputTokens: number
  quality: 'estimated' | 'provider_reported' | 'reported'
  reasoningTokens: number
  sessionId: string | null
  toolId: string
  toolLabel: string | null
  totalTokens: number
  transportPluginId: string | null
  transportPluginLabel: string | null
  transportPluginScope: string | null
  workspaceId: string | null
  workspaceLabel: string | null
}

const EMPTY_TOKENS: UsageTokenCounts = {
  cacheCreation: 0,
  cacheRead: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  total: 0
}

export const USAGE_DIRECT_TRANSPORT_ID = '__direct__'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const nonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const nonNegativeNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
)

const workspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? process.cwd()
const localWorkspaceId = `workspace:${createHash('sha256').update(workspaceFolder).digest('hex').slice(0, 16)}`
const localWorkspaceLabel = basename(workspaceFolder) || workspaceFolder
export const localUsageWorkspace = {
  id: localWorkspaceId,
  label: localWorkspaceLabel
}

const parseModelSelection = (value: string | undefined) => {
  const raw = value?.trim()
  if (raw == null || raw === '') return {}
  const comma = raw.indexOf(',')
  if (comma > 0) {
    return {
      modelServiceId: raw.slice(0, comma).trim(),
      modelId: raw.slice(comma + 1).trim() || undefined
    }
  }
  return { modelId: raw }
}

const usageResourceKey = (kind: UsageResourceDescriptor['kind'], id: string) => `${kind}:${id}`

const deduplicateResources = (resources: UsageResourceDescriptor[]) => {
  const values = new Map<string, UsageResourceDescriptor>()
  for (const resource of resources) {
    const key = usageResourceKey(resource.kind, resource.id)
    const current = values.get(key)
    values.set(
      key,
      current == null
        ? resource
        : {
          ...current,
          ...resource,
          authorityPlugin: resource.authorityPlugin ?? current.authorityPlugin,
          parent: resource.parent ?? current.parent
        }
    )
  }
  return [...values.values()]
}

const applyResourceMetadata = (
  observation: UsageObservation,
  resources: Map<string, UsageResourceDescriptor>
): UsageObservation => {
  const account = observation.accountId == null
    ? undefined
    : resources.get(usageResourceKey('account', observation.accountId))
  const modelServiceId = observation.modelServiceId ??
    (account?.parent?.kind === 'model-service' ? account.parent.id : undefined)
  const modelService = modelServiceId == null
    ? undefined
    : resources.get(usageResourceKey('model-service', modelServiceId))
  const model = observation.modelId == null
    ? undefined
    : resources.get(usageResourceKey('model', observation.modelId))
  const tool = resources.get(usageResourceKey('tool', observation.toolId))
  const workspace = observation.workspaceId == null
    ? undefined
    : resources.get(usageResourceKey('workspace', observation.workspaceId))
  const device = observation.provenance.deviceId == null
    ? undefined
    : resources.get(usageResourceKey('device', observation.provenance.deviceId))
  const authorityPlugin = observation.provenance.authorityPlugin ??
    account?.authorityPlugin ??
    modelService?.authorityPlugin ??
    model?.authorityPlugin ??
    tool?.authorityPlugin

  return {
    ...observation,
    ...(account == null ? {} : { accountLabel: account.label }),
    ...(model == null ? {} : { modelLabel: model.label }),
    ...(modelServiceId == null ? {} : { modelServiceId }),
    ...(modelService == null ? {} : { modelServiceLabel: modelService.label }),
    ...(tool == null ? {} : { toolLabel: tool.label }),
    ...(workspace == null ? {} : { workspaceLabel: workspace.label }),
    provenance: {
      ...observation.provenance,
      ...(authorityPlugin == null ? {} : { authorityPlugin }),
      ...(device == null ? {} : { deviceLabel: device.label })
    }
  }
}

const toMessageUsage = (usage: MessageTokenUsage): AdapterUsageData => ({
  aggregationMode: usage.aggregation_mode,
  cacheCreationInputTokens: usage.cache_creation_input_tokens,
  cacheReadInputTokens: usage.cache_read_input_tokens,
  costUsd: usage.total_cost_usd,
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
  quality: usage.quality,
  reasoningOutputTokens: usage.reasoning_output_tokens
})

const readUsageEvent = (event: unknown) => {
  if (!isRecord(event)) return undefined
  if (event.type === 'message' && isRecord(event.message) && isRecord(event.message.usage)) {
    return {
      id: nonEmptyString(event.message.id),
      model: nonEmptyString(event.message.model),
      observedAt: nonNegativeNumber(event.message.createdAt) || Date.now(),
      usage: toMessageUsage(event.message.usage as unknown as MessageTokenUsage)
    }
  }
  if (
    event.type === 'adapter_event' &&
    isRecord(event.data)
  ) {
    const runtimeEvent = isRecord(event.data.runtimeEvent) ? event.data.runtimeEvent : undefined
    const rawUsage = event.data.source === 'adapter_usage'
      ? event.data.usage
      : runtimeEvent?.usage
    if (!isRecord(rawUsage)) return undefined
    const usage = rawUsage as unknown as AdapterUsageData
    return {
      id: nonEmptyString(usage.id),
      model: nonEmptyString(usage.model) ?? nonEmptyString(runtimeEvent?.model),
      observedAt: nonNegativeNumber(usage.observedAt) ||
        nonNegativeNumber(runtimeEvent?.ts) ||
        Date.now(),
      usage
    }
  }
  return undefined
}

const tokensFromUsage = (usage: AdapterUsageData): UsageTokenCounts => {
  const input = nonNegativeNumber(usage.inputTokens)
  const output = nonNegativeNumber(usage.outputTokens)
  const cacheRead = nonNegativeNumber(usage.cacheReadInputTokens)
  const cacheCreation = nonNegativeNumber(usage.cacheCreationInputTokens)
  return {
    input,
    output,
    cacheRead,
    cacheCreation,
    reasoning: nonNegativeNumber(usage.reasoningOutputTokens),
    total: input + output + cacheRead + cacheCreation
  }
}

const rowToObservation = (row: UsageObservationRow): UsageObservation => ({
  id: row.id,
  observedAt: row.observedAt,
  aggregationMode: row.aggregationMode,
  quality: row.quality,
  toolId: row.toolId,
  ...(row.toolLabel == null ? {} : { toolLabel: row.toolLabel }),
  ...(row.sessionId == null ? {} : { sessionId: row.sessionId }),
  ...(row.workspaceId == null ? {} : { workspaceId: row.workspaceId }),
  ...(row.workspaceLabel == null ? {} : { workspaceLabel: row.workspaceLabel }),
  ...(row.modelServiceId == null ? {} : { modelServiceId: row.modelServiceId }),
  ...(row.modelServiceLabel == null ? {} : { modelServiceLabel: row.modelServiceLabel }),
  ...(row.modelId == null ? {} : { modelId: row.modelId }),
  ...(row.modelLabel == null ? {} : { modelLabel: row.modelLabel }),
  ...(row.accountId == null ? {} : { accountId: row.accountId }),
  ...(row.accountLabel == null ? {} : { accountLabel: row.accountLabel }),
  ...(row.costUsd == null ? {} : { costUsd: row.costUsd }),
  tokens: {
    input: row.inputTokens,
    output: row.outputTokens,
    cacheRead: row.cacheReadTokens,
    cacheCreation: row.cacheCreationTokens,
    reasoning: row.reasoningTokens,
    total: row.totalTokens
  },
  provenance: {
    origin: row.origin,
    ...(row.deviceId == null ? {} : { deviceId: row.deviceId }),
    ...(row.deviceLabel == null ? {} : { deviceLabel: row.deviceLabel }),
    ...(row.authorityPluginId == null
      ? {}
      : {
        authorityPlugin: {
          id: row.authorityPluginId,
          ...(row.authorityPluginScope == null ? {} : { scope: row.authorityPluginScope }),
          ...(row.authorityPluginLabel == null ? {} : { label: row.authorityPluginLabel })
        }
      }),
    ...(row.transportPluginId == null
      ? {}
      : {
        transportPlugin: {
          id: row.transportPluginId,
          ...(row.transportPluginScope == null ? {} : { scope: row.transportPluginScope }),
          ...(row.transportPluginLabel == null ? {} : { label: row.transportPluginLabel })
        }
      })
  }
})

const addTokens = (target: UsageSummary, observation: UsageObservation) => {
  target.input += observation.tokens.input
  target.output += observation.tokens.output
  target.cacheRead += observation.tokens.cacheRead
  target.cacheCreation += observation.tokens.cacheCreation
  target.reasoning += observation.tokens.reasoning
  target.total += observation.tokens.total
  target.costUsd += observation.costUsd ?? 0
  target.observationCount += 1
}

const emptySummary = (): UsageSummary => ({
  ...EMPTY_TOKENS,
  costUsd: 0,
  observationCount: 0
})

const matchesFilter = (values: string[] | undefined, value: string | undefined) => (
  values == null || values.length === 0 || (value != null && values.includes(value))
)

const preferObservation = (
  current: UsageObservation,
  candidate: UsageObservation
): UsageObservation => {
  const currentIsDirect = current.provenance.origin === 'local' ||
    current.provenance.transportPlugin == null
  const candidateIsDirect = candidate.provenance.origin === 'local' ||
    candidate.provenance.transportPlugin == null
  const preferred = candidateIsDirect && !currentIsDirect ? candidate : current
  const fallback = preferred === current ? candidate : current
  return {
    ...fallback,
    ...preferred,
    provenance: {
      ...preferred.provenance,
      authorityPlugin: preferred.provenance.authorityPlugin ??
        fallback.provenance.authorityPlugin
    }
  }
}

const filterRawObservations = (observations: UsageObservation[], query: UsageQuery) => {
  const from = query.from ?? Date.now() - 364 * 24 * 60 * 60 * 1000
  const to = query.to ?? Date.now()
  const filtered = observations.filter(observation => (
    observation.observedAt >= from &&
    observation.observedAt <= to &&
    matchesFilter(query.workspaces, observation.workspaceId) &&
    matchesFilter(query.tools, observation.toolId) &&
    matchesFilter(query.modelServices, observation.modelServiceId) &&
    matchesFilter(query.models, observation.modelId) &&
    matchesFilter(query.accounts, observation.accountId) &&
    matchesFilter(query.devices, observation.provenance.deviceId) &&
    matchesFilter(query.authorityPlugins, observation.provenance.authorityPlugin?.id) &&
    matchesFilter(
      query.transportPlugins,
      observation.provenance.transportPlugin?.id ?? USAGE_DIRECT_TRANSPORT_ID
    )
  ))

  const uniqueObservations = new Map<string, UsageObservation>()
  for (const observation of filtered) {
    const current = uniqueObservations.get(observation.id)
    uniqueObservations.set(
      observation.id,
      current == null ? observation : preferObservation(current, observation)
    )
  }
  return [...uniqueObservations.values()]
}

const selectUsageObservations = (observations: UsageObservation[]) => {
  const bySession = new Map<string, UsageObservation[]>()
  for (const observation of observations) {
    const key = observation.sessionId == null
      ? observation.id
      : JSON.stringify([
        observation.workspaceId ?? '',
        observation.provenance.deviceId ?? '',
        observation.toolId,
        observation.sessionId
      ])
    const values = bySession.get(key) ?? []
    values.push(observation)
    bySession.set(key, values)
  }

  return [...bySession.values()].flatMap((values) => {
    const deltas = values.filter(value => value.aggregationMode === 'delta')
    if (deltas.length > 0) {
      const hasDeltaCost = deltas.some(value => value.costUsd != null)
      const latestCumulativeCost = values
        .filter(value => value.aggregationMode === 'cumulative' && value.costUsd != null)
        .sort((left, right) => right.observedAt - left.observedAt)[0]?.costUsd
      if (hasDeltaCost || latestCumulativeCost == null) return deltas

      const latestDeltaIndex = deltas.reduce(
        (latestIndex, value, index) => value.observedAt > deltas[latestIndex].observedAt ? index : latestIndex,
        0
      )
      return deltas.map((value, index) => (
        index === latestDeltaIndex ? { ...value, costUsd: latestCumulativeCost } : value
      ))
    }
    const latest = values.sort((left, right) => right.observedAt - left.observedAt)[0]
    return latest == null ? [] : [latest]
  })
}

const facetValue = (observation: UsageObservation, key: UsageFacetKey) => {
  if (key === 'workspace') return [observation.workspaceId, observation.workspaceLabel]
  if (key === 'tool') return [observation.toolId, observation.toolLabel]
  if (key === 'modelService') return [observation.modelServiceId, observation.modelServiceLabel]
  if (key === 'model') return [observation.modelId, observation.modelLabel]
  if (key === 'account') return [observation.accountId, observation.accountLabel]
  if (key === 'device') return [observation.provenance.deviceId, observation.provenance.deviceLabel]
  if (key === 'authorityPlugin') {
    return [observation.provenance.authorityPlugin?.id, observation.provenance.authorityPlugin?.label]
  }
  return [
    observation.provenance.transportPlugin?.id ?? USAGE_DIRECT_TRANSPORT_ID,
    observation.provenance.transportPlugin?.label ?? 'Direct'
  ]
}

const facetResource = (
  observation: UsageObservation,
  key: UsageFacetKey,
  id: string,
  label: string,
  resources: Map<string, UsageResourceDescriptor>
): UsageResourceDescriptor | undefined => {
  const authorityPlugin = observation.provenance.authorityPlugin
  const kind = key === 'modelService' ? 'model-service' : key
  if (
    kind === 'account' ||
    kind === 'device' ||
    kind === 'model' ||
    kind === 'model-service' ||
    kind === 'tool' ||
    kind === 'workspace'
  ) {
    const resource = resources.get(usageResourceKey(kind, id))
    if (resource != null) return resource
  }
  if (key === 'account') {
    return {
      id,
      label,
      kind: 'account',
      ...(authorityPlugin == null ? {} : { authorityPlugin }),
      ...(observation.modelServiceId == null
        ? {}
        : { parent: { id: observation.modelServiceId, kind: 'model-service' as const } })
    }
  }
  if (key === 'modelService') {
    return { id, label, kind: 'model-service', ...(authorityPlugin == null ? {} : { authorityPlugin }) }
  }
  if (key === 'workspace') return { id, label, kind: 'workspace' }
  if (key === 'tool') return { id, label, kind: 'tool' }
  if (key === 'model') return { id, label, kind: 'model' }
  if (key === 'device') return { id, label, kind: 'device' }
  return { id, label, kind: 'plugin' }
}

const createFacets = (
  observations: UsageObservation[],
  resources: Map<string, UsageResourceDescriptor>
): Record<UsageFacetKey, UsageFacetOption[]> => {
  const keys: UsageFacetKey[] = [
    'workspace',
    'tool',
    'modelService',
    'model',
    'account',
    'device',
    'authorityPlugin',
    'transportPlugin'
  ]
  return Object.fromEntries(keys.map((key) => {
    const options = new Map<string, UsageFacetOption>()
    for (const observation of observations) {
      const [id, rawLabel] = facetValue(observation, key)
      if (id == null || id === '') continue
      const label = rawLabel ?? id
      const option = options.get(id) ?? {
        id,
        label,
        ...emptySummary(),
        resource: facetResource(observation, key, id, label, resources)
      }
      addTokens(option, observation)
      options.set(id, option)
    }
    return [
      key,
      [...options.values()].sort((left, right) => right.total - left.total || left.label.localeCompare(right.label))
    ]
  })) as Record<UsageFacetKey, UsageFacetOption[]>
}

const dayStart = (timestamp: number) => {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const dayKey = (timestamp: number) => {
  const date = new Date(timestamp)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

const createActivity = (observations: UsageObservation[]): UsageActivityBucket[] => {
  const buckets = new Map<number, UsageActivityBucket>()
  for (const observation of observations) {
    const from = dayStart(observation.observedAt)
    const bucket = buckets.get(from) ?? {
      from,
      to: from + 24 * 60 * 60 * 1000 - 1,
      key: dayKey(from),
      ...emptySummary()
    }
    addTokens(bucket, observation)
    buckets.set(from, bucket)
  }
  return [...buckets.values()].sort((left, right) => left.from - right.from)
}

export const buildUsageReport = (
  observations: UsageObservation[],
  rawQuery: UsageQuery = {},
  rawResources: UsageResourceDescriptor[] = []
): UsageReport => {
  const query: UsageQuery = {
    ...rawQuery,
    granularity: rawQuery.granularity ?? 'day',
    scope: rawQuery.scope ?? 'workspace'
  }
  const resources = deduplicateResources(rawResources)
  const resourceMap = new Map(
    resources.map(resource => [usageResourceKey(resource.kind, resource.id), resource])
  )
  const filtered = filterRawObservations(
    observations.map(observation => applyResourceMetadata(observation, resourceMap)),
    query
  )
  const selected = selectUsageObservations(filtered)
  const summary = emptySummary()
  selected.forEach(observation => addTokens(summary, observation))
  return {
    activity: createActivity(selected),
    coverage: [{
      id: localWorkspaceId,
      kind: 'workspace',
      label: localWorkspaceLabel,
      status: 'available'
    }],
    facets: createFacets(selected, resourceMap),
    generatedAt: Date.now(),
    observations: filtered,
    query,
    resources,
    summary
  }
}

export function createUsageRepo(db: SqliteDatabase) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO usage_observations (
      id, observedAt, sessionId, workspaceId, workspaceLabel, toolId, toolLabel,
      modelServiceId, modelServiceLabel, modelId, modelLabel, accountId, accountLabel,
      deviceId, deviceLabel, inputTokens, outputTokens, cacheReadTokens,
      cacheCreationTokens, reasoningTokens, totalTokens, costUsd, aggregationMode,
      quality, origin, authorityPluginId, authorityPluginScope, authorityPluginLabel,
      transportPluginId, transportPluginScope, transportPluginLabel
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `)

  const recordObservation = (observation: UsageObservation) => {
    insert.run(
      observation.id,
      observation.observedAt,
      observation.sessionId ?? null,
      observation.workspaceId ?? null,
      observation.workspaceLabel ?? null,
      observation.toolId,
      observation.toolLabel ?? null,
      observation.modelServiceId ?? null,
      observation.modelServiceLabel ?? null,
      observation.modelId ?? null,
      observation.modelLabel ?? null,
      observation.accountId ?? null,
      observation.accountLabel ?? null,
      observation.provenance.deviceId ?? null,
      observation.provenance.deviceLabel ?? null,
      observation.tokens.input,
      observation.tokens.output,
      observation.tokens.cacheRead,
      observation.tokens.cacheCreation,
      observation.tokens.reasoning,
      observation.tokens.total,
      observation.costUsd ?? null,
      observation.aggregationMode,
      observation.quality,
      observation.provenance.origin,
      observation.provenance.authorityPlugin?.id ?? null,
      observation.provenance.authorityPlugin?.scope ?? null,
      observation.provenance.authorityPlugin?.label ?? null,
      observation.provenance.transportPlugin?.id ?? null,
      observation.provenance.transportPlugin?.scope ?? null,
      observation.provenance.transportPlugin?.label ?? null
    )
  }

  const recordSessionEvent = (sessionId: string, event: unknown) => {
    const parsed = readUsageEvent(event)
    if (parsed == null) return
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get<Session>(sessionId)
    const usage = parsed.usage
    const usageSelection = parseModelSelection(usage.model)
    const eventSelection = parseModelSelection(parsed.model)
    const sessionSelection = parseModelSelection(session?.model)
    const modelServiceId = usage.modelService ??
      usageSelection.modelServiceId ??
      eventSelection.modelServiceId ??
      sessionSelection.modelServiceId
    const modelId = usageSelection.modelId ??
      eventSelection.modelId ??
      sessionSelection.modelId
    const eventId = parsed.id ?? usage.id ?? `${parsed.observedAt}:${tokensFromUsage(usage).total}`
    const accountId = usage.account ?? session?.account
    recordObservation({
      id: `local:${localWorkspaceId}:${sessionId}:${eventId}`,
      observedAt: parsed.observedAt,
      sessionId,
      workspaceId: localWorkspaceId,
      workspaceLabel: localWorkspaceLabel,
      toolId: session?.adapter ?? 'unknown',
      toolLabel: session?.adapter ?? 'Unknown tool',
      ...(modelServiceId == null ? {} : { modelServiceId, modelServiceLabel: modelServiceId }),
      ...(modelId == null ? {} : { modelId, modelLabel: modelId }),
      ...(accountId == null
        ? {}
        : {
          accountId,
          accountLabel: accountId
        }),
      tokens: tokensFromUsage(usage),
      ...(usage.costUsd == null ? {} : { costUsd: usage.costUsd }),
      aggregationMode: usage.aggregationMode ?? 'delta',
      quality: usage.quality ?? 'reported',
      provenance: {
        origin: 'local',
        deviceId: 'local',
        deviceLabel: 'This device'
      }
    })
  }

  const backfill = () => {
    const version = db.prepare('SELECT value FROM usage_ledger_meta WHERE key = ?')
      .get<{ value: string }>('message-backfill-version')?.value
    if (version === '1') return
    const rows = db.prepare(`
      SELECT messages.sessionId AS sessionId, messages.data AS data
      FROM messages
      WHERE messages.data LIKE '%"usage"%'
    `).all<{ data: string; sessionId: string }>()
    const run = db.transaction(() => {
      for (const row of rows) {
        try {
          recordSessionEvent(row.sessionId, JSON.parse(row.data) as unknown)
        } catch {
          // Historical malformed messages must not block server startup.
        }
      }
      db.prepare('INSERT OR REPLACE INTO usage_ledger_meta (key, value) VALUES (?, ?)')
        .run('message-backfill-version', '1')
    })
    run()
  }

  const list = () =>
    db.prepare('SELECT * FROM usage_observations ORDER BY observedAt ASC')
      .all<UsageObservationRow>()
      .map(rowToObservation)

  const report = (query: UsageQuery = {}) => buildUsageReport(list(), query)

  backfill()
  return { list, recordObservation, recordSessionEvent, report }
}

export type UsageRepo = ReturnType<typeof createUsageRepo>
