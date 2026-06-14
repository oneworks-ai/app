import { App } from 'antd'
import type { MutableRefObject } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { OverlayAction, OverlayDivider, OverlayPanel } from '#~/components/overlay'

import type { ElectronWebviewElement } from './use-interaction-panel-webview'

const MIN_ZOOM_FACTOR = 0.25
const MAX_ZOOM_FACTOR = 3
const ZOOM_STEP = 0.1

const clampZoomFactor = (value: number) => Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, value))

const formatZoomPercent = (value: number) => `${Math.round(value * 100)}%`

export function InteractionPanelIframeBrowserMenu({
  canUseFrame,
  iframeRef,
  isViewportToolbarOpen,
  onClose,
  onForceReload,
  onToggleViewportToolbar,
  shouldUseWebview,
  webviewRef
}: {
  canUseFrame: boolean
  iframeRef: MutableRefObject<HTMLIFrameElement | null>
  isViewportToolbarOpen: boolean
  onClose: () => void
  onForceReload: () => void
  onToggleViewportToolbar: () => void
  shouldUseWebview: boolean
  webviewRef: MutableRefObject<ElectronWebviewElement | null>
}) {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const [zoomFactor, setZoomFactor] = useState(1)

  const notifyUnsupported = () => {
    void message.warning(t('common.notSupportedYet'))
  }

  const applyZoomFactor = (nextZoomFactor: number) => {
    const normalizedZoomFactor = clampZoomFactor(nextZoomFactor)
    setZoomFactor(normalizedZoomFactor)
    try {
      webviewRef.current?.setZoomFactor?.(normalizedZoomFactor)
    } catch {
      iframeRef.current?.style.setProperty('zoom', String(normalizedZoomFactor))
    }
    iframeRef.current?.style.setProperty('zoom', String(normalizedZoomFactor))
  }

  const handleForceReload = () => {
    onClose()
    try {
      if (shouldUseWebview && webviewRef.current?.reloadIgnoringCache != null) {
        webviewRef.current.reloadIgnoringCache()
        return
      }
    } catch {
      // Fall through to the existing reload path.
    }
    onForceReload()
  }

  const handleToggleViewportToolbar = () => {
    onToggleViewportToolbar()
    onClose()
  }

  const clearWebviewData = async (dataType: 'cache' | 'cookies') => {
    if (window.oneworksDesktop?.clearInteractionPanelWebviewData == null) {
      notifyUnsupported()
      return
    }

    try {
      await window.oneworksDesktop.clearInteractionPanelWebviewData(dataType)
      void message.success(
        t(
          dataType === 'cookies'
            ? 'chat.interactionPanel.iframeClearCookieSuccess'
            : 'chat.interactionPanel.iframeClearCacheSuccess'
        )
      )
      onClose()
    } catch {
      void message.error(t('common.operationFailed'))
    }
  }

  const syncZoomFactor = () => {
    try {
      const currentZoom = webviewRef.current?.getZoomFactor?.()
      if (typeof currentZoom === 'number' && Number.isFinite(currentZoom)) {
        setZoomFactor(clampZoomFactor(currentZoom))
      }
    } catch {
      setZoomFactor(1)
    }
  }

  return (
    <OverlayPanel
      className='chat-interaction-panel-browser-menu'
      onClick={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onPointerEnter={syncZoomFactor}
    >
      <OverlayAction
        className='chat-interaction-panel-browser-menu__item'
        disabled={!canUseFrame}
        onClick={handleForceReload}
      >
        <span className='material-symbols-rounded chat-interaction-panel__menu-icon'>refresh</span>
        <span>{t('chat.interactionPanel.iframeForceReload')}</span>
      </OverlayAction>
      <OverlayAction
        className={`chat-interaction-panel-browser-menu__item ${isViewportToolbarOpen ? 'is-active' : ''}`}
        disabled={!canUseFrame}
        onClick={handleToggleViewportToolbar}
      >
        <span className='material-symbols-rounded chat-interaction-panel__menu-icon'>devices</span>
        <span>{t('chat.interactionPanel.iframeViewportToolbar')}</span>
      </OverlayAction>
      <OverlayDivider className='chat-interaction-panel-browser-menu__divider' decorative />
      <div className='chat-interaction-panel-browser-menu__zoom-row'>
        <span className='chat-interaction-panel-browser-menu__zoom-label'>
          {t('chat.interactionPanel.iframeZoom')}
        </span>
        <span className='chat-interaction-panel-browser-menu__zoom-controls'>
          <button
            type='button'
            className='chat-interaction-panel-browser-menu__zoom-btn material-symbols-rounded'
            aria-label={t('chat.interactionPanel.iframeZoomOut')}
            onClick={() => applyZoomFactor(zoomFactor - ZOOM_STEP)}
          >
            remove
          </button>
          <span className='chat-interaction-panel-browser-menu__zoom-value'>{formatZoomPercent(zoomFactor)}</span>
          <button
            type='button'
            className='chat-interaction-panel-browser-menu__zoom-btn material-symbols-rounded'
            aria-label={t('chat.interactionPanel.iframeZoomIn')}
            onClick={() => applyZoomFactor(zoomFactor + ZOOM_STEP)}
          >
            add
          </button>
        </span>
        <button
          type='button'
          className='chat-interaction-panel-browser-menu__zoom-reset material-symbols-rounded'
          aria-label={t('chat.interactionPanel.iframeZoomReset')}
          onClick={() => applyZoomFactor(1)}
        >
          restart_alt
        </button>
      </div>
      <OverlayDivider className='chat-interaction-panel-browser-menu__divider' decorative />
      <OverlayAction
        className='chat-interaction-panel-browser-menu__item'
        onClick={() => void clearWebviewData('cookies')}
      >
        <span className='material-symbols-rounded chat-interaction-panel__menu-icon'>cookie</span>
        <span>{t('chat.interactionPanel.iframeClearCookie')}</span>
      </OverlayAction>
      <OverlayAction
        className='chat-interaction-panel-browser-menu__item'
        onClick={() => void clearWebviewData('cache')}
      >
        <span className='material-symbols-rounded chat-interaction-panel__menu-icon'>cached</span>
        <span>{t('chat.interactionPanel.iframeClearCache')}</span>
      </OverlayAction>
    </OverlayPanel>
  )
}
