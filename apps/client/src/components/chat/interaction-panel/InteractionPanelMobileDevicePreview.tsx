/* eslint-disable max-lines -- Mobile device preview coordinates screen, tabs, dock state, and device refresh actions. */

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { InteractionPanelMobileDevicePreviewSidePanel } from './InteractionPanelMobileDevicePreviewSidePanel'
import { InteractionPanelMobileDeviceScreen } from './InteractionPanelMobileDeviceScreen'
import type { MobileDeviceDockPosition } from './InteractionPanelMobileDeviceSideTabs'
import { MobileDeviceStandaloneHeaderActions } from './InteractionPanelMobileDeviceStandaloneHeaderActions'
import { getDeviceWindowTitle, getReadyDevice } from './mobile-device-preview-utils'
import {
  fitStandaloneMobileDebugWindow,
  useFitStandaloneMobileDebugWindow
} from './use-fit-standalone-mobile-debug-window'
import { useMobileDevicePreviewController } from './use-mobile-device-preview-controller'

const readStandaloneScreenWidth = () => (
  document.querySelector<HTMLElement>('.standalone-mobile-debug-route .chat-interaction-panel-mobile-debug__screen')
    ?.getBoundingClientRect().width
)

export function InteractionPanelMobileDevicePreview({
  details,
  devices,
  isActive,
  onOpenDeviceList,
  onStandaloneDeviceTitleChange,
  onStandaloneHeaderActionsChange
}: {
  details: ReactNode
  devices: DesktopMobileDebugDevice[]
  isActive: boolean
  onOpenDeviceList?: () => void
  onStandaloneDeviceTitleChange?: (title: string | null) => void
  onStandaloneHeaderActionsChange?: (actions: ReactNode | null) => void
}) {
  const readyDevice = getReadyDevice(devices)
  const readyDeviceId = readyDevice?.id
  const deviceTitle = readyDevice == null ? undefined : getDeviceWindowTitle(readyDevice)
  const preview = useMobileDevicePreviewController(readyDevice, isActive)
  const [isSidePanelVisible, setIsSidePanelVisible] = useState(true)
  const [isEnvironmentPanelOpen, setIsEnvironmentPanelOpen] = useState(false)
  const [dockPosition, setDockPosition] = useState<MobileDeviceDockPosition>('right')
  const usesStandaloneHeaderActions = onStandaloneHeaderActionsChange != null
  const supportsEnvironmentPanel = readyDevice?.platform !== 'ios'
  const scheduleStandaloneWindowFit = useCallback((
    options: { hiddenScreenWidth?: number; hiddenWidthMode?: 'current-window' | 'device' } = {}
  ) => {
    if (!usesStandaloneHeaderActions) return
    window.requestAnimationFrame(() => {
      fitStandaloneMobileDebugWindow(options)
      window.setTimeout(() => fitStandaloneMobileDebugWindow(options), 120)
    })
  }, [usesStandaloneHeaderActions])
  const hideSidePanel = useCallback(() => {
    const hiddenScreenWidth = readStandaloneScreenWidth()
    setIsEnvironmentPanelOpen(false)
    setIsSidePanelVisible(false)
    scheduleStandaloneWindowFit({ hiddenScreenWidth, hiddenWidthMode: 'device' })
  }, [scheduleStandaloneWindowFit])
  const toggleSidePanel = useCallback(() => {
    const hiddenScreenWidth = isSidePanelVisible ? readStandaloneScreenWidth() : undefined
    setIsSidePanelVisible(current => !current)
    scheduleStandaloneWindowFit({
      hiddenScreenWidth,
      hiddenWidthMode: isSidePanelVisible ? 'device' : 'current-window'
    })
  }, [isSidePanelVisible, scheduleStandaloneWindowFit])
  const toggleEnvironmentPanel = useCallback(() => {
    if (!supportsEnvironmentPanel) return
    const willOpen = !isEnvironmentPanelOpen
    setIsEnvironmentPanelOpen(willOpen)
    if (willOpen) {
      setIsSidePanelVisible(true)
    }
    scheduleStandaloneWindowFit(willOpen && !isSidePanelVisible ? { hiddenWidthMode: 'current-window' } : {})
  }, [isEnvironmentPanelOpen, isSidePanelVisible, scheduleStandaloneWindowFit, supportsEnvironmentPanel])
  const sendInput = useCallback((input: DesktopMobileDeviceInputEvent) => {
    void preview.sendInput(input)
  }, [preview.sendInput])
  const changeDockPosition = useCallback((position: MobileDeviceDockPosition) => {
    setDockPosition(position)
    scheduleStandaloneWindowFit()
  }, [scheduleStandaloneWindowFit])

  const standaloneHeaderActions = useMemo(() =>
    usesStandaloneHeaderActions && readyDevice != null
      ? (
        <MobileDeviceStandaloneHeaderActions
          devicePlatform={readyDevice.platform}
          deviceId={readyDevice.id}
          isEnvironmentPanelOpen={isEnvironmentPanelOpen}
          isSidePanelVisible={isSidePanelVisible}
          onOpenDeviceList={onOpenDeviceList}
          onRefresh={preview.refreshPreview}
          onSendInput={sendInput}
          onToggleEnvironmentPanel={toggleEnvironmentPanel}
          onToggleSidePanel={toggleSidePanel}
        />
      )
      : null, [
    isEnvironmentPanelOpen,
    isSidePanelVisible,
    onOpenDeviceList,
    preview.refreshPreview,
    readyDevice,
    sendInput,
    toggleEnvironmentPanel,
    toggleSidePanel,
    usesStandaloneHeaderActions
  ])

  useEffect(() => {
    if (onStandaloneHeaderActionsChange == null) return
    onStandaloneHeaderActionsChange(standaloneHeaderActions)
    return () => onStandaloneHeaderActionsChange(null)
  }, [onStandaloneHeaderActionsChange, standaloneHeaderActions])

  useFitStandaloneMobileDebugWindow({
    isEnabled: usesStandaloneHeaderActions,
    isSidePanelVisible,
    readyDeviceId,
    videoHeight: preview.videoSize?.height,
    videoWidth: preview.videoSize?.width
  })

  useEffect(() => {
    if (!usesStandaloneHeaderActions || onStandaloneDeviceTitleChange == null) return
    if (deviceTitle == null) {
      onStandaloneDeviceTitleChange(null)
      return
    }
    onStandaloneDeviceTitleChange(deviceTitle)
    return () => onStandaloneDeviceTitleChange(null)
  }, [deviceTitle, onStandaloneDeviceTitleChange, usesStandaloneHeaderActions])

  if (readyDevice == null) return null
  const visibleDeviceTitle = deviceTitle ?? getDeviceWindowTitle(readyDevice)
  const screenRatio = preview.videoSize?.width != null && preview.videoSize.height > 0
    ? preview.videoSize.width / preview.videoSize.height
    : preview.screenshot?.width != null && preview.screenshot.height != null && preview.screenshot.height > 0
    ? preview.screenshot.width / preview.screenshot.height
    : undefined
  const previewGridClassName = [
    'chat-interaction-panel-mobile-debug__preview-grid',
    isSidePanelVisible ? `is-dock-${dockPosition}` : 'is-side-panel-hidden'
  ].join(' ')

  return (
    <section className='chat-interaction-panel-mobile-debug__preview-section'>
      <div className={previewGridClassName}>
        <InteractionPanelMobileDeviceScreen
          deviceTitle={visibleDeviceTitle}
          devicePlatform={readyDevice.platform}
          elementScreen={preview.elementTree?.root?.bounds}
          elementTreeRoot={preview.elementTree?.root}
          hoverNode={preview.hoverNode}
          inputScreen={readyDevice.screen}
          isInspecting={preview.isInspecting}
          screenshot={preview.screenshot}
          selectedNode={preview.selectedNode}
          videoDeviceId={readyDeviceId}
          videoSource={preview.videoSource}
          videoSize={preview.videoSize}
          videoStatus={preview.videoStatus}
          videoStreamKey={preview.videoStreamKey}
          onCancelInspect={preview.cancelInspect}
          onClearSelectedElement={preview.clearSelectedElement}
          onHoverElementId={preview.hoverElementById}
          onHoverPoint={preview.hoverElementAtPoint}
          onInspectElementId={preview.selectElementById}
          onInspectPoint={preview.selectElementAtPoint}
          onPointerLeave={() => preview.setHoverNodeId(undefined)}
          onSendInput={sendInput}
          onVideoError={preview.handleVideoError}
          onVideoSizeChange={preview.setVideoSize}
          onVideoStatusChange={preview.setVideoStatus}
          screenRatio={screenRatio}
          showDeviceTitlebar={!usesStandaloneHeaderActions}
        />
        <InteractionPanelMobileDevicePreviewSidePanel
          details={details}
          devicePlatform={readyDevice.platform}
          deviceId={readyDevice.id}
          dockPosition={dockPosition}
          elementTree={preview.elementTree}
          error={preview.error}
          flattenedNodes={preview.flattenedNodes}
          isEnvironmentPanelOpen={isEnvironmentPanelOpen}
          isInspecting={preview.isInspecting}
          isSidePanelVisible={isSidePanelVisible}
          selectedNode={preview.selectedNode}
          selectedNodeId={preview.selectedNodeId}
          showInlineActions={!usesStandaloneHeaderActions}
          onAppliedEnvironment={preview.refreshPreview}
          onDockPositionChange={changeDockPosition}
          onRefresh={preview.refreshPreview}
          onRestoreSidePanel={() => setIsSidePanelVisible(true)}
          onSelectNode={preview.setSelectedNodeId}
          onSendInput={sendInput}
          onToggleInspect={preview.toggleInspect}
          onToggleSidePanel={hideSidePanel}
        />
      </div>
    </section>
  )
}
