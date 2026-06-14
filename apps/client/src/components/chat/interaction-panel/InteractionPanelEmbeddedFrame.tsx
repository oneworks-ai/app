import type { TFunction } from 'i18next'
import type { MutableRefObject, PointerEvent, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import type { ElectronWebviewElement } from './use-interaction-panel-webview'

export interface InteractionPanelEmbeddedFrameViewportSize {
  height: number
  width: number
}

export type InteractionPanelEmbeddedFrameResizeEdge = 'bottom' | 'left' | 'right' | 'top'

const RULER_MARKS = Array.from({ length: 100 }, (_, index) => (index + 1) * 100)
const MEDIA_QUERY_ROWS = [
  { className: 'is-phone', widths: [320, 375, 390, 414, 430] },
  { className: 'is-tablet', widths: [768, 820, 1024] },
  { className: 'is-desktop', widths: [1280, 1440, 1920, 2560] }
] as const

export function InteractionPanelEmbeddedFrame({
  frameUrl,
  iframeRef,
  isViewportResizing = false,
  onIframeLoad,
  onSelectMediaQuerySize,
  onViewportResizeStart,
  onWebviewAttached,
  page,
  reloadVersion,
  showDeviceFrame = false,
  showMediaQueries = false,
  showRulers = false,
  shouldUseWebview,
  t,
  viewportScale = 1,
  viewportSize,
  webviewRef
}: {
  frameUrl: string
  iframeRef: MutableRefObject<HTMLIFrameElement | null>
  isViewportResizing?: boolean
  onIframeLoad: () => void
  onSelectMediaQuerySize?: (width: number) => void
  onViewportResizeStart?: (
    event: PointerEvent<HTMLDivElement>,
    edge: InteractionPanelEmbeddedFrameResizeEdge
  ) => void
  onWebviewAttached?: () => void
  page: InteractionPanelIframePage
  reloadVersion: number
  showDeviceFrame?: boolean
  showMediaQueries?: boolean
  showRulers?: boolean
  shouldUseWebview: boolean
  t: TFunction
  viewportScale?: number
  viewportSize: InteractionPanelEmbeddedFrameViewportSize | null
  webviewRef: MutableRefObject<ElectronWebviewElement | null>
}) {
  const [attachedWebviewUrl, setAttachedWebviewUrl] = useState('')
  const attachWebviewRef = useCallback((node: ElectronWebviewElement | null) => {
    const previousNode = webviewRef.current
    webviewRef.current = node
    if (node != null && node !== previousNode) onWebviewAttached?.()
  }, [onWebviewAttached, webviewRef])

  useEffect(() => {
    if (!shouldUseWebview || frameUrl === '') {
      setAttachedWebviewUrl('')
      return
    }

    const handle = window.setTimeout(() => {
      setAttachedWebviewUrl(frameUrl)
    }, 0)

    return () => window.clearTimeout(handle)
  }, [frameUrl, shouldUseWebview])

  if (frameUrl === '') {
    return (
      <div className='chat-interaction-panel__iframe-empty'>
        <span className='material-symbols-rounded' aria-hidden='true'>web_asset</span>
        <span>{t('chat.interactionPanel.iframeEmpty')}</span>
      </div>
    )
  }

  if (shouldUseWebview) {
    if (attachedWebviewUrl === '') {
      return (
        <div className='chat-interaction-panel__iframe-empty'>
          <span className='material-symbols-rounded' aria-hidden='true'>web_asset</span>
          <span>{t('chat.interactionPanel.iframeEmpty')}</span>
        </div>
      )
    }

    const webviewFrame = (
      <webview
        key={page.id}
        ref={attachWebviewRef}
        className='chat-interaction-panel__iframe chat-interaction-panel__webview'
        partition='persist:oneworks-interaction-panel'
        src={attachedWebviewUrl}
        title={page.title}
      />
    )

    return (
      <FrameViewport
        isViewportResizing={isViewportResizing}
        showDeviceFrame={showDeviceFrame}
        showMediaQueries={showMediaQueries}
        showRulers={showRulers}
        viewportScale={viewportScale}
        viewportSize={viewportSize}
        onSelectMediaQuerySize={onSelectMediaQuerySize}
        onViewportResizeStart={onViewportResizeStart}
      >
        {webviewFrame}
      </FrameViewport>
    )
  }

  const iframeFrame = (
    <iframe
      key={`${frameUrl}:${reloadVersion}`}
      ref={iframeRef}
      className='chat-interaction-panel__iframe'
      src={frameUrl}
      title={page.title}
      onLoad={onIframeLoad}
    />
  )

  return (
    <FrameViewport
      isViewportResizing={isViewportResizing}
      showDeviceFrame={showDeviceFrame}
      showMediaQueries={showMediaQueries}
      showRulers={showRulers}
      viewportScale={viewportScale}
      viewportSize={viewportSize}
      onSelectMediaQuerySize={onSelectMediaQuerySize}
      onViewportResizeStart={onViewportResizeStart}
    >
      {iframeFrame}
    </FrameViewport>
  )
}

function FrameViewport({
  children,
  isViewportResizing,
  onSelectMediaQuerySize,
  onViewportResizeStart,
  showDeviceFrame,
  showMediaQueries,
  showRulers,
  viewportScale,
  viewportSize
}: {
  children: ReactNode
  isViewportResizing: boolean
  onSelectMediaQuerySize?: (width: number) => void
  onViewportResizeStart?: (
    event: PointerEvent<HTMLDivElement>,
    edge: InteractionPanelEmbeddedFrameResizeEdge
  ) => void
  showDeviceFrame: boolean
  showMediaQueries: boolean
  showRulers: boolean
  viewportScale: number
  viewportSize: InteractionPanelEmbeddedFrameViewportSize | null
}) {
  const scale = viewportSize == null ? 1 : viewportScale
  const resizeEdges = ['top', 'right', 'bottom', 'left'] as const

  return (
    <div
      className={[
        'chat-interaction-panel__iframe-frame-host',
        viewportSize == null ? '' : 'has-fixed-viewport',
        viewportSize != null && showMediaQueries ? 'has-media-queries' : ''
      ].filter(Boolean).join(' ')}
    >
      {viewportSize != null && showMediaQueries && (
        <div className='chat-interaction-panel__iframe-frame-media-queries'>
          {MEDIA_QUERY_ROWS.map(row => (
            <div
              key={row.className}
              className={`chat-interaction-panel__iframe-frame-media-query-row ${row.className}`}
            >
              {row.widths.map(width => (
                <button
                  key={width}
                  type='button'
                  aria-label={`${width}px`}
                  title={`${width}px`}
                  onClick={event => {
                    event.stopPropagation()
                    onSelectMediaQuerySize?.(width)
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {viewportSize == null
        ? (
          <div className='chat-interaction-panel__iframe-frame-viewport'>
            {children}
          </div>
        )
        : (
          <div
            className={[
              'chat-interaction-panel__iframe-frame-viewport-scale-box',
              showDeviceFrame ? 'has-device-frame' : '',
              showRulers ? 'has-rulers' : ''
            ].filter(Boolean).join(' ')}
            style={{
              height: viewportSize.height * scale,
              width: viewportSize.width * scale
            }}
          >
            {showRulers && (
              <>
                <div className='chat-interaction-panel__iframe-frame-ruler is-horizontal' aria-hidden='true'>
                  {RULER_MARKS.map(mark => (
                    <span key={mark} style={{ left: mark * scale }}>{mark}</span>
                  ))}
                </div>
                <div className='chat-interaction-panel__iframe-frame-ruler is-vertical' aria-hidden='true'>
                  {RULER_MARKS.map(mark => (
                    <span key={mark} style={{ top: mark * scale }}>{mark}</span>
                  ))}
                </div>
              </>
            )}
            <div
              className='chat-interaction-panel__iframe-frame-viewport'
              style={{
                height: viewportSize.height,
                transform: `scale(${scale})`,
                width: viewportSize.width
              }}
            >
              {children}
            </div>
            {onViewportResizeStart != null && resizeEdges.map(edge => (
              <div
                key={edge}
                className={`chat-interaction-panel__iframe-frame-resize-handle is-${edge}`}
                data-dock-panel-no-resize='true'
                onPointerDown={event => onViewportResizeStart(event, edge)}
              />
            ))}
          </div>
        )}
      {isViewportResizing && (
        <div
          className='chat-interaction-panel__iframe-frame-resize-overlay'
          data-dock-panel-no-resize='true'
        />
      )}
    </div>
  )
}
