/* eslint-disable max-lines -- Mobile preview controller coordinates screenshot, tree polling, input queueing, and video state. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  MobileDeviceVideoPreviewSize,
  MobileDeviceVideoPreviewStatus
} from './InteractionPanelMobileDeviceVideoCanvas'
import { captureMobileDeviceScreenshot, dumpMobileElementTree, sendMobileDeviceInput } from './mobile-debug-platform'
import {
  elementTreeRefreshDelayMs,
  flattenElementNodes,
  hasElementNodeId,
  iosElementTreeRefreshDelayMs,
  iosScreenshotRefreshDelayMs,
  mergeElementNodeTree,
  screenshotRefreshDelayMs,
  toPhysicalMobileDevicePoint,
  withPhysicalMobileDeviceInput
} from './mobile-device-preview-utils'
import type { PointerDevicePoint } from './mobile-device-preview-utils'
import { queueMobileDeviceTouchInput } from './mobile-device-touch-input-queue'
import { useMobileDeviceElementSelection } from './use-mobile-device-element-selection'

const getInitialVideoStatus = (
  videoSource: DesktopMobileDebugDevice['videoSource'] | undefined
): MobileDeviceVideoPreviewStatus => videoSource === 'screenshot' ? 'unavailable' : 'starting'

const iosElementTreeInputQuietMs = 4200
const iosMjpegReconnectDelayMs = 2500

export const useMobileDevicePreviewController = (
  readyDevice: DesktopMobileDebugDevice | undefined,
  isActive: boolean
) => {
  const { t } = useTranslation()
  const readyDeviceId = readyDevice?.id
  const readyDevicePlatform = readyDevice?.platform
  const videoSource = readyDevice?.videoSource ?? 'scrcpy'
  const [screenshot, setScreenshot] = useState<DesktopMobileDeviceScreenshotResponse | null>(null)
  const [elementTree, setElementTree] = useState<DesktopMobileElementTreeResponse | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [hoverNodeId, setHoverNodeId] = useState<string>()
  const [isInspecting, setIsInspecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [videoStatus, setVideoStatus] = useState<MobileDeviceVideoPreviewStatus>(() =>
    getInitialVideoStatus(videoSource)
  )
  const [videoSize, setVideoSize] = useState<MobileDeviceVideoPreviewSize>()
  const [videoStreamKey, setVideoStreamKey] = useState(0)
  const screenshotRef = useRef<DesktopMobileDeviceScreenshotResponse | null>(null)
  const elementTreeRef = useRef<DesktopMobileElementTreeResponse | null>(null)
  const isScreenshotRefreshingRef = useRef(false)
  const isElementTreeRefreshingRef = useRef(false)
  const elementTreeLoopTimerRef = useRef<number>()
  const screenshotLoopTimerRef = useRef<number>()
  const touchInputQueueRef = useRef<Promise<void>>(Promise.resolve())
  const lastInputRequestedAtRef = useRef(0)
  const lastReadyDeviceIdRef = useRef<string | undefined>()
  const lastVideoSourceRef = useRef<DesktopMobileDebugDevice['videoSource'] | undefined>()
  const shouldUseScreenshotFallback = videoSource === 'screenshot' ||
    (videoStatus === 'unavailable' && readyDevicePlatform !== 'ios')
  const resolvedScreenshotRefreshDelayMs = readyDevicePlatform === 'ios'
    ? iosScreenshotRefreshDelayMs
    : screenshotRefreshDelayMs
  const resolvedElementTreeRefreshDelayMs = readyDevicePlatform === 'ios'
    ? iosElementTreeRefreshDelayMs
    : elementTreeRefreshDelayMs
  const previewFailedMessage = t('chat.interactionPanel.mobileDebugPreviewFailed')
  const flattenedNodes = useMemo(
    () => flattenElementNodes(elementTree?.root).filter(item => item.node.bounds != null),
    [elementTree]
  )
  const refreshScreenshot = useCallback(async () => {
    if (readyDeviceId == null || isScreenshotRefreshingRef.current) return
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
    if (readyDeviceId == null || isElementTreeRefreshingRef.current) return

    isElementTreeRefreshingRef.current = true
    try {
      const treeResult = await dumpMobileElementTree(readyDeviceId)
      if (treeResult.root == null) {
        if (elementTreeRef.current?.root == null) return
        elementTreeRef.current = treeResult
        setElementTree(treeResult)
        setSelectedNodeId(undefined)
        return
      }
      const currentTree = elementTreeRef.current
      const mergedRoot = mergeElementNodeTree(currentTree?.root, treeResult.root)
      if (currentTree != null && mergedRoot === currentTree.root) return
      const nextTree = currentTree == null ? treeResult : { ...treeResult, root: mergedRoot }
      elementTreeRef.current = nextTree
      setElementTree(nextTree)
      setSelectedNodeId(current =>
        current == null || hasElementNodeId(mergedRoot, current)
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
    setVideoStatus(getInitialVideoStatus(videoSource))
    setVideoStreamKey(current => current + 1)
  }, [videoSource])
  const refreshPreview = useCallback(() => {
    if (shouldUseScreenshotFallback) void refreshScreenshot()
    else restartVideoStream()
    void refreshElementTree()
  }, [refreshElementTree, refreshScreenshot, restartVideoStream, shouldUseScreenshotFallback])
  const selectionInputScreen = readyDevice?.screen ?? videoSize ?? screenshot ?? elementTree?.root?.bounds
  const toPhysicalPoint = useCallback((point: PointerDevicePoint) =>
    toPhysicalMobileDevicePoint(point, {
      rootBounds: elementTree?.root?.bounds,
      screen: selectionInputScreen,
      shouldScale: selectionInputScreen != null
    }), [elementTree?.root?.bounds, selectionInputScreen])
  useEffect(() => {
    let isCancelled = false
    const queueNextScreenshot = () => {
      if (isCancelled) return
      screenshotLoopTimerRef.current = window.setTimeout(() => {
        void runScreenshotLoop()
      }, resolvedScreenshotRefreshDelayMs)
    }
    const runElementTreeLoop = () => {
      if (isCancelled || document.visibilityState === 'hidden') return
      if (
        readyDevicePlatform === 'ios' &&
        Date.now() - lastInputRequestedAtRef.current < iosElementTreeInputQuietMs
      ) {
        return
      }
      void refreshElementTree()
    }
    const runScreenshotLoop = async () => {
      await refreshScreenshot()
      queueNextScreenshot()
    }

    if (lastReadyDeviceIdRef.current !== readyDeviceId || lastVideoSourceRef.current !== videoSource) {
      lastReadyDeviceIdRef.current = readyDeviceId
      lastVideoSourceRef.current = videoSource
      screenshotRef.current = null
      elementTreeRef.current = null
      setScreenshot(null)
      setElementTree(null)
      setSelectedNodeId(undefined)
      setHoverNodeId(undefined)
      restartVideoStream()
      setError(null)
    }
    if (readyDeviceId == null || !isActive) return
    if (shouldUseScreenshotFallback) void runScreenshotLoop()
    if (readyDevicePlatform !== 'ios') {
      runElementTreeLoop()
      elementTreeLoopTimerRef.current = window.setInterval(runElementTreeLoop, resolvedElementTreeRefreshDelayMs)
    }
    return () => {
      isCancelled = true
      if (elementTreeLoopTimerRef.current != null) window.clearInterval(elementTreeLoopTimerRef.current)
      if (screenshotLoopTimerRef.current != null) window.clearTimeout(screenshotLoopTimerRef.current)
    }
  }, [
    isActive,
    readyDeviceId,
    readyDevicePlatform,
    refreshElementTree,
    refreshScreenshot,
    resolvedElementTreeRefreshDelayMs,
    resolvedScreenshotRefreshDelayMs,
    restartVideoStream,
    shouldUseScreenshotFallback,
    videoSource
  ])
  useEffect(() => {
    if (
      !isActive ||
      readyDeviceId == null ||
      readyDevicePlatform !== 'ios' ||
      videoSource !== 'mjpeg' ||
      videoStatus !== 'unavailable'
    ) {
      return
    }
    const reconnectTimer = window.setTimeout(() => {
      setError(null)
      restartVideoStream()
    }, iosMjpegReconnectDelayMs)
    return () => window.clearTimeout(reconnectTimer)
  }, [
    isActive,
    readyDeviceId,
    readyDevicePlatform,
    restartVideoStream,
    videoSource,
    videoStatus
  ])
  const sendInputRequest = useCallback(async (input: DesktopMobileDeviceInputEvent) => {
    if (readyDeviceId == null) return

    try {
      lastInputRequestedAtRef.current = Date.now()
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
      // WDA source snapshots can monopolize XCTest for seconds on complex apps.
      // Keep iOS input responsive; users can refresh the tree explicitly when needed.
      if (readyDevicePlatform !== 'ios' && (input.kind !== 'touch' || input.touchPhase === 'up')) {
        window.setTimeout(() => void refreshElementTree(), 420)
        window.setTimeout(() => void refreshElementTree(), 1100)
      }
    } catch {
      if (input.kind !== 'touch') setError(t('chat.interactionPanel.mobileDebugInputFailed'))
    }
  }, [
    elementTree?.root?.bounds,
    readyDeviceId,
    readyDevicePlatform,
    refreshElementTree,
    refreshScreenshot,
    shouldUseScreenshotFallback,
    t,
    videoSize
  ])
  const sendInput = useCallback(
    (input: DesktopMobileDeviceInputEvent) => queueMobileDeviceTouchInput(touchInputQueueRef, input, sendInputRequest),
    [sendInputRequest]
  )
  const toggleInspect = useCallback(() => {
    setIsInspecting(current => {
      const nextIsInspecting = !current
      if (nextIsInspecting) window.setTimeout(() => void refreshElementTree(), 0)
      return nextIsInspecting
    })
  }, [refreshElementTree])
  const cancelInspect = useCallback(() => {
    setIsInspecting(false)
    setHoverNodeId(undefined)
  }, [])
  const clearSelectedElement = useCallback(() => {
    setSelectedNodeId(undefined)
    setHoverNodeId(undefined)
  }, [])
  const handleVideoError = useCallback((message: string) => setError(message || previewFailedMessage), [
    previewFailedMessage
  ])
  const { hoverElementAtPoint, selectElementAtPoint } = useMobileDeviceElementSelection({
    elementTree,
    setHoverNodeId,
    setSelectedNodeId,
    toPhysicalPoint
  })
  const hoverElementById = useCallback((nodeId: string) => {
    if (!flattenedNodes.some(item => item.node.id === nodeId)) return
    setHoverNodeId(nodeId)
  }, [flattenedNodes])
  const inspectElementAtPoint = useCallback((point: PointerDevicePoint) => {
    if (!selectElementAtPoint(point)) return
    setHoverNodeId(undefined)
    setIsInspecting(false)
  }, [selectElementAtPoint])
  const inspectElementById = useCallback((nodeId: string) => {
    if (!flattenedNodes.some(item => item.node.id === nodeId)) return
    setSelectedNodeId(nodeId)
    setHoverNodeId(undefined)
    setIsInspecting(false)
  }, [flattenedNodes])
  return {
    cancelInspect,
    clearSelectedElement,
    elementTree,
    error,
    flattenedNodes,
    handleVideoError,
    hoverElementById,
    hoverElementAtPoint,
    hoverNode: flattenedNodes.find(item => item.node.id === hoverNodeId)?.node,
    isInspecting,
    refreshPreview,
    screenshot,
    selectElementById: inspectElementById,
    selectElementAtPoint: inspectElementAtPoint,
    selectedNode: flattenedNodes.find(item => item.node.id === selectedNodeId)?.node,
    selectedNodeId,
    sendInput,
    setHoverNodeId,
    setSelectedNodeId,
    setVideoSize,
    setVideoStatus,
    toggleInspect,
    videoSize,
    videoSource,
    videoStatus,
    videoStreamKey
  }
}
