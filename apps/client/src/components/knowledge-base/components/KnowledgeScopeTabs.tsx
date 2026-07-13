import './KnowledgeScopeTabs.scss'

import { Tabs } from 'antd'

import { RouteContainerHeaderActionButton } from '@oneworks/components/route-layout'
import type { RouteContainerHeaderActionItem } from '@oneworks/components/route-layout'

interface KnowledgeScopeTabItem<T extends string> {
  icon: string
  key: T
  label: string
}

interface KnowledgeScopeTabsProps<T extends string> {
  actionItems?: RouteContainerHeaderActionItem[]
  activeKey: T
  items: Array<KnowledgeScopeTabItem<T>>
  onChange: (value: T) => void
}

export function KnowledgeScopeTabs<T extends string>({
  actionItems = [],
  activeKey,
  items,
  onChange
}: KnowledgeScopeTabsProps<T>) {
  return (
    <Tabs
      className='knowledge-base-view__scope-tabs'
      activeKey={activeKey}
      items={items.map(item => ({
        key: item.key,
        label: (
          <span className='knowledge-base-view__scope-tab-label'>
            <span className='material-symbols-rounded' aria-hidden='true'>{item.icon}</span>
            <span>{item.label}</span>
          </span>
        )
      }))}
      tabBarExtraContent={actionItems.length === 0
        ? undefined
        : {
          right: actionItems.map(item => (
            <RouteContainerHeaderActionButton key={item.key} item={item} />
          ))
        }}
      onChange={(value) => onChange(value as T)}
    />
  )
}
