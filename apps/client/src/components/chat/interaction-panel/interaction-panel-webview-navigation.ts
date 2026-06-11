import { normalizeFrameUrl } from './interaction-panel-iframe-pages'

interface NavigableWebview {
  getURL: () => string
}

type WebviewNavigationEvent = Event & { url?: string }

export const normalizeWebviewUrlForCompare = (value: string) => {
  const trimmedValue = value.trim()
  if (trimmedValue === '') return ''

  try {
    return new URL(trimmedValue).href
  } catch {
    return normalizeFrameUrl(trimmedValue)
  }
}

export const isWebviewHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim())

export const getWebviewEventUrl = (event: Event, webview: NavigableWebview) => {
  const eventUrl = (event as WebviewNavigationEvent).url
  if (eventUrl != null && eventUrl !== '') return eventUrl
  try {
    return webview.getURL()
  } catch {
    return ''
  }
}

export const getWebviewCurrentUrl = (webview: NavigableWebview, fallbackUrl: string) => {
  try {
    return webview.getURL() || fallbackUrl
  } catch {
    return fallbackUrl
  }
}
