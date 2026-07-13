import { Tabs } from 'antd'
import type { TabsProps } from 'antd'

import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

import { PluginOverview } from './PluginDetailSections'
import type { PluginOverviewLabels } from './PluginDetailSections'

export function PluginDetailView({
  activeTabKey,
  items,
  onTabChange,
  overviewLabels,
  overviewPlugin
}: {
  activeTabKey: string
  items: TabsProps['items']
  onTabChange: (key: string) => void
  overviewLabels: PluginOverviewLabels
  overviewPlugin: PluginRuntimeInstance
}) {
  return (
    <div className='plugin-detail-route__content'>
      <main className='plugin-detail-route__main'>
        <PluginOverview labels={overviewLabels} plugin={overviewPlugin} />
        <Tabs
          activeKey={activeTabKey}
          className='plugin-detail-route__tabs'
          items={items}
          onChange={onTabChange}
        />
      </main>
    </div>
  )
}
