import type { ResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'

interface ScriptableWebview {
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
}

export interface WebviewMetadata {
  faviconUrl?: string
  title?: string
}

const webviewMetadataScript = `(() => {
  const trimText = value => typeof value === 'string' ? value.trim() : ''
  const readMetaContent = selector => trimText(document.querySelector(selector)?.content)
  const title = trimText(document.title) ||
    readMetaContent('meta[property="og:title"]') ||
    readMetaContent('meta[name="twitter:title"]') ||
    readMetaContent('meta[name="application-name"]')
  const iconLink = Array.from(document.querySelectorAll('link[rel][href]'))
    .find(link => /(^|\\s)(icon|apple-touch-icon|mask-icon)(\\s|$)/i.test(link.getAttribute('rel') || ''))
  return {
    faviconUrl: iconLink?.href || undefined,
    title: title || undefined
  }
})()`

const buildWebviewThemeScript = (themeMode: ResolvedThemeMode) =>
  `(() => {
  const themeMode = ${JSON.stringify(themeMode)}
  const root = document.documentElement
  root.dataset.oneWorksTheme = themeMode
  root.style.colorScheme = themeMode
  const parent = document.head || root
  let colorSchemeMeta = document.querySelector('meta[name="color-scheme"]')
  if (colorSchemeMeta == null) {
    colorSchemeMeta = document.createElement('meta')
    colorSchemeMeta.setAttribute('name', 'color-scheme')
    parent.appendChild(colorSchemeMeta)
  }
  colorSchemeMeta.setAttribute('content', themeMode)
})()`

const mobileDebugDevtoolsStyleId = 'oneworks-mobile-debug-devtools-style'

const mobileDebugDevtoolsStyle = `
  .toolbar-button,
  .toolbar-button[role="button"] {
    min-width: 24px !important;
    width: 24px !important;
    height: 24px !important;
  }

  .toolbar-button devtools-icon,
  .toolbar-button .toolbar-button-icon,
  .toolbar-button .glyph,
  .toolbar-button .largeicon,
  devtools-icon.toolbar-button-icon,
  .tabbed-pane-header-tab devtools-icon {
    --icon-size: 16px !important;
    width: 16px !important;
    min-width: 16px !important;
    height: 16px !important;
    min-height: 16px !important;
    font-size: 16px !important;
    line-height: 16px !important;
  }
`

const buildMobileDebugDevtoolsStyleScript = () =>
  `(() => {
  const styleId = ${JSON.stringify(mobileDebugDevtoolsStyleId)}
  const css = ${JSON.stringify(mobileDebugDevtoolsStyle)}
  const parent = document.head || document.documentElement
  let style = document.getElementById(styleId)
  if (style == null) {
    style = document.createElement('style')
    style.id = styleId
    parent.appendChild(style)
  }
  style.textContent = css
})()`

const normalizeWebviewMetadata = (value: unknown): WebviewMetadata => {
  if (value == null || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const faviconUrl = typeof record.faviconUrl === 'string' ? record.faviconUrl.trim() : ''

  return {
    ...(faviconUrl === '' ? {} : { faviconUrl }),
    ...(title === '' ? {} : { title })
  }
}

export const readWebviewDocumentMetadata = async (
  webview: ScriptableWebview
): Promise<WebviewMetadata> => {
  try {
    return normalizeWebviewMetadata(await webview.executeJavaScript(webviewMetadataScript, false))
  } catch {
    return {}
  }
}

export const applyWebviewTheme = async (
  webview: ScriptableWebview,
  resolvedThemeMode: ResolvedThemeMode
) => {
  try {
    await webview.executeJavaScript(buildWebviewThemeScript(resolvedThemeMode), false)
  } catch {
    // Some pages reject guest script execution during navigation. The next load event retries it.
  }
}

export const applyMobileDebugDevtoolsStyle = async (
  webview: ScriptableWebview,
  isEnabled: boolean
) => {
  if (!isEnabled) return

  try {
    await webview.executeJavaScript(buildMobileDebugDevtoolsStyleScript(), false)
  } catch {
    // DevTools can navigate while loading; the next webview lifecycle event retries injection.
  }
}
