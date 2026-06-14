import type { TFunction } from 'i18next'
import type { MutableRefObject, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import type { ElectronWebviewElement } from './use-interaction-panel-webview'

export interface InteractionPanelEmbeddedFrameViewportSize {
  height: number
  width: number
}

export function InteractionPanelEmbeddedFrame({
  frameUrl,
  iframeRef,
  onIframeLoad,
  onWebviewAttached,
  page,
  reloadVersion,
  shouldUseWebview,
  t,
  viewportSize,
  webviewRef
}: {
  frameUrl: string
  iframeRef: MutableRefObject<HTMLIFrameElement | null>
  onIframeLoad: () => void
  onWebviewAttached?: () => void
  page: InteractionPanelIframePage
  reloadVersion: number
  shouldUseWebview: boolean
  t: TFunction
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
      <FrameViewport viewportSize={viewportSize}>
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
    <FrameViewport viewportSize={viewportSize}>
      {iframeFrame}
    </FrameViewport>
  )
}

function FrameViewport({
  children,
  viewportSize
}: {
  children: ReactNode
  viewportSize: InteractionPanelEmbeddedFrameViewportSize | null
}) {
  return (
    <div
      className={[
        'chat-interaction-panel__iframe-frame-host',
        viewportSize == null ? '' : 'has-fixed-viewport'
      ].filter(Boolean).join(' ')}
    >
      <div
        className='chat-interaction-panel__iframe-frame-viewport'
        style={viewportSize == null ? undefined : {
          height: viewportSize.height,
          width: viewportSize.width
        }}
      >
        {children}
      </div>
    </div>
  )
}
