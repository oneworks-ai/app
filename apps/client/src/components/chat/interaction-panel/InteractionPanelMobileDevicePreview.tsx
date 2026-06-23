import type { ReactNode } from 'react'

import { InteractionPanelMobileDeviceScreen } from './InteractionPanelMobileDeviceScreen'
import { InteractionPanelMobileDeviceSideTabs } from './InteractionPanelMobileDeviceSideTabs'
import { getDeviceWindowTitle, getReadyDevice } from './mobile-device-preview-utils'
import { useMobileDevicePreviewController } from './use-mobile-device-preview-controller'

export function InteractionPanelMobileDevicePreview({
  details,
  devices
}: {
  details: ReactNode
  devices: DesktopMobileDebugDevice[]
}) {
  const readyDevice = getReadyDevice(devices)
  const readyDeviceId = readyDevice?.id
  const preview = useMobileDevicePreviewController(readyDeviceId)

  if (readyDevice == null) return null
  const screenRatio = preview.videoSize?.width != null && preview.videoSize.height > 0
    ? preview.videoSize.width / preview.videoSize.height
    : preview.screenshot?.width != null && preview.screenshot.height != null && preview.screenshot.height > 0
    ? preview.screenshot.width / preview.screenshot.height
    : undefined

  return (
    <section className='chat-interaction-panel-mobile-debug__preview-section'>
      <div className='chat-interaction-panel-mobile-debug__preview-grid'>
        <InteractionPanelMobileDeviceScreen
          deviceTitle={getDeviceWindowTitle(readyDevice)}
          hoverNode={preview.hoverNode}
          isInspecting={preview.isInspecting}
          screenshot={preview.screenshot}
          selectedNode={preview.selectedNode}
          videoDeviceId={readyDeviceId}
          videoSize={preview.videoSize}
          videoStatus={preview.videoStatus}
          videoStreamKey={preview.videoStreamKey}
          onHoverPoint={preview.hoverElementAtPoint}
          onInspectPoint={preview.selectElementAtPoint}
          onPointerLeave={() => preview.setHoverNodeId(undefined)}
          onRefresh={preview.refreshPreview}
          onSendInput={input => void preview.sendInput(input)}
          onToggleInspect={preview.toggleInspect}
          onVideoError={preview.handleVideoError}
          onVideoSizeChange={preview.setVideoSize}
          onVideoStatusChange={preview.setVideoStatus}
          screenRatio={screenRatio}
        />
        <InteractionPanelMobileDeviceSideTabs
          details={details}
          elementTree={preview.elementTree}
          error={preview.error}
          flattenedNodes={preview.flattenedNodes}
          selectedNode={preview.selectedNode}
          selectedNodeId={preview.selectedNodeId}
          onSelectNode={preview.setSelectedNodeId}
          onSendInput={input => void preview.sendInput(input)}
        />
      </div>
    </section>
  )
}
