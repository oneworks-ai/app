import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

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

const STANDALONE_MOBILE_DEBUG_ROUTE_KEY = 'standalone.mobile-debug'

const getSearchParamText = (searchParams: URLSearchParams, key: string) => {
  const value = searchParams.get(key)?.trim()
  return value == null || value === '' ? undefined : value
}

export function StandaloneMobileDebugRoute() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const title = t('chat.interactionPanel.mobileDebugTitle')
  const initialDeviceId = useMemo(() => getSearchParamText(searchParams, 'deviceId'), [searchParams])
  const [page, setPage] = useState<InteractionPanelMobileDebugPage>(() => ({
    ...createInteractionPanelMobileDebugPage(title),
    selectedDeviceId: initialDeviceId
  }))
  const [headerActions, setHeaderActions] = useState<ReactNode | null>(null)

  useEffect(() => {
    setPage(current => ({ ...current, title }))
  }, [title])

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
          title={title}
        />
        <section className='standalone-mobile-debug-route__content'>
          <InteractionPanelMobileDebugView
            isActive
            page={page}
            onChangePage={changePage}
            onOpenDebugUrl={openDebugUrl}
            onStandaloneHeaderActionsChange={setHeaderActions}
          />
        </section>
      </main>
    </StandaloneRouteThemeProvider>
  )
}
