import { resolvePluginContributionText } from './plugin-i18n'
import type { PluginContributionNavItem } from './plugin-manifest'

export interface PluginSidebarNavigationAction {
  icon: string
  key: string
  label: string
  onSelect: () => void
}

export interface PluginSidebarNavigationItem {
  actions?: PluginSidebarNavigationAction[]
  icon: string
  isActive: boolean
  key: string
  label: string
  onSelect: () => void
}

type RuntimePluginNavigationItem = PluginContributionNavItem & { pluginScope: string }

const executeTarget = (
  target: { command?: string; payload?: unknown; route?: string },
  pluginScope: string,
  navigate: (route: string) => void,
  executeCommand?: (pluginScope: string, command: string, payload?: unknown) => Promise<unknown>
) => {
  if (target.route == null && target.command != null && executeCommand != null) {
    void executeCommand(pluginScope, target.command, target.payload)
    return
  }
  if (target.route != null) navigate(target.route)
}

export const buildPluginSidebarNavigationItems = ({
  executeCommand,
  items,
  language,
  navigate,
  pathname
}: {
  executeCommand?: (pluginScope: string, command: string, payload?: unknown) => Promise<unknown>
  items: RuntimePluginNavigationItem[]
  language: string
  navigate: (route: string) => void
  pathname: string
}): PluginSidebarNavigationItem[] =>
  items.map(item => {
    const route = item.route ?? (item.command == null ? `/plugins/${item.pluginScope}/${item.id}` : undefined)
    return {
      actions: item.actions?.map(action => ({
        icon: action.icon ?? 'arrow_forward',
        key: `${item.pluginScope}:${item.id}:${action.id}`,
        label: resolvePluginContributionText(action, 'title', language) ?? action.title,
        onSelect: () => executeTarget(action, item.pluginScope, navigate, executeCommand)
      })),
      icon: item.icon ?? 'layers',
      isActive: route != null && pathname === route.split('?')[0],
      key: `plugin:${item.pluginScope}:${item.id}`,
      label: resolvePluginContributionText(item, 'title', language) ?? item.title,
      onSelect: () => executeTarget({ ...item, route }, item.pluginScope, navigate, executeCommand)
    }
  })

export const buildPluginCompactNavigationActions = (
  items: PluginSidebarNavigationItem[]
): PluginSidebarNavigationAction[] =>
  items.flatMap(item =>
    (item.actions ?? []).map(action => ({
      ...action,
      key: `compact:${action.key}`
    }))
  )
