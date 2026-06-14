import type { InteractionPanelIframePage } from './InteractionPanelIframeView'

const buildIframeStorageKey = (sessionId: string) => `chatInteractionIframePages:${sessionId}`
const iframePageDevtoolsVariants = new Set<InteractionPanelIframePage['variant']>([
  'mobile-debug-devtools'
])

export interface OpenInteractionPanelIframeUrlOptions {
  faviconUrl?: string
  title?: string
  variant?: InteractionPanelIframePage['variant']
}

export const normalizeFrameUrl = (value: string) => {
  const trimmedValue = value.trim()
  if (trimmedValue === '') {
    return ''
  }

  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmedValue)) {
    try {
      return new URL(trimmedValue).href
    } catch {
      return trimmedValue
    }
  }

  try {
    return new URL(`https://${trimmedValue}`).href
  } catch {
    return `https://${trimmedValue}`
  }
}

export const getIframePageHostTitle = (url: string, fallbackTitle: string) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host === '' ? fallbackTitle : host
  } catch {
    return fallbackTitle
  }
}

export const getIframePageFallbackFaviconUrl = (url: string) => {
  try {
    return `${new URL(url).origin}/favicon.ico`
  } catch {
    return undefined
  }
}

const getIframePageTitleForUrl = (page: InteractionPanelIframePage, url: string) => (
  isIframePageDevtoolsVariant(page) ? page.title : getIframePageHostTitle(url, page.title)
)

const getIframePageFaviconUrlForUrl = (page: InteractionPanelIframePage, url: string) => (
  isIframePageDevtoolsVariant(page) ? page.faviconUrl : getIframePageFallbackFaviconUrl(url)
)

export const isIframePageDevtoolsVariant = (page: Pick<InteractionPanelIframePage, 'variant'>) =>
  iframePageDevtoolsVariants.has(page.variant)

export const createIframePage = (
  title: string,
  options: Pick<InteractionPanelIframePage, 'faviconUrl' | 'variant'> = {}
): InteractionPanelIframePage => ({
  id: `iframe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  title,
  url: '',
  ...(options.faviconUrl == null || options.faviconUrl.trim() === '' ? {} : { faviconUrl: options.faviconUrl.trim() }),
  ...(options.variant == null ? {} : { variant: options.variant })
})

const normalizeIframePage = (page: InteractionPanelIframePage): InteractionPanelIframePage => {
  const history = Array.isArray(page.history) ? page.history.filter(url => typeof url === 'string') : undefined
  const historyIndex = history == null || history.length === 0
    ? undefined
    : Math.min(Math.max(page.historyIndex ?? history.length - 1, 0), history.length - 1)
  const variant = isIframePageDevtoolsVariant(page) ? page.variant : undefined
  const { variant: _variant, ...basePage } = page
  return {
    ...basePage,
    ...(typeof page.faviconUrl === 'string' && page.faviconUrl !== '' ? { faviconUrl: page.faviconUrl } : {}),
    ...(history == null || historyIndex == null ? {} : { history, historyIndex }),
    ...(variant == null ? {} : { variant })
  }
}

export const readIframePages = (sessionId: string): InteractionPanelIframePage[] => {
  if (typeof window === 'undefined') return []
  try {
    const rawValue = window.localStorage.getItem(buildIframeStorageKey(sessionId))
    const parsedValue = rawValue == null ? [] : JSON.parse(rawValue)
    if (!Array.isArray(parsedValue)) return []
    return parsedValue
      .filter((item): item is InteractionPanelIframePage => (
        item != null &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.url === 'string'
      ))
      .map(normalizeIframePage)
  } catch {
    return []
  }
}

export const writeIframePages = (sessionId: string, pages: InteractionPanelIframePage[]) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(buildIframeStorageKey(sessionId), JSON.stringify(pages))
  } catch {
    // Persisting iframe pages is best-effort only.
  }
}

export const updateIframePageUrl = (
  page: InteractionPanelIframePage,
  url: string
): InteractionPanelIframePage => {
  const normalizedUrl = normalizeFrameUrl(url)
  if (normalizedUrl === '') {
    return {
      ...page,
      url: '',
      history: [],
      historyIndex: undefined
    }
  }

  const currentHistory = page.history?.length ? page.history : page.url === '' ? [] : [page.url]
  const currentIndex = page.historyIndex ?? currentHistory.length - 1
  const nextHistory = currentHistory[currentIndex] === normalizedUrl
    ? currentHistory
    : [...currentHistory.slice(0, currentIndex + 1), normalizedUrl]
  return {
    ...page,
    url: normalizedUrl,
    title: getIframePageTitleForUrl(page, normalizedUrl),
    faviconUrl: getIframePageFaviconUrlForUrl(page, normalizedUrl),
    history: nextHistory,
    historyIndex: nextHistory.length - 1
  }
}

export const navigateIframePageHistory = (
  page: InteractionPanelIframePage,
  delta: -1 | 1
): InteractionPanelIframePage => {
  const history = page.history ?? []
  const currentIndex = page.historyIndex ?? history.length - 1
  const nextIndex = currentIndex + delta
  const nextUrl = history[nextIndex]
  if (nextUrl == null) {
    return page
  }

  return {
    ...page,
    url: nextUrl,
    title: getIframePageTitleForUrl(page, nextUrl),
    faviconUrl: getIframePageFaviconUrlForUrl(page, nextUrl),
    historyIndex: nextIndex
  }
}

export const selectIframePageHistoryIndex = (
  page: InteractionPanelIframePage,
  index: number
): InteractionPanelIframePage => {
  const history = page.history ?? []
  const nextUrl = history[index]
  if (nextUrl == null) {
    return page
  }

  return {
    ...page,
    url: nextUrl,
    title: getIframePageTitleForUrl(page, nextUrl),
    faviconUrl: getIframePageFaviconUrlForUrl(page, nextUrl),
    historyIndex: index
  }
}

export const updateIframePageMetadata = (
  page: InteractionPanelIframePage,
  metadata: { faviconUrl?: string; title?: string }
): InteractionPanelIframePage => ({
  ...page,
  ...(isIframePageDevtoolsVariant(page) || metadata.title == null || metadata.title.trim() === ''
    ? {}
    : { title: metadata.title.trim() }),
  ...(isIframePageDevtoolsVariant(page) || metadata.faviconUrl == null || metadata.faviconUrl.trim() === ''
    ? {}
    : { faviconUrl: metadata.faviconUrl })
})
