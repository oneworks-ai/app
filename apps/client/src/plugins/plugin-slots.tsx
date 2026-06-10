import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalPluginContext } from './plugin-context'
import { createPluginI18nContext, localizePluginContributionItem } from './plugin-i18n'
import type { PluginSlot } from './plugin-manifest'

const emptyPluginSlotItems: Array<{ id: string; pluginScope: string }> = []

export function usePluginSlot<T extends { id: string }>(slot: PluginSlot): Array<T & { pluginScope: string }> {
  const { i18n } = useTranslation()
  const context = useOptionalPluginContext()
  const items = (context?.snapshot.slots[slot] ?? emptyPluginSlotItems) as Array<T & { pluginScope: string }>
  const language = i18n.resolvedLanguage ?? i18n.language

  return useMemo(() => {
    const pluginI18n = createPluginI18nContext()
    return items.map(item => localizePluginContributionItem(item, pluginI18n))
  }, [items, language])
}

export function usePluginCommandExecutor() {
  const context = useOptionalPluginContext()
  const registry = context?.registry

  return useMemo(
    () => registry == null ? undefined : registry.executeCommand.bind(registry),
    [registry]
  )
}
