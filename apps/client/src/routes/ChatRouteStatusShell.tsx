import './ChatRoute.scss'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import {
  useInstallRoutePluginMoreMenu,
  useInstallRoutePluginWindowBarActions,
  useRoutePluginHeaderActions
} from '#~/plugins/route-plugin-chrome'

export function ChatRouteStatusShell({
  children,
  isReady = true,
  title
}: {
  children: ReactNode
  isReady?: boolean
  title?: ReactNode
}) {
  const { t } = useTranslation()
  const { openRouteSidebar } = useRouteContainerSidebarOpener()
  const routePluginHeaderActions = useRoutePluginHeaderActions('chat')

  useInstallRoutePluginMoreMenu('chat')
  useInstallRoutePluginWindowBarActions('chat')

  return (
    <RouteContainerLayout
      className='chat-route-layout chat-route-layout--status'
      bodyClassName='chat-route-layout__body'
      header={
        <RouteContainerHeader
          actionItems={routePluginHeaderActions}
          icon='chat_bubble'
          onOpenSidebar={openRouteSidebar}
          title={title ?? t('chat.newSessionTitle')}
        />
      }
    >
      <div className={`chat-container ${isReady ? 'ready' : ''}`}>
        {children}
      </div>
    </RouteContainerLayout>
  )
}
