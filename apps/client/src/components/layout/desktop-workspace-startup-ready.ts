import { createContext, useContext, useEffect } from 'react'

import type { DesktopWorkspaceStartupReadiness } from '@oneworks/types'

export const DesktopWorkspaceStartupReadyContext = createContext<
  (
    (readiness?: DesktopWorkspaceStartupReadiness) => void
  ) | null
>(null)

interface DesktopWorkspaceStartupReadyOptions {
  readiness?: DesktopWorkspaceStartupReadiness
  visibleSelector?: string
}

const READY_PAINT_FALLBACK_MS = 250

const isElementVisible = (element: Element) => {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false

  const style = window.getComputedStyle(element)
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
}

const hasVisibleElement = (selector: string) => (
  Array.from(document.querySelectorAll(selector)).some(isElementVisible)
)

export function useDesktopWorkspaceStartupReady(
  ready: boolean,
  options: DesktopWorkspaceStartupReadyOptions = {}
) {
  const markReady = useContext(DesktopWorkspaceStartupReadyContext)
  const { readiness = 'editable', visibleSelector } = options

  useEffect(() => {
    if (!ready || markReady == null) return

    let isDisposed = false
    let isDone = false
    let firstFrame: number | null = null
    let secondFrame: number | null = null
    let paintFallbackTimer: number | null = null
    let visibleObserver: MutationObserver | null = null

    const stopWatchingVisibleElement = () => {
      visibleObserver?.disconnect()
      visibleObserver = null
    }

    const markReadyOnce = () => {
      if (isDisposed || isDone) return

      isDone = true
      stopWatchingVisibleElement()
      if (paintFallbackTimer != null) {
        window.clearTimeout(paintFallbackTimer)
        paintFallbackTimer = null
      }
      markReady(readiness)
    }

    const finishAfterPaint = () => {
      if (isDisposed || isDone || firstFrame != null || secondFrame != null) return

      paintFallbackTimer = window.setTimeout(markReadyOnce, READY_PAINT_FALLBACK_MS)
      firstFrame = window.requestAnimationFrame(() => {
        firstFrame = null
        secondFrame = window.requestAnimationFrame(() => {
          secondFrame = null
          markReadyOnce()
        })
      })
    }

    const checkVisibleElement = () => {
      if (visibleSelector != null && !hasVisibleElement(visibleSelector)) return

      finishAfterPaint()
    }

    if (visibleSelector == null) {
      finishAfterPaint()
    } else {
      visibleObserver = new MutationObserver(checkVisibleElement)
      visibleObserver.observe(document.documentElement, {
        attributeFilter: [
          'aria-hidden',
          'class',
          'data-oneworks-sender-editor-ready',
          'data-oneworks-sender-editor-unavailable',
          'hidden',
          'style'
        ],
        attributes: true,
        childList: true,
        subtree: true
      })
      checkVisibleElement()
    }

    return () => {
      isDisposed = true
      stopWatchingVisibleElement()
      if (firstFrame != null) {
        window.cancelAnimationFrame(firstFrame)
      }
      if (secondFrame != null) {
        window.cancelAnimationFrame(secondFrame)
      }
      if (paintFallbackTimer != null) {
        window.clearTimeout(paintFallbackTimer)
      }
    }
  }, [markReady, readiness, ready, visibleSelector])
}
