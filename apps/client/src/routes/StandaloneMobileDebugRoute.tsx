import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'

import { parseStandaloneDeviceRoutePath } from '@oneworks/types'

import '#~/components/chat/interaction-panel/ChatInteractionPanel.scss'
import { InteractionPanelMobileDebugView } from '#~/components/chat/interaction-panel/InteractionPanelMobileDebugView'
import type { OpenInteractionPanelIframeUrlOptions } from '#~/components/chat/interaction-panel/interaction-panel-iframe-pages'
import {
  createInteractionPanelMobileDebugPage
} from '#~/components/chat/interaction-panel/interaction-panel-mobile-debug-pages'
import type {
  InteractionPanelMobileDebugPage
} from '#~/components/chat/interaction-panel/interaction-panel-mobile-debug-pages'

import { StandaloneRouteThemeProvider } from './StandaloneRouteThemeProvider'
import { StandaloneWindowHeader } from './StandaloneWindowHeader'
import './StandaloneMobileDebugRoute.scss'

const STANDALONE_MOBILE_DEBUG_ROUTE_KEY = 'standalone.devices'

export function StandaloneMobileDebugRoute() {
  const { t } = useTranslation()
  const location = useLocation()
  const deviceRoute = useMemo(
    () => parseStandaloneDeviceRoutePath(`${location.pathname}${location.search}`),
    [location.pathname, location.search]
  )
  const title = t('chat.interactionPanel.mobileDebugTitle')
  const [page, setPage] = useState<InteractionPanelMobileDebugPage>(() => ({
    ...createInteractionPanelMobileDebugPage(title),
    mode: deviceRoute?.mode === 'settings' ? 'config' : 'targets',
    selectedDeviceId: deviceRoute?.deviceId
  }))
  const [headerActions, setHeaderActions] = useState<ReactNode | null>(null)
  const [deviceTitle, setDeviceTitle] = useState<string | null>(null)
  const headerTitle = deviceTitle ?? title

  useEffect(() => {
    setPage(current => ({ ...current, title }))
  }, [title])

  useEffect(() => {
    setPage(current => ({
      ...current,
      mode: deviceRoute?.mode === 'settings' ? 'config' : 'targets',
      selectedDeviceId: deviceRoute?.deviceId
    }))
  }, [deviceRoute?.deviceId, deviceRoute?.mode])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.oneworksDesktop?.markWorkspaceStartupReady?.()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const changePage = useCallback(
    (updater: (page: InteractionPanelMobileDebugPage) => InteractionPanelMobileDebugPage) => {
      setPage(updater)
    },
    []
  )

  const openDebugUrl = useCallback((url: string, _options?: OpenInteractionPanelIframeUrlOptions) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <StandaloneRouteThemeProvider>
      <main className='standalone-mobile-debug-route'>
        <StandaloneWindowHeader
          actions={headerActions}
          routeKey={STANDALONE_MOBILE_DEBUG_ROUTE_KEY}
          title={headerTitle}
        />
        <section className='standalone-mobile-debug-route__content'>
          <InteractionPanelMobileDebugView
            isActive
            page={page}
            onChangePage={changePage}
            onOpenDebugUrl={openDebugUrl}
            onStandaloneDeviceTitleChange={setDeviceTitle}
            onStandaloneHeaderActionsChange={setHeaderActions}
          />
        </section>
      </main>
    </StandaloneRouteThemeProvider>
  )
}
