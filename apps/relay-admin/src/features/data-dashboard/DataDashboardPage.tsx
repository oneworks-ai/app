import './DataDashboardPage.css'

import { Tabs } from 'antd'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { AdminTabLabel } from '../../shared/ui/AdminTabs'
import { DiagnosticsPage } from '../diagnostics/DiagnosticsPage'
import { PlatformModelUsage } from '../model-usage/PlatformModelUsage'
import { DataDashboardOverview } from './DataDashboardOverview'

const dashboardTabs = ['overview', 'stability', 'model-service'] as const
type DataDashboardTab = typeof dashboardTabs[number]

const isDataDashboardTab = (value: string | undefined): value is DataDashboardTab => (
  value != null && dashboardTabs.includes(value as DataDashboardTab)
)

const dashboardPath = (tab: DataDashboardTab) => `/data-dashboard/${tab}`

export const DataDashboardPage = ({ token }: { token: string }) => {
  const { dashboardTab } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab: DataDashboardTab = isDataDashboardTab(dashboardTab) ? dashboardTab : 'overview'
  const searchByTab = useRef<Partial<Record<DataDashboardTab, string>>>({})

  useEffect(() => {
    searchByTab.current[activeTab] = location.search
  }, [activeTab, location.search])

  useEffect(() => {
    if (dashboardTab == null || isDataDashboardTab(dashboardTab)) return
    void navigate(dashboardPath('overview'), { replace: true })
  }, [dashboardTab, navigate])

  const openTab = (tab: DataDashboardTab) => {
    const search = searchByTab.current[tab] ?? ''
    void navigate({ pathname: dashboardPath(tab), search })
  }

  return (
    <section className='relay-data-dashboard'>
      <Tabs
        activeKey={activeTab}
        className='relay-admin-tabs relay-data-dashboard__tabs'
        items={[
          {
            children: <DataDashboardOverview token={token} onOpenDimension={openTab} />,
            key: 'overview',
            label: <AdminTabLabel iconName='home'>运营概览</AdminTabLabel>
          },
          {
            children: <DiagnosticsPage embedded token={token} />,
            key: 'stability',
            label: <AdminTabLabel iconName='monitor_heart'>稳定性</AdminTabLabel>
          },
          {
            children: <PlatformModelUsage embedded token={token} />,
            key: 'model-service',
            label: <AdminTabLabel iconName='hub'>Model Service</AdminTabLabel>
          }
        ]}
        onChange={key => openTab(key as DataDashboardTab)}
      />
    </section>
  )
}
