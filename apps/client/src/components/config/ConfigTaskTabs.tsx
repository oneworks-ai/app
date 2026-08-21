import './ConfigTaskTabs.scss'

import type { ComponentProps, ReactNode } from 'react'
import { useLayoutEffect, useRef } from 'react'

import { NativeTabs } from '#~/components/native-tabs'

import { ConfigSectionPanel } from './ConfigSectionPanel'
import type { ConfigTaskTabKey, TaskTabbedConfigSectionKey } from './config-task-tabs'
import { getConfigTaskTabDefinitions, getConfigTaskTabFields, resolveConfigTaskTabKey } from './config-task-tabs'

type ConfigSectionPanelProps = ComponentProps<typeof ConfigSectionPanel>

export interface ConfigTaskTabsProps extends
  Omit<
    ConfigSectionPanelProps,
    'detailQuery' | 'fields' | 'onDetailQueryChange' | 'sectionKey'
  >
{
  detailQuery?: string
  leadingContentByTab?: Partial<Record<ConfigTaskTabKey, ReactNode>>
  onDetailQueryChange?: (nextQuery: string) => void
  onTaskTabChange: (nextTabKey: ConfigTaskTabKey) => void
  requestedTabKey?: string
  sectionKey: TaskTabbedConfigSectionKey
}

export function ConfigTaskTabs({
  detailQuery = '',
  leadingContentByTab,
  onDetailQueryChange,
  onTaskTabChange,
  requestedTabKey,
  sectionKey,
  t,
  ...panelProps
}: ConfigTaskTabsProps) {
  const tabsRootRef = useRef<HTMLDivElement | null>(null)
  const definitions = getConfigTaskTabDefinitions(sectionKey)
  const activeTabKey = resolveConfigTaskTabKey({
    detailQuery,
    requestedTabKey,
    sectionKey
  })
  const activeDefinition = definitions.find(tab => tab.key === activeTabKey) ?? definitions[0]!
  const fields = getConfigTaskTabFields(sectionKey, activeDefinition.key)

  useLayoutEffect(() => {
    const activeTab = tabsRootRef.current?.querySelector<HTMLElement>(
      '.native-tabs__tab[aria-selected="true"]'
    )
    const items = activeTab?.closest<HTMLElement>('.native-tabs__items')
    if (activeTab == null || items == null) return

    const left = activeTab.offsetLeft
    const right = left + activeTab.offsetWidth
    if (left < items.scrollLeft) {
      items.scrollLeft = left
    } else if (right > items.scrollLeft + items.clientWidth) {
      items.scrollLeft = right - items.clientWidth
    }
  }, [activeDefinition.key])

  return (
    <div ref={tabsRootRef} className='config-task-tabs' data-config-task-tabs={sectionKey}>
      <NativeTabs
        activeKey={activeDefinition.key}
        ariaLabel={t('config.taskTabs.ariaLabel')}
        className='config-task-tabs__tabs'
        items={definitions.map(tab => ({
          icon: tab.icon,
          key: tab.key,
          label: t(tab.labelKey)
        }))}
        onChange={onTaskTabChange}
      />
      <div
        aria-label={t(activeDefinition.labelKey)}
        className='native-tabs-panel config-task-tabs__panel'
        role='tabpanel'
      >
        {leadingContentByTab?.[activeDefinition.key] == null
          ? null
          : (
            <div className='config-task-tabs__leading'>
              {leadingContentByTab[activeDefinition.key]}
            </div>
          )}
        <ConfigSectionPanel
          {...panelProps}
          key={activeDefinition.key}
          detailQuery={detailQuery}
          fields={fields}
          onDetailQueryChange={onDetailQueryChange}
          sectionKey={sectionKey}
          t={t}
        />
      </div>
    </div>
  )
}
