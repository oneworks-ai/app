import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import {
  buildStandaloneDeviceDebugRoutePath,
  parseStandaloneDeviceRoutePath,
  standaloneDeviceSettingsRoutePath,
  standaloneDevicesRoutePath
} from '@oneworks/types/standalone-route'
import type { StandaloneDeviceRouteMode } from '@oneworks/types/standalone-route'

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

const getMobileDebugPageMode = (deviceRouteMode: StandaloneDeviceRouteMode | undefined) => {
  if (deviceRouteMode === 'settings') return 'config'
  if (deviceRouteMode === 'devices') return 'devices'
  return 'targets'
}

export function StandaloneMobileDebugRoute() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const deviceRoute = useMemo(
    () => parseStandaloneDeviceRoutePath(`${location.pathname}${location.search}`),
    [location.pathname, location.search]
  )
  const title = t('chat.interactionPanel.mobileDebugTitle')
  const [page, setPage] = useState<InteractionPanelMobileDebugPage>(() => ({
    ...createInteractionPanelMobileDebugPage(title),
    mode: getMobileDebugPageMode(deviceRoute?.mode),
    selectedDeviceId: deviceRoute?.mode === 'debug' ? deviceRoute.deviceId : undefined
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
      mode: getMobileDebugPageMode(deviceRoute?.mode),
      selectedDeviceId: deviceRoute?.mode === 'debug' ? deviceRoute.deviceId : undefined
    }))
  }, [deviceRoute?.deviceId, deviceRoute?.mode])

  useEffect(() => {
    if (deviceRoute?.mode !== 'debug') return
    const deviceOptions = page.deviceOptions
    if (deviceOptions == null) return
    if (deviceOptions.some(device => device.id === deviceRoute.deviceId)) return

    const readyDevices = deviceOptions.filter(device => device.state === 'device')
    navigate(
      readyDevices.length === 1
        ? buildStandaloneDeviceDebugRoutePath(readyDevices[0].id)
        : standaloneDevicesRoutePath,
      { replace: true }
    )
  }, [deviceRoute, navigate, page.deviceOptions])

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

  const openDeviceDebug = useCallback((deviceId: string) => {
    navigate(buildStandaloneDeviceDebugRoutePath(deviceId))
  }, [navigate])

  const openDeviceList = useCallback(() => {
    navigate(standaloneDevicesRoutePath)
  }, [navigate])

  const openDeviceSettings = useCallback(() => {
    navigate(standaloneDeviceSettingsRoutePath)
  }, [navigate])

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
            onOpenDeviceDebug={openDeviceDebug}
            onOpenDeviceList={openDeviceList}
            onOpenDeviceSettings={openDeviceSettings}
            onStandaloneDeviceTitleChange={setDeviceTitle}
            onStandaloneHeaderActionsChange={setHeaderActions}
          />
        </section>
      </main>
    </StandaloneRouteThemeProvider>
  )
}
