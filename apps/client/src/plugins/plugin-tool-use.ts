import { useMemo } from 'react'

import { createPluginI18nContext, resolvePluginContributionText } from './plugin-i18n'
import type {
  PluginContributionToolUseField,
  PluginContributionToolUseFieldFormat,
  PluginContributionToolUsePresentation
} from './plugin-manifest'
import { usePluginSlot } from './plugin-slots'

export type RuntimeToolUsePresentation = PluginContributionToolUsePresentation & {
  pluginScope: string
}

const inputModes = new Set(['auto', 'declared', 'hidden'])
const resultModes = new Set(['auto', 'declared', 'hidden'])
const fieldFormats = new Set(['inline', 'text', 'code', 'list', 'chips', 'records', 'json'])
const resultFormats = new Set(['auto', 'text', 'code', 'json', 'markdown'])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const normalizeFields = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const path = asNonEmptyString(candidate.path)
    const fieldTitle = asNonEmptyString(candidate.title)
    if (path == null || fieldTitle == null) return []
    const format = fieldFormats.has(String(candidate.format))
      ? candidate.format as PluginContributionToolUseFieldFormat
      : undefined
    const itemRecord = isRecord(candidate.item) ? candidate.item : undefined
    const item = itemRecord == null
      ? undefined
      : {
        titlePath: asNonEmptyString(itemRecord.titlePath),
        subtitlePath: asNonEmptyString(itemRecord.subtitlePath),
        statusPath: asNonEmptyString(itemRecord.statusPath),
        metaPath: asNonEmptyString(itemRecord.metaPath),
        detailPath: asNonEmptyString(itemRecord.detailPath)
      }
    return [{
      ...candidate,
      path,
      title: fieldTitle,
      format,
      item,
      language: asNonEmptyString(candidate.language)
    }]
  })
}

const normalizeToolUsePresentation = (
  contribution: PluginContributionToolUsePresentation & { pluginScope: string }
): RuntimeToolUsePresentation | undefined => {
  const id = asNonEmptyString(contribution.id)
  const title = asNonEmptyString(contribution.title)
  const pluginScope = asNonEmptyString(contribution.pluginScope)
  const tools = Array.isArray(contribution.tools)
    ? contribution.tools.map(asNonEmptyString).filter((value): value is string => value != null)
    : []
  if (id == null || title == null || pluginScope == null || tools.length === 0) return undefined

  const inputRecord = isRecord(contribution.input) ? contribution.input : undefined
  const fields = normalizeFields(inputRecord?.fields)
  const inputMode = inputModes.has(String(inputRecord?.mode))
    ? inputRecord?.mode as NonNullable<RuntimeToolUsePresentation['input']>['mode']
    : undefined
  const resultRecord = isRecord(contribution.result) ? contribution.result : undefined
  const resultMode = resultModes.has(String(resultRecord?.mode))
    ? resultRecord?.mode as NonNullable<RuntimeToolUsePresentation['result']>['mode']
    : undefined
  const resultFormat = resultFormats.has(String(resultRecord?.format))
    ? resultRecord?.format as NonNullable<RuntimeToolUsePresentation['result']>['format']
    : undefined

  return {
    ...contribution,
    id,
    title,
    pluginScope,
    tools,
    icon: asNonEmptyString(contribution.icon),
    origin: contribution.origin === 'any' ? 'any' : undefined,
    target: asNonEmptyString(contribution.target),
    input: inputRecord == null ? undefined : { mode: inputMode, fields },
    result: resultRecord == null
      ? undefined
      : {
        mode: resultMode,
        format: resultFormat,
        fields: normalizeFields(resultRecord.fields),
        language: asNonEmptyString(resultRecord.language)
      }
  }
}

const getToolNameSegments = (name: string) => (
  name.includes('__') ? name.split('__').filter(Boolean) : name.split(':').filter(Boolean)
)

export const getToolUseBaseName = (name: string) => getToolNameSegments(name).at(-1) ?? name

const isToolFromPluginScope = (name: string, pluginScope: string) => {
  const namespace = getToolNameSegments(name).find(segment => segment.startsWith('oneworks-'))
  if (namespace == null) return false
  try {
    const base64Url = namespace.slice('oneworks-'.length)
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(base64Url.length / 4) * 4, '=')
    const binary = globalThis.atob(base64)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const resourceScope = new TextDecoder().decode(bytes)
    return resourceScope === pluginScope || resourceScope.startsWith(`${pluginScope}/`)
  } catch {
    return false
  }
}

const getMatchScore = (
  name: string,
  contribution: RuntimeToolUsePresentation
) => {
  if (!Array.isArray(contribution.tools)) return 0
  const exactMatch = contribution.tools.includes(name)
  const baseMatch = contribution.tools.includes(getToolUseBaseName(name))
  if (!exactMatch && !baseMatch) return 0

  if (contribution.origin === 'any') return exactMatch ? 20 : 10
  if (!isToolFromPluginScope(name, contribution.pluginScope)) return 0
  return exactMatch ? 40 : 30
}

export const resolvePluginToolUsePresentation = (
  name: string,
  contributions: RuntimeToolUsePresentation[]
) => {
  let bestMatch: RuntimeToolUsePresentation | undefined
  let bestScore = 0
  for (const contribution of contributions) {
    const score = getMatchScore(name, contribution)
    if (score <= bestScore) continue
    bestMatch = contribution
    bestScore = score
  }
  return bestMatch
}

export function usePluginToolUsePresentations() {
  const contributions = usePluginSlot<PluginContributionToolUsePresentation>('chat.toolUse.presentations')

  return useMemo(() => {
    const pluginI18n = createPluginI18nContext()
    return contributions.flatMap((contribution) => {
      const normalized = normalizeToolUsePresentation(contribution)
      if (normalized == null) return []
      const localizeFields = (fields?: PluginContributionToolUseField[]) =>
        fields?.map(field => ({
          ...field,
          title: resolvePluginContributionText(field, 'title', pluginI18n) ?? field.title
        }))
      return [{
        ...normalized,
        input: normalized.input == null
          ? undefined
          : {
            ...normalized.input,
            fields: localizeFields(normalized.input.fields)
          },
        result: normalized.result == null
          ? undefined
          : {
            ...normalized.result,
            fields: localizeFields(normalized.result.fields)
          }
      }]
    })
  }, [contributions])
}

export function usePluginToolUsePresentation(name: string) {
  const contributions = usePluginToolUsePresentations()
  return useMemo(
    () => resolvePluginToolUsePresentation(name, contributions),
    [contributions, name]
  )
}
