/* eslint-disable max-lines -- bottom dock shell owns resize, fullscreen, minimize height, and motion coordination together. */
import './DockPanel.scss'

import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePanelResize } from '#~/hooks/use-panel-resize'

import type { DockPanelProps } from './DockPanel.types'
import { DockPanelHeader } from './DockPanelHeader'
import { useDockPanelFullscreen } from './use-dock-panel-fullscreen'

const DEFAULT_PANEL_HEIGHT = 240
const DEFAULT_PANEL_MIN_HEIGHT = 180
const DOCK_PANEL_ENTER_MOTION_MS = 240

const clampPanelHeight = (height: number, minHeight: number, maxHeight: number) =>
  Math.min(Math.max(height, minHeight), Math.max(minHeight, maxHeight))

const resolvePanelMinHeight = (minHeight: DockPanelProps['minHeight'], containerHeight: number | null) => {
  if (typeof minHeight === 'number') return minHeight

  const percentMatch = minHeight?.trim().match(/^(\d+(?:\.\d+)?)%$/)
  if (percentMatch == null) return DEFAULT_PANEL_MIN_HEIGHT
  if (containerHeight == null) return 0

  return Math.max(0, Math.round(containerHeight * Number(percentMatch[1]) / 100))
}

const toCssLength = (value: NonNullable<DockPanelProps['minimizedHeight']>) =>
  typeof value === 'number' ? `${value}px` : value

const shouldIgnoreResizePointerDown = (target: HTMLElement | null) =>
  target?.closest(
    'button, a, input, textarea, select, option, [role="button"], [data-dock-panel-no-resize="true"]'
  ) != null

