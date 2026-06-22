import { Tabs } from 'antd'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceDetailsPanel } from './InteractionPanelMobileDeviceDetailsPanel'
import { InteractionPanelMobileDeviceInspectPanel } from './InteractionPanelMobileDeviceInspectPanel'
import { InteractionPanelMobileDeviceScreen } from './InteractionPanelMobileDeviceScreen'
import {
  findDeepestNodeAtPoint,
  flattenElementNodes,
  getDeviceWindowTitle,
  getReadyDevice,
  screenshotRefreshMs
} from './mobile-device-preview-utils'
import type { PointerDevicePoint } from './mobile-device-preview-utils'

export function InteractionPanelMobileDevicePreview({
  details,
  devices
}: {
  details: ReactNode
  devices: DesktopMobileDebugDevice[]
}) {
  const { t } = useTranslation()
  const readyDevice = getReadyDevice(devices)
  const readyDeviceId = readyDevice?.id
  const [screenshot, setScreenshot] = useState<DesktopMobileDeviceScreenshotResponse | null>(null)
  const [elementTree, setElementTree] = useState<DesktopMobileElementTreeResponse | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [hoverNodeId, setHoverNodeId] = useState<string>()
  const [isInspecting, setIsInspecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const screenshotRef = useRef<DesktopMobileDeviceScreenshotResponse | null>(null)
  const isScreenshotRefreshingRef = useRef(false)
  const isElementTreeRefreshingRef = useRef(false)

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

  const refreshScreenshot = useCallback(async () => {
    const deviceId = readyDeviceId
    const desktopApi = window.oneworksDesktop
    if (
      deviceId == null ||
      desktopApi?.captureMobileDeviceScreenshot == null ||
      isScreenshotRefreshingRef.current
    ) {
      return
    }

    isScreenshotRefreshingRef.current = true
    try {
      const nextScreenshot = await desktopApi.captureMobileDeviceScreenshot(deviceId)
      screenshotRef.current = nextScreenshot
      setScreenshot(nextScreenshot)
      setError(null)
    } catch {
      setError(current => screenshotRef.current == null ? t('chat.interactionPanel.mobileDebugPreviewFailed') : current)
    } finally {
      isScreenshotRefreshingRef.current = false
    }
  }, [readyDeviceId, t])

  const refreshElementTree = useCallback(async () => {
    const deviceId = readyDeviceId
    const dumpMobileElementTree = window.oneworksDesktop?.dumpMobileElementTree
    if (deviceId == null || dumpMobileElementTree == null || isElementTreeRefreshingRef.current) return

    isElementTreeRefreshingRef.current = true
    try {
      const treeResult = await dumpMobileElementTree(deviceId)
      setElementTree(treeResult)
      setSelectedNodeId(current =>
        current == null || flattenElementNodes(treeResult.root).some(item => item.node.id === current)
          ? current
          : undefined
      )
    } catch {
      // Keep the previous element tree visible when the platform inspector is temporarily unavailable.
    } finally {
      isElementTreeRefreshingRef.current = false
    }
  }, [readyDeviceId])

  const refreshPreview = useCallback(() => {
    void refreshScreenshot()
    void refreshElementTree()
  }, [refreshElementTree, refreshScreenshot])

  useEffect(() => {
    screenshotRef.current = null
    setScreenshot(null)
    setElementTree(null)
    setSelectedNodeId(undefined)
    setHoverNodeId(undefined)
    setError(null)
    if (readyDeviceId == null) return
    void refreshScreenshot()
    void refreshElementTree()
    const screenshotTimer = window.setInterval(() => void refreshScreenshot(), screenshotRefreshMs)
    return () => window.clearInterval(screenshotTimer)
  }, [readyDeviceId, refreshElementTree, refreshScreenshot])

  const sendInput = useCallback(async (input: DesktopMobileDeviceInputEvent) => {
    const deviceId = readyDeviceId
    const sendMobileDeviceInput = window.oneworksDesktop?.sendMobileDeviceInput
    if (deviceId == null || sendMobileDeviceInput == null) return

    try {
      await sendMobileDeviceInput(deviceId, input)
      window.setTimeout(() => void refreshScreenshot(), 180)
      if (isInspecting) window.setTimeout(() => void refreshElementTree(), 420)
    } catch {
      setError(t('chat.interactionPanel.mobileDebugInputFailed'))
    }
  }, [isInspecting, readyDeviceId, refreshElementTree, refreshScreenshot, t])

  const selectElementAtPoint = useCallback((point: PointerDevicePoint) => {
    setSelectedNodeId(findDeepestNodeAtPoint(elementTree?.root, point)?.id)
  }, [elementTree?.root])

  const hoverElementAtPoint = useCallback((point: PointerDevicePoint) => {
    setHoverNodeId(findDeepestNodeAtPoint(elementTree?.root, point)?.id)
  }, [elementTree?.root])

  if (readyDevice == null) return null
  const screenRatio = screenshot?.width != null && screenshot.height != null && screenshot.height > 0
    ? screenshot.width / screenshot.height
    : undefined

  return (
    <section className='chat-interaction-panel-mobile-debug__preview-section'>
      <div className='chat-interaction-panel-mobile-debug__preview-grid'>
        <InteractionPanelMobileDeviceScreen
          deviceTitle={getDeviceWindowTitle(readyDevice)}
          hoverNode={hoverNode}
          isInspecting={isInspecting}
          screenshot={screenshot}
          selectedNode={selectedNode}
          onHoverPoint={hoverElementAtPoint}
          onInspectPoint={selectElementAtPoint}
          onPointerLeave={() => setHoverNodeId(undefined)}
          onRefresh={() => void refreshPreview()}
          onSendInput={input => void sendInput(input)}
          onToggleInspect={() => {
            setIsInspecting(current => {
              const nextIsInspecting = !current
              if (nextIsInspecting) window.setTimeout(() => void refreshElementTree(), 0)
              return nextIsInspecting
            })
          }}
          screenRatio={screenRatio}
        />
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
                    onSelectNode={setSelectedNodeId}
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
                    onSendInput={input => void sendInput(input)}
                  />
                ),
                key: 'details',
                label: t('chat.interactionPanel.mobileDebugDetails')
              }
            ]}
          />
        </div>
      </div>
    </section>
  )
}
