import { normalizeFrameUrl } from './interaction-panel-iframe-pages'

export const resolveBrowserControlNavigationHistorySync = ({
  activeIndex,
  currentUrl,
  entries
}: {
  activeIndex: number
  currentUrl: string
  entries: Array<{ title?: string; url: string }>
}) => {
  const history = entries.map(entry => normalizeFrameUrl(entry.url))
  if (history.length === 0 || history.includes('')) {
    throw new Error('The native browser history does not contain valid URL entries.')
  }
  const normalizedCurrentUrl = normalizeFrameUrl(currentUrl)
  if (normalizedCurrentUrl === '') throw new Error('The native browser history does not have a current URL.')
  const historyIndex = Math.min(history.length - 1, Math.max(0, Math.round(activeIndex)))
  history[historyIndex] = normalizedCurrentUrl
  return { currentUrl: normalizedCurrentUrl, history, historyIndex }
}
