import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useState } from 'react'

import { usePanelResize } from './use-panel-resize.js'
import { useRouteSidePanelFullscreenState } from './use-route-side-panel-fullscreen-state.js'

export interface RouteContainerSidePanelResizeOptions {
  defaultWidth?: number
  maxWidth?: number
  minContentWidth?: number
  minWidth?: number
  resizeHandleAriaLabel?: string
  resizeHandleTitle?: string
  storageKey?: string
}

interface RouteContainerSidePanelProps {
  className: string
  containerRef: RefObject<HTMLDivElement | null>
  content: ReactNode
  isFullscreen?: boolean
  isClosing: boolean
  resize?: RouteContainerSidePanelResizeOptions
}

const DEFAULT_SIDE_PANEL_WIDTH = 300
const MAX_SIDE_PANEL_WIDTH = 520
const MIN_SIDE_PANEL_CONTENT_WIDTH = 360
const MIN_SIDE_PANEL_WIDTH = 240

const clampPanelWidth = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

const readStoredSidePanelWidth = ({
  defaultWidth = DEFAULT_SIDE_PANEL_WIDTH,
  maxWidth = MAX_SIDE_PANEL_WIDTH,
  minWidth = MIN_SIDE_PANEL_WIDTH,
  storageKey
}: RouteContainerSidePanelResizeOptions) => {
  if (storageKey == null) {
    return clampPanelWidth(defaultWidth, minWidth, maxWidth)
  }

  try {
    const storedValue = localStorage.getItem(storageKey)
    if (storedValue == null) {
      return clampPanelWidth(defaultWidth, minWidth, maxWidth)
    }

    const parsedValue = Number(storedValue)
    return Number.isFinite(parsedValue)
      ? clampPanelWidth(parsedValue, minWidth, maxWidth)
      : clampPanelWidth(defaultWidth, minWidth, maxWidth)
  } catch {
    return clampPanelWidth(defaultWidth, minWidth, maxWidth)
  }
}

export function RouteContainerSidePanel({
  className,
  containerRef,
  content,
  isFullscreen = false,
  isClosing,
  resize
}: RouteContainerSidePanelProps) {
  const fullscreenRenderState = useRouteSidePanelFullscreenState({
    isClosing,
    isFullscreen
  })
  const minWidth = resize?.minWidth ?? MIN_SIDE_PANEL_WIDTH
  const minContentWidth = resize?.minContentWidth ?? MIN_SIDE_PANEL_CONTENT_WIDTH
  const configuredMaxWidth = resize?.maxWidth
  const defaultWidth = resize?.defaultWidth ?? DEFAULT_SIDE_PANEL_WIDTH
  const renderFullscreenShell = fullscreenRenderState !== 'idle'
  const resizeEnabled = resize != null && !isClosing && !renderFullscreenShell

  const resolveMaxWidth = useCallback((containerWidth?: number) => {
    const measuredContainerWidth = containerWidth ?? containerRef.current?.getBoundingClientRect().width
    const containerMaxWidth = measuredContainerWidth == null
      ? configuredMaxWidth ?? MAX_SIDE_PANEL_WIDTH
      : measuredContainerWidth - minContentWidth
    const resolvedMaxWidth = configuredMaxWidth == null
      ? containerMaxWidth
      : Math.min(configuredMaxWidth, containerMaxWidth)

    return Math.max(minWidth, Math.floor(resolvedMaxWidth))
  }, [configuredMaxWidth, containerRef, minContentWidth, minWidth])

  const [maxWidth, setMaxWidth] = useState(() => resolveMaxWidth())
  const [width, setWidth] = useState(() => readStoredSidePanelWidth(resize ?? {}))

  useEffect(() => {
    if (!resizeEnabled) return

    setWidth(readStoredSidePanelWidth({
      defaultWidth,
      maxWidth,
      minWidth,
      storageKey: resize?.storageKey
    }))
  }, [defaultWidth, maxWidth, minWidth, resize?.storageKey, resizeEnabled])

  useEffect(() => {
    if (!resizeEnabled) return

    const updateMaxWidth = () => {
      const nextMaxWidth = resolveMaxWidth()
      setMaxWidth(nextMaxWidth)
      setWidth(currentWidth => clampPanelWidth(currentWidth, minWidth, nextMaxWidth))
    }

    updateMaxWidth()
    const container = containerRef.current
    if (container == null) return

    const resizeObserver = new ResizeObserver(updateMaxWidth)
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
    }
  }, [containerRef, minWidth, resizeEnabled, resolveMaxWidth])

  const commitWidth = useCallback((nextWidth: number) => {
    const resolvedWidth = clampPanelWidth(nextWidth, minWidth, maxWidth)
    setWidth(resolvedWidth)

    if (resize?.storageKey == null) return

    try {
      localStorage.setItem(resize.storageKey, String(resolvedWidth))
    } catch {
      // Ignore storage failures; resizing should remain usable.
    }
  }, [maxWidth, minWidth, resize?.storageKey])

  const sideResize = usePanelResize({
    axis: 'x',
    cursor: 'col-resize',
    direction: -1,
    disabled: !resizeEnabled,
    getMaxValue: () => resolveMaxWidth(),
    max: maxWidth,
    min: minWidth,
    onCommit: commitWidth,
    onPreview: setWidth,
    value: width
  })

  const resolvedClassName = [
    className,
    renderFullscreenShell ? 'is-fullscreen' : '',
    fullscreenRenderState === 'entering' ? 'is-fullscreen-entering' : '',
    fullscreenRenderState === 'exiting' ? 'is-fullscreen-exiting' : '',
    isClosing ? 'is-closing' : '',
    sideResize.isResizing ? 'is-resizing' : ''
  ].filter(Boolean).join(' ')
  const style = resize == null
    ? undefined
    : {
      '--route-container-side-panel-max-width': `${maxWidth}px`,
      '--route-container-side-panel-width': `${width}px`
    } as CSSProperties

  return (
    <aside className={resolvedClassName} style={style}>
      {resizeEnabled && (
        <div
          aria-label={resize.resizeHandleAriaLabel ?? 'Resize side panel'}
          className='route-container-layout__side-panel-resize-handle'
          onKeyDown={sideResize.handleKeyDown}
          onPointerDown={sideResize.handlePointerDown}
          role='separator'
          tabIndex={0}
          title={resize.resizeHandleTitle ?? 'Resize side panel'}
        />
      )}
      <div className='route-container-layout__side-panel-content'>
        {content}
      </div>
    </aside>
  )
}
