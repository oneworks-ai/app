/* eslint-disable max-lines -- iframe view coordinates URL state, navigation controls, and webview lifecycle. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { readWebpageMetadata } from '#~/api/webpage'
import { addDesktopViewShortcutListener } from '#~/desktop/view-shortcuts'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'

import { InteractionPanelEmbeddedFrame } from './InteractionPanelEmbeddedFrame'
import { InteractionPanelIframeAddressBar } from './InteractionPanelIframeAddressBar'
import { InteractionPanelIframeNavigation } from './InteractionPanelIframeNavigation'
import { InteractionPanelIframeToolbarActions } from './InteractionPanelIframeToolbarActions'
import { readIframeDocumentMetadata } from './interaction-panel-iframe-metadata'
import { getIframePageHostTitle, normalizeFrameUrl } from './interaction-panel-iframe-pages'
import { normalizeWebviewUrlForCompare } from './interaction-panel-webview-navigation'
import { useInteractionPanelUrlHistory } from './use-interaction-panel-url-history'
import { useInteractionPanelWebview } from './use-interaction-panel-webview'
import type { ElectronWebviewElement } from './use-interaction-panel-webview'

export type InteractionPanelIframePageVariant = 'mobile-debug-devtools'

export interface InteractionPanelIframePage {
  faviconUrl?: string
  history?: string[]
  historyIndex?: number
  id: string
  title: string
  url: string
  variant?: InteractionPanelIframePageVariant
}

export function InteractionPanelIframeView({
  isActive,
  onChangeMetadata,
  onNavigateHistory,
  onSelectHistory,
  onChangeUrl,
  page,
  projectUrlHistoryKey,
  sessionUrlHistoryKey
}: {
  isActive: boolean
  onChangeMetadata: (pageId: string, metadata: { faviconUrl?: string; title?: string }) => void
  onNavigateHistory: (pageId: string, delta: -1 | 1) => void
  onSelectHistory: (pageId: string, index: number) => void
  onChangeUrl: (pageId: string, url: string) => void
  page: InteractionPanelIframePage
  projectUrlHistoryKey: string
  sessionUrlHistoryKey: string
}) {
  const { t } = useTranslation()
  const { resolvedThemeMode } = useResolvedThemeMode()
  const [draftUrl, setDraftUrl] = useState(page.url)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [webviewFrameUrl, setWebviewFrameUrl] = useState(() => normalizeFrameUrl(page.url))
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const webviewRef = useRef<ElectronWebviewElement | null>(null)
  const onChangeMetadataRef = useRef(onChangeMetadata)
  const { history: urlHistory, record: recordUrlHistory } = useInteractionPanelUrlHistory({
    projectKey: projectUrlHistoryKey,
    sessionKey: sessionUrlHistoryKey
  })
  const frameUrl = useMemo(() => normalizeFrameUrl(page.url), [page.url])
  const isMobileDebugDevtools = page.variant === 'mobile-debug-devtools'
  const webview = useInteractionPanelWebview({
    frameUrl,
    isMobileDebugDevtools,
    onChangeMetadata,
    onChangeUrl,
    pageId: page.id,
    recordUrlHistory,
    resolvedThemeMode,
    webviewRef
  })
  const history = page.history ?? []
  const historyIndex = page.historyIndex ?? history.length - 1
  const iframeCanGoBack = historyIndex > 0
  const iframeCanGoForward = historyIndex >= 0 && historyIndex < history.length - 1
  const canGoBack = webview.shouldUseWebview ? webview.canGoBack || iframeCanGoBack : iframeCanGoBack
  const canGoForward = webview.shouldUseWebview ? webview.canGoForward || iframeCanGoForward : iframeCanGoForward
  const normalizedDraftUrl = useMemo(() => normalizeFrameUrl(draftUrl), [draftUrl])
  const isEditingUrl = normalizedDraftUrl !== frameUrl
  const externalUrl = normalizedDraftUrl !== '' ? normalizedDraftUrl : frameUrl
  const embeddedFrameUrl = webview.shouldUseWebview ? webviewFrameUrl : frameUrl
  const shouldHideToolbar = webview.shouldUseWebview && isMobileDebugDevtools

  useEffect(() => {
    setDraftUrl(page.url)
  }, [page.url])

  useEffect(() => {
    if (!webview.shouldUseWebview) return
    if (frameUrl === '') {
      setWebviewFrameUrl('')
      return
    }

    let currentWebviewUrl = ''
    try {
      currentWebviewUrl = webviewRef.current?.getURL() ?? ''
    } catch {
      currentWebviewUrl = ''
    }
    if (
      normalizeWebviewUrlForCompare(currentWebviewUrl) === normalizeWebviewUrlForCompare(frameUrl)
    ) {
      return
    }

    setWebviewFrameUrl(frameUrl)
  }, [frameUrl, webview.shouldUseWebview])

  useEffect(() => {
    onChangeMetadataRef.current = onChangeMetadata
  }, [onChangeMetadata])

  useEffect(() => {
    if (frameUrl === '' || webview.shouldUseWebview) {
      return
    }

    const abortController = new AbortController()
    void readWebpageMetadata(frameUrl, { signal: abortController.signal })
      .then(metadata => {
        const nextMetadata: { faviconUrl?: string; title?: string } = {}
        if (metadata.faviconUrl != null) nextMetadata.faviconUrl = metadata.faviconUrl
        if (metadata.title != null) nextMetadata.title = metadata.title
        onChangeMetadataRef.current(page.id, nextMetadata)
        recordUrlHistory({ url: frameUrl, ...nextMetadata })
      })
      .catch(() => undefined)
    return () => abortController.abort()
  }, [frameUrl, page.id, recordUrlHistory, webview.shouldUseWebview])

  const handleOpen = (event?: KeyboardEvent<HTMLInputElement>) => {
    if (!isEditingUrl) {
      event?.currentTarget.blur()
      return
    }

    onChangeUrl(page.id, normalizedDraftUrl)
    recordUrlHistory({
      url: normalizedDraftUrl,
      title: getIframePageHostTitle(normalizedDraftUrl, normalizedDraftUrl)
    })
    event?.currentTarget.blur()
  }
  const handleRefresh = () => {
    if (webview.shouldUseWebview) {
      webviewRef.current?.reload()
      return
    }

    try {
      iframeRef.current?.contentWindow?.location.reload()
    } catch {
      setReloadVersion(current => current + 1)
    }
  }

  useEffect(() =>
    addDesktopViewShortcutListener((action) => {
      if (!isActive || action !== 'reload-browser-page') return
      handleRefresh()
    }), [isActive])

  const handleNavigateHistory = (delta: -1 | 1) => {
    if (webview.shouldUseWebview && webview.navigateHistory(delta)) {
      return
    }

    onNavigateHistory(page.id, delta)
  }

  const handleLoad = () => {
    if (frameUrl === '') {
      return
    }

    const { faviconUrl, title } = readIframeDocumentMetadata(iframeRef.current)

    if (title != null || faviconUrl != null) {
      onChangeMetadataRef.current(page.id, { faviconUrl, title })
      recordUrlHistory({ faviconUrl, title, url: frameUrl })
    }
  }

  return (
    <div className='chat-interaction-panel__iframe-view'>
      {!shouldHideToolbar && (
        <div className='chat-interaction-panel__iframe-toolbar' data-dock-panel-no-resize='true'>
          <InteractionPanelIframeNavigation
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            frameUrl={frameUrl}
            history={history}
            historyIndex={historyIndex}
            pageId={page.id}
            onNavigateHistory={handleNavigateHistory}
            onRefresh={handleRefresh}
            onSelectHistory={onSelectHistory}
          />
          <InteractionPanelIframeAddressBar
            draftUrl={draftUrl}
            externalUrl={externalUrl}
            isEditingUrl={isEditingUrl}
            urlHistory={urlHistory}
            onChangeDraftUrl={setDraftUrl}
            onOpen={handleOpen}
          />
          <InteractionPanelIframeToolbarActions
            frameUrl={frameUrl}
            iframeRef={iframeRef}
            shouldUseWebview={webview.shouldUseWebview}
            webviewRef={webviewRef}
            onForceReload={handleRefresh}
          />
        </div>
      )}
      <InteractionPanelEmbeddedFrame
        frameUrl={embeddedFrameUrl}
        iframeRef={iframeRef}
        page={page}
        reloadVersion={reloadVersion}
        shouldUseWebview={webview.shouldUseWebview}
        t={t}
        webviewRef={webviewRef}
        onIframeLoad={handleLoad}
      />
    </div>
  )
}
