import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDebugResults } from './InteractionPanelMobileDebugResults'
import { InteractionPanelMobileDebugSettings } from './InteractionPanelMobileDebugSettings'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'
import type { InteractionPanelMobileDebugPage } from './interaction-panel-mobile-debug-pages'
import { readMobileDebugConfig, writeMobileDebugConfig } from './mobile-debug-config-state'
import type { MobileDebugConfigState } from './mobile-debug-config-state'

export function InteractionPanelMobileDebugView({
  isActive,
  page,
  onChangePage,
  onOpenDebugUrl,
  onStandaloneDeviceTitleChange,
  onStandaloneHeaderActionsChange
}: {
  isActive: boolean
  page: InteractionPanelMobileDebugPage
  onChangePage: (updater: (page: InteractionPanelMobileDebugPage) => InteractionPanelMobileDebugPage) => void
  onOpenDebugUrl: (url: string, options?: OpenInteractionPanelIframeUrlOptions) => void
  onStandaloneDeviceTitleChange?: (title: string | null) => void
  onStandaloneHeaderActionsChange?: (actions: ReactNode | null) => void
}) {
  const { t } = useTranslation()
  const [config, setConfig] = useState(readMobileDebugConfig)
  const [state, setState] = useState<DesktopMobileDebugTargetsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const isRefreshingRef = useRef(false)
  const isConfigMode = page.mode === 'config'
  const isAdbMissing = state?.adbMissing === true || state?.errors.includes('ADB was not found.') === true

  const updateConfig = useCallback((updater: (current: MobileDebugConfigState) => MobileDebugConfigState) => {
    setConfig(current => {
      const nextConfig = updater(current)
      writeMobileDebugConfig(nextConfig)
      return nextConfig
    })
  }, [])

  const refreshTargets = useCallback(async () => {
    if (isRefreshingRef.current) return

    const listMobileDebugTargets = window.oneworksDesktop?.listMobileDebugTargets
    if (listMobileDebugTargets == null) {
      setState(null)
      setError(t('chat.interactionPanel.mobileDebugDesktopOnly'))
      return
    }

    isRefreshingRef.current = true
    setIsLoading(true)
    setError(null)
    try {
      setState(await listMobileDebugTargets({ ...config, selectedDeviceId: page.selectedDeviceId }))
    } catch {
      setError(t('common.operationFailed'))
    } finally {
      isRefreshingRef.current = false
      setIsLoading(false)
    }
  }, [config, page.selectedDeviceId, t])

  const refreshAdbStatus = useCallback(async () => {
    if (isRefreshingRef.current) return

    const listMobileDebugTargets = window.oneworksDesktop?.listMobileDebugTargets
    if (listMobileDebugTargets == null) return

    isRefreshingRef.current = true
    try {
      setState(
        await listMobileDebugTargets({
          discoverNetworkTargets: false,
          discoverUsbDevices: true,
          networkTargets: [],
          portForwardingRules: []
        })
      )
    } catch {
      // Keep the existing settings page visible when lightweight status probing fails.
    } finally {
      isRefreshingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!isActive || isConfigMode) return
    void refreshTargets()
    const refreshTimer = window.setInterval(() => void refreshTargets(), 3000)
    return () => window.clearInterval(refreshTimer)
  }, [isActive, isConfigMode, refreshTargets])

  useEffect(() => {
    if (!isActive || !isConfigMode) return
    void refreshAdbStatus()
    const refreshTimer = window.setInterval(() => void refreshAdbStatus(), 3000)
    return () => window.clearInterval(refreshTimer)
  }, [isActive, isConfigMode, refreshAdbStatus])

  useEffect(() => {
    if (!isConfigMode) return
    onStandaloneHeaderActionsChange?.(null)
    onStandaloneDeviceTitleChange?.(null)
  }, [isConfigMode, onStandaloneDeviceTitleChange, onStandaloneHeaderActionsChange])

  const visibleState = useMemo(() => {
    if (state == null || page.selectedDeviceId == null) return state
    return {
      ...state,
      devices: state.devices.filter(device => device.id === page.selectedDeviceId),
      portForwarding: state.portForwarding.filter(status => status.deviceId === page.selectedDeviceId),
      targets: state.targets.filter(target => target.deviceId === page.selectedDeviceId || target.source === 'network')
    }
  }, [page.selectedDeviceId, state])

  useEffect(() => {
    if (state == null || isConfigMode) return
    const selectedDevice = page.selectedDeviceId == null
      ? undefined
      : state.devices.find(device => device.id === page.selectedDeviceId)
    const nextSelectedDeviceLabel = page.selectedDeviceId == null
      ? undefined
      : selectedDevice?.label ?? page.selectedDeviceLabel
    const nextDeviceOptions = state.devices.map(device => ({
      id: device.id,
      label: device.label,
      state: device.state
    }))
    const nextTitle = t('chat.interactionPanel.mobileDebugTitle')

    onChangePage(current => {
      const currentDeviceOptions = current.deviceOptions ?? []
      const hasSameDeviceOptions = currentDeviceOptions.length === nextDeviceOptions.length &&
        currentDeviceOptions.every((device, index) => {
          const nextDevice = nextDeviceOptions[index]
          return nextDevice != null &&
            device.id === nextDevice.id &&
            device.label === nextDevice.label &&
            device.state === nextDevice.state
        })
      if (
        current.title === nextTitle &&
        current.selectedDeviceLabel === nextSelectedDeviceLabel &&
        hasSameDeviceOptions
      ) {
        return current
      }
      return {
        ...current,
        deviceOptions: nextDeviceOptions,
        selectedDeviceLabel: nextSelectedDeviceLabel,
        title: nextTitle
      }
    })
  }, [isConfigMode, onChangePage, page.selectedDeviceId, page.selectedDeviceLabel, state, t])

  return (
    <div className='chat-interaction-panel-mobile-debug'>
      {isConfigMode
        ? (
          <InteractionPanelMobileDebugSettings
            config={config}
            isAdbMissing={isAdbMissing}
            onChangeConfig={updateConfig}
          />
        )
        : (
          <InteractionPanelMobileDebugResults
            error={error}
            isLoading={isLoading}
            state={visibleState}
            onOpenDebugUrl={onOpenDebugUrl}
            onStandaloneDeviceTitleChange={onStandaloneDeviceTitleChange}
            onStandaloneHeaderActionsChange={onStandaloneHeaderActionsChange}
          />
        )}
    </div>
  )
}
