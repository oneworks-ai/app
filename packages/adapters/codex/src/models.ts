/* eslint-disable max-lines -- Codex catalog loading and capability normalization share one adapter boundary. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

import type { AdapterBuiltinModel, AdapterModelServiceTier, EffortLevel } from '@oneworks/types'

/**
 * Codex native model options.
 * Codex keeps the current account-visible model catalog in models_cache.json.
 * Prefer that cache for display metadata so newly rolled out or deprecated
 * models follow the installed Codex CLI instead of this adapter package.
 */

interface CodexModelCacheEntry {
  slug?: unknown
  display_name?: unknown
  description?: unknown
  default_reasoning_level?: unknown
  supported_reasoning_levels?: unknown
  service_tiers?: unknown
  visibility?: unknown
  priority?: unknown
}

interface CodexModelsCache {
  models?: unknown
}

interface CodexCatalogSource {
  description: string
  path: string
}

const DEFAULT_MODEL_OPTION: AdapterBuiltinModel = {
  value: 'default',
  title: 'Default',
  description: 'Use the account default model and provider selection managed by Codex'
}

const FALLBACK_MODEL_ENTRIES = [
  ['gpt-5.5', 'GPT-5.5', 'Frontier model for complex coding, research, and real-world work'],
  ['gpt-5.4', 'GPT-5.4', 'Flagship frontier model for professional work with industry-leading coding capabilities'],
  ['gpt-5.3-codex', 'GPT-5.3-Codex', 'Industry-leading coding model for complex software engineering'],
  [
    'gpt-5.3-codex-spark',
    'GPT-5.3-Codex-Spark',
    'Text-only research preview model optimized for near-instant, real-time coding iteration'
  ],
  ['gpt-5.2-codex', 'GPT-5.2-Codex', 'Advanced coding model for real-world engineering'],
  ['gpt-5.2', 'GPT-5.2', 'Previous general-purpose model for coding and agentic tasks'],
  ['gpt-5.1-codex-max', 'GPT-5.1-Codex-Max', 'Optimized for long-horizon, agentic coding tasks in Codex'],
  ['gpt-5.1', 'GPT-5.1', 'Great for coding and agentic tasks across domains'],
  ['gpt-5.1-codex', 'GPT-5.1-Codex', 'Optimized for long-running, agentic coding tasks in Codex'],
  ['gpt-5-codex', 'GPT-5-Codex', 'Version of GPT-5 tuned for long-running, agentic coding tasks'],
  ['gpt-5-codex-mini', 'GPT-5-Codex-Mini', 'Smaller, more cost-effective version of GPT-5-Codex'],
  ['gpt-5', 'GPT-5', 'Reasoning model for coding and agentic tasks across domains']
] as const

const FALLBACK_BUILTIN_MODELS: AdapterBuiltinModel[] = FALLBACK_MODEL_ENTRIES.map(([value, title, description]) => ({
  value,
  title,
  description
}))

const normalizeNonEmptyString = (value: unknown) => {
  const normalized = typeof value === 'string' ? value.trim() : undefined
  return normalized == null || normalized === '' ? undefined : normalized
}

const normalizePriority = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const normalizeEffort = (value: unknown): EffortLevel | undefined => (
  value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' ||
    value === 'max' || value === 'ultra'
    ? value
    : undefined
)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeSupportedEfforts = (value: unknown): EffortLevel[] | undefined => {
  if (!Array.isArray(value)) return undefined

  const efforts = value
    .map((entry) => isRecord(entry) ? normalizeEffort(entry.effort) : undefined)
    .filter((effort): effort is EffortLevel => effort != null)
  return efforts.length > 0 ? [...new Set(efforts)] : undefined
}

const normalizeServiceTiers = (value: unknown): AdapterModelServiceTier[] | undefined => {
  if (!Array.isArray(value)) return undefined

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const id = normalizeNonEmptyString(entry.id)
    const name = normalizeNonEmptyString(entry.name)
    const description = normalizeNonEmptyString(entry.description)
    return id == null || name == null
      ? []
      : [{ id, name, description: description ?? name }]
  })
}

const toSyntheticDisplayName = (modelId: string) => (
  modelId
    .split(/[-_\s]+/g)
    .filter(part => part !== '')
    .map(part => part.toUpperCase() === part ? part : part[0]?.toUpperCase() + part.slice(1))
    .join(' ') || modelId
)

const resolveCodexHome = () => (
  normalizeNonEmptyString(process.env.CODEX_HOME) ??
    resolve(normalizeNonEmptyString(process.env.HOME) ?? homedir(), '.codex')
)

