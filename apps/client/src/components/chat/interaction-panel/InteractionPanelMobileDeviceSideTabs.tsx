import { Tabs } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { MobileDeviceInlineTabActions } from './InteractionPanelMobileDeviceActions'
import {
  InteractionPanelMobileDeviceInputPanel,
  InteractionPanelMobileDeviceTargetsPanel
} from './InteractionPanelMobileDeviceDetailsPanel'
import { InteractionPanelMobileDeviceInspectPanel } from './InteractionPanelMobileDeviceInspectPanel'
import { InteractionPanelMobileDeviceLogsPanel } from './InteractionPanelMobileDeviceLogsPanel'
import { MobileDeviceTabActionButton } from './InteractionPanelMobileDeviceTabActionButton'
import type { FlattenedElementNode } from './mobile-device-preview-utils'

export type MobileDeviceDockPosition = 'bottom' | 'left' | 'right'

const dockPositionItems: Array<{ icon: string; key: MobileDeviceDockPosition; labelKey: string }> = [
  { icon: 'left_panel_open', key: 'left', labelKey: 'mobileDebugDockLeft' },
  { icon: 'bottom_panel_open', key: 'bottom', labelKey: 'mobileDebugDockBottom' },
  { icon: 'right_panel_open', key: 'right', labelKey: 'mobileDebugDockRight' }
]

const renderMobileDebugTabLabel = (icon: string, label: ReactNode) => (
  <span className='chat-interaction-panel-mobile-debug__tab-label'>
    <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>
    <span>{label}</span>
  </span>
)

function MobileDeviceDockPositionSwitch({
  dockPosition,
  onDockPositionChange
}: {
  dockPosition: MobileDeviceDockPosition
  onDockPositionChange: (position: MobileDeviceDockPosition) => void
}) {
  const { t } = useTranslation()

  return (
    <div
      className='chat-interaction-panel-mobile-debug__dock-switch'
      role='group'
      aria-label={t('chat.interactionPanel.mobileDebugDockPosition')}
    >
      {dockPositionItems.map(item => (
        <MobileDeviceTabActionButton
          key={item.key}
          active={dockPosition === item.key}
          icon={item.icon}
          label={t(`chat.interactionPanel.${item.labelKey}`)}
          onClick={() => onDockPositionChange(item.key)}
        />
      ))}
    </div>
  )
}

export function InteractionPanelMobileDeviceSideTabs({
  details,
  deviceId,
  dockPosition,
  elementTree,
  error,
  flattenedNodes,
  isInspecting,
  selectedNode,
  selectedNodeId,
  showInlineActions = true,
  onDockPositionChange,
  onRefresh,
  onSelectNode,
  onSendInput,
  onToggleInspect,
  onToggleSidePanel
}: {
  details: ReactNode
  deviceId: string
  dockPosition: MobileDeviceDockPosition
  elementTree: DesktopMobileElementTreeResponse | null
  error: string | null
  flattenedNodes: FlattenedElementNode[]
  isInspecting: boolean
  selectedNode: DesktopMobileElementNode | undefined
  selectedNodeId: string | undefined
  showInlineActions?: boolean
  onDockPositionChange: (position: MobileDeviceDockPosition) => void
  onRefresh: () => void
  onSelectNode: (nodeId: string | undefined) => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  onToggleInspect: () => void
  onToggleSidePanel: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className='chat-interaction-panel-mobile-debug__side-tabs'>
      <Tabs
        defaultActiveKey='elements'
        size='small'
        tabBarExtraContent={{
          left: (
            <div className='chat-interaction-panel-mobile-debug__tab-left-actions'>
              <MobileDeviceTabActionButton
                active={isInspecting}
                icon='highlight_mouse_cursor'
                label={t('chat.interactionPanel.mobileDebugInspectMode')}
                onClick={onToggleInspect}
              />
            </div>
          ),
          right: (
            <div className='chat-interaction-panel-mobile-debug__tab-right-actions'>
              <MobileDeviceDockPositionSwitch
                dockPosition={dockPosition}
                onDockPositionChange={onDockPositionChange}
              />
              {showInlineActions && (
                <MobileDeviceInlineTabActions
                  onRefresh={onRefresh}
                  onSendInput={onSendInput}
                  onToggleSidePanel={onToggleSidePanel}
                />
              )}
            </div>
          )
        }}
        items={[
          {
            children: (
              <InteractionPanelMobileDeviceInspectPanel
                elementTree={elementTree}
                flattenedNodes={flattenedNodes}
                selectedNode={selectedNode}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
              />
            ),
            key: 'elements',
            label: renderMobileDebugTabLabel('account_tree', t('chat.interactionPanel.mobileDebugElements'))
          },
          {
            children: (
              <InteractionPanelMobileDeviceTargetsPanel
                details={details}
              />
            ),
            key: 'targets',
            label: renderMobileDebugTabLabel('web_asset', t('chat.interactionPanel.mobileDebugTargetTab'))
          },
          {
            children: (
              <InteractionPanelMobileDeviceInputPanel
                error={error}
                onSendInput={onSendInput}
              />
            ),
            key: 'input',
            label: renderMobileDebugTabLabel('keyboard', t('chat.interactionPanel.mobileDebugInputTab'))
          },
          {
            children: <InteractionPanelMobileDeviceLogsPanel deviceId={deviceId} />,
            key: 'logs',
            label: renderMobileDebugTabLabel('terminal', t('chat.interactionPanel.mobileDebugLogs'))
          }
        ]}
      />
    </div>
  )
}
