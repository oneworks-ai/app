import type { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import {
  createIframePage,
  navigateIframePageHistory,
  normalizeFrameUrl,
  selectIframePageHistoryIndex,
  updateIframePageMetadata,
  updateIframePageUrl
} from './interaction-panel-iframe-pages'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'

type IframePagesUpdater = (current: InteractionPanelIframePage[]) => InteractionPanelIframePage[]

export function useInteractionPanelIframePages({
  terminalSessionId,
  t
}: {
  terminalSessionId: string
  t: TFunction
}) {
  const iframePagesRef = useRef<InteractionPanelIframePage[]>([])
  const [iframePages, setIframePages] = useState<InteractionPanelIframePage[]>([])

  const setNextIframePages = (updater: IframePagesUpdater) => {
    const nextPages = updater(iframePagesRef.current)
    iframePagesRef.current = nextPages
    setIframePages(nextPages)
  }

  useEffect(() => {
    iframePagesRef.current = []
    setIframePages([])
  }, [terminalSessionId])

  const addIframePage = () => {
    const nextPage = createIframePage(
      t('chat.interactionPanel.iframeTitle', { index: iframePagesRef.current.length + 1 })
    )
    setNextIframePages(current => [...current, nextPage])
    return nextPage
  }

  const openIframeUrl = (url: string, options: OpenInteractionPanelIframeUrlOptions = {}) => {
    const normalizedUrl = normalizeFrameUrl(url)
    const optionFaviconUrl = options.faviconUrl?.trim()
    const optionTitle = options.title?.trim()
    const existingPage = options.openMode === 'new-tab'
      ? undefined
      : iframePagesRef.current.find(page => normalizeFrameUrl(page.url) === normalizedUrl)
    if (existingPage != null) {
      const shouldUpdateFavicon = options.variant === 'mobile-debug-devtools'
        ? existingPage.faviconUrl !== optionFaviconUrl
        : optionFaviconUrl != null && optionFaviconUrl !== '' && existingPage.faviconUrl !== optionFaviconUrl
      if (
        (options.variant != null && existingPage.variant !== options.variant) ||
        shouldUpdateFavicon ||
        (optionTitle != null && optionTitle !== '' && existingPage.title !== optionTitle)
      ) {
        const nextPage = {
          ...existingPage,
          ...(options.browserControlRequestId == null
            ? {}
            : { browserControlRequestId: options.browserControlRequestId }),
          ...(shouldUpdateFavicon ? { faviconUrl: optionFaviconUrl } : {}),
          ...(optionTitle == null || optionTitle === '' ? {} : { title: optionTitle }),
          ...(options.variant == null ? {} : { variant: options.variant })
        }
        setNextIframePages(current => current.map(page => page.id === nextPage.id ? nextPage : page))
        return nextPage
      }
      return existingPage
    }

    const nextPage = updateIframePageUrl(
      createIframePage(
        optionTitle || t('chat.interactionPanel.iframeTitle', { index: iframePagesRef.current.length + 1 }),
        options
      ),
      normalizedUrl
    )
    setNextIframePages(current =>
      current.some(page => normalizeFrameUrl(page.url) === normalizedUrl) ? current : [...current, nextPage]
    )
    return nextPage
  }

  const closeIframePages = (pageIds: Set<string>) => {
    setNextIframePages(current => current.filter(page => !pageIds.has(page.id)))
  }

  return {
    addIframePage,
    closeIframePages,
    handleIframeMetadataChange: (pageId: string, metadata: { faviconUrl?: string; title?: string }) =>
      setNextIframePages(current =>
        current.map(page => page.id === pageId ? updateIframePageMetadata(page, metadata) : page)
      ),
    handleIframeNavigateHistory: (pageId: string, delta: -1 | 1) =>
      setNextIframePages(current =>
        current.map(page => page.id === pageId ? navigateIframePageHistory(page, delta) : page)
      ),
    handleIframeSelectHistory: (pageId: string, index: number) =>
      setNextIframePages(current =>
        current.map(page => page.id === pageId ? selectIframePageHistoryIndex(page, index) : page)
      ),
    handleIframeUrlChange: (pageId: string, url: string) =>
      setNextIframePages(current => current.map(page => page.id === pageId ? updateIframePageUrl(page, url) : page)),
    iframePages,
    openIframeUrl
  }
}
