import process from 'node:process'

import { createModelUsageClient } from '@oneworks/diagnostics'
import { createOtlpHttpDiagnosticExporterFromEnv } from '@oneworks/diagnostics/node'
import type { ChatMessage, DiagnosticsConfig, ModelServiceConfig } from '@oneworks/types'
import { parseServiceModelSelector } from '@oneworks/utils/model-selection'

export interface SessionModelUsageInput {
  adapter?: string
  diagnostics?: DiagnosticsConfig
  fallbackModel?: string
  message: ChatMessage
  modelServices?: Record<string, ModelServiceConfig>
  reportingEnabled?: boolean
  sessionId: string
}

const cleanDimension = (value: string | undefined) => {
  const text = value?.trim()
  return text == null || text === '' ? undefined : text
}

export const modelUsageReportingEnabled = (
  diagnostics: DiagnosticsConfig | undefined,
  teamScope?: string
) => {
  const preference = diagnostics?.modelUsageReporting
  if (teamScope != null && typeof preference === 'object') {
    const team = Object.entries(preference.teams ?? {})
      .find(([teamId, item]) => teamId === teamScope || item.slug === teamScope)?.[1]
    if (team?.mode === 'required' || team?.userCanControl === false) return true
    return team?.enabled !== false
  }
  if (teamScope != null) return true
  if (typeof preference === 'boolean') return preference
  return preference?.enabled !== false
}

export const modelUsageTeamScopeFromModelService = (
  modelServices: Record<string, ModelServiceConfig> | undefined,
  selectedModel: string | undefined
) => {
  const parsed = selectedModel == null ? undefined : parseServiceModelSelector(selectedModel)
  const service = parsed?.serviceKey == null ? undefined : modelServices?.[parsed.serviceKey]
  const extra = service?.extra
  const oneworks = extra?.oneworks
  if (oneworks == null || typeof oneworks !== 'object' || Array.isArray(oneworks)) return undefined
  const teamId = (oneworks as Record<string, unknown>).relayTeamId
  return typeof teamId === 'string' && teamId.trim() !== '' ? teamId.trim() : undefined
}

export const modelUsageInputFromMessage = ({
  adapter,
  fallbackModel,
  message,
  reportingEnabled,
  sessionId
}: SessionModelUsageInput) => {
  if (reportingEnabled === false) return undefined
  if (message.role !== 'assistant' || message.usage == null) return undefined
  const selectedModel = cleanDimension(message.model) ?? cleanDimension(fallbackModel)
  if (selectedModel == null) return undefined
  const parsed = parseServiceModelSelector(selectedModel)
  const resolvedAdapter = cleanDimension(adapter) ?? 'unknown'
  return {
    adapter: resolvedAdapter,
    cacheCreationInputTokens: message.usage.cache_creation_input_tokens,
    cachedInputTokens: message.usage.cache_read_input_tokens,
    context: { agentSessionId: sessionId },
    eventId: message.id,
    inputTokens: message.usage.input_tokens,
    model: parsed?.modelName ?? selectedModel,
    modelService: parsed?.serviceKey ?? resolvedAdapter,
    occurredAt: new Date(message.createdAt),
    outputTokens: message.usage.output_tokens,
    source: 'oneworks' as const,
    success: true
  }
}

const modelUsageClients = new Map<string, ReturnType<typeof createModelUsageClient> | undefined>()

const getModelUsageClient = (teamScope?: string) => {
  const key = teamScope ?? 'personal'
  if (modelUsageClients.has(key)) return modelUsageClients.get(key)
  const exporter = createOtlpHttpDiagnosticExporterFromEnv({
    headerOverrides: {
      'x-oneworks-team-id': teamScope
    },
    onError: error => {
      console.warn('[model-usage] OTLP export failed:', error instanceof Error ? error.message : String(error))
    }
  })
  if (exporter == null) {
    modelUsageClients.set(key, undefined)
    return undefined
  }
  const client = createModelUsageClient({
    exporters: [exporter],
    resource: {
      architecture: process.arch,
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      platform: process.platform,
      serviceName: 'oneworks-server',
      serviceVersion: process.env.npm_package_version,
      surface: 'server'
    }
  })
  modelUsageClients.set(key, client)
  return client
}

export const recordSessionModelUsage = (input: SessionModelUsageInput) => {
  if (input.reportingEnabled === false) return undefined
  const selectedModel = cleanDimension(input.message.model) ?? cleanDimension(input.fallbackModel)
  const teamScope = modelUsageTeamScopeFromModelService(input.modelServices, selectedModel)
  const reportingEnabled = input.reportingEnabled ?? modelUsageReportingEnabled(input.diagnostics, teamScope)
  if (!reportingEnabled) return undefined
  const measurement = modelUsageInputFromMessage({ ...input, reportingEnabled })
  if (measurement == null) return undefined
  return getModelUsageClient(teamScope)?.record(measurement)
}

export const flushSessionModelUsage = async () => {
  await Promise.all([...modelUsageClients.values()].map(async client => await client?.flush()))
}
