import { App, Button, Dropdown, Tooltip } from 'antd'
import type { MutableRefObject } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { createBrowserActivityRouteState } from '#~/components/browser-activity/browser-activity-route-state'
import { BrowserDataSyncModal } from '#~/components/browser-data-sync/BrowserDataSyncModal'

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
  isDeveloperToolsOpen,
  isViewportToolbarOpen,
  projectUrlHistoryKey,
  onForceReload,
  sessionUrlHistoryKey,
  onToggleDeveloperTools,
  onToggleViewportToolbar,
  shouldUseWebview,
  webviewRef
}: {
  frameUrl: string
  iframeRef: MutableRefObject<HTMLIFrameElement | null>
  isDeveloperToolsOpen: boolean
  isViewportToolbarOpen: boolean
  projectUrlHistoryKey: string
  onForceReload: () => void
  sessionUrlHistoryKey: string
  onToggleDeveloperTools: () => void
  onToggleViewportToolbar: () => void
  shouldUseWebview: boolean
  webviewRef: MutableRefObject<ElectronWebviewElement | null>
}) {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const [browserDataSyncOpen, setBrowserDataSyncOpen] = useState(false)
  const canUseFrame = frameUrl !== ''
  const canOpenBrowserHistory = window.oneworksDesktop?.listBrowserHistory != null
  const canOpenBrowserDownloads = window.oneworksDesktop?.listBrowserDownloads != null

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

  const handleOpenSavedPasswords = () => {
    void navigate('/config/savedPasswords')
  }

  const getBrowserActivityRouteState = () =>
    createBrowserActivityRouteState({
      projectKeys: [projectUrlHistoryKey],
      sessionKey: sessionUrlHistoryKey
    })

  const handleOpenBrowserHistory = () => {
    void navigate('/config/browserHistory', { state: getBrowserActivityRouteState() })
  }

  const handleOpenBrowserDownloads = () => {
    void navigate('/config/browserDownloads', { state: getBrowserActivityRouteState() })
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
            isDeveloperToolsOpen={isDeveloperToolsOpen}
            isViewportToolbarOpen={isViewportToolbarOpen}
            shouldUseWebview={shouldUseWebview}
            webviewRef={webviewRef}
            onClose={() => setIsMoreOpen(false)}
            onForceReload={onForceReload}
            onOpenBrowserDataSync={() => setBrowserDataSyncOpen(true)}
            onOpenBrowserDownloads={canOpenBrowserDownloads ? handleOpenBrowserDownloads : undefined}
            onOpenBrowserHistory={canOpenBrowserHistory ? handleOpenBrowserHistory : undefined}
            onOpenSavedPasswords={handleOpenSavedPasswords}
            onToggleDeveloperTools={onToggleDeveloperTools}
            onToggleViewportToolbar={onToggleViewportToolbar}
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
      <BrowserDataSyncModal
        open={browserDataSyncOpen}
        onClose={() => setBrowserDataSyncOpen(false)}
      />
    </div>
  )
}
