import { Button } from 'antd'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDebugTargetList } from './InteractionPanelMobileDebugTargetList'
import { InteractionPanelMobileDevicePreview } from './InteractionPanelMobileDevicePreview'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'
import { getDeviceWindowTitle } from './mobile-device-preview-utils'

const getPortForwardingStatusLabelKey = (status: DesktopMobileDebugPortForwardStatus['status']) => {
  if (status === 'active') return 'chat.interactionPanel.mobileDebugPortForwardActive'
  if (status === 'removed') return 'chat.interactionPanel.mobileDebugPortForwardRemoved'
  if (status === 'skipped') return 'chat.interactionPanel.mobileDebugPortForwardSkipped'
  return 'chat.interactionPanel.mobileDebugPortForwardError'
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
  const connectionErrors = connectionState?.errors.filter(Boolean) ?? errors
  const connectionDevices = connectionState?.devices ?? devices
  const portForwarding = state?.portForwarding ?? []
  const isAdbMissing = state?.adbMissing === true || errors.includes('ADB was not found.')
  const isConnectionAdbMissing = connectionState?.adbMissing === true || connectionErrors.includes('ADB was not found.')
  const hasDevicePreview = !isAdbMissing && devices.some(device => device.state === 'device')
  const isSelectedDeviceDisconnected = selectedDeviceId != null &&
    connectionState != null &&
    !isConnectionAdbMissing &&
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
      {isLoading && state == null && (
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
              onOpenDebugUrl={onOpenDebugUrl}
              portForwarding={portForwarding}
              state={state}
              targets={targets}
            />
          }
          devices={devices}
          onOpenDeviceList={onOpenDeviceList}
          onStandaloneDeviceTitleChange={onStandaloneDeviceTitleChange}
          onStandaloneHeaderActionsChange={onStandaloneHeaderActionsChange}
        />
      )}
      {!hasDevicePreview && (
        <MobileDebugDetailsContent
          errors={errors}
          isAdbMissing={isAdbMissing}
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

function MobileDebugDetailsContent({
  errors,
  isAdbMissing,
  onOpenDebugUrl,
  portForwarding,
  state,
  targets
}: {
  errors: string[]
  isAdbMissing: boolean
  onOpenDebugUrl: (url: string, options?: OpenInteractionPanelIframeUrlOptions) => void
  portForwarding: DesktopMobileDebugPortForwardStatus[]
  state: DesktopMobileDebugTargetsResponse | null
  targets: DesktopMobileDebugTarget[]
}) {
  const { t } = useTranslation()
  const devices = state?.devices ?? []

  return (
    <>
      <PortForwardingList portForwarding={portForwarding} />
      {targets.length > 0 && (
        <InteractionPanelMobileDebugTargetList targets={targets} onOpenDebugUrl={onOpenDebugUrl} />
      )}
      {isAdbMissing && <InteractionPanelMobileDebugAdbInstallGuide />}
      {state != null && !isAdbMissing && devices.length === 0 && targets.length === 0 && (
        <div className='chat-interaction-panel-mobile-debug__empty'>
          {t('chat.interactionPanel.mobileDebugNoDevices')}
        </div>
      )}
      {state != null && devices.length > 0 && targets.length === 0 && (
        <div className='chat-interaction-panel-mobile-debug__empty'>
          {t('chat.interactionPanel.mobileDebugNoTargets')}
        </div>
      )}
      <ErrorList errors={errors} />
    </>
  )
}

export function InteractionPanelMobileDebugAdbInstallGuide() {
  const { t } = useTranslation()

  return (
    <section className='chat-interaction-panel-mobile-debug__adb-guide'>
      <span className='material-symbols-rounded' aria-hidden='true'>download_for_offline</span>
      <div className='chat-interaction-panel-mobile-debug__adb-guide-copy'>
        <span className='chat-interaction-panel-mobile-debug__adb-guide-title'>
          {t('chat.interactionPanel.mobileDebugAdbMissingTitle')}
        </span>
        <span>{t('chat.interactionPanel.mobileDebugAdbMissingDescription')}</span>
        <code>{t('chat.interactionPanel.mobileDebugAdbInstallCommand')}</code>
        <span>{t('chat.interactionPanel.mobileDebugAdbInstallHint')}</span>
      </div>
    </section>
  )
}

function PortForwardingList({ portForwarding }: { portForwarding: DesktopMobileDebugPortForwardStatus[] }) {
  const { t } = useTranslation()
  if (portForwarding.length === 0) return null

  return (
    <section className='chat-interaction-panel-mobile-debug__section'>
      <div className='chat-interaction-panel-mobile-debug__section-title'>
        {t('chat.interactionPanel.mobileDebugPortForwardingStatus')}
      </div>
      <div className='chat-interaction-panel-mobile-debug__forward-list'>
        {portForwarding.map(status => (
          <div
            key={`${status.ruleId}:${status.deviceId}:${status.status}`}
            className={`chat-interaction-panel-mobile-debug__forward is-${status.status}`}
          >
            <span className='material-symbols-rounded' aria-hidden='true'>sync_alt</span>
            <span className='chat-interaction-panel-mobile-debug__forward-copy'>
              <span>{status.deviceLabel} · localhost:{status.devicePort} → {status.localAddress}</span>
              {status.message != null && <span>{status.message}</span>}
            </span>
            <span className='chat-interaction-panel-mobile-debug__forward-status'>
              {t(getPortForwardingStatusLabelKey(status.status))}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function ErrorList({ errors }: { errors: string[] }) {
  const { t } = useTranslation()
  if (errors.length === 0) return null

  return (
    <section className='chat-interaction-panel-mobile-debug__section'>
      <div className='chat-interaction-panel-mobile-debug__section-title'>
        {t('chat.interactionPanel.mobileDebugDiagnostics')}
      </div>
      <div className='chat-interaction-panel-mobile-debug__error-list'>
        {errors.map(errorMessage => (
          <div key={errorMessage} className='chat-interaction-panel-mobile-debug__error'>
            {errorMessage}
          </div>
        ))}
      </div>
    </section>
  )
}
