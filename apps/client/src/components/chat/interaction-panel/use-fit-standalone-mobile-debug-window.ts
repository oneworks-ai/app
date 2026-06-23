import { useEffect, useRef } from 'react'

const standaloneSidePanelMinWidth = 360
const standaloneHeaderTitleMaxWidth = 220
const standaloneHeaderFallbackTrafficWidth = 78
const standaloneWindowResizeThreshold = 6

const readCssPixels = (value: string) => {
  const numericValue = Number.parseFloat(value)
  return Number.isFinite(numericValue) ? numericValue : 0
}

const resolveStandaloneMobileDebugWindowFitSize = () => {
  const route = document.querySelector<HTMLElement>('.standalone-mobile-debug-route')
  const header = route?.querySelector<HTMLElement>('.standalone-mobile-debug-route__header')
  const body = route?.querySelector<HTMLElement>('.chat-interaction-panel-mobile-debug__body')
  const grid = route?.querySelector<HTMLElement>('.chat-interaction-panel-mobile-debug__preview-grid')
  const deviceWindow = route?.querySelector<HTMLElement>('.chat-interaction-panel-mobile-debug__device-window')
  const sideTabs = route?.querySelector<HTMLElement>('.chat-interaction-panel-mobile-debug__side-tabs')
  if (header == null || body == null || grid == null || deviceWindow == null) return undefined

  const bodyStyle = window.getComputedStyle(body)
  const gridStyle = window.getComputedStyle(grid)
  const bodyHorizontalPadding = readCssPixels(bodyStyle.paddingLeft) + readCssPixels(bodyStyle.paddingRight)
  const gridGap = readCssPixels(gridStyle.columnGap)
  const headerActions = header.querySelector<HTMLElement>('.standalone-mobile-debug-route__header-actions')
  const trafficSpace = header.querySelector<HTMLElement>('.standalone-mobile-debug-route__traffic-space')
  const title = header.querySelector<HTMLElement>('.standalone-mobile-debug-route__title')
  const headerContentWidth = (trafficSpace?.getBoundingClientRect().width ?? standaloneHeaderFallbackTrafficWidth) +
    Math.min(title?.scrollWidth ?? standaloneHeaderTitleMaxWidth, standaloneHeaderTitleMaxWidth) +
    (headerActions?.getBoundingClientRect().width ?? 0) +
    24
  const deviceRect = deviceWindow.getBoundingClientRect()
  const sideTabsRect = sideTabs?.getBoundingClientRect()
  const sidePanelWidth = Math.max(sideTabsRect?.width ?? 0, standaloneSidePanelMinWidth)
  const isCurrentSidePanelVisible = !grid.classList.contains('is-side-panel-hidden')
  const targetContentWidth = isCurrentSidePanelVisible
    ? deviceRect.width + gridGap + sidePanelWidth
    : deviceRect.width

  return {
    height: window.innerHeight,
    width: Math.ceil(Math.max(targetContentWidth + bodyHorizontalPadding, headerContentWidth))
  }
}

export const fitStandaloneMobileDebugWindow = () => {
  const nextSize = resolveStandaloneMobileDebugWindowFitSize()
  if (nextSize == null) return
  void window.oneworksDesktop?.setCurrentWindowContentSize?.(nextSize).catch(() => undefined)
}

export function useFitStandaloneMobileDebugWindow({
  isEnabled,
  isSidePanelVisible,
  readyDeviceId,
  videoHeight,
  videoWidth
}: {
  isEnabled: boolean
  isSidePanelVisible: boolean
  readyDeviceId?: string
  videoHeight?: number
  videoWidth?: number
}) {
  const fitSizeRef = useRef<{ height: number; width: number }>()

  useEffect(() => {
    if (!isEnabled || readyDeviceId == null) return
    const setWindowContentSize = window.oneworksDesktop?.setCurrentWindowContentSize
    if (setWindowContentSize == null) return

    let animationFrame: number | undefined
    const scheduleFitWindow = () => {
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = undefined
        const nextSize = resolveStandaloneMobileDebugWindowFitSize()
        if (nextSize == null) return
        const previousSize = fitSizeRef.current
        const hasSamePreviousSize = previousSize != null &&
          Math.abs(previousSize.width - nextSize.width) < standaloneWindowResizeThreshold &&
          Math.abs(previousSize.height - nextSize.height) < standaloneWindowResizeThreshold
        const hasSameWindowSize = Math.abs(window.innerWidth - nextSize.width) < standaloneWindowResizeThreshold &&
          Math.abs(window.innerHeight - nextSize.height) < standaloneWindowResizeThreshold
        if (hasSamePreviousSize && hasSameWindowSize) return

        fitSizeRef.current = nextSize
        void setWindowContentSize(nextSize).catch(() => undefined)
      })
    }

    scheduleFitWindow()
    const settleTimer = window.setTimeout(scheduleFitWindow, 120)
    const finalSettleTimer = window.setTimeout(scheduleFitWindow, 320)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleFitWindow)
    for (
      const element of document.querySelectorAll<HTMLElement>(
        [
          '.standalone-mobile-debug-route__header',
          '.chat-interaction-panel-mobile-debug__body',
          '.chat-interaction-panel-mobile-debug__preview-grid',
          '.chat-interaction-panel-mobile-debug__device-window',
          '.chat-interaction-panel-mobile-debug__side-tabs'
        ].join(',')
      )
    ) {
      resizeObserver?.observe(element)
    }
    window.addEventListener('resize', scheduleFitWindow)
    return () => {
      window.clearTimeout(settleTimer)
      window.clearTimeout(finalSettleTimer)
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleFitWindow)
    }
  }, [isEnabled, isSidePanelVisible, readyDeviceId, videoHeight, videoWidth])
}
