import { useTranslation } from 'react-i18next'

const getDeviceStateLabelKey = (state: string) => {
  if (state === 'device') return 'chat.interactionPanel.mobileDebugDeviceReady'
  if (state === 'unauthorized') return 'chat.interactionPanel.mobileDebugDeviceUnauthorized'
  if (state === 'offline') return 'chat.interactionPanel.mobileDebugDeviceOffline'
  return 'chat.interactionPanel.mobileDebugDeviceUnknown'
}

const getDeviceStateIcon = (state: string) => {
  if (state === 'device') return 'check_circle'
  if (state === 'unauthorized') return 'lock'
  if (state === 'offline') return 'cloud_off'
  return 'help'
}

export function InteractionPanelMobileDebugDeviceList({
  error,
  isAdbMissing,
  isLoading,
  state,
  onOpenDeviceDebug,
  onOpenSettings
}: {
  error: string | null
  isAdbMissing: boolean
  isLoading: boolean
  state: DesktopMobileDebugTargetsResponse | null
  onOpenDeviceDebug: (deviceId: string) => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  const devices = state?.devices ?? []

  return (
    <section className='chat-interaction-panel-mobile-debug__device-list-page'>
      <header className='chat-interaction-panel-mobile-debug__device-list-header'>
        <div className='chat-interaction-panel-mobile-debug__device-list-title'>
          <span className='material-symbols-rounded' aria-hidden='true'>devices</span>
          <span>{t('chat.interactionPanel.mobileDebugDevices')}</span>
        </div>
        <button
          type='button'
          className='chat-interaction-panel-mobile-debug__device-list-action'
          title={t('chat.interactionPanel.mobileDebugConfig')}
          aria-label={t('chat.interactionPanel.mobileDebugConfig')}
          onClick={onOpenSettings}
        >
          <span className='material-symbols-rounded' aria-hidden='true'>tune</span>
        </button>
      </header>
      {error != null && <div className='chat-interaction-panel-mobile-debug__notice is-error'>{error}</div>}
      {isLoading && state == null && (
        <div className='chat-interaction-panel-mobile-debug__notice'>
          {t('chat.interactionPanel.mobileDebugScanning')}
        </div>
      )}
      {isAdbMissing && devices.length === 0 && <MobileDebugDeviceListAdbGuide />}
      {state != null && !isAdbMissing && devices.length === 0 && (
        <div className='chat-interaction-panel-mobile-debug__empty'>
          {t('chat.interactionPanel.mobileDebugNoDevices')}
        </div>
      )}
      {devices.length > 0 && (
        <div className='chat-interaction-panel-mobile-debug__device-list'>
          {devices.map(device => {
            const isReady = device.state === 'device'
            return (
              <button
                key={device.id}
                type='button'
                className={`chat-interaction-panel-mobile-debug__device-row ${isReady ? 'is-ready' : 'is-disabled'}`}
                disabled={!isReady}
                onClick={() => onOpenDeviceDebug(device.id)}
              >
                <span className='material-symbols-rounded chat-interaction-panel-mobile-debug__device-row-icon'>
                  {getDeviceStateIcon(device.state)}
                </span>
                <span className='chat-interaction-panel-mobile-debug__device-row-copy'>
                  <span className='chat-interaction-panel-mobile-debug__device-row-title'>{device.label}</span>
                  <span>{device.id}</span>
                </span>
                <span className='chat-interaction-panel-mobile-debug__device-row-status'>
                  {t(getDeviceStateLabelKey(device.state))}
                </span>
                {isReady && (
                  <span className='material-symbols-rounded chat-interaction-panel-mobile-debug__device-row-open'>
                    chevron_right
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
      <MobileDebugDeviceListErrors errors={state?.errors.filter(Boolean) ?? []} />
    </section>
  )
}

function MobileDebugDeviceListAdbGuide() {
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

function MobileDebugDeviceListErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null

  return (
    <section className='chat-interaction-panel-mobile-debug__error-list'>
      {errors.map(error => (
        <div key={error} className='chat-interaction-panel-mobile-debug__error'>
          {error}
        </div>
      ))}
    </section>
  )
}
