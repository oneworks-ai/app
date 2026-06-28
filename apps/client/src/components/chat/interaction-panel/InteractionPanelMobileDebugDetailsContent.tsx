import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDebugTargetList } from './InteractionPanelMobileDebugTargetList'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'

const getPortForwardingStatusLabelKey = (status: DesktopMobileDebugPortForwardStatus['status']) => {
  if (status === 'active') return 'chat.interactionPanel.mobileDebugPortForwardActive'
  if (status === 'removed') return 'chat.interactionPanel.mobileDebugPortForwardRemoved'
  if (status === 'skipped') return 'chat.interactionPanel.mobileDebugPortForwardSkipped'
  return 'chat.interactionPanel.mobileDebugPortForwardError'
}

export function MobileDebugDetailsContent({
  errors,
  isAdbMissing,
  notice,
  onOpenDebugUrl,
  portForwarding,
  state,
  targets
}: {
  errors: string[]
  isAdbMissing: boolean
  notice?: string
  onOpenDebugUrl: (url: string, options?: OpenInteractionPanelIframeUrlOptions) => void
  portForwarding: DesktopMobileDebugPortForwardStatus[]
  state: DesktopMobileDebugTargetsResponse | null
  targets: DesktopMobileDebugTarget[]
}) {
  const { t } = useTranslation()
  const devices = state?.devices ?? []

  return (
    <>
      {notice != null && (
        <div className='chat-interaction-panel-mobile-debug__notice'>
          {notice}
        </div>
      )}
      <PortForwardingList portForwarding={portForwarding} />
      {targets.length > 0 && (
        <InteractionPanelMobileDebugTargetList targets={targets} onOpenDebugUrl={onOpenDebugUrl} />
      )}
      {isAdbMissing && devices.length === 0 && <InteractionPanelMobileDebugAdbInstallGuide />}
      {state != null && devices.length === 0 && targets.length === 0 && (
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
