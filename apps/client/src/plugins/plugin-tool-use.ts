import { useMemo } from 'react'

import { createPluginI18nContext, resolvePluginContributionText } from './plugin-i18n'
import type { PluginContributionToolUseField, PluginContributionToolUsePresentation } from './plugin-manifest'
import { usePluginSlot } from './plugin-slots'
import { normalizePluginToolUsePresentation } from './plugin-tool-use-normalization'
import type { RuntimeToolUsePresentation } from './plugin-tool-use-normalization'

export { normalizePluginToolUsePresentation } from './plugin-tool-use-normalization'
export type { RuntimeToolUsePresentation } from './plugin-tool-use-normalization'

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
      const normalized = normalizePluginToolUsePresentation(contribution)
      if (normalized == null) return []
      const localizeFields = (fields?: PluginContributionToolUseField[]) =>
        fields?.map(field => ({
          path: field.path,
          title: resolvePluginContributionText(field, 'title', pluginI18n) ?? field.title,
          format: field.format,
          item: field.item,
          language: field.language,
          titleI18n: field.titleI18n
        }))
      return [{
        id: normalized.id,
        title: resolvePluginContributionText(normalized, 'title', pluginI18n) ?? normalized.title,
        pluginScope: normalized.pluginScope,
        tools: normalized.tools,
        description: normalized.description,
        descriptionI18n: normalized.descriptionI18n,
        icon: normalized.icon,
        i18n: normalized.i18n,
        origin: normalized.origin,
        roles: normalized.roles,
        surfaces: normalized.surfaces,
        target: normalized.target,
        titleI18n: normalized.titleI18n,
        input: normalized.input == null
          ? undefined
          : {
            mode: normalized.input.mode,
            fields: localizeFields(normalized.input.fields)
          },
        result: normalized.result == null
          ? undefined
          : {
            mode: normalized.result.mode,
            format: normalized.result.format,
            fields: localizeFields(normalized.result.fields),
            language: normalized.result.language
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
