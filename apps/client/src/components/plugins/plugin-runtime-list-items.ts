import type { NativeHostPlugin } from '@oneworks/types'

import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'
import {
  getPluginPresentationSearchText,
  resolvePluginDescription,
  resolvePluginDisplayName,
  resolvePluginPresentationIcon
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
    version: plugin.version
  })),
  ...nativePlugins.map((plugin): PluginListItem => ({
    adapter: plugin.adapter,
    description: plugin.description,
    icon: plugin.icon == null
      ? { name: nativeAdapterIcons[plugin.adapter] ?? 'extension', type: 'material' }
      : { alt: plugin.displayName ?? plugin.name, src: plugin.icon, type: 'image' },
    id: createNativePluginRouteKey(plugin),
    kind: 'native',
    name: plugin.displayName ?? plugin.name,
    native: plugin,
    searchText: [
      plugin.displayName,
      plugin.name,
      plugin.id,
      plugin.adapter,
      plugin.marketplace,
      plugin.scope,
      plugin.source.displayPath
    ].filter(Boolean).join(' '),
    source: plugin.scope,
    state: plugin.state,
    version: plugin.version
  }))
]
