import { Button, Checkbox, Input } from 'antd'
import { useTranslation } from 'react-i18next'

import { createMobileDebugConfigId } from './mobile-debug-config-state'
import type { MobileDebugConfigState } from './mobile-debug-config-state'

export function PortForwardingConfigPanel({
  config,
  onChangeConfig
}: {
  config: MobileDebugConfigState
  onChangeConfig: (updater: (current: MobileDebugConfigState) => MobileDebugConfigState) => void
}) {
  const { t } = useTranslation()

  return (
    <div className='chat-interaction-panel-mobile-debug__config-panel'>
      <div className='chat-interaction-panel-mobile-debug__config-title'>
        {t('chat.interactionPanel.mobileDebugPortForwarding')}
      </div>
      {config.portForwardingRules.length === 0 && (
        <div className='chat-interaction-panel-mobile-debug__config-empty'>
          {t('chat.interactionPanel.mobileDebugNoPortForwardingRules')}
        </div>
      )}
      {config.portForwardingRules.map(rule => (
        <div key={rule.id} className='chat-interaction-panel-mobile-debug__config-row is-port-forward'>
          <Checkbox
            checked={rule.enabled !== false}
            onChange={event =>
              onChangeConfig(current => ({
                ...current,
                portForwardingRules: current.portForwardingRules.map(item =>
                  item.id === rule.id ? { ...item, enabled: event.target.checked } : item
                )
              }))}
          />
          <Input
            inputMode='numeric'
            value={rule.devicePort === 0 ? '' : String(rule.devicePort)}
            placeholder={t('chat.interactionPanel.mobileDebugDevicePort')}
            onChange={event => {
              const nextPort = Number.parseInt(event.target.value, 10)
              onChangeConfig(current => ({
                ...current,
                portForwardingRules: current.portForwardingRules.map(item =>
                  item.id === rule.id ? { ...item, devicePort: Number.isFinite(nextPort) ? nextPort : 0 } : item
                )
              }))
            }}
          />
          <Input
            value={rule.localAddress}
            placeholder={t('chat.interactionPanel.mobileDebugLocalAddress')}
            onChange={event =>
              onChangeConfig(current => ({
                ...current,
                portForwardingRules: current.portForwardingRules.map(item =>
                  item.id === rule.id ? { ...item, localAddress: event.target.value } : item
                )
              }))}
          />
          <RemoveConfigButton
            onClick={() =>
              onChangeConfig(current => ({
                ...current,
                portForwardingRules: current.portForwardingRules.filter(item => item.id !== rule.id)
              }))}
          />
        </div>
      ))}
      <Button
        type='text'
        className='chat-interaction-panel-mobile-debug__add-rule'
        icon={<span className='material-symbols-rounded'>add</span>}
        onClick={() =>
          onChangeConfig(current => ({
            ...current,
            portForwardingRules: [
              ...current.portForwardingRules,
              {
                devicePort: 3000,
                enabled: true,
                id: createMobileDebugConfigId('forward'),
                localAddress: '127.0.0.1:3000'
              }
            ]
          }))}
      >
        {t('chat.interactionPanel.mobileDebugAddPortForward')}
      </Button>
    </div>
  )
}

export function NetworkTargetConfigPanel({
  config,
  onChangeConfig
}: {
  config: MobileDebugConfigState
  onChangeConfig: (updater: (current: MobileDebugConfigState) => MobileDebugConfigState) => void
}) {
  const { t } = useTranslation()

  return (
    <div className='chat-interaction-panel-mobile-debug__config-panel'>
      <div className='chat-interaction-panel-mobile-debug__config-title'>
        {t('chat.interactionPanel.mobileDebugNetworkTargets')}
      </div>
      {config.networkTargets.length === 0 && (
        <div className='chat-interaction-panel-mobile-debug__config-empty'>
          {t('chat.interactionPanel.mobileDebugNoNetworkTargetsConfigured')}
        </div>
      )}
      {config.networkTargets.map(target => (
        <div key={target.id} className='chat-interaction-panel-mobile-debug__config-row is-network-target'>
          <Checkbox
            checked={target.enabled !== false}
            onChange={event =>
              onChangeConfig(current => ({
                ...current,
                networkTargets: current.networkTargets.map(item =>
                  item.id === target.id ? { ...item, enabled: event.target.checked } : item
                )
              }))}
          />
          <Input
            value={target.address}
            placeholder={t('chat.interactionPanel.mobileDebugNetworkAddress')}
            onChange={event =>
              onChangeConfig(current => ({
                ...current,
                networkTargets: current.networkTargets.map(item =>
                  item.id === target.id ? { ...item, address: event.target.value } : item
                )
              }))}
          />
          <RemoveConfigButton
            onClick={() =>
              onChangeConfig(current => ({
                ...current,
                networkTargets: current.networkTargets.filter(item => item.id !== target.id)
              }))}
          />
        </div>
      ))}
      <Button
        type='text'
        className='chat-interaction-panel-mobile-debug__add-rule'
        icon={<span className='material-symbols-rounded'>add</span>}
        onClick={() =>
          onChangeConfig(current => ({
            ...current,
            networkTargets: [
              ...current.networkTargets,
              {
                address: 'localhost:9222',
                enabled: true,
                id: createMobileDebugConfigId('network')
              }
            ]
          }))}
      >
        {t('chat.interactionPanel.mobileDebugAddNetworkTarget')}
      </Button>
    </div>
  )
}

function RemoveConfigButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()

  return (
    <Button
      type='text'
      className='chat-interaction-panel-mobile-debug__remove'
      aria-label={t('common.remove')}
      icon={<span className='material-symbols-rounded'>close</span>}
      onClick={onClick}
    />
  )
}
