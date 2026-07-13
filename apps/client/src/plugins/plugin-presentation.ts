import type { IconAsset } from '#~/components/icons/IconAsset'

import loggerIcon from '../../../../packages/plugins/logger/assets/icon.svg?raw'
import standardDevIcon from '../../../../packages/plugins/standard-dev/assets/icon.svg?raw'

import { buildPluginReadmeAssetUrl } from './api'
import { resolvePluginLocalizedText } from './plugin-i18n'
import type { PluginRuntimeInstance } from './plugin-manifest'

const legacyOfficialPresentations: Record<string, {
  displayName: string
  displayNameI18n: Record<string, string>
  icon: string
}> = {
  '@oneworks/plugin-logger': {
    displayName: 'Logger',
    displayNameI18n: { en: 'Logger', 'zh-Hans': '日志' },
    icon: loggerIcon
  },
  '@oneworks/plugin-standard-dev': {
    displayName: 'Standard Development',
    displayNameI18n: { en: 'Standard Development', 'zh-Hans': '标准研发' },
    icon: standardDevIcon
  }
}

const getLegacyOfficialPresentation = (plugin: PluginRuntimeInstance) => (
  plugin.packageId == null ? undefined : legacyOfficialPresentations[plugin.packageId]
)

export const resolvePluginDisplayName = (plugin: PluginRuntimeInstance, language: string) => (
  resolvePluginLocalizedText(
    plugin.displayNameI18n ?? getLegacyOfficialPresentation(plugin)?.displayNameI18n,
    language,
    {
      allowAnyFallback: false,
      fallbackLanguage: 'en'
    }
  ) ?? plugin.displayName ?? getLegacyOfficialPresentation(plugin)?.displayName ?? plugin.name ?? plugin.scope
)

export const resolvePluginDescription = (plugin: PluginRuntimeInstance, language: string) => (
  resolvePluginLocalizedText(plugin.descriptionI18n, language, {
    allowAnyFallback: false,
    fallbackLanguage: 'en'
  }) ?? plugin.description
)

export const resolvePluginPresentationIcon = (
  plugin: PluginRuntimeInstance,
  serverBaseUrl?: string
): IconAsset => {
  if (plugin.icon != null) {
    return {
      type: 'image',
      src: buildPluginReadmeAssetUrl(plugin.scope, plugin.icon, { serverBaseUrl }),
      alt: ''
    }
  }
  const legacyPresentation = getLegacyOfficialPresentation(plugin)
  return legacyPresentation == null
    ? { type: 'material', name: 'extension' }
    : {
      type: 'svg',
      svg: legacyPresentation.icon,
      title: plugin.displayName ?? legacyPresentation.displayName
    }
}

export const getPluginPresentationSearchText = (plugin: PluginRuntimeInstance, language: string) => {
  const legacyPresentation = getLegacyOfficialPresentation(plugin)
  const useLegacyPresentation = plugin.displayName == null && plugin.displayNameI18n == null
  return `${resolvePluginDisplayName(plugin, language)} ${
    Object.values(plugin.displayNameI18n ?? legacyPresentation?.displayNameI18n ?? {}).join(' ')
  } ${plugin.displayName ?? ''} ${useLegacyPresentation ? legacyPresentation?.displayName ?? '' : ''} ${
    plugin.name ?? ''
  } ${plugin.description ?? ''} ${Object.values(plugin.descriptionI18n ?? {}).join(' ')} ${plugin.scope} ${
    plugin.packageId ?? ''
  } ${plugin.requestId ?? ''} ${plugin.pluginRoot ?? plugin.rootDir ?? ''}`
}
