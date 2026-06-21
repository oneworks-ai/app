import { useEffect, useState } from 'react'
import type { MutableRefObject } from 'react'

import type { ResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'

import type { InteractionPanelUrlHistoryEntry } from './interaction-panel-url-history'
import {
  applyMobileDebugDevtoolsStyle,
  applyWebviewTheme,
  readWebviewDocumentMetadata
} from './interaction-panel-webview-document'
import type { WebviewMetadata } from './interaction-panel-webview-document'
import {
  getWebviewCurrentUrl,
  getWebviewEventUrl,
  isWebviewHttpUrl,
  normalizeWebviewUrlForCompare
} from './interaction-panel-webview-navigation'

export interface ElectronWebviewElement extends HTMLElement {
  canGoBack: () => boolean
  canGoForward: () => boolean
  capturePage?: () => Promise<{ toDataURL: () => string }>
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
  getTitle: () => string
  getURL: () => string
  getWebContentsId?: () => number
  getZoomFactor?: () => number
  goBack: () => void
  goForward: () => void
  loadURL: (url: string) => Promise<void>
  reload: () => void
  reloadIgnoringCache?: () => void
  setZoomFactor?: (factor: number) => void
}

type WebviewTitleEvent = Event & { title?: string }
type WebviewFaviconEvent = Event & { favicons?: string[] }

export const isDesktopWebviewAvailable = () => (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  window.oneworksDesktop?.supportsWebviewTag === true &&
  document.createElement('webview') instanceof HTMLElement
)

export function useInteractionPanelWebview({
  frameUrl,
  isMobileDebugDevtools,
  onChangeMetadata,
  onChangeUrl,
  pageId,
  recordUrlHistory,
  resolvedThemeMode,
  webviewRef
}: {
  frameUrl: string
  isMobileDebugDevtools: boolean
  onChangeMetadata: (pageId: string, metadata: { faviconUrl?: string; title?: string }) => void
  onChangeUrl: (pageId: string, url: string) => void
  pageId: string
  recordUrlHistory: (entry: Omit<InteractionPanelUrlHistoryEntry, 'updatedAt'>) => void
  resolvedThemeMode: ResolvedThemeMode
  webviewRef: MutableRefObject<ElectronWebviewElement | null>
}) {
  const shouldUseWebview = isDesktopWebviewAvailable()
  const [historyState, setHistoryState] = useState({ canGoBack: false, canGoForward: false })

  const updateHistoryState = () => {
    const webview = webviewRef.current
    if (webview == null) {
      setHistoryState({ canGoBack: false, canGoForward: false })
      return
    }

    try {
      setHistoryState({
        canGoBack: webview.canGoBack(),
        canGoForward: webview.canGoForward()
      })
    } catch {
      setHistoryState({ canGoBack: false, canGoForward: false })
    }
  }

  useEffect(() => {
    if (!shouldUseWebview || frameUrl === '') {
      setHistoryState({ canGoBack: false, canGoForward: false })
      return
    }

    const webview = webviewRef.current
    if (webview == null) return

    const commitMetadata = (metadata: WebviewMetadata) => {
      if (isMobileDebugDevtools) return
      const nextMetadata: WebviewMetadata = metadata
      if (nextMetadata.title == null && nextMetadata.faviconUrl == null) return
      onChangeMetadata(pageId, nextMetadata)
      recordUrlHistory({ url: getWebviewCurrentUrl(webview, frameUrl), ...nextMetadata })
    }

    const refreshDocumentState = () => {
      void applyWebviewTheme(webview, resolvedThemeMode)
      void applyMobileDebugDevtoolsStyle(webview, isMobileDebugDevtools)
      void readWebviewDocumentMetadata(webview).then(commitMetadata)
    }
    const handleDomReady = () => {
      refreshDocumentState()
      updateHistoryState()
    }

    const handleNavigation = (event: Event) => {
      const nextUrl = getWebviewEventUrl(event, webview)
      const comparableNextUrl = normalizeWebviewUrlForCompare(nextUrl)
      if (
        isWebviewHttpUrl(nextUrl) &&
        comparableNextUrl !== normalizeWebviewUrlForCompare(frameUrl)
      ) {
        onChangeUrl(pageId, nextUrl)
      }
      updateHistoryState()
    }
    const handleTitleChange = (event: Event) => {
      if (isMobileDebugDevtools) return
      const nextTitle = (event as WebviewTitleEvent).title ?? webview.getTitle()
      if (nextTitle.trim() === '') return
      onChangeMetadata(pageId, { title: nextTitle })
      recordUrlHistory({ title: nextTitle, url: getWebviewCurrentUrl(webview, frameUrl) })
    }
    const handleFaviconChange = (event: Event) => {
      if (isMobileDebugDevtools) return
      const faviconUrl = (event as WebviewFaviconEvent).favicons?.find(Boolean)
      if (faviconUrl == null || faviconUrl === '') return
      onChangeMetadata(pageId, { faviconUrl })
      recordUrlHistory({ faviconUrl, url: getWebviewCurrentUrl(webview, frameUrl) })
    }

    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('did-finish-load', refreshDocumentState)
    webview.addEventListener('did-navigate', handleNavigation)
    webview.addEventListener('did-navigate-in-page', handleNavigation)
    webview.addEventListener('did-stop-loading', refreshDocumentState)
    webview.addEventListener('did-stop-loading', updateHistoryState)
    webview.addEventListener('page-title-updated', handleTitleChange)
    webview.addEventListener('page-favicon-updated', handleFaviconChange)
    updateHistoryState()

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady)
      webview.removeEventListener('did-finish-load', refreshDocumentState)
      webview.removeEventListener('did-navigate', handleNavigation)
      webview.removeEventListener('did-navigate-in-page', handleNavigation)
      webview.removeEventListener('did-stop-loading', refreshDocumentState)
      webview.removeEventListener('did-stop-loading', updateHistoryState)
      webview.removeEventListener('page-title-updated', handleTitleChange)
      webview.removeEventListener('page-favicon-updated', handleFaviconChange)
    }
  }, [
    frameUrl,
    isMobileDebugDevtools,
    onChangeMetadata,
    onChangeUrl,
    pageId,
    recordUrlHistory,
    resolvedThemeMode,
    shouldUseWebview,
    webviewRef
  ])

  const navigateHistory = (delta: -1 | 1) => {
    const webview = webviewRef.current
    try {
      if (delta === -1 && webview?.canGoBack() === true) {
        webview.goBack()
        return true
      }
      if (delta === 1 && webview?.canGoForward() === true) {
        webview.goForward()
        return true
      }
    } catch {
      return false
    }
    return false
  }

  return {
    canGoBack: historyState.canGoBack,
    canGoForward: historyState.canGoForward,
    navigateHistory,
    shouldUseWebview
  }
}