export function DockPanel({
  enterMotion = 'slide-up',
  allowResize = true,
  allowFullscreen = false,
  children,
  className,
  closeIcon,
  closeLabel,
  defaultHeight = DEFAULT_PANEL_HEIGHT,
  footer,
  fullscreenEnterLabel,
  fullscreenExitLabel,
  fullscreenMinimizedIcon,
  fullscreenMinimizedLabel,
  hideHeader = false,
  isMinimized = false,
  isResizeDisabled = false,
  isOpen = true,
  maxHeight = 520,
  meta,
  minimizedHeight,
  minHeight = DEFAULT_PANEL_MIN_HEIGHT,
  onClose,
  onExpandMinimized,
  resizeLabel,
  storageKey,
  title,
  actions
}: DockPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const { isFullscreen, isFullscreenExiting, toggleFullscreen } = useDockPanelFullscreen()
  const effectiveFullscreen = isFullscreen && !isMinimized
  const [containerHeight, setContainerHeight] = useState<number | null>(null)
  const effectiveMinHeight = useMemo(() => resolvePanelMinHeight(minHeight, containerHeight), [
    containerHeight,
    minHeight
  ])
  const [isEntering, setIsEntering] = useState(() => isOpen && enterMotion === 'slide-up')
  const previousIsOpenRef = useRef(isOpen)
  const [panelHeight, setPanelHeight] = useState(() => {
    const storedHeight = Number(localStorage.getItem(storageKey))
    const initialMinHeight = resolvePanelMinHeight(minHeight, null)
    return Number.isFinite(storedHeight) && storedHeight > 0
      ? clampPanelHeight(storedHeight, initialMinHeight, maxHeight)
      : clampPanelHeight(defaultHeight, initialMinHeight, maxHeight)
  })
  const pendingPanelHeightRef = useRef(panelHeight)
  const resizeEnabled = allowResize && !isResizeDisabled && !isMinimized && !effectiveFullscreen

  useEffect(() => {
    const wasOpen = previousIsOpenRef.current
    previousIsOpenRef.current = isOpen

    if (!isOpen || enterMotion !== 'slide-up') {
      setIsEntering(false)
      return
    }

    if (!wasOpen) {
      setIsEntering(true)
    }
  }, [enterMotion, isOpen])

  useEffect(() => {
    if (!isEntering) return undefined

    const timeoutId = window.setTimeout(() => setIsEntering(false), DOCK_PANEL_ENTER_MOTION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [isEntering])

  const readContainerHeight = useCallback(() => {
    const parent = panelRef.current?.parentElement
    const nextHeight = parent?.getBoundingClientRect().height
    return nextHeight != null && Number.isFinite(nextHeight) ? Math.max(0, nextHeight) : null
  }, [])

  useEffect(() => {
    const updateContainerHeight = () => setContainerHeight(readContainerHeight())
    updateContainerHeight()

    const parent = panelRef.current?.parentElement
    if (parent == null || typeof ResizeObserver === 'undefined') return undefined

    const resizeObserver = new ResizeObserver(updateContainerHeight)
    resizeObserver.observe(parent)
    return () => resizeObserver.disconnect()
  }, [readContainerHeight])

  useEffect(() => {
    pendingPanelHeightRef.current = panelHeight
    localStorage.setItem(storageKey, String(panelHeight))
  }, [panelHeight, storageKey])

  useEffect(() => {
    setPanelHeight(currentHeight => {
      const nextHeight = clampPanelHeight(currentHeight, effectiveMinHeight, maxHeight)
      if (nextHeight === currentHeight) return currentHeight

      pendingPanelHeightRef.current = nextHeight
      panelRef.current?.style.setProperty('--dock-panel-height', `${nextHeight}px`)
      panelRef.current?.style.removeProperty('--dock-panel-resize-height')
      return nextHeight
    })
  }, [effectiveMinHeight, maxHeight])

  const getResizeMaxHeight = useCallback(() => {
    const parentHeight = readContainerHeight()

    return parentHeight != null ? Math.min(maxHeight, parentHeight - 96) : maxHeight
  }, [maxHeight, readContainerHeight])

  const getResizeStartHeight = useCallback(() => panelRef.current?.getBoundingClientRect().height ?? panelHeight, [
    panelHeight
  ])

  const previewPanelHeight = useCallback((nextHeight: number) => {
    pendingPanelHeightRef.current = nextHeight
    panelRef.current?.style.setProperty('--dock-panel-resize-height', `${nextHeight}px`)
  }, [])

  const commitPanelHeight = useCallback((nextHeight: number) => {
    pendingPanelHeightRef.current = nextHeight
    panelRef.current?.style.setProperty('--dock-panel-height', `${nextHeight}px`)
    panelRef.current?.style.removeProperty('--dock-panel-resize-height')
    setPanelHeight(nextHeight)
  }, [])

  const panelResize = usePanelResize({
    axis: 'y',
    cursor: 'row-resize',
    direction: -1,
    disabled: !resizeEnabled,
    getMaxValue: getResizeMaxHeight,
    getStartValue: getResizeStartHeight,
    max: maxHeight,
    min: effectiveMinHeight,
    value: panelHeight,
    onCommit: commitPanelHeight,
    onPreview: previewPanelHeight,
    onResizeStart: previewPanelHeight,
    shouldIgnorePointerDown: shouldIgnoreResizePointerDown
  })

  const handleToggleFullscreen = () => {
    if (isMinimized) {
      onExpandMinimized?.()
    }

    toggleFullscreen()
  }
  const shouldShowFullscreenAction = allowFullscreen || (isMinimized && onExpandMinimized != null)
  const bodyContent = typeof children === 'function'
    ? children({ isFullscreen: effectiveFullscreen, onToggleFullscreen: handleToggleFullscreen })
    : children

  const panelStyle = useMemo(
    () => ({
      '--dock-panel-height': `${panelHeight}px`,
      '--dock-panel-max-height': `${maxHeight}px`,
      '--dock-panel-min-height': `${effectiveMinHeight}px`,
      ...(minimizedHeight == null ? {} : { '--dock-panel-minimized-height': toCssLength(minimizedHeight) })
    }),
    [effectiveMinHeight, maxHeight, minimizedHeight, panelHeight]
  )

  return (
    <div
      ref={panelRef}
      className={`dock-panel ${isEntering ? 'is-entering-slide-up' : ''} ${isOpen ? 'is-open' : 'is-closing'} ${
        className ?? ''
      } ${panelResize.isResizing ? 'is-resizing' : ''} ${isMinimized ? 'is-minimized' : ''} ${
        resizeEnabled ? 'is-resizable' : 'is-static'
      } ${isResizeDisabled || isMinimized || effectiveFullscreen ? 'is-resize-disabled' : ''} ${
        effectiveFullscreen ? 'is-fullscreen' : ''
      } ${isFullscreenExiting ? 'is-fullscreen-exiting' : ''}`}
      style={panelStyle as CSSProperties}
    >
      {resizeEnabled && (
        <div
          className='dock-panel__resize-strip'
          role='separator'
          aria-label={resizeLabel}
          aria-orientation='horizontal'
          aria-valuemin={effectiveMinHeight}
          aria-valuemax={maxHeight}
          aria-valuenow={panelHeight}
          tabIndex={0}
          title={resizeLabel}
          onPointerDown={panelResize.handlePointerDown}
          onKeyDown={panelResize.handleKeyDown}
        />
      )}
      {!hideHeader && (
        <DockPanelHeader
          actions={actions}
          closeIcon={closeIcon}
          closeLabel={closeLabel}
          fullscreenEnterLabel={fullscreenEnterLabel}
          fullscreenExitLabel={fullscreenExitLabel}
          fullscreenMinimizedIcon={fullscreenMinimizedIcon}
          fullscreenMinimizedLabel={fullscreenMinimizedLabel}
          isFullscreen={effectiveFullscreen}
          isMinimized={isMinimized}
          meta={meta}
          title={title}
          onClose={onClose}
          onToggleFullscreen={shouldShowFullscreenAction ? handleToggleFullscreen : undefined}
        />
      )}
      <div className='dock-panel__body'>{bodyContent}</div>
      {footer != null && <div className='dock-panel__footer'>{footer}</div>}
    </div>
  )
}
