import { Tabs } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceDetailsPanel } from './InteractionPanelMobileDeviceDetailsPanel'
import { InteractionPanelMobileDeviceInspectPanel } from './InteractionPanelMobileDeviceInspectPanel'
import type { FlattenedElementNode } from './mobile-device-preview-utils'

export function InteractionPanelMobileDeviceSideTabs({
  details,
  elementTree,
  error,
  flattenedNodes,
  selectedNode,
  selectedNodeId,
  onSelectNode,
  onSendInput
}: {
  details: ReactNode
  elementTree: DesktopMobileElementTreeResponse | null
  error: string | null
  flattenedNodes: FlattenedElementNode[]
  selectedNode: DesktopMobileElementNode | undefined
  selectedNodeId: string | undefined
  onSelectNode: (nodeId: string) => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
}) {
  const { t } = useTranslation()

  return (
    <div className='chat-interaction-panel-mobile-debug__side-tabs'>
      <Tabs
        defaultActiveKey='elements'
        size='small'
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
