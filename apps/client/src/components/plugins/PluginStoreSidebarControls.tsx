import { Tooltip } from 'antd'

import type { NativeHostPlugin } from '@oneworks/types'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type {
  RouteSidebarListContextMenuItems,
  RouteSidebarListGroup
} from '#~/components/layout/route-sidebar-context'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'
import {
  getPluginPresentationSearchText,
  resolvePluginDisplayName,
  resolvePluginPresentationIcon
} from '#~/plugins/plugin-presentation'

import { createNativePluginRouteKey } from './plugin-runtime-list-items'

export type PluginGroupMode = 'enabled' | 'source'
type PluginSourceGroup = 'builtIn' | 'global' | 'project' | 'localDev'
type PluginContextMenuItemsFactory = (plugin: PluginRuntimeInstance) => RouteSidebarListContextMenuItems

interface PluginGroupModeControlsProps {
  groupMode: PluginGroupMode
  t: (key: string) => string
  onGroupModeChange: (mode: PluginGroupMode) => void
}

const pluginGroupModeOptions: Array<{
  icon: string
  key: PluginGroupMode
  labelKey: string
}> = [
  { icon: 'toggle_on', key: 'enabled', labelKey: 'pluginStore.groupByEnabled' },
  { icon: 'folder_open', key: 'source', labelKey: 'pluginStore.groupBySource' }
]

const createPluginListItem = (
  plugin: PluginRuntimeInstance,
  language: string,
  serverBaseUrl?: string,
  getContextMenuItems?: PluginContextMenuItemsFactory
) => ({
  contextMenuItems: getContextMenuItems?.(plugin),
  icon: resolvePluginPresentationIcon(plugin, serverBaseUrl),
  key: plugin.scope,
  label: resolvePluginDisplayName(plugin, language),
  searchText: getPluginPresentationSearchText(plugin, language)
})

const nativeAdapterIcons: Record<string, string> = {
  codex: 'code',
  'claude-code': 'psychology',
  copilot: 'support_agent',
  gemini: 'auto_awesome',
  kimi: 'dark_mode',
  opencode: 'terminal'
}

const createNativePluginListItem = (plugin: NativeHostPlugin) => ({
  contextMenuItems: undefined,
  icon: plugin.icon == null
    ? { name: nativeAdapterIcons[plugin.adapter] ?? 'extension', type: 'material' as const }
    : { alt: plugin.displayName ?? plugin.name, src: plugin.icon, type: 'image' as const },
  key: createNativePluginRouteKey(plugin),
  label: plugin.displayName ?? plugin.name,
  searchText: [
    plugin.displayName,
    plugin.name,
    plugin.adapter,
    plugin.marketplace,
    plugin.source.displayPath
  ].filter(Boolean).join(' ')
})

const resolveNativeSourceGroup = (plugin: NativeHostPlugin): PluginSourceGroup => {
  if (plugin.scope === 'project') return 'project'
  if (plugin.scope === 'builtin') return 'builtIn'
  return 'global'
}

export const resolvePluginSourceGroup = (plugin: PluginRuntimeInstance): PluginSourceGroup => {
  return plugin.sourceGroup ?? 'project'
}

export const buildPluginRouteSidebarGroups = (
  plugins: PluginRuntimeInstance[],
  groupMode: PluginGroupMode,
  t: (key: string) => string,
  language: string,
  serverBaseUrl?: string,
  getContextMenuItems?: PluginContextMenuItemsFactory,
  nativePlugins: NativeHostPlugin[] = []
): RouteSidebarListGroup[] => {
  if (groupMode === 'source') {
    const sourceGroups: Array<{
      icon: string
      key: PluginSourceGroup
      labelKey: string
    }> = [
      { icon: 'deployed_code', key: 'builtIn', labelKey: 'pluginStore.sourceBuiltIn' },
      { icon: 'public', key: 'global', labelKey: 'pluginStore.sourceGlobal' },
      { icon: 'folder', key: 'project', labelKey: 'pluginStore.sourceProject' },
      { icon: 'code_blocks', key: 'localDev', labelKey: 'pluginStore.sourceLocalDev' }
    ]

    return sourceGroups.map(group => ({
      icon: group.icon,
      items: plugins
        .filter(plugin => resolvePluginSourceGroup(plugin) === group.key)
        .map(plugin => createPluginListItem(plugin, language, serverBaseUrl, getContextMenuItems))
        .concat(
          nativePlugins
            .filter(plugin => resolveNativeSourceGroup(plugin) === group.key)
            .map(createNativePluginListItem)
        ),
      key: `source:${group.key}`,
      label: t(group.labelKey)
    }))
  }

  return [
    {
      icon: 'toggle_on',
      items: plugins
        .filter(plugin => plugin.enabled !== false)
        .map(plugin => createPluginListItem(plugin, language, serverBaseUrl, getContextMenuItems))
        .concat(nativePlugins.filter(plugin => plugin.state === 'enabled').map(createNativePluginListItem)),
      key: 'enabled:true',
      label: t('pluginStore.groupEnabled')
    },
    {
      icon: 'toggle_off',
      items: plugins
        .filter(plugin => plugin.enabled === false)
        .map(plugin => createPluginListItem(plugin, language, serverBaseUrl, getContextMenuItems))
        .concat(nativePlugins.filter(plugin => plugin.state !== 'enabled').map(createNativePluginListItem)),
      key: 'enabled:false',
      label: t('pluginStore.groupDisabled')
    }
  ]
}

export function PluginGroupModeControls({
  groupMode,
  t,
  onGroupModeChange
}: PluginGroupModeControlsProps) {
  return (
    <span className='plugin-store-route__group-actions' aria-label={t('pluginStore.groupMode')}>
      {pluginGroupModeOptions.map(option => {
        const isActive = groupMode === option.key
        return (
          <Tooltip key={option.key} title={t(option.labelKey)}>
            <button
              type='button'
              className={[
                'search-toggle-button',
                'plugin-store-route__group-button',
                isActive ? 'is-open' : ''
              ].filter(Boolean).join(' ')}
              aria-label={t(option.labelKey)}
              aria-pressed={isActive}
              onMouseDown={event => event.preventDefault()}
              onClick={() => onGroupModeChange(option.key)}
            >
              <MaterialSymbol className='search-toggle-icon' name={option.icon} />
            </button>
          </Tooltip>
        )
      })}
    </span>
  )
}
