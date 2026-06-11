import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import {
  getIframePageFallbackFaviconUrl,
  getIframePageHostTitle,
  normalizeFrameUrl
} from './interaction-panel-iframe-pages'
import type { InteractionPanelResourceSearchResult } from './interaction-panel-resource-search'
import { readInteractionPanelUrlHistory } from './interaction-panel-url-history'

type InteractionPanelWebsiteResourceSearchResult = Extract<InteractionPanelResourceSearchResult, { kind: 'website' }>

export const buildInteractionPanelWebsiteResources = ({
  iframePages,
  projectUrlHistoryKey,
  sessionUrlHistoryKey
}: {
  iframePages: InteractionPanelIframePage[]
  projectUrlHistoryKey: string
  sessionUrlHistoryKey: string
}) => {
  const resourcesByUrl = new Map<string, InteractionPanelWebsiteResourceSearchResult>()
  const addWebsite = ({
    faviconUrl,
    source,
    title,
    updatedAt,
    url
  }: {
    faviconUrl?: string
    source: 'history' | 'open'
    title?: string
    updatedAt: number
    url: string
  }) => {
    const normalizedUrl = normalizeFrameUrl(url)
    if (normalizedUrl === '' || resourcesByUrl.has(normalizedUrl)) return
    const nextTitle = title?.trim() || getIframePageHostTitle(normalizedUrl, normalizedUrl)
    resourcesByUrl.set(normalizedUrl, {
      faviconUrl: faviconUrl ?? getIframePageFallbackFaviconUrl(normalizedUrl),
      id: `website:${normalizedUrl}`,
      kind: 'website',
      source,
      title: nextTitle,
      updatedAt,
      url: normalizedUrl
    })
  }

  iframePages.forEach((page, index) => {
    addWebsite({
      faviconUrl: page.faviconUrl,
      source: 'open',
      title: page.title,
      updatedAt: Number.MAX_SAFE_INTEGER - index,
      url: page.url
    })
  })
  readInteractionPanelUrlHistory([
    { kind: 'project', key: projectUrlHistoryKey },
    { kind: 'session', key: sessionUrlHistoryKey }
  ]).forEach(entry => addWebsite({ ...entry, source: 'history' }))
  return [...resourcesByUrl.values()]
}
