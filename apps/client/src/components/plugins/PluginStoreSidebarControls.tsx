import { Tooltip } from 'antd'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type {
  RouteSidebarListContextMenuItems,
  RouteSidebarListGroup
} from '#~/components/layout/route-sidebar-context'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

export type PluginGroupMode = 'enabled' | 'source'
type PluginSourceGroup = 'builtIn' | 'global' | 'local' | 'localDev'
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
  getContextMenuItems?: PluginContextMenuItemsFactory
) => ({
  contextMenuItems: getContextMenuItems?.(plugin),
  icon: plugin.enabled === false ? 'extension_off' : 'extension',
  key: plugin.scope,
  label: plugin.displayName ?? plugin.name ?? plugin.scope,
  searchText: `${plugin.displayName ?? ''} ${plugin.name ?? ''} ${plugin.scope} ${plugin.packageId ?? ''} ${
    plugin.requestId ?? ''
  } ${plugin.pluginRoot ?? plugin.rootDir ?? ''}`
})

export const resolvePluginSourceGroup = (plugin: PluginRuntimeInstance): PluginSourceGroup => {
  if (plugin.sourceGroup != null) return plugin.sourceGroup

  const root = (plugin.pluginRoot ?? plugin.rootDir ?? '').replaceAll('\\', '/')
  const requestId = plugin.requestId.replaceAll('\\', '/')

  if (plugin.watch?.enabled === true || root.includes('/.oo/plugins.dev/')) {
    return 'localDev'
  }

  if (
    plugin.packageId?.startsWith('@oneworks/plugin-') === true ||
    root.includes('/packages/plugins/') ||
    root.includes('/plugins/cache/openai-bundled/') ||
    root.includes('/plugins/cache/openai-primary-runtime/')
  ) {
    return 'builtIn'
  }

  if (root.includes('/.oneworks/global/plugins/')) {
    return 'global'
  }

  if (requestId.startsWith('/') && !root.includes('/node_modules/')) {
    return 'localDev'
  }

  if (root.includes('/node_modules/') || plugin.packageId != null) {
    return 'local'
  }

  return 'global'
}

export const buildPluginRouteSidebarGroups = (
  plugins: PluginRuntimeInstance[],
  groupMode: PluginGroupMode,
  t: (key: string) => string,
  getContextMenuItems?: PluginContextMenuItemsFactory
): RouteSidebarListGroup[] => {
  if (groupMode === 'source') {
    const sourceGroups: Array<{
      icon: string
      key: PluginSourceGroup
      labelKey: string
    }> = [
      { icon: 'deployed_code', key: 'builtIn', labelKey: 'pluginStore.sourceBuiltIn' },
      { icon: 'public', key: 'global', labelKey: 'pluginStore.sourceGlobal' },
      { icon: 'folder', key: 'local', labelKey: 'pluginStore.sourceLocal' },
      { icon: 'code_blocks', key: 'localDev', labelKey: 'pluginStore.sourceLocalDev' }
    ]

    return sourceGroups.map(group => ({
      icon: group.icon,
      items: plugins
        .filter(plugin => resolvePluginSourceGroup(plugin) === group.key)
        .map(plugin => createPluginListItem(plugin, getContextMenuItems)),
      key: `source:${group.key}`,
      label: t(group.labelKey)
    }))
  }

  return [
    {
      icon: 'toggle_on',
      items: plugins
        .filter(plugin => plugin.enabled !== false)
        .map(plugin => createPluginListItem(plugin, getContextMenuItems)),
      key: 'enabled:true',
      label: t('pluginStore.groupEnabled')
    },
    {
      icon: 'toggle_off',
      items: plugins
        .filter(plugin => plugin.enabled === false)
        .map(plugin => createPluginListItem(plugin, getContextMenuItems)),
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
