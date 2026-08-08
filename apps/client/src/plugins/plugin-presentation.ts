import type { IconAsset } from '#~/components/icons/IconAsset'
import type { NativeHostPlugin, PluginMarketplaceCatalogPlugin } from '@oneworks/types'

import loggerIcon from '../../../../packages/plugins/logger/assets/icon.svg?raw'
import standardDevIcon from '../../../../packages/plugins/standard-dev/assets/icon.svg?raw'

import { buildPluginReadmeAssetUrl } from './api'
import { resolvePluginLocalizedText } from './plugin-i18n'
import type { PluginRuntimeInstance } from './plugin-manifest'
import {
  projectPluginPresentationValue,
  sanitizePluginAssetReference,
  sanitizePluginPresentationData,
  sanitizePluginPresentationValue
} from './plugin-presentation-projection'
export {
  PRIVATE_PLUGIN_PRESENTATION_VALUE,
  projectPluginPresentationList,
  projectPluginPresentationValue,
  sanitizePluginAssetReference,
  sanitizePluginIconRef,
  sanitizePluginMaterialIcon,
  sanitizePluginPresentationData,
  sanitizePluginPresentationValue
} from './plugin-presentation-projection'

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

const firstSafePluginPresentationValue = (...values: Array<string | undefined>) => {
  for (const value of values) {
    const safeValue = sanitizePluginPresentationValue(value)
    if (safeValue != null) return safeValue
  }
  return undefined
}

export const resolvePluginDisplayName = (plugin: PluginRuntimeInstance, language: string) => {
  const legacyPresentation = getLegacyOfficialPresentation(plugin)
  return firstSafePluginPresentationValue(
    resolvePluginLocalizedText(
      plugin.displayNameI18n ?? legacyPresentation?.displayNameI18n,
      language,
      {
        allowAnyFallback: false,
        fallbackLanguage: 'en'
      }
    ),
    plugin.displayName,
    legacyPresentation?.displayName,
    plugin.name,
    plugin.packageId,
    plugin.scope
  ) ?? 'plugin'
}

export const resolvePluginDescription = (plugin: PluginRuntimeInstance, language: string) => (
  sanitizePluginPresentationValue(resolvePluginLocalizedText(plugin.descriptionI18n, language, {
    allowAnyFallback: false,
    fallbackLanguage: 'en'
  })) ?? sanitizePluginPresentationValue(plugin.description)
)

export const resolvePluginRequestDisplay = (plugin: PluginRuntimeInstance) => (
  firstSafePluginPresentationValue(plugin.requestId, plugin.packageId, plugin.name, plugin.scope) ?? 'plugin'
)

export const resolvePluginRootDisplay = (_plugin: PluginRuntimeInstance): undefined => undefined

export const resolveNativePluginDisplayName = (plugin: NativeHostPlugin) => (
  firstSafePluginPresentationValue(
    plugin.displayName,
    plugin.name,
    plugin.adapter,
    plugin.marketplace,
    plugin.id
  ) ?? 'plugin'
)

export const resolveNativePluginDescription = (plugin: NativeHostPlugin) => (
  sanitizePluginPresentationValue(plugin.description)
)

export const resolveNativePluginSourceDisplay = (plugin: NativeHostPlugin) => (
  projectPluginPresentationValue(plugin.source.displayPath)
)

export const resolveMarketplacePluginDisplayName = (plugin: PluginMarketplaceCatalogPlugin) => (
  firstSafePluginPresentationValue(plugin.displayName, plugin.name) ?? 'plugin'
)

export const resolveMarketplacePluginDescription = (plugin: PluginMarketplaceCatalogPlugin) => (
  sanitizePluginPresentationValue(plugin.description)
)

export const resolveMarketplacePluginSourceDisplay = (plugin: PluginMarketplaceCatalogPlugin) => (
  projectPluginPresentationValue(plugin.sourceLabel)
)

export const buildPluginPresentationInstanceConfig = (plugin: PluginRuntimeInstance) => {
  const pluginRoot = resolvePluginRootDisplay(plugin)
  return {
    enabled: plugin.enabled !== false,
    id: resolvePluginRequestDisplay(plugin),
    options: sanitizePluginPresentationData(plugin.options ?? {}),
    packageId: sanitizePluginPresentationValue(plugin.packageId),
    ...(pluginRoot == null ? {} : { pluginRoot }),
    scope: sanitizePluginPresentationValue(plugin.scope) ?? 'plugin',
    sourceGroup: plugin.sourceGroup,
    watch: plugin.watch?.enabled === true
  }
}

export const resolvePluginPresentationIcon = (
  plugin: PluginRuntimeInstance,
  serverBaseUrl?: string
): IconAsset => {
  const icon = sanitizePluginAssetReference(plugin.icon)
  const scope = sanitizePluginPresentationValue(plugin.scope)
  if (icon != null && scope != null) {
    return {
      type: 'image',
      src: buildPluginReadmeAssetUrl(scope, icon, { serverBaseUrl }),
      alt: ''
    }
  }
  const legacyPresentation = getLegacyOfficialPresentation(plugin)
  return legacyPresentation == null
    ? { type: 'material', name: 'extension' }
    : {
      type: 'svg',
      svg: legacyPresentation.icon,
      title: sanitizePluginPresentationValue(plugin.displayName) ?? legacyPresentation.displayName
    }
}

const getSafeLocalizedValues = (values: Record<string, string> | undefined) => (
  Object.values(values ?? {})
    .map(value => sanitizePluginPresentationValue(value))
    .filter((value): value is string => value != null)
)

export const getPluginPresentationSearchText = (plugin: PluginRuntimeInstance, language: string) => {
  const legacyPresentation = getLegacyOfficialPresentation(plugin)
  const useLegacyPresentation = plugin.displayName == null && plugin.displayNameI18n == null
  return [
    resolvePluginDisplayName(plugin, language),
    ...getSafeLocalizedValues(plugin.displayNameI18n ?? legacyPresentation?.displayNameI18n),
    sanitizePluginPresentationValue(plugin.displayName),
    useLegacyPresentation ? legacyPresentation?.displayName : undefined,
    sanitizePluginPresentationValue(plugin.name),
    resolvePluginDescription(plugin, language),
    ...getSafeLocalizedValues(plugin.descriptionI18n),
    sanitizePluginPresentationValue(plugin.scope),
    sanitizePluginPresentationValue(plugin.packageId),
    sanitizePluginPresentationValue(plugin.requestId),
    resolvePluginRootDisplay(plugin)
  ].filter((value): value is string => value != null && value !== '').join(' ')
}
