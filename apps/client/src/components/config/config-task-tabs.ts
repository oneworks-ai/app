import { parseConfigDetailRoute } from './configDetail'
import type { FieldSpec } from './configSchema'
import { configSchema } from './configSchema'

export type TaskTabbedConfigSectionKey = 'conversation' | 'general'

export const configTaskTabQueryKey = 'sectionTab'

export type ConfigTaskTabKey =
  | 'actions'
  | 'advanced'
  | 'base'
  | 'defaults'
  | 'links'
  | 'models'
  | 'notifications'
  | 'presets'
  | 'tools'

export interface ConfigTaskTabDefinition {
  groups: string[]
  icon: string
  key: ConfigTaskTabKey
  labelKey: string
}

const taskTabsBySection: Record<TaskTabbedConfigSectionKey, ConfigTaskTabDefinition[]> = {
  general: [
    {
      groups: ['base'],
      icon: 'tune',
      key: 'base',
      labelKey: 'config.taskTabs.general.base'
    },
    {
      groups: ['models'],
      icon: 'model_training',
      key: 'models',
      labelKey: 'config.taskTabs.general.models'
    },
    {
      groups: ['links'],
      icon: 'link',
      key: 'links',
      labelKey: 'config.taskTabs.general.links'
    },
    {
      groups: ['permissions', 'env'],
      icon: 'shield',
      key: 'tools',
      labelKey: 'config.taskTabs.general.tools'
    },
    {
      groups: ['items'],
      icon: 'notifications',
      key: 'notifications',
      labelKey: 'config.taskTabs.general.notifications'
    },
    {
      groups: ['advanced'],
      icon: 'settings',
      key: 'advanced',
      labelKey: 'config.taskTabs.general.advanced'
    }
  ],
  conversation: [
    {
      groups: ['defaults'],
      icon: 'tune',
      key: 'defaults',
      labelKey: 'config.taskTabs.conversation.defaults'
    },
    {
      groups: ['presets'],
      icon: 'bolt',
      key: 'presets',
      labelKey: 'config.taskTabs.conversation.presets'
    },
    {
      groups: ['actions'],
      icon: 'construction',
      key: 'actions',
      labelKey: 'config.taskTabs.conversation.actions'
    }
  ]
}

const isSamePath = (left: string[], right: string[]) => (
  left.length === right.length && left.every((segment, index) => segment === right[index])
)

export const getConfigTaskTabDefinitions = (sectionKey: TaskTabbedConfigSectionKey) => (
  taskTabsBySection[sectionKey]
)

export const getConfigTaskTabFields = (
  sectionKey: TaskTabbedConfigSectionKey,
  tabKey: ConfigTaskTabKey
): FieldSpec[] => {
  const definition = taskTabsBySection[sectionKey].find(tab => tab.key === tabKey)
  if (definition == null) return []
  return (configSchema[sectionKey] ?? []).filter(field => definition.groups.includes(field.group ?? 'default'))
}

const getDetailTaskTabKey = (
  sectionKey: TaskTabbedConfigSectionKey,
  detailQuery: string
): ConfigTaskTabKey | undefined => {
  const fields = configSchema[sectionKey] ?? []
  const route = parseConfigDetailRoute({ fields, raw: detailQuery })
  if (route == null) return undefined
  const field = fields.find(candidate => isSamePath(candidate.path, route.fieldPath))
  if (field == null) return undefined
  const group = field.group ?? 'default'
  return taskTabsBySection[sectionKey].find(tab => tab.groups.includes(group))?.key
}

export const resolveConfigTaskTabKey = ({
  detailQuery,
  requestedTabKey,
  sectionKey
}: {
  detailQuery?: string
  requestedTabKey?: string
  sectionKey: TaskTabbedConfigSectionKey
}): ConfigTaskTabKey => {
  const detailTabKey = getDetailTaskTabKey(sectionKey, detailQuery ?? '')
  if (detailTabKey != null) return detailTabKey

  const requestedTab = taskTabsBySection[sectionKey].find(tab => tab.key === requestedTabKey)
  return requestedTab?.key ?? taskTabsBySection[sectionKey][0]!.key
}
