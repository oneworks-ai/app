import { Button } from 'antd'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { MobileDebugDetailsContent } from './InteractionPanelMobileDebugDetailsContent'
import { InteractionPanelMobileDevicePreview } from './InteractionPanelMobileDevicePreview'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'
import { getDeviceWindowTitle } from './mobile-device-preview-utils'

const inferPendingDevicePlatform = (deviceId: string): DesktopMobileDebugDevice['platform'] => {
  const normalizedDeviceId = deviceId.toLowerCase()
  return normalizedDeviceId.includes('ios') || normalizedDeviceId.includes('wda') ? 'ios' : 'android'
}

const createPendingSelectedDevice = (
  selectedDeviceId: string | undefined,
  selectedDeviceLabel: string | undefined
): DesktopMobileDebugDevice | undefined => {
  if (selectedDeviceId == null) return undefined
  const platform = inferPendingDevicePlatform(selectedDeviceId)
  return {
    detail: selectedDeviceId,
    id: selectedDeviceId,
    label: selectedDeviceLabel ?? selectedDeviceId,
    platform,
    state: 'device',
    videoSource: platform === 'ios' ? 'mjpeg' : 'scrcpy'
  }
}

export function InteractionPanelMobileDebugResults({
  connectionState,
  error,
  isActive,
  isLoading,
  onStandaloneDeviceTitleChange,
  onStandaloneHeaderActionsChange,
  onOpenDebugUrl,
  onOpenDeviceList,
  onReconnect,
  selectedDeviceId,
  selectedDeviceLabel,
  state
}: {
  error: string | null
  isActive: boolean
  isLoading: boolean
  onStandaloneDeviceTitleChange?: (title: string | null) => void
  onStandaloneHeaderActionsChange?: (actions: ReactNode | null) => void
  onOpenDebugUrl: (url: string, options?: OpenInteractionPanelIframeUrlOptions) => void
  onOpenDeviceList?: () => void
  onReconnect?: () => void | Promise<void>
  selectedDeviceId?: string
  selectedDeviceLabel?: string
  connectionState?: DesktopMobileDebugTargetsResponse | null
  state: DesktopMobileDebugTargetsResponse | null
}) {
  const { t } = useTranslation()
  const devices = state?.devices ?? []
  const targets = state?.targets ?? []
  const errors = state?.errors.filter(Boolean) ?? []
  const connectionDevices = connectionState?.devices ?? devices
  const portForwarding = state?.portForwarding ?? []
  const isAdbMissing = state?.adbMissing === true || errors.includes('ADB was not found.')
  const hasReadyDevice = devices.some(device => device.state === 'device')
  const pendingSelectedDevice = hasReadyDevice
    ? undefined
    : createPendingSelectedDevice(selectedDeviceId, selectedDeviceLabel)
  const previewDevices = pendingSelectedDevice == null
    ? devices
    : [
      pendingSelectedDevice,
      ...devices.filter(device => device.id !== pendingSelectedDevice.id)
    ]
  const hasDevicePreview = previewDevices.some(device => device.state === 'device')
  const isInitialSelectedDeviceScan = selectedDeviceId != null && isLoading && state == null
  const isSelectedDeviceDisconnected = selectedDeviceId != null &&
    connectionState != null &&
    !connectionDevices.some(device => device.id === selectedDeviceId && device.state === 'device')
  const cachedSelectedDevice = selectedDeviceId == null
    ? undefined
    : devices.find(device => device.id === selectedDeviceId)
  const disconnectedDeviceName = cachedSelectedDevice == null
    ? selectedDeviceLabel ?? selectedDeviceId ?? t('chat.interactionPanel.mobileDebugDevices')
    : getDeviceWindowTitle(cachedSelectedDevice)

  useEffect(() => {
    if (hasDevicePreview) return
    onStandaloneHeaderActionsChange?.(null)
    onStandaloneDeviceTitleChange?.(null)
  }, [hasDevicePreview, onStandaloneDeviceTitleChange, onStandaloneHeaderActionsChange])

  return (
    <div className='chat-interaction-panel-mobile-debug__body'>
      {error != null && <div className='chat-interaction-panel-mobile-debug__notice is-error'>{error}</div>}
      {isLoading && state == null && selectedDeviceId == null && (
        <div className='chat-interaction-panel-mobile-debug__notice'>
          {t('chat.interactionPanel.mobileDebugScanning')}
        </div>
      )}
      {hasDevicePreview && (
        <InteractionPanelMobileDevicePreview
          isActive={isActive}
          details={
            <MobileDebugDetailsContent
              errors={errors}
              isAdbMissing={isAdbMissing}
              notice={isInitialSelectedDeviceScan ? t('chat.interactionPanel.mobileDebugScanning') : undefined}
              onOpenDebugUrl={onOpenDebugUrl}
              portForwarding={portForwarding}
              state={state}
              targets={targets}
            />
          }
          devices={previewDevices}
          onOpenDeviceList={onOpenDeviceList}
          onStandaloneDeviceTitleChange={onStandaloneDeviceTitleChange}
          onStandaloneHeaderActionsChange={onStandaloneHeaderActionsChange}
        />
      )}
      {!hasDevicePreview && (
        <MobileDebugDetailsContent
          errors={errors}
          isAdbMissing={isAdbMissing}
          notice={isInitialSelectedDeviceScan ? t('chat.interactionPanel.mobileDebugScanning') : undefined}
          onOpenDebugUrl={onOpenDebugUrl}
          portForwarding={portForwarding}
          state={state}
          targets={targets}
        />
      )}
      {isSelectedDeviceDisconnected && (
        <MobileDebugDeviceDisconnectedOverlay
          deviceName={disconnectedDeviceName}
          isReconnecting={isLoading}
          onOpenDeviceList={onOpenDeviceList}
          onReconnect={onReconnect}
        />
      )}
    </div>
  )
}

function MobileDebugDeviceDisconnectedOverlay({
  deviceName,
  isReconnecting,
  onOpenDeviceList,
  onReconnect
}: {
  deviceName: string
  isReconnecting: boolean
  onOpenDeviceList?: () => void
  onReconnect?: () => void | Promise<void>
}) {
  const { t } = useTranslation()

  return (
    <div className='chat-interaction-panel-mobile-debug__disconnect-overlay'>
      <section className='chat-interaction-panel-mobile-debug__disconnect-dialog' role='alertdialog' aria-modal='true'>
        <span className='material-symbols-rounded' aria-hidden='true'>phonelink_off</span>
        <div className='chat-interaction-panel-mobile-debug__disconnect-copy'>
          <h2>{t('chat.interactionPanel.mobileDebugDeviceDisconnectedTitle')}</h2>
          <p>{t('chat.interactionPanel.mobileDebugDeviceDisconnectedDescription', { device: deviceName })}</p>
        </div>
        <div className='chat-interaction-panel-mobile-debug__disconnect-actions'>
          <Button
            type='primary'
            icon={<span className='material-symbols-rounded' aria-hidden='true'>sync</span>}
            loading={isReconnecting}
            onClick={() => void onReconnect?.()}
          >
            {t('chat.interactionPanel.mobileDebugReconnectAction')}
          </Button>
          <Button
            icon={<span className='material-symbols-rounded' aria-hidden='true'>arrow_back</span>}
            onClick={() => onOpenDeviceList?.()}
          >
            {t('chat.interactionPanel.mobileDebugBackAction')}
          </Button>
        </div>
      </section>
    </div>
  )
}
