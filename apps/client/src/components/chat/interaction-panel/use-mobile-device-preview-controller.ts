import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  MobileDeviceVideoPreviewSize,
  MobileDeviceVideoPreviewStatus
} from './InteractionPanelMobileDeviceVideoCanvas'
import {
  findDeepestNodeAtPoint,
  flattenElementNodes,
  screenshotRefreshDelayMs,
  toPhysicalMobileDevicePoint,
  withPhysicalMobileDeviceInput
} from './mobile-device-preview-utils'
import type { PointerDevicePoint } from './mobile-device-preview-utils'
export const useMobileDevicePreviewController = (readyDeviceId: string | undefined) => {
  const { t } = useTranslation()
  const [screenshot, setScreenshot] = useState<DesktopMobileDeviceScreenshotResponse | null>(null)
  const [elementTree, setElementTree] = useState<DesktopMobileElementTreeResponse | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [hoverNodeId, setHoverNodeId] = useState<string>()
  const [isInspecting, setIsInspecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [videoStatus, setVideoStatus] = useState<MobileDeviceVideoPreviewStatus>('starting')
  const [videoSize, setVideoSize] = useState<MobileDeviceVideoPreviewSize>()
  const [videoStreamKey, setVideoStreamKey] = useState(0)
  const screenshotRef = useRef<DesktopMobileDeviceScreenshotResponse | null>(null)
  const isScreenshotRefreshingRef = useRef(false)
  const isElementTreeRefreshingRef = useRef(false)
  const screenshotLoopTimerRef = useRef<number>()
  const lastReadyDeviceIdRef = useRef<string | undefined>()
  const shouldUseScreenshotFallback = videoStatus === 'unavailable'
  const previewFailedMessage = t('chat.interactionPanel.mobileDebugPreviewFailed')
  const flattenedNodes = useMemo(
    () => flattenElementNodes(elementTree?.root).filter(item => item.node.bounds != null),
    [elementTree]
  )
  const refreshScreenshot = useCallback(async () => {
    const captureMobileDeviceScreenshot = window.oneworksDesktop?.captureMobileDeviceScreenshot
    if (readyDeviceId == null || captureMobileDeviceScreenshot == null || isScreenshotRefreshingRef.current) return

    isScreenshotRefreshingRef.current = true
    try {
      const nextScreenshot = await captureMobileDeviceScreenshot(readyDeviceId)
      screenshotRef.current = nextScreenshot
      setScreenshot(nextScreenshot)
      setError(null)
    } catch {
      setError(current => screenshotRef.current == null ? previewFailedMessage : current)
    } finally {
      isScreenshotRefreshingRef.current = false
    }
  }, [previewFailedMessage, readyDeviceId])
  const refreshElementTree = useCallback(async () => {
    const dumpMobileElementTree = window.oneworksDesktop?.dumpMobileElementTree
    if (readyDeviceId == null || dumpMobileElementTree == null || isElementTreeRefreshingRef.current) return

    isElementTreeRefreshingRef.current = true
    try {
      const treeResult = await dumpMobileElementTree(readyDeviceId)
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
  const restartVideoStream = useCallback(() => {
    setVideoSize(undefined)
    setVideoStatus('starting')
    setVideoStreamKey(current => current + 1)
  }, [])
  const refreshPreview = useCallback(() => {
    if (shouldUseScreenshotFallback) void refreshScreenshot()
    else restartVideoStream()
    void refreshElementTree()
  }, [refreshElementTree, refreshScreenshot, restartVideoStream, shouldUseScreenshotFallback])
  const toPhysicalPoint = useCallback((point: PointerDevicePoint) =>
    toPhysicalMobileDevicePoint(point, {
      rootBounds: elementTree?.root?.bounds,
      screen: videoSize,
      shouldScale: !shouldUseScreenshotFallback
    }), [elementTree?.root?.bounds, shouldUseScreenshotFallback, videoSize])
  useEffect(() => {
    let isCancelled = false
    const queueNextScreenshot = () => {
      if (isCancelled) return
      screenshotLoopTimerRef.current = window.setTimeout(() => {
        void runScreenshotLoop()
      }, screenshotRefreshDelayMs)
    }
    const runScreenshotLoop = async () => {
      await refreshScreenshot()
      queueNextScreenshot()
    }

    if (lastReadyDeviceIdRef.current !== readyDeviceId) {
      lastReadyDeviceIdRef.current = readyDeviceId
      screenshotRef.current = null
      setScreenshot(null)
      setElementTree(null)
      setSelectedNodeId(undefined)
      setHoverNodeId(undefined)
      restartVideoStream()
      setError(null)
    }
    if (readyDeviceId == null) return
    if (!shouldUseScreenshotFallback) {
      void refreshElementTree()
      return
    }
    void runScreenshotLoop()
    void refreshElementTree()
    return () => {
      isCancelled = true
      if (screenshotLoopTimerRef.current != null) window.clearTimeout(screenshotLoopTimerRef.current)
    }
  }, [readyDeviceId, refreshElementTree, refreshScreenshot, restartVideoStream, shouldUseScreenshotFallback])
  const sendInput = useCallback(async (input: DesktopMobileDeviceInputEvent) => {
    const sendMobileDeviceInput = window.oneworksDesktop?.sendMobileDeviceInput
    if (readyDeviceId == null || sendMobileDeviceInput == null) return

    try {
      await sendMobileDeviceInput(
        readyDeviceId,
        withPhysicalMobileDeviceInput(input, {
          rootBounds: elementTree?.root?.bounds,
          screen: videoSize,
          shouldScale: !shouldUseScreenshotFallback
        })
      )
      if (shouldUseScreenshotFallback) {
        window.setTimeout(() => void refreshScreenshot(), 180)
      }
      if (isInspecting) window.setTimeout(() => void refreshElementTree(), 420)
    } catch {
      setError(t('chat.interactionPanel.mobileDebugInputFailed'))
    }
  }, [
    isInspecting,
    elementTree?.root?.bounds,
    readyDeviceId,
    refreshElementTree,
    refreshScreenshot,
    shouldUseScreenshotFallback,
    t,
    videoSize
  ])
  const toggleInspect = useCallback(() => {
    setIsInspecting(current => {
      const nextIsInspecting = !current
      if (nextIsInspecting) window.setTimeout(() => void refreshElementTree(), 0)
      return nextIsInspecting
    })
  }, [refreshElementTree])
  const handleVideoError = useCallback((message: string) => {
    setError(message || previewFailedMessage)
  }, [previewFailedMessage])
  const hoverElementAtPoint = useCallback((point: PointerDevicePoint) => {
    setHoverNodeId(findDeepestNodeAtPoint(elementTree?.root, toPhysicalPoint(point))?.id)
  }, [elementTree?.root, toPhysicalPoint])
  const selectElementAtPoint = useCallback((point: PointerDevicePoint) => {
    setSelectedNodeId(findDeepestNodeAtPoint(elementTree?.root, toPhysicalPoint(point))?.id)
  }, [elementTree?.root, toPhysicalPoint])
  return {
    elementTree,
    error,
    flattenedNodes,
    handleVideoError,
    hoverElementAtPoint,
    hoverNode: flattenedNodes.find(item => item.node.id === hoverNodeId)?.node,
    isInspecting,
    refreshPreview,
    screenshot,
    selectElementAtPoint,
    selectedNode: flattenedNodes.find(item => item.node.id === selectedNodeId)?.node,
    selectedNodeId,
    sendInput,
    setHoverNodeId,
    setSelectedNodeId,
    setVideoSize,
    setVideoStatus,
    toggleInspect,
    videoSize,
    videoStatus,
    videoStreamKey
  }
}