const resolveCodexModelsCachePath = () => resolve(resolveCodexHome(), 'models_cache.json')

const parseTomlStringLiteral = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) {
    const match = trimmed.match(/^"((?:\\.|[^"\\])*)"/)
    if (match?.[1] == null) return undefined
    try {
      return JSON.parse(`"${match[1]}"`) as string
    } catch {
      return undefined
    }
  }

  if (trimmed.startsWith("'")) {
    const match = trimmed.match(/^'([^']*)'/)
    return match?.[1]
  }

  return undefined
}

const resolveCodexModelCatalogPath = () => {
  const codexHome = resolveCodexHome()
  try {
    const configContent = readFileSync(resolve(codexHome, 'config.toml'), 'utf8')
    for (const line of configContent.replaceAll('\r\n', '\n').split('\n')) {
      const trimmedLine = line.trimStart()
      if (trimmedLine.startsWith('[')) return undefined
      if (!trimmedLine.startsWith('model_catalog_json')) continue
      const assignment = trimmedLine.slice('model_catalog_json'.length).trimStart()
      if (!assignment.startsWith('=')) continue
      const parsedPath = normalizeNonEmptyString(parseTomlStringLiteral(assignment.slice(1)))
      if (parsedPath == null) return undefined
      return resolve(codexHome, parsedPath)
    }
  } catch {
    return undefined
  }

  return undefined
}

const resolveCodexCatalogSources = (): CodexCatalogSource[] => {
  const catalogPath = resolveCodexModelCatalogPath()
  return [
    ...(catalogPath == null ? [] : [{ description: 'model_catalog_json', path: catalogPath }]),
    { description: 'models_cache.json', path: resolveCodexModelsCachePath() }
  ]
}

const readCodexModelsFromSource = (source: CodexCatalogSource) => {
  try {
    const parsed = JSON.parse(readFileSync(source.path, 'utf8')) as CodexModelsCache
    return Array.isArray(parsed.models) ? parsed.models : []
  } catch {
    return []
  }
}

const readCodexModelCache = () => {
  for (const source of resolveCodexCatalogSources()) {
    const models = readCodexModelsFromSource(source)
    if (models.length > 0) return models
  }
  return []
}

const mapCachedModel = (
  entry: unknown,
  index: number
): { model: AdapterBuiltinModel; priority?: number; index: number } | undefined => {
  if (!isRecord(entry)) return undefined
  const model = entry as CodexModelCacheEntry
  const value = normalizeNonEmptyString(model.slug)
  if (value == null || value === DEFAULT_MODEL_OPTION.value) return undefined
  if (normalizeNonEmptyString(model.visibility) === 'hide') return undefined

  return {
    model: {
      value,
      title: normalizeNonEmptyString(model.display_name) ?? toSyntheticDisplayName(value),
      description: normalizeNonEmptyString(model.description) ?? `Codex model ${value}`,
      defaultEffort: normalizeEffort(model.default_reasoning_level),
      supportedEfforts: normalizeSupportedEfforts(model.supported_reasoning_levels),
      serviceTiers: normalizeServiceTiers(model.service_tiers)
    },
    priority: normalizePriority(model.priority),
    index
  }
}

const loadCachedBuiltinModels = () => (
  readCodexModelCache()
    .map(mapCachedModel)
    .filter((entry): entry is { model: AdapterBuiltinModel; priority?: number; index: number } => entry != null)
    .sort((a, b) => {
      if (a.priority != null && b.priority != null && a.priority !== b.priority) {
        return a.priority - b.priority
      }
      if (a.priority != null && b.priority == null) return -1
      if (a.priority == null && b.priority != null) return 1
      return a.index - b.index
    })
    .map(entry => entry.model)
)

export const loadCodexBuiltinModels = (): AdapterBuiltinModel[] => {
  const cachedModels = loadCachedBuiltinModels()
  const defaultModel = cachedModels[0]
  return [
    {
      ...DEFAULT_MODEL_OPTION,
      defaultEffort: defaultModel?.defaultEffort,
      supportedEfforts: defaultModel?.supportedEfforts,
      serviceTiers: defaultModel?.serviceTiers
    },
    ...(cachedModels.length > 0 ? cachedModels : FALLBACK_BUILTIN_MODELS)
  ]
}

export const loadBuiltinModels = loadCodexBuiltinModels

export const builtinModels: AdapterBuiltinModel[] = loadCodexBuiltinModels()
