import { Tabs } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { MobileDeviceInlineTabActions, MobileDeviceTabActionButton } from './InteractionPanelMobileDeviceActions'
import { InteractionPanelMobileDeviceDetailsPanel } from './InteractionPanelMobileDeviceDetailsPanel'
import { InteractionPanelMobileDeviceInspectPanel } from './InteractionPanelMobileDeviceInspectPanel'
import type { FlattenedElementNode } from './mobile-device-preview-utils'

export function InteractionPanelMobileDeviceSideTabs({
  details,
  elementTree,
  error,
  flattenedNodes,
  isInspecting,
  selectedNode,
  selectedNodeId,
  showInlineActions = true,
  onRefresh,
  onSelectNode,
  onSendInput,
  onToggleInspect,
  onToggleSidePanel
}: {
  details: ReactNode
  elementTree: DesktopMobileElementTreeResponse | null
  error: string | null
  flattenedNodes: FlattenedElementNode[]
  isInspecting: boolean
  selectedNode: DesktopMobileElementNode | undefined
  selectedNodeId: string | undefined
  showInlineActions?: boolean
  onRefresh: () => void
  onSelectNode: (nodeId: string) => void
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
            <MobileDeviceTabActionButton
              active={isInspecting}
              icon={isInspecting ? 'select_check_box' : 'select'}
              label={t('chat.interactionPanel.mobileDebugInspectMode')}
              onClick={onToggleInspect}
            />
          ),
          right: showInlineActions
            ? (
              <MobileDeviceInlineTabActions
                onRefresh={onRefresh}
                onSendInput={onSendInput}
                onToggleSidePanel={onToggleSidePanel}
              />
            )
            : undefined
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
            label: 'Elements'
          },
          {
            children: (
              <InteractionPanelMobileDeviceDetailsPanel
                details={details}
                error={error}
                onSendInput={onSendInput}
              />
            ),
            key: 'details',
            label: t('chat.interactionPanel.mobileDebugDetails')
          }
        ]}
      />
    </div>
  )
}
