import { App, Button, Dropdown, Tooltip } from 'antd'
import type { MutableRefObject } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelIframeBrowserMenu } from './InteractionPanelIframeBrowserMenu'
import type { ElectronWebviewElement } from './use-interaction-panel-webview'

const copyImageDataUrlToClipboard = async (dataUrl: string) => {
  if (window.oneworksDesktop?.writeImageDataUrlToClipboard != null) {
    await window.oneworksDesktop.writeImageDataUrlToClipboard(dataUrl)
    return
  }

  if (navigator.clipboard?.write == null || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard is unavailable.')
  }

  const response = await fetch(dataUrl)
  const blob = await response.blob()
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

export function InteractionPanelIframeToolbarActions({
  frameUrl,
  iframeRef,
  onForceReload,
  shouldUseWebview,
  webviewRef
}: {
  frameUrl: string
  iframeRef: MutableRefObject<HTMLIFrameElement | null>
  onForceReload: () => void
  shouldUseWebview: boolean
  webviewRef: MutableRefObject<ElectronWebviewElement | null>
}) {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const canUseFrame = frameUrl !== ''

  const notifyUnsupported = () => {
    void message.warning(t('common.notSupportedYet'))
  }

  const handleScreenshot = async () => {
    const webview = webviewRef.current
    if (!shouldUseWebview || webview?.capturePage == null || !canUseFrame) {
      notifyUnsupported()
      return
    }

    try {
      const screenshot = await webview.capturePage()
      const dataUrl = screenshot.toDataURL()
      if (dataUrl.trim() === '') throw new Error('Empty screenshot.')
      await copyImageDataUrlToClipboard(dataUrl)
      void message.success(t('chat.interactionPanel.iframeScreenshotCopied'))
    } catch {
      void message.error(t('chat.interactionPanel.iframeScreenshotFailed'))
    }
  }

  return (
    <div className='chat-interaction-panel__iframe-actions'>
      <Tooltip title={t('chat.interactionPanel.iframeScreenshot')}>
        <Button
          type='text'
          className='chat-interaction-panel__iframe-tool-btn'
          disabled={!canUseFrame}
          aria-label={t('chat.interactionPanel.iframeScreenshot')}
          icon={<span className='material-symbols-rounded'>center_focus_weak</span>}
          onClick={() => void handleScreenshot()}
        />
      </Tooltip>
      <Dropdown
        trigger={['click']}
        open={isMoreOpen}
        menu={{ items: [] }}
        overlayClassName='chat-interaction-panel-browser-menu-dropdown'
        placement='bottomRight'
        popupRender={() => (
          <InteractionPanelIframeBrowserMenu
            canUseFrame={canUseFrame}
            iframeRef={iframeRef}
            shouldUseWebview={shouldUseWebview}
            webviewRef={webviewRef}
            onClose={() => setIsMoreOpen(false)}
            onForceReload={onForceReload}
          />
        )}
        onOpenChange={setIsMoreOpen}
      >
        <Button
          type='text'
          className={`chat-interaction-panel__iframe-tool-btn ${isMoreOpen ? 'is-open' : ''}`}
          aria-label={t('chat.interactionPanel.iframeMore')}
          icon={<span className='material-symbols-rounded'>more_vert</span>}
        />
      </Dropdown>
    </div>
  )
}
