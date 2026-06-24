import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDebugDeviceList } from './InteractionPanelMobileDebugDeviceList'
import { InteractionPanelMobileDebugResults } from './InteractionPanelMobileDebugResults'
import { InteractionPanelMobileDebugSettings } from './InteractionPanelMobileDebugSettings'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'
import type { InteractionPanelMobileDebugPage } from './interaction-panel-mobile-debug-pages'
import { useMobileDebugTargetsState } from './use-mobile-debug-targets-state'

export function InteractionPanelMobileDebugView({
  isActive,
  page,
  onChangePage,
  onOpenDebugUrl,
  onOpenDeviceDebug,
  onOpenDeviceList,
  onOpenDeviceSettings,
  onStandaloneDeviceTitleChange,
  onStandaloneHeaderActionsChange
}: {
  isActive: boolean
  page: InteractionPanelMobileDebugPage
  onChangePage: (updater: (page: InteractionPanelMobileDebugPage) => InteractionPanelMobileDebugPage) => void
  onOpenDebugUrl: (url: string, options?: OpenInteractionPanelIframeUrlOptions) => void
  onOpenDeviceDebug?: (deviceId: string) => void
  onOpenDeviceList?: () => void
  onOpenDeviceSettings?: () => void
  onStandaloneDeviceTitleChange?: (title: string | null) => void
  onStandaloneHeaderActionsChange?: (actions: ReactNode | null) => void
}) {
  const { t } = useTranslation()
  const isConfigMode = page.mode === 'config'
  const isDevicesMode = page.mode === 'devices'
  const { config, error, isAdbMissing, isLoading, refreshTargets, state, updateConfig } = useMobileDebugTargetsState({
    isActive,
    isConfigMode,
    selectedDeviceId: page.selectedDeviceId
  })
  const [lastReadyDebugState, setLastReadyDebugState] = useState<DesktopMobileDebugTargetsResponse | null>(null)
  const openDeviceList = useCallback(() => {
    if (onOpenDeviceList != null) {
      onOpenDeviceList()
      return
    }
    onChangePage(current => ({ ...current, mode: 'devices' }))
  }, [onChangePage, onOpenDeviceList])

  useEffect(() => {
    if (!isConfigMode && !isDevicesMode) return
    onStandaloneHeaderActionsChange?.(null)
    onStandaloneDeviceTitleChange?.(null)
  }, [isConfigMode, isDevicesMode, onStandaloneDeviceTitleChange, onStandaloneHeaderActionsChange])

  const visibleState = useMemo(() => {
    if (state == null || page.selectedDeviceId == null) return state
    return {
      ...state,
      devices: state.devices.filter(device => device.id === page.selectedDeviceId),
      portForwarding: state.portForwarding.filter(status => status.deviceId === page.selectedDeviceId),
      targets: state.targets.filter(target => target.deviceId === page.selectedDeviceId || target.source === 'network')
    }
  }, [page.selectedDeviceId, state])
  const hasReadyVisibleDevice = visibleState?.devices.some(device => device.state === 'device') === true

  useEffect(() => {
    if (isConfigMode || isDevicesMode || visibleState == null || !hasReadyVisibleDevice) return
    setLastReadyDebugState(visibleState)
  }, [hasReadyVisibleDevice, isConfigMode, isDevicesMode, visibleState])

  const displayState = useMemo(() => {
    if (page.selectedDeviceId == null || visibleState == null || hasReadyVisibleDevice) return visibleState
    const cachedStateMatchesDevice = lastReadyDebugState?.devices.some(device =>
      device.id === page.selectedDeviceId
    ) === true
    return cachedStateMatchesDevice ? lastReadyDebugState : visibleState
  }, [hasReadyVisibleDevice, lastReadyDebugState, page.selectedDeviceId, visibleState])

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
        : isDevicesMode
        ? (
          <InteractionPanelMobileDebugDeviceList
            error={error}
            isAdbMissing={isAdbMissing}
            isLoading={isLoading}
            state={state}
            onOpenDeviceDebug={onOpenDeviceDebug ?? (() => undefined)}
            onOpenSettings={onOpenDeviceSettings ?? (() => undefined)}
          />
        )
        : (
          <InteractionPanelMobileDebugResults
            error={error}
            isActive={isActive}
            isLoading={isLoading}
            connectionState={visibleState}
            state={displayState}
            selectedDeviceId={page.selectedDeviceId}
            selectedDeviceLabel={page.selectedDeviceLabel}
            onOpenDebugUrl={onOpenDebugUrl}
            onOpenDeviceList={openDeviceList}
            onReconnect={refreshTargets}
            onStandaloneDeviceTitleChange={onStandaloneDeviceTitleChange}
            onStandaloneHeaderActionsChange={onStandaloneHeaderActionsChange}
          />
        )}
    </div>
  )
}
