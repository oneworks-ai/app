import type { TFunction } from 'i18next'
import type { MutableRefObject } from 'react'
import { useEffect, useState } from 'react'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import type { ElectronWebviewElement } from './use-interaction-panel-webview'

export function InteractionPanelEmbeddedFrame({
  frameUrl,
  iframeRef,
  onIframeLoad,
  page,
  reloadVersion,
  shouldUseWebview,
  t,
  webviewRef
}: {
  frameUrl: string
  iframeRef: MutableRefObject<HTMLIFrameElement | null>
  onIframeLoad: () => void
  page: InteractionPanelIframePage
  reloadVersion: number
  shouldUseWebview: boolean
  t: TFunction
  webviewRef: MutableRefObject<ElectronWebviewElement | null>
}) {
  const [attachedWebviewUrl, setAttachedWebviewUrl] = useState('')

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

    return (
      <webview
        key={page.id}
        ref={webviewRef}
        className='chat-interaction-panel__iframe chat-interaction-panel__webview'
        partition='persist:oneworks-interaction-panel'
        src={attachedWebviewUrl}
        title={page.title}
      />
    )
  }

  return (
    <iframe
      key={`${frameUrl}:${reloadVersion}`}
      ref={iframeRef}
      className='chat-interaction-panel__iframe'
      src={frameUrl}
      title={page.title}
      onLoad={onIframeLoad}
    />
  )
}
