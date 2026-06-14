import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { usePanelResize } from './use-panel-resize.js'
import { useRouteSidePanelFullscreenState } from './use-route-side-panel-fullscreen-state.js'

export interface RouteContainerSidePanelResizeOptions {
  defaultWidth?: number
  maxWidth?: number
  maxWidthRatio?: number
  minContentWidth?: number
  minWidth?: number
  width?: number
  onWidthChange?: (width: number) => void
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

const SIDE_PANEL_WIDTH = { default: 300, max: 520, min: 240, minContent: 360 } as const

const clampPanelWidth = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

const normalizeMaxWidthRatio = (value: number | undefined) =>
  value == null || !Number.isFinite(value) || value <= 0 ? undefined : Math.min(value, 1)

const readStoredSidePanelWidth = ({
  defaultWidth = SIDE_PANEL_WIDTH.default,
  maxWidth = SIDE_PANEL_WIDTH.max,
  minWidth = SIDE_PANEL_WIDTH.min,
  storageKey
}: RouteContainerSidePanelResizeOptions) => {
  const fallbackWidth = clampPanelWidth(defaultWidth, minWidth, maxWidth)
  if (storageKey == null) return fallbackWidth

  try {
    const storedValue = localStorage.getItem(storageKey)
    const parsedValue = storedValue == null ? Number.NaN : Number(storedValue)
    return Number.isFinite(parsedValue)
      ? clampPanelWidth(parsedValue, minWidth, maxWidth)
      : fallbackWidth
  } catch {
    return fallbackWidth
  }
}

const writeStoredSidePanelWidth = (storageKey: string | undefined, width: number) => {
  if (storageKey == null) return

  try {
    localStorage.setItem(storageKey, String(width))
  } catch {
    // Ignore storage failures; resizing should remain usable.
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
  const fullscreenRenderState = useRouteSidePanelFullscreenState({ isClosing, isFullscreen })
  const minWidth = resize?.minWidth ?? SIDE_PANEL_WIDTH.min
  const minContentWidth = resize?.minContentWidth ?? SIDE_PANEL_WIDTH.minContent
  const configuredMaxWidth = resize?.maxWidth
  const configuredMaxWidthRatio = normalizeMaxWidthRatio(resize?.maxWidthRatio)
  const renderFullscreenShell = fullscreenRenderState !== 'idle'
  const resizeEnabled = resize != null && !isClosing && !renderFullscreenShell

  const resolveMaxWidth = useCallback((containerWidth?: number) => {
    const measuredContainerWidth = containerWidth ?? containerRef.current?.getBoundingClientRect().width
    const contentMaxWidth = measuredContainerWidth == null
      ? configuredMaxWidth ?? SIDE_PANEL_WIDTH.max
      : measuredContainerWidth - minContentWidth
    const ratioMaxWidth = measuredContainerWidth == null || configuredMaxWidthRatio == null
      ? undefined
      : measuredContainerWidth * configuredMaxWidthRatio
    const resolvedMaxWidth = [configuredMaxWidth, ratioMaxWidth, contentMaxWidth]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .reduce((current, value) => Math.min(current, value))

    return Math.max(minWidth, Math.floor(resolvedMaxWidth))
  }, [configuredMaxWidth, configuredMaxWidthRatio, containerRef, minContentWidth, minWidth])

  const [maxWidth, setMaxWidth] = useState(() => resolveMaxWidth())
  const [uncontrolledWidth, setUncontrolledWidth] = useState(() => readStoredSidePanelWidth(resize ?? {}))
  const controlledWidth = resize?.width
  const width = controlledWidth ?? uncontrolledWidth
  const maxWidthRef = useRef(maxWidth)
  const widthRef = useRef(width)
  const setWidth = useCallback((nextWidth: number) => {
    widthRef.current = nextWidth
    if (controlledWidth == null) {
      setUncontrolledWidth(nextWidth)
    }
    resize?.onWidthChange?.(nextWidth)
  }, [controlledWidth, resize?.onWidthChange])

  useEffect(() => {
    widthRef.current = width
  }, [width])

  useEffect(() => {
    if (!resizeEnabled || controlledWidth != null) return

    setWidth(readStoredSidePanelWidth({
      defaultWidth: resize?.defaultWidth,
      maxWidth,
      minWidth,
      storageKey: resize?.storageKey
    }))
  }, [controlledWidth, maxWidth, minWidth, resize?.defaultWidth, resize?.storageKey, resizeEnabled, setWidth])

  useEffect(() => {
    if (!resizeEnabled) return

    const updateMaxWidth = () => {
      const previousMaxWidth = maxWidthRef.current
      const nextMaxWidth = resolveMaxWidth()
      const wasPinnedToMax = widthRef.current >= previousMaxWidth - 1
      const nextWidth = wasPinnedToMax ? nextMaxWidth : clampPanelWidth(widthRef.current, minWidth, nextMaxWidth)

      maxWidthRef.current = nextMaxWidth
      setMaxWidth(nextMaxWidth)
      setWidth(nextWidth)
      if (wasPinnedToMax) writeStoredSidePanelWidth(resize?.storageKey, nextWidth)
    }

    updateMaxWidth()
    const container = containerRef.current
    if (container == null) return

    const resizeObserver = new ResizeObserver(updateMaxWidth)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [containerRef, minWidth, resize?.storageKey, resizeEnabled, resolveMaxWidth, setWidth])

  const commitWidth = useCallback((nextWidth: number) => {
    const resolvedWidth = clampPanelWidth(nextWidth, minWidth, maxWidth)
    setWidth(resolvedWidth)
    writeStoredSidePanelWidth(resize?.storageKey, resolvedWidth)
  }, [maxWidth, minWidth, resize?.storageKey, setWidth])

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
      <div className='route-container-layout__side-panel-content'>{content}</div>
    </aside>
  )
}
