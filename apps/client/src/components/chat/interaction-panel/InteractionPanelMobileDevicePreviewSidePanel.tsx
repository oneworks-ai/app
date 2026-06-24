import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceEnvironmentPanel } from './InteractionPanelMobileDeviceEnvironmentPanel'
import { InteractionPanelMobileDeviceSideTabs } from './InteractionPanelMobileDeviceSideTabs'
import type { MobileDeviceDockPosition } from './InteractionPanelMobileDeviceSideTabs'

export function InteractionPanelMobileDevicePreviewSidePanel({
  details,
  deviceId,
  dockPosition,
  elementTree,
  error,
  flattenedNodes,
  isEnvironmentPanelOpen,
  isInspecting,
  isSidePanelVisible,
  selectedNode,
  selectedNodeId,
  showInlineActions,
  onAppliedEnvironment,
  onDockPositionChange,
  onRefresh,
  onRestoreSidePanel,
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
  flattenedNodes: Array<{ depth: number; node: DesktopMobileElementNode }>
  isEnvironmentPanelOpen: boolean
  isInspecting: boolean
  isSidePanelVisible: boolean
  selectedNode: DesktopMobileElementNode | undefined
  selectedNodeId: string | undefined
  showInlineActions: boolean
  onAppliedEnvironment: () => void
  onDockPositionChange: (position: MobileDeviceDockPosition) => void
  onRefresh: () => void
  onRestoreSidePanel: () => void
  onSelectNode: (nodeId: string | undefined) => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  onToggleInspect: () => void
  onToggleSidePanel: () => void
}) {
  const { t } = useTranslation()

  if (!isSidePanelVisible) {
    if (!showInlineActions) return null
    return (
      <button
        type='button'
        className='chat-interaction-panel-mobile-debug__side-panel-restore'
        aria-label={t('chat.interactionPanel.mobileDebugShowSidePanel')}
        title={t('chat.interactionPanel.mobileDebugShowSidePanel')}
        onClick={onRestoreSidePanel}
      >
        <span className='material-symbols-rounded' aria-hidden='true'>right_panel_open</span>
      </button>
    )
  }

  if (isEnvironmentPanelOpen) {
    return <InteractionPanelMobileDeviceEnvironmentPanel deviceId={deviceId} onApplied={onAppliedEnvironment} />
  }

  return (
    <InteractionPanelMobileDeviceSideTabs
      details={details}
      deviceId={deviceId}
      dockPosition={dockPosition}
      elementTree={elementTree}
      error={error}
      flattenedNodes={flattenedNodes}
      isInspecting={isInspecting}
      selectedNode={selectedNode}
      selectedNodeId={selectedNodeId}
      showInlineActions={showInlineActions}
      onDockPositionChange={onDockPositionChange}
      onRefresh={onRefresh}
      onSelectNode={onSelectNode}
      onSendInput={onSendInput}
      onToggleInspect={onToggleInspect}
      onToggleSidePanel={onToggleSidePanel}
    />
  )
}
