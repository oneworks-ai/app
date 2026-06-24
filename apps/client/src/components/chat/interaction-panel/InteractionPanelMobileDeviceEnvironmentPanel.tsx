import { App, Tabs } from 'antd'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getApiErrorMessage } from '#~/api'

import { InteractionPanelMobileDeviceEnvironmentBatteryPanel } from './InteractionPanelMobileDeviceEnvironmentBatteryPanel'
import { InteractionPanelMobileDeviceEnvironmentCellularPanel } from './InteractionPanelMobileDeviceEnvironmentCellularPanel'
import { InteractionPanelMobileDeviceEnvironmentFingerprintPanel } from './InteractionPanelMobileDeviceEnvironmentFingerprintPanel'
import { renderMobileEnvironmentTabLabel } from './InteractionPanelMobileDeviceEnvironmentLayout'
import { InteractionPanelMobileDeviceEnvironmentLocationPanel } from './InteractionPanelMobileDeviceEnvironmentLocationPanel'
import { InteractionPanelMobileDeviceEnvironmentPhonePanel } from './InteractionPanelMobileDeviceEnvironmentPhonePanel'
import { applyMobileDeviceEnvironmentAction } from './mobile-debug-platform'
import { isAndroidEmulatorDevice } from './mobile-device-environment-options'
import type { MobileEnvironmentActionRunnerOptions, MobileEnvironmentTabKey } from './mobile-device-environment-options'

export function InteractionPanelMobileDeviceEnvironmentPanel({
  deviceId,
  onApplied
}: {
  deviceId: string
  onApplied: () => void
}) {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const [activeKey, setActiveKey] = useState<MobileEnvironmentTabKey>('battery')
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null)
  const pendingActionKeyRef = useRef<string | null>(null)
  const isEmulator = isAndroidEmulatorDevice(deviceId)
  const isBusy = pendingActionKey != null
  const isEmulatorControlDisabled = !isEmulator || isBusy

  const runEnvironmentAction = useCallback(async (
    actionKey: string,
    action: DesktopMobileDeviceEnvironmentAction,
    options: MobileEnvironmentActionRunnerOptions = {}
  ) => {
    if (pendingActionKeyRef.current != null) return
    pendingActionKeyRef.current = actionKey
    setPendingActionKey(actionKey)
    try {
      await applyMobileDeviceEnvironmentAction(deviceId, action)
      onApplied()
      if (options.silentSuccess !== true) {
        void message.success(t('chat.interactionPanel.mobileDebugEnvironmentApplied'))
      }
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('chat.interactionPanel.mobileDebugEnvironmentApplyFailed')))
    } finally {
      pendingActionKeyRef.current = null
      setPendingActionKey(null)
    }
  }, [deviceId, message, onApplied, t])

  return (
    <aside className='chat-interaction-panel-mobile-debug__environment-panel'>
      {!isEmulator && (
        <div className='chat-interaction-panel-mobile-debug__environment-note'>
          {t('chat.interactionPanel.mobileDebugEnvironmentEmulatorOnly')}
        </div>
      )}
      <Tabs
        activeKey={activeKey}
        size='small'
        onChange={key => setActiveKey(key as MobileEnvironmentTabKey)}
        items={[
          {
            children: (
              <InteractionPanelMobileDeviceEnvironmentBatteryPanel
                isBusy={isBusy}
                pendingActionKey={pendingActionKey}
                runEnvironmentAction={runEnvironmentAction}
              />
            ),
            key: 'battery',
            label: renderMobileEnvironmentTabLabel(
              'battery_charging_full',
              t('chat.interactionPanel.mobileDebugEnvironmentBattery')
            )
          },
          {
            children: (
              <InteractionPanelMobileDeviceEnvironmentCellularPanel
                isEmulatorControlDisabled={isEmulatorControlDisabled}
                runEnvironmentAction={runEnvironmentAction}
              />
            ),
            key: 'cellular',
            label: renderMobileEnvironmentTabLabel(
              'signal_cellular_alt',
              t('chat.interactionPanel.mobileDebugEnvironmentCellular')
            )
          },
          {
            children: (
              <InteractionPanelMobileDeviceEnvironmentLocationPanel
                isEmulatorControlDisabled={isEmulatorControlDisabled}
                runEnvironmentAction={runEnvironmentAction}
              />
            ),
            key: 'location',
            label: renderMobileEnvironmentTabLabel(
              'my_location',
              t('chat.interactionPanel.mobileDebugEnvironmentLocation')
            )
          },
          {
            children: (
              <InteractionPanelMobileDeviceEnvironmentPhonePanel
                isEmulatorControlDisabled={isEmulatorControlDisabled}
                pendingActionKey={pendingActionKey}
                runEnvironmentAction={runEnvironmentAction}
              />
            ),
            key: 'phone',
            label: renderMobileEnvironmentTabLabel('call', t('chat.interactionPanel.mobileDebugEnvironmentPhone'))
          },
          {
            children: (
              <InteractionPanelMobileDeviceEnvironmentFingerprintPanel
                isEmulatorControlDisabled={isEmulatorControlDisabled}
                pendingActionKey={pendingActionKey}
                runEnvironmentAction={runEnvironmentAction}
              />
            ),
            key: 'fingerprint',
            label: renderMobileEnvironmentTabLabel(
              'fingerprint',
              t('chat.interactionPanel.mobileDebugEnvironmentFingerprint')
            )
          }
        ]}
      />
    </aside>
  )
}
