import { Checkbox } from 'antd'
import { useTranslation } from 'react-i18next'

import { NetworkTargetConfigPanel, PortForwardingConfigPanel } from './InteractionPanelMobileDebugConfigPanels'
import { InteractionPanelMobileDebugAdbInstallGuide } from './InteractionPanelMobileDebugResults'
import type { MobileDebugConfigState } from './mobile-debug-config-state'

export function InteractionPanelMobileDebugSettings({
  config,
  isAdbMissing,
  onChangeConfig
}: {
  config: MobileDebugConfigState
  isAdbMissing: boolean
  onChangeConfig: (updater: (current: MobileDebugConfigState) => MobileDebugConfigState) => void
}) {
  const { t } = useTranslation()

  return (
    <section className='chat-interaction-panel-mobile-debug__settings'>
      {isAdbMissing && <InteractionPanelMobileDebugAdbInstallGuide />}
      <div className='chat-interaction-panel-mobile-debug__settings-row'>
        <Checkbox
          checked={config.discoverUsbDevices}
          onChange={event => onChangeConfig(current => ({ ...current, discoverUsbDevices: event.target.checked }))}
        >
          {t('chat.interactionPanel.mobileDebugDiscoverUsbDevices')}
        </Checkbox>
      </div>
      <div className='chat-interaction-panel-mobile-debug__settings-row'>
        <Checkbox
          checked={config.discoverNetworkTargets}
          onChange={event => onChangeConfig(current => ({ ...current, discoverNetworkTargets: event.target.checked }))}
        >
          {t('chat.interactionPanel.mobileDebugDiscoverNetworkTargets')}
        </Checkbox>
      </div>

      <PortForwardingConfigPanel config={config} onChangeConfig={onChangeConfig} />
      <NetworkTargetConfigPanel config={config} onChangeConfig={onChangeConfig} />
    </section>
  )
}
