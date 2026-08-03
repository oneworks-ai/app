import type { PluginContributionToolUseFieldFormat, PluginContributionToolUsePresentation } from './plugin-manifest'
import { isPrivatePublicFieldName } from './plugin-public-api-generic'

export type RuntimeToolUsePresentation = PluginContributionToolUsePresentation & {
  pluginScope: string
}

const inputModes = new Set(['auto', 'declared', 'hidden'])
const resultModes = new Set(['auto', 'declared', 'hidden'])
const fieldFormats = new Set(['inline', 'text', 'code', 'list', 'chips', 'records', 'json'])
const resultFormats = new Set(['auto', 'text', 'code', 'json', 'markdown'])
const roles = new Set(['manager', 'workspace'])
const surfaces = new Set(['launcher', 'workspace'])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) == null)
)

const asNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const normalizeStringRecord = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const normalized = Object.create(null) as Record<string, string>
  for (const key of Object.keys(value)) {
    if (isPrivatePublicFieldName(key) || typeof value[key] !== 'string') return undefined
    normalized[key] = value[key]
  }
  return normalized
}

const normalizeLocalizedText = (value: unknown) => (
  typeof value === 'string' ? value : normalizeStringRecord(value)
)

const normalizeI18n = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const normalized = Object.create(null) as Record<string, { description?: string; title?: string }>
  for (const locale of Object.keys(value)) {
    const entry = value[locale]
    if (isPrivatePublicFieldName(locale) || !isRecord(entry)) return undefined
    if (!Object.keys(entry).every(key => key === 'description' || key === 'title')) return undefined
    const description = entry.description
    const title = entry.title
    if (
      (description != null && typeof description !== 'string') ||
      (title != null && typeof title !== 'string')
    ) return undefined
    normalized[locale] = {
      description: typeof description === 'string' ? description : undefined,
      title: typeof title === 'string' ? title : undefined
    }
  }
  return normalized
}

const normalizeEnumArray = <T extends string>(value: unknown, allowed: Set<string>) => {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && allowed.has(item))) {
    return undefined
  }
  return [...value] as T[]
}

const normalizeFields = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const fieldPath = asNonEmptyString(candidate.path)
    const title = asNonEmptyString(candidate.title)
    if (fieldPath == null || title == null) return []
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
      path: fieldPath,
      title,
      format,
      item,
      language: asNonEmptyString(candidate.language),
      titleI18n: normalizeStringRecord(candidate.titleI18n)
    }]
  })
}

export const normalizePluginToolUsePresentation = (
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
    id,
    title,
    pluginScope,
    tools,
    description: normalizeLocalizedText(contribution.description),
    descriptionI18n: normalizeStringRecord(contribution.descriptionI18n),
    icon: asNonEmptyString(contribution.icon),
    i18n: normalizeI18n(contribution.i18n),
    origin: contribution.origin === 'any' ? 'any' : undefined,
    roles: normalizeEnumArray<'manager' | 'workspace'>(contribution.roles, roles),
    surfaces: normalizeEnumArray<'launcher' | 'workspace'>(contribution.surfaces, surfaces),
    target: asNonEmptyString(contribution.target),
    titleI18n: normalizeStringRecord(contribution.titleI18n),
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
