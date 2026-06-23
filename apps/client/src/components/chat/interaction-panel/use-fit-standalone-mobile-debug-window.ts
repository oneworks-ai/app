import { useEffect, useRef } from 'react'

const standaloneSidePanelMinWidth = 360
const standaloneHeaderTitleMaxWidth = 220
const standaloneHeaderFallbackTrafficWidth = 78
const standaloneFallbackControlsHeight = 30
const standaloneFallbackScreenRatio = 9 / 19.5
const standaloneWindowResizeThreshold = 6

const readCssPixels = (value: string) => {
  const numericValue = Number.parseFloat(value)
  return Number.isFinite(numericValue) ? numericValue : 0
}

const readScreenRatio = (route: HTMLElement) => {
  const screenColumn = route.querySelector<HTMLElement>('.chat-interaction-panel-mobile-debug__screen-column')
  const cssRatio = Number(
    window.getComputedStyle(screenColumn ?? route).getPropertyValue('--mobile-debug-screen-ratio').trim()
  )
  if (Number.isFinite(cssRatio) && cssRatio > 0) return cssRatio

  const canvas = route.querySelector<HTMLCanvasElement>('.chat-interaction-panel-mobile-debug__video-canvas')
  if (canvas != null && canvas.width > 0 && canvas.height > 0) {
    return canvas.width / canvas.height
  }

  return standaloneFallbackScreenRatio
}

interface StandaloneMobileDebugWindowFitOptions {
  hiddenScreenWidth?: number
  hiddenWidthMode?: 'current-window' | 'device'
}

const resolveStandaloneMobileDebugWindowFitSize = (
  options: StandaloneMobileDebugWindowFitOptions = {}
) => {
  const route = document.querySelector<HTMLElement>('.standalone-mobile-debug-route')
  const header = route?.querySelector<HTMLElement>('.standalone-mobile-debug-route__header')
  const body = route?.querySelector<HTMLElement>('.chat-interaction-panel-mobile-debug__body')
  const grid = route?.querySelector<HTMLElement>('.chat-interaction-panel-mobile-debug__preview-grid')
  const deviceWindow = route?.querySelector<HTMLElement>('.chat-interaction-panel-mobile-debug__device-window')
  const deviceControls = route?.querySelector<HTMLElement>('.chat-interaction-panel-mobile-debug__device-controls')
  const sideTabs = route?.querySelector<HTMLElement>('.chat-interaction-panel-mobile-debug__side-tabs')
  if (header == null || body == null || grid == null || deviceWindow == null) return undefined

  const bodyStyle = window.getComputedStyle(body)
  const gridStyle = window.getComputedStyle(grid)
  const bodyHorizontalPadding = readCssPixels(bodyStyle.paddingLeft) + readCssPixels(bodyStyle.paddingRight)
  const gridGap = readCssPixels(gridStyle.columnGap)
  const headerRect = header.getBoundingClientRect()
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
  if (isCurrentSidePanelVisible) {
    const minimumExpandedWidth = Math.ceil(
      Math.max(deviceRect.width + gridGap + sidePanelWidth + bodyHorizontalPadding, headerContentWidth)
    )
    return {
      height: window.innerHeight,
      width: Math.max(window.innerWidth, minimumExpandedWidth)
    }
  }

  const controlsHeight = deviceControls?.getBoundingClientRect().height ?? standaloneFallbackControlsHeight
  const screenWidth = Math.max(
    1,
    options.hiddenScreenWidth ??
      (options.hiddenWidthMode === 'device' ? deviceRect.width : window.innerWidth - bodyHorizontalPadding)
  )
  const screenRatio = readScreenRatio(route)
  return {
    height: Math.ceil(headerRect.height + controlsHeight + screenWidth / screenRatio),
    width: Math.ceil(screenWidth + bodyHorizontalPadding)
  }
}

export const fitStandaloneMobileDebugWindow = (options?: StandaloneMobileDebugWindowFitOptions) => {
  const nextSize = resolveStandaloneMobileDebugWindowFitSize(options)
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
    let resizeTimer: number | undefined
    const scheduleFitWindow = ({ defer = false }: { defer?: boolean } = {}) => {
      if (resizeTimer != null) window.clearTimeout(resizeTimer)
      if (defer) {
        resizeTimer = window.setTimeout(() => {
          resizeTimer = undefined
          scheduleFitWindow()
        }, 80)
        return
      }
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
    const scheduleDeferredFitWindow = () => scheduleFitWindow({ defer: true })
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(
      scheduleDeferredFitWindow
    )
    for (
      const element of document.querySelectorAll<HTMLElement>(
        [
          '.standalone-mobile-debug-route__header',
          '.chat-interaction-panel-mobile-debug__body',
          '.chat-interaction-panel-mobile-debug__device-controls',
          '.chat-interaction-panel-mobile-debug__preview-grid',
          '.chat-interaction-panel-mobile-debug__device-window',
          '.chat-interaction-panel-mobile-debug__screen-column',
          '.chat-interaction-panel-mobile-debug__side-tabs'
        ].join(',')
      )
    ) {
      resizeObserver?.observe(element)
    }
    window.addEventListener('resize', scheduleDeferredFitWindow)
    return () => {
      if (resizeTimer != null) window.clearTimeout(resizeTimer)
      window.clearTimeout(settleTimer)
      window.clearTimeout(finalSettleTimer)
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleDeferredFitWindow)
    }
  }, [isEnabled, isSidePanelVisible, readyDeviceId, videoHeight, videoWidth])
}
