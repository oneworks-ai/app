import type { NativeHostPlugin } from '@oneworks/types'

import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'
import {
  getPluginPresentationSearchText,
  projectPluginPresentationValue,
  resolveNativePluginDescription,
  resolveNativePluginDisplayName,
  resolveNativePluginSourceDisplay,
  resolvePluginDescription,
  resolvePluginDisplayName,
  resolvePluginPresentationIcon,
  sanitizePluginAssetReference
} from '#~/plugins/plugin-presentation'

export type PluginListKind = 'native' | 'oneworks'
export type PluginListState = 'disabled' | 'enabled' | 'unknown'

export interface PluginListItem {
  adapter?: string
  description?: string
  icon: ReturnType<typeof resolvePluginPresentationIcon>
  id: string
  kind: PluginListKind
  name: string
  native?: NativeHostPlugin
  plugin?: PluginRuntimeInstance
  searchText: string
  source: string
  state: PluginListState
  version?: string
}

const nativeAdapterIcons: Record<string, string> = {
  codex: 'code',
  'claude-code': 'psychology',
  gemini: 'auto_awesome',
  copilot: 'support_agent',
  kimi: 'dark_mode',
  opencode: 'terminal'
}

const resolvePluginListState = (value: string): PluginListState => (
  value === 'disabled' || value === 'enabled' ? value : 'unknown'
)

export const resolveNativePluginPresentationIcon = (plugin: NativeHostPlugin) => {
  const icon = sanitizePluginAssetReference(plugin.icon)
  const adapterIcon = Object.hasOwn(nativeAdapterIcons, plugin.adapter)
    ? nativeAdapterIcons[plugin.adapter]
    : undefined
  return icon == null
    ? { name: adapterIcon ?? 'extension', type: 'material' as const }
    : { alt: resolveNativePluginDisplayName(plugin), src: icon, type: 'image' as const }
}

export const createNativePluginRouteKey = (plugin: NativeHostPlugin) => (
  `native:${plugin.adapter}:${plugin.id}`
)

export const buildPluginListItems = ({
  language,
  nativePlugins,
  plugins,
  serverBaseUrl
}: {
  language: string
  nativePlugins: NativeHostPlugin[]
  plugins: PluginRuntimeInstance[]
  serverBaseUrl?: string
}): PluginListItem[] => [
  ...plugins.map((plugin): PluginListItem => ({
    description: resolvePluginDescription(plugin, language),
    icon: resolvePluginPresentationIcon(plugin, serverBaseUrl),
    id: plugin.scope,
    kind: 'oneworks',
    name: resolvePluginDisplayName(plugin, language),
    plugin,
    searchText: getPluginPresentationSearchText(plugin, language),
    source: plugin.sourceGroup ?? 'unknown',
    state: plugin.enabled === false ? 'disabled' : 'enabled',
    version: plugin.version == null ? undefined : projectPluginPresentationValue(plugin.version)
  })),
  ...nativePlugins.map((plugin): PluginListItem => ({
    adapter: projectPluginPresentationValue(plugin.adapter),
    description: resolveNativePluginDescription(plugin),
    icon: resolveNativePluginPresentationIcon(plugin),
    id: createNativePluginRouteKey(plugin),
    kind: 'native',
    name: resolveNativePluginDisplayName(plugin),
    native: plugin,
    searchText: [
      resolveNativePluginDisplayName(plugin),
      projectPluginPresentationValue(plugin.id),
      projectPluginPresentationValue(plugin.adapter),
      projectPluginPresentationValue(plugin.marketplace),
      projectPluginPresentationValue(plugin.scope),
      resolveNativePluginSourceDisplay(plugin)
    ].join(' '),
    source: projectPluginPresentationValue(plugin.scope),
    state: resolvePluginListState(plugin.state),
    version: plugin.version == null ? undefined : projectPluginPresentationValue(plugin.version)
  }))
]
