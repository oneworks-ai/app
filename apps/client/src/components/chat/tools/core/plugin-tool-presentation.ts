import type {
  PluginContributionToolUseFieldFormat,
  PluginContributionToolUseRecordItem
} from '#~/plugins/plugin-manifest'
import type { RuntimeToolUsePresentation } from '#~/plugins/plugin-tool-use'

import { buildGenericToolPresentation } from './generic-tool-presentation'
import type { GenericToolPresentation } from './generic-tool-presentation'
import type { ToolFieldFormat, ToolFieldView, ToolRecordView } from './tool-field-sections'

const blockedPathSegments = new Set(['__proto__', 'constructor', 'prototype'])
const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const readToolUseValue = (value: unknown, path: string): unknown => {
  if (typeof path !== 'string' || path.trim() === '') return undefined
  let current = value
  for (const segment of path.split('.')) {
    if (blockedPathSegments.has(segment) || current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

const hasValue = (value: unknown) => (
  value != null && value !== '' && (!Array.isArray(value) || value.length > 0)
)

const inferFieldFormat = (value: unknown): ToolFieldFormat => {
  if (Array.isArray(value)) return 'list'
  if (value != null && typeof value === 'object') return 'json'
  return 'inline'
}

const toFieldFormat = (
  format: PluginContributionToolUseFieldFormat | undefined,
  value: unknown
): ToolFieldFormat => format ?? inferFieldFormat(value)

const asDisplayText = (value: unknown) => {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

const firstDisplayText = (record: Record<string, unknown>, paths: string[]) => {
  for (const path of paths) {
    const value = asDisplayText(readToolUseValue(record, path))
    if (value != null) return value
  }
  return undefined
}

const buildRecordViews = (
  value: unknown,
  item?: PluginContributionToolUseRecordItem
): ToolRecordView[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate, index) => {
    if (!isRecord(candidate)) {
      const title = asDisplayText(candidate)
      return title == null ? [] : [{ title }]
    }
    const title = item?.titlePath == null
      ? firstDisplayText(candidate, ['title', 'name', 'node_id', 'id', 'op'])
      : asDisplayText(readToolUseValue(candidate, item.titlePath))
    const subtitle = item?.subtitlePath == null
      ? undefined
      : asDisplayText(readToolUseValue(candidate, item.subtitlePath))
    const status = item?.statusPath == null
      ? undefined
      : asDisplayText(readToolUseValue(candidate, item.statusPath))
    const meta = item?.metaPath == null
      ? undefined
      : asDisplayText(readToolUseValue(candidate, item.metaPath))
    const detail = item?.detailPath == null
      ? undefined
      : readToolUseValue(candidate, item.detailPath)
    return [{
      title: title ?? `#${index + 1}`,
      subtitle,
      status,
      meta,
      detail
    }]
  })
}

const buildDeclaredFields = (
  contribution: RuntimeToolUsePresentation,
  source: unknown,
  fields = contribution.input?.fields ?? []
) => {
  const inlineFields: ToolFieldView[] = []
  const blockFields: ToolFieldView[] = []
  for (const field of fields) {
    const value = readToolUseValue(source, field.path)
    if (!hasValue(value)) continue
    const format = toFieldFormat(field.format, value)
    const records = format === 'records' ? buildRecordViews(value, field.item) : undefined
    if (format === 'records' && records?.length === 0) continue
    if (format === 'chips' && !Array.isArray(value)) continue
    const view: ToolFieldView = {
      fallbackLabel: field.title,
      format,
      labelKey: `plugin.${contribution.pluginScope}.toolUse.${contribution.id}.${field.path}`,
      lang: field.language,
      value,
      records
    }
    if (format === 'inline') inlineFields.push(view)
    else blockFields.push(view)
  }
  return { blockFields, inlineFields }
}

export const buildPluginToolResultPresentation = (
  content: unknown,
  contribution?: RuntimeToolUsePresentation
) => {
  const result = contribution?.result
  const mode = result?.mode ?? (result?.fields == null ? 'auto' : 'declared')
  const fields = mode === 'declared' && contribution != null
    ? buildDeclaredFields(contribution, content, result?.fields)
    : { blockFields: [], inlineFields: [] }
  return { mode, ...fields }
}

export const buildPluginToolPresentation = (
  name: string,
  input: unknown,
  contribution?: RuntimeToolUsePresentation
): GenericToolPresentation => {
  const generic = buildGenericToolPresentation(name, input)
  if (contribution == null) return generic

  const inputMode = contribution.input?.mode ?? (
    contribution.input?.fields == null ? 'auto' : 'declared'
  )
  const declaredFields = inputMode === 'declared'
    ? buildDeclaredFields(contribution, input)
    : undefined
  const primaryValue = contribution.target == null
    ? generic.primary
    : readToolUseValue(input, contribution.target)
  const primary = hasValue(primaryValue)
    ? (typeof primaryValue === 'string' ? primaryValue : String(primaryValue))
    : undefined

  return {
    ...generic,
    fallbackTitle: contribution.title,
    titleKey: undefined,
    icon: contribution.icon ?? generic.icon,
    primary,
    inlineFields: inputMode === 'auto' ? generic.inlineFields : (declaredFields?.inlineFields ?? []),
    blockFields: inputMode === 'auto' ? generic.blockFields : (declaredFields?.blockFields ?? []),
    diff: inputMode === 'auto' ? generic.diff : undefined,
    suppressSuccessResult: undefined
  }
}
