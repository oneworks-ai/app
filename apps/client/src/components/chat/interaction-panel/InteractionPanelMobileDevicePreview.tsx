import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceInspectPanel } from './InteractionPanelMobileDeviceInspectPanel'
import { InteractionPanelMobileDeviceScreen } from './InteractionPanelMobileDeviceScreen'
import {
  findDeepestNodeAtPoint,
  flattenElementNodes,
  getReadyDevice,
  screenshotRefreshMs
} from './mobile-device-preview-utils'
import type { PointerDevicePoint } from './mobile-device-preview-utils'

export function InteractionPanelMobileDevicePreview({
  devices
}: {
  devices: DesktopMobileDebugDevice[]
}) {
  const { t } = useTranslation()
  const readyDevice = getReadyDevice(devices)
  const [screenshot, setScreenshot] = useState<DesktopMobileDeviceScreenshotResponse | null>(null)
  const [elementTree, setElementTree] = useState<DesktopMobileElementTreeResponse | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [hoverNodeId, setHoverNodeId] = useState<string>()
  const [isInspecting, setIsInspecting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const isRefreshingRef = useRef(false)

  const flattenedNodes = useMemo(
    () => flattenElementNodes(elementTree?.root).filter(item => item.node.bounds != null),
    [elementTree]
  )
  const selectedNode = useMemo(
    () => flattenedNodes.find(item => item.node.id === selectedNodeId)?.node,
    [flattenedNodes, selectedNodeId]
  )
  const hoverNode = useMemo(
    () => flattenedNodes.find(item => item.node.id === hoverNodeId)?.node,
    [flattenedNodes, hoverNodeId]
  )

  const refreshPreview = useCallback(async () => {
    const deviceId = readyDevice?.id
    const desktopApi = window.oneworksDesktop
    if (
      deviceId == null ||
      desktopApi?.captureMobileDeviceScreenshot == null ||
      desktopApi.dumpMobileElementTree == null ||
      isRefreshingRef.current
    ) {
      return
    }

    isRefreshingRef.current = true
    try {
      const [screenshotResult, treeResult] = await Promise.allSettled([
        desktopApi.captureMobileDeviceScreenshot(deviceId),
        desktopApi.dumpMobileElementTree(deviceId)
      ])
      if (screenshotResult.status === 'fulfilled') {
        setScreenshot(screenshotResult.value)
      } else {
        setError(t('chat.interactionPanel.mobileDebugPreviewFailed'))
      }
      if (treeResult.status === 'fulfilled') {
        setElementTree(treeResult.value)
        setSelectedNodeId(current =>
          current == null || flattenElementNodes(treeResult.value.root).some(item => item.node.id === current)
            ? current
            : undefined
        )
      }
      if (screenshotResult.status === 'fulfilled' || treeResult.status === 'fulfilled') {
        setError(null)
      }
    } finally {
      isRefreshingRef.current = false
    }
  }, [readyDevice?.id, t])

  useEffect(() => {
    setScreenshot(null)
    setElementTree(null)
    setSelectedNodeId(undefined)
    setHoverNodeId(undefined)
    setError(null)
    if (readyDevice == null) return
    void refreshPreview()
    const timer = window.setInterval(() => void refreshPreview(), screenshotRefreshMs)
    return () => window.clearInterval(timer)
  }, [readyDevice, refreshPreview])

  const sendInput = useCallback(async (input: DesktopMobileDeviceInputEvent) => {
    const deviceId = readyDevice?.id
    const sendMobileDeviceInput = window.oneworksDesktop?.sendMobileDeviceInput
    if (deviceId == null || sendMobileDeviceInput == null) return

    try {
      await sendMobileDeviceInput(deviceId, input)
      window.setTimeout(() => void refreshPreview(), 260)
    } catch {
      setError(t('chat.interactionPanel.mobileDebugInputFailed'))
    }
  }, [readyDevice?.id, refreshPreview, t])

  const selectElementAtPoint = useCallback((point: PointerDevicePoint) => {
    setSelectedNodeId(findDeepestNodeAtPoint(elementTree?.root, point)?.id)
  }, [elementTree?.root])

  const hoverElementAtPoint = useCallback((point: PointerDevicePoint) => {
    setHoverNodeId(findDeepestNodeAtPoint(elementTree?.root, point)?.id)
  }, [elementTree?.root])

  if (readyDevice == null) return null

  return (
    <section className='chat-interaction-panel-mobile-debug__preview-section'>
      <div className='chat-interaction-panel-mobile-debug__preview-toolbar'>
        <div className='chat-interaction-panel-mobile-debug__device-summary'>
          <span className='material-symbols-rounded' aria-hidden='true'>adb</span>
          <span>{readyDevice.label}</span>
        </div>
      </div>

      <div className='chat-interaction-panel-mobile-debug__preview-grid'>
        <InteractionPanelMobileDeviceScreen
          error={error}
          hoverNode={hoverNode}
          isInspecting={isInspecting}
          screenshot={screenshot}
          selectedNode={selectedNode}
          onHoverPoint={hoverElementAtPoint}
          onInspectPoint={selectElementAtPoint}
          onPointerLeave={() => setHoverNodeId(undefined)}
          onRefresh={() => void refreshPreview()}
          onSendInput={input => void sendInput(input)}
          onToggleInspect={() => setIsInspecting(current => !current)}
        />
        <InteractionPanelMobileDeviceInspectPanel
          elementTree={elementTree}
          flattenedNodes={flattenedNodes}
          selectedNode={selectedNode}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
        />
      </div>
    </section>
  )
}
