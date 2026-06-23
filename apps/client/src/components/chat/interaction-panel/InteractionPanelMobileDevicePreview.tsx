import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MobileDeviceStandaloneHeaderActions } from './InteractionPanelMobileDeviceActions'
import { InteractionPanelMobileDeviceScreen } from './InteractionPanelMobileDeviceScreen'
import { InteractionPanelMobileDeviceSideTabs } from './InteractionPanelMobileDeviceSideTabs'
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
  onStandaloneDeviceTitleChange,
  onStandaloneHeaderActionsChange
}: {
  details: ReactNode
  devices: DesktopMobileDebugDevice[]
  onStandaloneDeviceTitleChange?: (title: string | null) => void
  onStandaloneHeaderActionsChange?: (actions: ReactNode | null) => void
}) {
  const { t } = useTranslation()
  const readyDevice = getReadyDevice(devices)
  const readyDeviceId = readyDevice?.id
  const deviceTitle = readyDevice == null ? undefined : getDeviceWindowTitle(readyDevice)
  const preview = useMobileDevicePreviewController(readyDeviceId)
  const [isSidePanelVisible, setIsSidePanelVisible] = useState(true)
  const usesStandaloneHeaderActions = onStandaloneHeaderActionsChange != null
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
  const sendInput = useCallback((input: DesktopMobileDeviceInputEvent) => {
    void preview.sendInput(input)
  }, [preview.sendInput])

  const standaloneHeaderActions = useMemo(() =>
    usesStandaloneHeaderActions && readyDevice != null
      ? (
        <MobileDeviceStandaloneHeaderActions
          isSidePanelVisible={isSidePanelVisible}
          onRefresh={preview.refreshPreview}
          onSendInput={sendInput}
          onToggleSidePanel={toggleSidePanel}
        />
      )
      : null, [
    isSidePanelVisible,
    preview.refreshPreview,
    readyDevice,
    sendInput,
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

  return (
    <section className='chat-interaction-panel-mobile-debug__preview-section'>
      <div
        className={`chat-interaction-panel-mobile-debug__preview-grid ${
          isSidePanelVisible ? '' : 'is-side-panel-hidden'
        }`}
      >
        <InteractionPanelMobileDeviceScreen
          deviceTitle={visibleDeviceTitle}
          elementScreen={preview.elementTree?.root?.bounds}
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
          onSendInput={sendInput}
          onVideoError={preview.handleVideoError}
          onVideoSizeChange={preview.setVideoSize}
          onVideoStatusChange={preview.setVideoStatus}
          screenRatio={screenRatio}
          showDeviceTitlebar={!usesStandaloneHeaderActions}
        />
        {isSidePanelVisible
          ? (
            <InteractionPanelMobileDeviceSideTabs
              details={details}
              elementTree={preview.elementTree}
              error={preview.error}
              flattenedNodes={preview.flattenedNodes}
              isInspecting={preview.isInspecting}
              selectedNode={preview.selectedNode}
              selectedNodeId={preview.selectedNodeId}
              onRefresh={preview.refreshPreview}
              onSelectNode={preview.setSelectedNodeId}
              onSendInput={sendInput}
              showInlineActions={!usesStandaloneHeaderActions}
              onToggleInspect={preview.toggleInspect}
              onToggleSidePanel={hideSidePanel}
            />
          )
          : usesStandaloneHeaderActions
          ? null
          : (
            <button
              type='button'
              className='chat-interaction-panel-mobile-debug__side-panel-restore'
              aria-label={t('chat.interactionPanel.mobileDebugShowSidePanel')}
              title={t('chat.interactionPanel.mobileDebugShowSidePanel')}
              onClick={() => setIsSidePanelVisible(true)}
            >
              <span className='material-symbols-rounded' aria-hidden='true'>right_panel_open</span>
            </button>
          )}
      </div>
    </section>
  )
}
