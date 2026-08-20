import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalPluginContext } from './plugin-context'
import type { PluginRuntimeSource } from './plugin-context'
import { createPluginI18nContext, localizePluginContributionItem } from './plugin-i18n'
import type { PluginSlot } from './plugin-manifest'

export type RuntimeScopedPluginContribution<T extends { id: string }> = T & {
  pluginRuntimeSource: PluginRuntimeSource
  pluginScope: string
}

export interface PluginCommandExecutor {
  (
    pluginScope: string,
    command: string,
    payload?: unknown,
    runtimeSource?: PluginRuntimeSource
  ): Promise<unknown>
}

const hostChromeSlots = new Set<PluginSlot>([
  'chat.header.actions',
  'chat.header.moreMenu',
  'chat.interactionPanel.emptyActions',
  'nav.footer.before',
  'nav.items',
  'nav.moreMenu',
  'route.header.actions',
  'route.moreMenu.items',
  'route.sidebar.contextMenu',
  'route.windowBar.actions',
  'sessions.groups'
])

const emptyPluginSlotItems: Array<RuntimeScopedPluginContribution<{ id: string }>> = []

const collectPluginSlotItems = <T extends { id: string }>(
  context: ReturnType<typeof useOptionalPluginContext>,
  slot: PluginSlot
): Array<RuntimeScopedPluginContribution<T>> => {
  if (context == null) return emptyPluginSlotItems as Array<RuntimeScopedPluginContribution<T>>
  const sources = hostChromeSlots.has(slot)
    ? context.contributionRuntimeSources
    : context.contributionRuntimeSources.slice(0, 1)
  const itemsByKey = new Map<string, RuntimeScopedPluginContribution<T>>()

  for (const source of sources) {
    const items = (source.snapshot.slots[slot] ?? emptyPluginSlotItems) as Array<T & { pluginScope: string }>
    for (const item of items) {
      const key = `${item.pluginScope}/${item.id}`
      if (itemsByKey.has(key)) continue
      itemsByKey.set(key, {
        ...item,
        pluginRuntimeSource: source.runtimeSource
      })
    }
  }

  return [...itemsByKey.values()]
}

export function usePluginSlot<T extends { id: string }>(slot: PluginSlot): Array<RuntimeScopedPluginContribution<T>> {
  const { i18n } = useTranslation()
  const context = useOptionalPluginContext()
  const contributionRuntimeSources = context?.contributionRuntimeSources
  const language = i18n.resolvedLanguage ?? i18n.language

  return useMemo(() => {
    const pluginI18n = createPluginI18nContext()
    return collectPluginSlotItems<T>(context, slot)
      .map(item => localizePluginContributionItem(item, pluginI18n))
  }, [context, contributionRuntimeSources, language, slot])
}

export function usePluginCommandExecutor() {
  const context = useOptionalPluginContext()
  return useMemo<PluginCommandExecutor | undefined>(() => {
    if (context == null) return undefined
    return (pluginScope, command, payload, runtimeSource) => {
      const source = runtimeSource == null
        ? context.contributionRuntimeSources[0]
        : context.contributionRuntimeSources.find(candidate => candidate.runtimeSource === runtimeSource)

      if (runtimeSource != null && source == null) {
        return Promise.reject(new Error(`Plugin runtime source "${runtimeSource}" is unavailable`))
      }

      const resolvedSource = source ?? context.contributionRuntimeSources[0]
      return (resolvedSource?.registry ?? context.registry).executeCommand(
        pluginScope,
        command,
        payload,
        { serverBaseUrl: resolvedSource?.pluginServerBaseUrl ?? context.pluginServerBaseUrl }
      )
    }
  }, [context])
}
