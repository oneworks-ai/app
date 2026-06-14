/* eslint-disable max-lines -- iframe view coordinates URL state, navigation controls, and webview lifecycle. */
import { App, Dropdown } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildWebDebugDevtoolsUrl,
  isWebDebugDevtoolsDebugEnabled,
  readWebDebugChiiRuntime,
  readWebDebugTargets
} from '#~/api/web-debug'
import type { WebDebugChiiRuntime, WebDebugDevtoolsDockSide, WebDebugTarget } from '#~/api/web-debug'
import { readWebpageMetadata } from '#~/api/webpage'
import { OverlayAction, OverlayDivider, OverlayPanel } from '#~/components/overlay'
import { addDesktopViewShortcutListener } from '#~/desktop/view-shortcuts'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'

import { InteractionPanelEmbeddedFrame } from './InteractionPanelEmbeddedFrame'
import type {
  InteractionPanelEmbeddedFrameResizeEdge,
  InteractionPanelEmbeddedFrameViewportSize
} from './InteractionPanelEmbeddedFrame'
import { InteractionPanelIframeAddressBar } from './InteractionPanelIframeAddressBar'
import { InteractionPanelIframeNavigation } from './InteractionPanelIframeNavigation'
import { InteractionPanelIframeToolbarActions } from './InteractionPanelIframeToolbarActions'
import { InteractionPanelPageDebuggerListView } from './InteractionPanelPageDebuggerListView'
import {
  buildChiiScriptSnippet,
  injectChiiTargetScript,
  injectChiiTargetScriptIntoWebview,
  isSameOriginFrameUrl
} from './interaction-panel-iframe-debug'
import { readIframeDocumentMetadata } from './interaction-panel-iframe-metadata'
import {
  getIframePageHostTitle,
  isIframePageDevtoolsVariant,
  normalizeFrameUrl
} from './interaction-panel-iframe-pages'
import { findWebDebugTargetForUrl } from './interaction-panel-page-debugger'
import { normalizeWebviewUrlForCompare } from './interaction-panel-webview-navigation'
import { useInteractionPanelUrlHistory } from './use-interaction-panel-url-history'
import { useInteractionPanelWebview } from './use-interaction-panel-webview'
import type { ElectronWebviewElement } from './use-interaction-panel-webview'

export type InteractionPanelIframePageVariant = 'mobile-debug-devtools'

const DEVELOPER_TOOLS_DEFAULT_WIDTH = 480
const DEVELOPER_TOOLS_DEFAULT_HEIGHT = 320
const DEVELOPER_TOOLS_MIN_WIDTH = 320
const DEVELOPER_TOOLS_MIN_HEIGHT = 220
const DEVELOPER_TOOLS_MAX_WIDTH = 960
const DEVELOPER_TOOLS_MAX_HEIGHT = 720
const DEVELOPER_TOOLS_TARGET_WAIT_MS = 250
const DEVELOPER_TOOLS_TARGET_WAIT_ATTEMPTS = 12
const DEVELOPER_TOOLS_TARGET_HEALTHCHECK_MS = 15_000
const DEVELOPER_TOOLS_TARGET_AUTO_INJECT_MS = 5_000

type ChiiTargetInjectionStatus = 'failed' | 'injected' | 'unavailable'
interface ChiiTargetInjectionOptions {
  force?: boolean
}
interface IframeViewportPreset {
  id: string
  label?: string
  labelKey?: string
  size: InteractionPanelEmbeddedFrameViewportSize | null
}

const IFRAME_VIEWPORT_RESPONSIVE_PRESET = {
  id: 'responsive',
  labelKey: 'chat.interactionPanel.iframeViewportResponsive',
  size: null
} satisfies IframeViewportPreset

const IFRAME_VIEWPORT_ZOOM_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const
type IframeViewportZoomValue = 'auto' | typeof IFRAME_VIEWPORT_ZOOM_OPTIONS[number]

const IFRAME_VIEWPORT_STANDARD_PRESETS = [
  {
    id: 'iphone-se',
    label: 'iPhone SE',
    size: { height: 667, width: 375 }
  },
  {
    id: 'iphone-xr',
    label: 'iPhone XR',
    size: { height: 896, width: 414 }
  },
  {
    id: 'iphone-12-pro',
    label: 'iPhone 12 Pro',
    size: { height: 844, width: 390 }
  },
  {
    id: 'iphone-14-pro-max',
    label: 'iPhone 14 Pro Max',
    size: { height: 932, width: 430 }
  },
  {
    id: 'iphone-16',
    label: 'iPhone 16',
    size: { height: 852, width: 393 }
  },
  {
    id: 'iphone-16-pro',
    label: 'iPhone 16 Pro',
    size: { height: 874, width: 402 }
  },
  {
    id: 'iphone-16-pro-max',
    label: 'iPhone 16 Pro Max',
    size: { height: 956, width: 440 }
  },
  {
    id: 'iphone-17',
    label: 'iPhone 17',
    size: { height: 874, width: 402 }
  },
  {
    id: 'iphone-17-pro',
    label: 'iPhone 17 Pro',
    size: { height: 874, width: 402 }
  },
  {
    id: 'iphone-17-pro-max',
    label: 'iPhone 17 Pro Max',
    size: { height: 956, width: 440 }
  },
  {
    id: 'iphone-air',
    label: 'iPhone Air',
    size: { height: 912, width: 420 }
  },
  {
    id: 'pixel-7',
    label: 'Pixel 7',
    size: { height: 915, width: 412 }
  },
  {
    id: 'pixel-9',
    label: 'Pixel 9',
    size: { height: 923, width: 412 }
  },
  {
    id: 'pixel-9-pro',
    label: 'Pixel 9 Pro',
    size: { height: 914, width: 410 }
  },
  {
    id: 'pixel-9-pro-xl',
    label: 'Pixel 9 Pro XL',
    size: { height: 921, width: 414 }
  },
  {
    id: 'pixel-10',
    label: 'Pixel 10',
    size: { height: 923, width: 412 }
  },
  {
    id: 'pixel-10-pro',
    label: 'Pixel 10 Pro',
    size: { height: 914, width: 410 }
  },
  {
    id: 'pixel-10-pro-xl',
    label: 'Pixel 10 Pro XL',
    size: { height: 921, width: 414 }
  },
  {
    id: 'samsung-galaxy-s8-plus',
    label: 'Samsung Galaxy S8+',
    size: { height: 740, width: 360 }
  },
  {
    id: 'samsung-galaxy-s20-ultra',
    label: 'Samsung Galaxy S20 Ultra',
    size: { height: 915, width: 412 }
  },
  {
    id: 'samsung-galaxy-s25',
    label: 'Samsung Galaxy S25',
    size: { height: 780, width: 360 }
  },
  {
    id: 'samsung-galaxy-s25-plus',
    label: 'Samsung Galaxy S25+',
    size: { height: 891, width: 412 }
  },
  {
    id: 'samsung-galaxy-s25-ultra',
    label: 'Samsung Galaxy S25 Ultra',
    size: { height: 891, width: 412 }
  },
  {
    id: 'galaxy-z-flip-6',
    label: 'Galaxy Z Flip6',
    size: { height: 960, width: 393 }
  },
  {
    id: 'galaxy-z-fold-6-cover',
    label: 'Galaxy Z Fold6 Cover',
    size: { height: 792, width: 323 }
  },
  {
    id: 'galaxy-z-fold-6-main',
    label: 'Galaxy Z Fold6 Main',
    size: { height: 720, width: 619 }
  },
  {
    id: 'ipad-mini',
    label: 'iPad Mini',
    size: { height: 1024, width: 768 }
  },
  {
    id: 'ipad-air',
    label: 'iPad Air',
    size: { height: 1180, width: 820 }
  },
  {
    id: 'ipad-pro',
    label: 'iPad Pro',
    size: { height: 1366, width: 1024 }
  },
  {
    id: 'surface-pro-7',
    label: 'Surface Pro 7',
    size: { height: 1368, width: 912 }
  },
  {
    id: 'surface-duo',
    label: 'Surface Duo',
    size: { height: 720, width: 540 }
  },
  {
    id: 'galaxy-z-fold-5',
    label: 'Galaxy Z Fold 5',
    size: { height: 882, width: 344 }
  },
  {
    id: 'asus-zenbook-fold',
    label: 'Asus Zenbook Fold',
    size: { height: 853, width: 1280 }
  },
  {
    id: 'samsung-galaxy-a51-71',
    label: 'Samsung Galaxy A51/71',
    size: { height: 914, width: 412 }
  },
  {
    id: 'nest-hub',
    label: 'Nest Hub',
    size: { height: 600, width: 1024 }
  },
  {
    id: 'nest-hub-max',
    label: 'Nest Hub Max',
    size: { height: 800, width: 1280 }
  }
] satisfies readonly IframeViewportPreset[]

const IFRAME_VIEWPORT_PRESETS = [
  IFRAME_VIEWPORT_RESPONSIVE_PRESET,
  ...IFRAME_VIEWPORT_STANDARD_PRESETS
] as const

type IframeViewportPresetId = (typeof IFRAME_VIEWPORT_PRESETS)[number]['id']
type IframeViewportDeviceType = 'desktop' | 'mobile'

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

const escapeHtmlAttribute = (value: string) => (
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
)

const readIframeScreenshotDataUrl = async (
  iframe: HTMLIFrameElement,
  fullSize: boolean
) => {
  const iframeDocument = iframe.contentDocument
  if (iframeDocument == null) throw new Error('Iframe document is unavailable.')

  const clonedDocumentElement = iframeDocument.documentElement.cloneNode(true) as HTMLElement
  clonedDocumentElement.querySelectorAll('script').forEach(script => script.remove())
  clonedDocumentElement.querySelector('head')?.insertAdjacentHTML(
    'afterbegin',
    `<base href="${escapeHtmlAttribute(iframeDocument.location.href)}">`
  )

  const documentWidth = Math.max(
    iframeDocument.documentElement.scrollWidth,
    iframeDocument.body?.scrollWidth ?? 0,
    iframe.clientWidth
  )
  const documentHeight = Math.max(
    iframeDocument.documentElement.scrollHeight,
    iframeDocument.body?.scrollHeight ?? 0,
    iframe.clientHeight
  )
  const width = Math.min(12_000, Math.max(1, Math.round(fullSize ? documentWidth : iframe.clientWidth)))
  const height = Math.min(12_000, Math.max(1, Math.round(fullSize ? documentHeight : iframe.clientHeight)))
  const html = new XMLSerializer().serializeToString(clonedDocumentElement)
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<foreignObject width="100%" height="100%">${html}</foreignObject>`,
    '</svg>'
  ].join('')
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))

  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()

    const canvas = window.document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context == null) throw new Error('Canvas is unavailable.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

const delay = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

const debugIframeDevtools = (...args: unknown[]) => {
  if (!isWebDebugDevtoolsDebugEnabled()) return
  console.debug('[iframe-debug]', ...args) // eslint-disable-line no-console
}

const debugIframeDevtoolsJson = (label: string, payload: unknown) => {
  if (!isWebDebugDevtoolsDebugEnabled()) return
  let serializedPayload = ''
  try {
    serializedPayload = typeof payload === 'string' ? payload : JSON.stringify(payload)
  } catch (error) {
    serializedPayload = JSON.stringify({ error: String(error) })
  }
  console.debug('[iframe-debug]', label, serializedPayload) // eslint-disable-line no-console
}

const getUrlOrigin = (url: string | null) => {
  if (typeof window === 'undefined') return ''
  if (url == null) return window.location.origin

  try {
    return new URL(url).origin
  } catch {
    return window.location.origin
  }
}

const getLoadedFrameOrigin = (frame: HTMLIFrameElement | null, fallbackUrl: string | null) => {
  if (typeof window === 'undefined' || frame?.contentWindow == null) return null

  try {
    const frameHref = frame.contentWindow.location.href
    if (frameHref === 'about:blank' || frameHref.trim() === '') return null
    return new URL(frameHref).origin
  } catch {
    return fallbackUrl == null ? null : getUrlOrigin(fallbackUrl)
  }
}

const readDeveloperToolsToolbarMetrics = (toolbarElement: HTMLElement | null) => {
  if (toolbarElement == null) return {}

  const rect = toolbarElement.getBoundingClientRect()
  const style = getComputedStyle(toolbarElement)
  const iconSize = Number.parseFloat(style.getPropertyValue('--interaction-panel-chrome-icon-size'))
  return {
    toolbarBackgroundColor: style.backgroundColor,
    toolbarIconSize: Number.isFinite(iconSize) && iconSize > 0 ? iconSize : undefined,
    toolbarTotalHeight: Number.isFinite(rect.height) && rect.height > 0 ? rect.height : undefined
  }
}

const appendDeveloperToolsToolbarMetrics = (url: string, toolbarElement: HTMLElement | null) => {
  const metrics = readDeveloperToolsToolbarMetrics(toolbarElement)
  if (
    metrics.toolbarBackgroundColor == null &&
    metrics.toolbarIconSize == null &&
    metrics.toolbarTotalHeight == null
  ) return url

  const nextUrl = new URL(url)
  if (metrics.toolbarBackgroundColor != null && metrics.toolbarBackgroundColor.trim() !== '') {
    nextUrl.searchParams.set('oneworks_toolbar_background_color', metrics.toolbarBackgroundColor.trim())
  }
  if (metrics.toolbarIconSize != null) {
    nextUrl.searchParams.set('oneworks_toolbar_icon_size', String(Math.round(metrics.toolbarIconSize * 100) / 100))
  }
  if (metrics.toolbarTotalHeight != null) {
    nextUrl.searchParams.set(
      'oneworks_toolbar_total_height',
      String(Math.round(metrics.toolbarTotalHeight * 100) / 100)
    )
  }
  return nextUrl.toString()
}

const clampDeveloperToolsWidth = (value: number, containerWidth?: number) => {
  const containerMax = containerWidth == null ? DEVELOPER_TOOLS_MAX_WIDTH : Math.max(
    DEVELOPER_TOOLS_MIN_WIDTH,
    Math.min(DEVELOPER_TOOLS_MAX_WIDTH, containerWidth - 260)
  )
  return Math.min(containerMax, Math.max(DEVELOPER_TOOLS_MIN_WIDTH, value))
}

const createChiiTargetId = (pageId: string) => {
  const normalizedPageId = pageId.replace(/[^\w-]/g, '')
  return `ow-${normalizedPageId || 'page'}`
}

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
  const { message } = App.useApp()
  const { t } = useTranslation()
  const { resolvedThemeMode } = useResolvedThemeMode()
  const [draftUrl, setDraftUrl] = useState(page.url)
  const [developerToolsDockSide, setDeveloperToolsDockSide] = useState<WebDebugDevtoolsDockSide>('right')
  const [developerToolsHeight, setDeveloperToolsHeight] = useState(DEVELOPER_TOOLS_DEFAULT_HEIGHT)
  const [developerToolsUrl, setDeveloperToolsUrl] = useState<string | null>(null)
  const [developerToolsWidth, setDeveloperToolsWidth] = useState(DEVELOPER_TOOLS_DEFAULT_WIDTH)
  const [isDeveloperToolsOpen, setIsDeveloperToolsOpen] = useState(false)
  const [isDeveloperToolsResizing, setIsDeveloperToolsResizing] = useState(false)
  const [isViewportDeviceFrameVisible, setIsViewportDeviceFrameVisible] = useState(false)
  const [isViewportDevicePixelRatioVisible, setIsViewportDevicePixelRatioVisible] = useState(false)
  const [isViewportDeviceTypeVisible, setIsViewportDeviceTypeVisible] = useState(false)
  const [isViewportMediaQueriesVisible, setIsViewportMediaQueriesVisible] = useState(true)
  const [isViewportMoreOpen, setIsViewportMoreOpen] = useState(false)
  const [isViewportResizing, setIsViewportResizing] = useState(false)
  const [isViewportRulersVisible, setIsViewportRulersVisible] = useState(false)
  const [isViewportToolbarOpen, setIsViewportToolbarOpen] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [autoViewportScale, setAutoViewportScale] = useState(1)
  const [viewportDevicePixelRatio, setViewportDevicePixelRatio] = useState('2')
  const [viewportDeviceType, setViewportDeviceType] = useState<IframeViewportDeviceType>('mobile')
  const [viewportZoomValue, setViewportZoomValue] = useState<IframeViewportZoomValue>('auto')
  const [viewportSize, setViewportSize] = useState<InteractionPanelEmbeddedFrameViewportSize>({
    height: 844,
    width: 390
  })
  const [viewportPresetId, setViewportPresetId] = useState<IframeViewportPresetId>('responsive')
  const [webviewFrameUrl, setWebviewFrameUrl] = useState(() => normalizeFrameUrl(page.url))
  const [webviewAttachVersion, setWebviewAttachVersion] = useState(0)
  const chiiTargetId = useMemo(() => createChiiTargetId(page.id), [page.id])
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const isMountedRef = useRef(false)
  const pagePaneRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<HTMLDivElement | null>(null)
  const viewportToolbarRef = useRef<HTMLDivElement | null>(null)
  const viewportResizeCleanupRef = useRef<(() => void) | null>(null)
  const developerToolsFrameRef = useRef<HTMLIFrameElement | null>(null)
  const developerToolsResizeCleanupRef = useRef<(() => void) | null>(null)
  const webviewRef = useRef<ElectronWebviewElement | null>(null)
  const onChangeMetadataRef = useRef(onChangeMetadata)
  const { history: urlHistory, record: recordUrlHistory } = useInteractionPanelUrlHistory({
    projectKey: projectUrlHistoryKey,
    sessionKey: sessionUrlHistoryKey
  })
  const frameUrl = useMemo(() => normalizeFrameUrl(page.url), [page.url])
  const isMobileDebugDevtools = isIframePageDevtoolsVariant(page)
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
  const developerToolsOrigin = useMemo(() => getUrlOrigin(developerToolsUrl), [developerToolsUrl])
  const iframeViewportSize = isViewportToolbarOpen ? viewportSize : null
  const isViewportSizeEditable = viewportPresetId === IFRAME_VIEWPORT_RESPONSIVE_PRESET.id
  const resolvedViewportScale = viewportZoomValue === 'auto' ? autoViewportScale : viewportZoomValue
  const viewportZoomPercent = `${Math.round(resolvedViewportScale * 100)}%`
  const shouldHideToolbar = webview.shouldUseWebview && isMobileDebugDevtools

  useEffect(() => {
    if (!isViewportToolbarOpen) {
      setAutoViewportScale(1)
      return
    }

    const updateViewportScale = () => {
      const pagePane = pagePaneRef.current
      if (pagePane == null) return

      const topToolbarHeight = shouldHideToolbar ? 0 : toolbarRef.current?.offsetHeight ?? 0
      const viewportToolbarHeight = viewportToolbarRef.current?.offsetHeight ?? 0
      const availableWidth = Math.max(1, pagePane.clientWidth - 24)
      const availableHeight = Math.max(1, pagePane.clientHeight - topToolbarHeight - viewportToolbarHeight - 24)
      const nextScale = Math.min(1, availableWidth / viewportSize.width, availableHeight / viewportSize.height)
      const normalizedScale = Math.max(0.1, Math.floor(nextScale * 100) / 100)
      setAutoViewportScale(current => Math.abs(current - normalizedScale) < 0.005 ? current : normalizedScale)
    }

    updateViewportScale()
    window.addEventListener('resize', updateViewportScale)

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.removeEventListener('resize', updateViewportScale)
      }
    }

    const observer = new ResizeObserver(updateViewportScale)
    const observedElements = [
      pagePaneRef.current,
      toolbarRef.current,
      viewportToolbarRef.current
    ].filter((element): element is HTMLElement => element != null)
    observedElements.forEach(element => observer.observe(element))

    return () => {
      window.removeEventListener('resize', updateViewportScale)
      observer.disconnect()
    }
  }, [isViewportToolbarOpen, shouldHideToolbar, viewportSize.height, viewportSize.width])

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

  const getCurrentInspectableUrl = useCallback(() => {
    if (webview.shouldUseWebview) {
      try {
        const currentWebviewUrl = webviewRef.current?.getURL()
        if (currentWebviewUrl != null && currentWebviewUrl.trim() !== '') {
          return currentWebviewUrl
        }
      } catch {
        return frameUrl
      }
    }

    return frameUrl
  }, [frameUrl, webview.shouldUseWebview])

  const injectCurrentPageTarget = useCallback(async (
    runtime: WebDebugChiiRuntime,
    options: ChiiTargetInjectionOptions = {}
  ): Promise<ChiiTargetInjectionStatus> => {
    if (frameUrl === '' || isMobileDebugDevtools) {
      debugIframeDevtools('skip target injection', {
        frameUrl,
        force: options.force === true,
        reason: frameUrl === '' ? 'empty-frame-url' : 'mobile-debug-devtools'
      })
      return 'unavailable'
    }

    try {
      if (webview.shouldUseWebview) {
        debugIframeDevtools('inject target into webview', {
          force: options.force === true,
          frameUrl,
          targetId: chiiTargetId,
          targetUrl: runtime.targetUrl
        })
        await injectChiiTargetScriptIntoWebview(webviewRef.current, runtime.targetUrl, {
          ...options,
          targetId: chiiTargetId
        })
        debugIframeDevtools('target injected into webview', { force: options.force === true, frameUrl })
        return 'injected'
      }

      if (!isSameOriginFrameUrl(frameUrl)) {
        debugIframeDevtools('skip target injection', {
          force: options.force === true,
          frameUrl,
          reason: 'cross-origin-frame'
        })
        return 'unavailable'
      }

      debugIframeDevtools('inject target into iframe', {
        force: options.force === true,
        frameUrl,
        targetId: chiiTargetId,
        targetUrl: runtime.targetUrl
      })
      await injectChiiTargetScript(iframeRef.current, runtime.targetUrl, {
        ...options,
        targetId: chiiTargetId
      })
      debugIframeDevtools('target injected into iframe', { force: options.force === true, frameUrl })
      return 'injected'
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.warn(
        `[iframe-debug] Failed to inject page debugger target: ${errorMessage}; targetUrl=${runtime.targetUrl}; frameUrl=${frameUrl}`
      )
      return 'failed'
    }
  }, [chiiTargetId, frameUrl, isMobileDebugDevtools, webview.shouldUseWebview])

  const autoInjectCurrentPageTarget = useCallback(async () => {
    if (frameUrl === '' || isMobileDebugDevtools) return

    try {
      const runtime = await readWebDebugChiiRuntime()
      const status = await injectCurrentPageTarget(runtime)
      debugIframeDevtools('auto target injection finished', { frameUrl, status })
    } catch {
      // Auto-injection is best effort. The explicit developer-tools action reports fallback guidance.
    }
  }, [frameUrl, injectCurrentPageTarget, isMobileDebugDevtools])

  const copyDeveloperToolsScriptFallback = useCallback(async (runtime: WebDebugChiiRuntime) => {
    if (navigator.clipboard?.writeText == null) {
      void message.warning(t('chat.interactionPanel.iframeDebugInjectUnavailable'))
      return
    }

    try {
      await navigator.clipboard.writeText(buildChiiScriptSnippet(runtime.targetUrl))
      void message.warning(t('chat.interactionPanel.iframeDebugAutoInjectUnavailableCopied'))
    } catch {
      void message.warning(t('chat.interactionPanel.iframeDebugInjectUnavailable'))
    }
  }, [message, t])

  const buildDeveloperToolsUrlForTarget = useCallback((
    runtime: WebDebugChiiRuntime,
    target: WebDebugTarget
  ) =>
    buildWebDebugDevtoolsUrl(runtime, target, {
      debug: isWebDebugDevtoolsDebugEnabled(),
      dockControls: 'menu',
      dockSide: developerToolsDockSide,
      ...readDeveloperToolsToolbarMetrics(toolbarRef.current)
    }), [developerToolsDockSide])

  const waitForCurrentPageTarget = useCallback(async (runtime: WebDebugChiiRuntime) => {
    const frameUrlForCompare = getCurrentInspectableUrl()
    let latestTargets: WebDebugTarget[] = []
    debugIframeDevtools('wait for current page target', { frameUrl: frameUrlForCompare })

    for (let attempt = 0; attempt < DEVELOPER_TOOLS_TARGET_WAIT_ATTEMPTS; attempt += 1) {
      const { targets } = await readWebDebugTargets(runtime)
      latestTargets = targets
      const matchingTarget = targets.find(target => target.id === chiiTargetId) ??
        findWebDebugTargetForUrl(targets, frameUrlForCompare)
      debugIframeDevtools('target polling attempt', {
        attempt: attempt + 1,
        frameUrl: frameUrlForCompare,
        matchingTargetId: matchingTarget?.id,
        expectedTargetId: chiiTargetId,
        targetCount: targets.length
      })
      if (matchingTarget != null) return matchingTarget
      if (attempt < DEVELOPER_TOOLS_TARGET_WAIT_ATTEMPTS - 1) {
        await delay(DEVELOPER_TOOLS_TARGET_WAIT_MS)
      }
    }

    const fallbackTarget = latestTargets.length === 1 ? latestTargets[0] : null
    debugIframeDevtools('target polling finished', {
      fallbackTargetId: fallbackTarget?.id,
      frameUrl: frameUrlForCompare,
      targetCount: latestTargets.length
    })
    return fallbackTarget
  }, [chiiTargetId, getCurrentInspectableUrl])

  const openDeveloperTools = useCallback(async () => {
    let runtime: WebDebugChiiRuntime
    try {
      runtime = await readWebDebugChiiRuntime()
    } catch {
      void message.error(t('chat.interactionPanel.iframeDebugServiceUnavailable'))
      return
    }

    setIsDeveloperToolsOpen(true)
    setDeveloperToolsUrl(null)
    debugIframeDevtools('open developer tools', {
      dockSide: developerToolsDockSide,
      frameUrl: getCurrentInspectableUrl(),
      runtime
    })

    let injectionStatus = await injectCurrentPageTarget(runtime)
    debugIframeDevtools('explicit target injection finished', {
      frameUrl,
      status: injectionStatus
    })
    try {
      let target = await waitForCurrentPageTarget(runtime)
      if (target == null && injectionStatus !== 'unavailable') {
        debugIframeDevtools('force target reinjection after missing target', { frameUrl })
        injectionStatus = await injectCurrentPageTarget(runtime, { force: true })
        debugIframeDevtools('force target reinjection finished', { frameUrl, status: injectionStatus })
        target = await waitForCurrentPageTarget(runtime)
      }
      if (target != null) {
        debugIframeDevtools('open developer tools target', {
          dockSide: developerToolsDockSide,
          targetId: target.id,
          targetUrl: target.url
        })
        setDeveloperToolsUrl(buildDeveloperToolsUrlForTarget(runtime, target))
        return
      }
    } catch {
      // Keep the side target list visible when target polling fails.
    }

    if (injectionStatus !== 'injected') {
      debugIframeDevtools('copy target script fallback', { status: injectionStatus })
      await copyDeveloperToolsScriptFallback(runtime)
    }
  }, [
    copyDeveloperToolsScriptFallback,
    buildDeveloperToolsUrlForTarget,
    developerToolsDockSide,
    frameUrl,
    getCurrentInspectableUrl,
    injectCurrentPageTarget,
    message,
    t,
    waitForCurrentPageTarget
  ])

  const handleToggleDeveloperTools = () => {
    if (isDeveloperToolsOpen) {
      setIsDeveloperToolsOpen(false)
      return
    }

    void openDeveloperTools()
  }

  const handleToggleViewportToolbar = () => {
    setIsViewportToolbarOpen(current => !current)
  }

  const handleViewportPresetChange = (presetId: IframeViewportPresetId) => {
    setViewportPresetId(presetId)
    setViewportZoomValue('auto')
    const presetSize = IFRAME_VIEWPORT_PRESETS.find(preset => preset.id === presetId)?.size
    if (presetSize != null) setViewportSize(presetSize)
  }

  const handleViewportSizeChange = (dimension: keyof InteractionPanelEmbeddedFrameViewportSize, value: string) => {
    const nextValue = Math.min(4096, Math.max(1, Number.parseInt(value, 10) || 1))
    setViewportPresetId('responsive')
    setViewportSize(current => ({ ...current, [dimension]: nextValue }))
  }

  const handleViewportZoomChange = (value: string) => {
    if (value === 'auto') {
      setViewportZoomValue('auto')
      return
    }

    const nextZoomValue = Number.parseFloat(value)
    if (!Number.isFinite(nextZoomValue)) return
    setViewportZoomValue(nextZoomValue as IframeViewportZoomValue)
  }

  const handleRotateViewport = () => {
    setViewportSize(current => ({ height: current.width, width: current.height }))
    setViewportZoomValue('auto')
  }

  const handleSelectViewportMediaQuerySize = (width: number) => {
    setViewportPresetId('responsive')
    setViewportZoomValue('auto')
    setViewportSize(current => ({ ...current, width }))
  }

  const handleViewportResizeStart = (
    event: PointerEvent<HTMLDivElement>,
    edge: InteractionPanelEmbeddedFrameResizeEdge
  ) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)

    viewportResizeCleanupRef.current?.()
    setIsViewportResizing(true)
    setViewportPresetId('responsive')
    setViewportZoomValue('auto')

    const startX = event.clientX
    const startY = event.clientY
    const startSize = viewportSize
    const scale = Math.max(0.1, resolvedViewportScale)

    const resizeViewport = (clientX: number, clientY: number) => {
      const deltaX = (clientX - startX) / scale
      const deltaY = (clientY - startY) / scale
      const nextWidth = edge === 'right'
        ? startSize.width + deltaX
        : edge === 'left'
        ? startSize.width - deltaX
        : startSize.width
      const nextHeight = edge === 'bottom'
        ? startSize.height + deltaY
        : edge === 'top'
        ? startSize.height - deltaY
        : startSize.height

      setViewportSize({
        height: Math.min(4096, Math.max(1, Math.round(nextHeight))),
        width: Math.min(4096, Math.max(1, Math.round(nextWidth)))
      })
    }

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault()
      resizeViewport(moveEvent.clientX, moveEvent.clientY)
    }

    const cleanup = () => {
      setIsViewportResizing(false)
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', cleanup, true)
      window.removeEventListener('pointercancel', cleanup, true)
      viewportResizeCleanupRef.current = null
    }

    viewportResizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', cleanup, true)
    window.addEventListener('pointercancel', cleanup, true)
  }

  const handleToggleViewportDeviceFrame = () => {
    setIsViewportDeviceFrameVisible(current => !current)
    setIsViewportMoreOpen(false)
  }

  const handleToggleViewportMediaQueries = () => {
    setIsViewportMediaQueriesVisible(current => !current)
    setIsViewportMoreOpen(false)
  }

  const handleToggleViewportRulers = () => {
    setIsViewportRulersVisible(current => !current)
    setIsViewportMoreOpen(false)
  }

  const handleToggleViewportDevicePixelRatio = () => {
    setIsViewportDevicePixelRatioVisible(current => !current)
    setIsViewportMoreOpen(false)
  }

  const handleToggleViewportDeviceType = () => {
    setIsViewportDeviceTypeVisible(current => !current)
    setIsViewportMoreOpen(false)
  }

  const handleViewportScreenshot = async (fullSize: boolean) => {
    setIsViewportMoreOpen(false)

    try {
      const webviewElement = webviewRef.current
      if (webview.shouldUseWebview && webviewElement?.capturePage != null) {
        const screenshot = await webviewElement.capturePage()
        const dataUrl = screenshot.toDataURL()
        if (dataUrl.trim() === '') throw new Error('Empty screenshot.')
        await copyImageDataUrlToClipboard(dataUrl)
        void message.success(t('chat.interactionPanel.iframeScreenshotCopied'))
        return
      }

      const iframeElement = iframeRef.current
      if (iframeElement == null) throw new Error('Iframe is unavailable.')
      const dataUrl = await readIframeScreenshotDataUrl(iframeElement, fullSize)
      await copyImageDataUrlToClipboard(dataUrl)
      void message.success(t('chat.interactionPanel.iframeScreenshotCopied'))
    } catch {
      void message.error(t('chat.interactionPanel.iframeScreenshotFailed'))
    }
  }

  const handleResetViewportDefaults = () => {
    setViewportPresetId('responsive')
    setViewportZoomValue('auto')
    setViewportSize({ height: 844, width: 390 })
    setIsViewportDeviceFrameVisible(false)
    setIsViewportDevicePixelRatioVisible(false)
    setIsViewportDeviceTypeVisible(false)
    setIsViewportMediaQueriesVisible(true)
    setIsViewportRulersVisible(false)
    setIsViewportMoreOpen(false)
  }

  const handleWebviewAttached = useCallback(() => {
    setWebviewAttachVersion(current => current + 1)
  }, [])

  const postDeveloperToolsDockSide = useCallback(() => {
    const targetOrigin = getLoadedFrameOrigin(developerToolsFrameRef.current, developerToolsUrl)
    if (targetOrigin == null) {
      debugIframeDevtools('skip dock side post before devtools frame is ready', {
        dockSide: developerToolsDockSide
      })
      return
    }

    try {
      debugIframeDevtools('post dock side to devtools', {
        dockSide: developerToolsDockSide,
        origin: targetOrigin
      })
      developerToolsFrameRef.current?.contentWindow?.postMessage({
        dockSide: developerToolsDockSide,
        source: 'oneworks-host',
        type: 'dock-side-changed'
      }, targetOrigin)
    } catch {
      // The frame can disappear while switching targets or closing developer tools.
    }
  }, [developerToolsDockSide, developerToolsUrl])

  const postDeveloperToolsDeviceToolbarState = useCallback(() => {
    const targetOrigin = getLoadedFrameOrigin(developerToolsFrameRef.current, developerToolsUrl)
    if (targetOrigin == null) {
      debugIframeDevtools('skip device toolbar state post before devtools frame is ready', {
        isOpen: isViewportToolbarOpen
      })
      return
    }

    try {
      debugIframeDevtools('post device toolbar state to devtools', {
        isOpen: isViewportToolbarOpen,
        origin: targetOrigin
      })
      developerToolsFrameRef.current?.contentWindow?.postMessage({
        isOpen: isViewportToolbarOpen,
        source: 'oneworks-host',
        type: 'device-toolbar-state-changed'
      }, targetOrigin)
    } catch {
      // The frame can disappear while switching targets or closing developer tools.
    }
  }, [developerToolsUrl, isViewportToolbarOpen])

  const handleDeveloperToolsFrameLoad = () => {
    postDeveloperToolsDockSide()
    postDeveloperToolsDeviceToolbarState()
  }

  const handleDeveloperToolsResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    developerToolsResizeCleanupRef.current?.()

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Transparent overlay below keeps iframe/webview from swallowing the drag stream.
    }

    const startX = event.clientX
    const startY = event.clientY
    const isBottomDock = developerToolsDockSide === 'bottom'
    const startSize = isBottomDock ? developerToolsHeight : developerToolsWidth
    const containerRect = viewRef.current?.getBoundingClientRect()
    setIsDeveloperToolsResizing(true)

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (isBottomDock) {
        const deltaY = moveEvent.clientY - startY
        const containerMax = containerRect == null
          ? DEVELOPER_TOOLS_MAX_HEIGHT
          : Math.max(
            DEVELOPER_TOOLS_MIN_HEIGHT,
            Math.min(DEVELOPER_TOOLS_MAX_HEIGHT, containerRect.height - 220)
          )
        setDeveloperToolsHeight(Math.min(containerMax, Math.max(DEVELOPER_TOOLS_MIN_HEIGHT, startSize - deltaY)))
        return
      }

      const deltaX = moveEvent.clientX - startX
      const widthDelta = developerToolsDockSide === 'left' ? deltaX : -deltaX
      setDeveloperToolsWidth(clampDeveloperToolsWidth(startSize + widthDelta, containerRect?.width))
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', cleanup, true)
      window.removeEventListener('pointercancel', cleanup, true)
      window.removeEventListener('blur', cleanup)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
      developerToolsResizeCleanupRef.current = null
      if (isMountedRef.current) {
        setIsDeveloperToolsResizing(false)
      }
    }

    document.body.style.cursor = isBottomDock ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    developerToolsResizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', cleanup, { capture: true, once: true })
    window.addEventListener('pointercancel', cleanup, { capture: true, once: true })
    window.addEventListener('blur', cleanup, { once: true })
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
    void autoInjectCurrentPageTarget()
  }

  useEffect(() => {
    if (!webview.shouldUseWebview || frameUrl === '' || isMobileDebugDevtools) return

    const webviewElement = webviewRef.current
    if (webviewElement == null) return

    const handleReady = () => void autoInjectCurrentPageTarget()
    webviewElement.addEventListener('dom-ready', handleReady)
    webviewElement.addEventListener('did-finish-load', handleReady)
    handleReady()

    return () => {
      webviewElement.removeEventListener('dom-ready', handleReady)
      webviewElement.removeEventListener('did-finish-load', handleReady)
    }
  }, [
    autoInjectCurrentPageTarget,
    frameUrl,
    isMobileDebugDevtools,
    webview.shouldUseWebview,
    webviewAttachVersion
  ])

  useEffect(() => {
    if (!isActive || frameUrl === '' || isMobileDebugDevtools) return

    void autoInjectCurrentPageTarget()
    const timer = window.setInterval(
      () => void autoInjectCurrentPageTarget(),
      DEVELOPER_TOOLS_TARGET_AUTO_INJECT_MS
    )

    return () => window.clearInterval(timer)
  }, [
    autoInjectCurrentPageTarget,
    frameUrl,
    isActive,
    isMobileDebugDevtools
  ])

  useEffect(() => {
    const handleDeveloperToolsMessage = (event: MessageEvent) => {
      if (event.source !== developerToolsFrameRef.current?.contentWindow) return
      const frameOrigin = getLoadedFrameOrigin(developerToolsFrameRef.current, developerToolsUrl)
      if (event.origin !== developerToolsOrigin && event.origin !== frameOrigin) return

      const data = event.data as {
        dockSide?: unknown
        label?: unknown
        payload?: unknown
        source?: unknown
        type?: unknown
      } | null
      if (data?.source !== 'oneworks-devtools') return
      if (data.type === 'debug-log') {
        debugIframeDevtoolsJson(
          `devtools ${typeof data.label === 'string' ? data.label : 'log'}`,
          data.payload
        )
        return
      }
      debugIframeDevtools('received devtools message', {
        dockSide: data.dockSide,
        origin: event.origin,
        type: data.type
      })

      if (data.type === 'set-dock-side') {
        if (data.dockSide !== 'left' && data.dockSide !== 'right' && data.dockSide !== 'bottom') return
        setDeveloperToolsDockSide(data.dockSide)
        return
      }

      if (data.type === 'toggle-device-toolbar') {
        setIsViewportToolbarOpen(current => !current)
      }
    }

    window.addEventListener('message', handleDeveloperToolsMessage)
    return () => window.removeEventListener('message', handleDeveloperToolsMessage)
  }, [developerToolsOrigin, developerToolsUrl])

  useEffect(() => {
    postDeveloperToolsDockSide()
  }, [developerToolsDockSide, developerToolsUrl, postDeveloperToolsDockSide])

  useEffect(() => {
    postDeveloperToolsDeviceToolbarState()
  }, [developerToolsUrl, isViewportToolbarOpen, postDeveloperToolsDeviceToolbarState])

  useEffect(() => {
    if (!isDeveloperToolsOpen || frameUrl === '' || isMobileDebugDevtools) return
    let isCancelled = false

    const ensureDeveloperToolsTarget = async () => {
      try {
        const runtime = await readWebDebugChiiRuntime()
        const frameUrlForCompare = getCurrentInspectableUrl()
        const { targets } = await readWebDebugTargets(runtime)
        const existingTarget = targets.find(target => target.id === chiiTargetId) ??
          findWebDebugTargetForUrl(targets, frameUrlForCompare)
        debugIframeDevtools('developer tools target healthcheck', {
          expectedTargetId: chiiTargetId,
          frameUrl: frameUrlForCompare,
          hasTarget: existingTarget != null,
          targetCount: targets.length,
          targetId: existingTarget?.id
        })
        if (existingTarget != null || isCancelled) return

        debugIframeDevtools('developer tools target missing; force reinject', {
          frameUrl: frameUrlForCompare
        })
        const injectionStatus = await injectCurrentPageTarget(runtime, { force: true })
        debugIframeDevtools('developer tools target force reinject finished', {
          frameUrl: frameUrlForCompare,
          status: injectionStatus
        })
        if (injectionStatus === 'unavailable' || isCancelled) return

        const target = await waitForCurrentPageTarget(runtime)
        if (target == null || isCancelled) return
        debugIframeDevtools('developer tools target recovered', {
          targetId: target.id,
          targetUrl: target.url
        })
        setDeveloperToolsUrl(buildDeveloperToolsUrlForTarget(runtime, target))
      } catch {
        // Health checks are best effort; the next interval will retry.
      }
    }

    void ensureDeveloperToolsTarget()
    const timer = window.setInterval(
      () => void ensureDeveloperToolsTarget(),
      DEVELOPER_TOOLS_TARGET_HEALTHCHECK_MS
    )

    return () => {
      isCancelled = true
      window.clearInterval(timer)
    }
  }, [
    buildDeveloperToolsUrlForTarget,
    chiiTargetId,
    frameUrl,
    getCurrentInspectableUrl,
    injectCurrentPageTarget,
    isDeveloperToolsOpen,
    isMobileDebugDevtools,
    waitForCurrentPageTarget
  ])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      developerToolsResizeCleanupRef.current?.()
    }
  }, [])

  const developerToolsPaneStyle = developerToolsDockSide === 'bottom'
    ? { height: developerToolsHeight }
    : { width: developerToolsWidth }

  return (
    <div ref={viewRef} className='chat-interaction-panel__iframe-view'>
      <div
        className={[
          'chat-interaction-panel__iframe-workspace',
          isDeveloperToolsOpen ? 'has-devtools' : '',
          isDeveloperToolsOpen ? `is-dock-${developerToolsDockSide}` : '',
          isDeveloperToolsResizing ? 'is-resizing-devtools' : ''
        ].filter(Boolean).join(' ')}
      >
        <div ref={pagePaneRef} className='chat-interaction-panel__iframe-page-pane'>
          {!shouldHideToolbar && (
            <div
              ref={toolbarRef}
              className='chat-interaction-panel__iframe-toolbar'
              data-dock-panel-no-resize='true'
            >
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
                isDeveloperToolsOpen={isDeveloperToolsOpen}
                isViewportToolbarOpen={isViewportToolbarOpen}
                shouldUseWebview={webview.shouldUseWebview}
                webviewRef={webviewRef}
                onForceReload={handleRefresh}
                onToggleDeveloperTools={handleToggleDeveloperTools}
                onToggleViewportToolbar={handleToggleViewportToolbar}
              />
            </div>
          )}
          {!shouldHideToolbar && isViewportToolbarOpen && (
            <div
              ref={viewportToolbarRef}
              className='chat-interaction-panel__iframe-viewport-toolbar'
              data-dock-panel-no-resize='true'
            >
              <span className='chat-interaction-panel__iframe-viewport-label'>
                {t('chat.interactionPanel.iframeViewportDimensions')}
              </span>
              <select
                className='chat-interaction-panel__iframe-viewport-select is-preset'
                value={viewportPresetId}
                aria-label={t('chat.interactionPanel.iframeViewportPreset')}
                onChange={event => handleViewportPresetChange(event.currentTarget.value as IframeViewportPresetId)}
              >
                <option value={IFRAME_VIEWPORT_RESPONSIVE_PRESET.id}>
                  {t(IFRAME_VIEWPORT_RESPONSIVE_PRESET.labelKey)}
                </option>
                <optgroup label={t('chat.interactionPanel.iframeViewportStandard')}>
                  {IFRAME_VIEWPORT_STANDARD_PRESETS.map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label ?? preset.id}
                    </option>
                  ))}
                </optgroup>
              </select>
              <input
                className='chat-interaction-panel__iframe-viewport-input'
                type='number'
                min={1}
                max={4096}
                disabled={!isViewportSizeEditable}
                value={viewportSize.width}
                aria-label={t('chat.interactionPanel.iframeViewportWidth')}
                onChange={event => handleViewportSizeChange('width', event.currentTarget.value)}
              />
              <span className='chat-interaction-panel__iframe-viewport-cross'>×</span>
              <input
                className='chat-interaction-panel__iframe-viewport-input'
                type='number'
                min={1}
                max={4096}
                disabled={!isViewportSizeEditable}
                value={viewportSize.height}
                aria-label={t('chat.interactionPanel.iframeViewportHeight')}
                onChange={event => handleViewportSizeChange('height', event.currentTarget.value)}
              />
              <select
                className='chat-interaction-panel__iframe-viewport-select is-compact'
                value={viewportZoomValue}
                aria-label={t('chat.interactionPanel.iframeViewportZoom')}
                onChange={event => handleViewportZoomChange(event.currentTarget.value)}
              >
                <option value='auto'>
                  {t('chat.interactionPanel.iframeViewportZoomAuto', { value: viewportZoomPercent })}
                </option>
                {IFRAME_VIEWPORT_ZOOM_OPTIONS.map(zoomValue => (
                  <option key={zoomValue} value={zoomValue}>
                    {Math.round(zoomValue * 100)}%
                  </option>
                ))}
              </select>
              {isViewportDevicePixelRatioVisible && (
                <select
                  className='chat-interaction-panel__iframe-viewport-select is-compact'
                  value={viewportDevicePixelRatio}
                  aria-label={t('chat.interactionPanel.iframeViewportDevicePixelRatio')}
                  onChange={event => setViewportDevicePixelRatio(event.currentTarget.value)}
                >
                  <option value='1'>DPR 1</option>
                  <option value='2'>DPR 2</option>
                  <option value='3'>DPR 3</option>
                </select>
              )}
              {isViewportDeviceTypeVisible && (
                <select
                  className='chat-interaction-panel__iframe-viewport-select is-device-type'
                  value={viewportDeviceType}
                  aria-label={t('chat.interactionPanel.iframeViewportDeviceType')}
                  onChange={event => setViewportDeviceType(event.currentTarget.value as IframeViewportDeviceType)}
                >
                  <option value='mobile'>{t('chat.interactionPanel.iframeViewportDeviceTypeMobile')}</option>
                  <option value='desktop'>{t('chat.interactionPanel.iframeViewportDeviceTypeDesktop')}</option>
                </select>
              )}
              <span className='chat-interaction-panel__iframe-viewport-spacer' aria-hidden='true' />
              <button
                type='button'
                className='chat-interaction-panel__iframe-viewport-icon-btn'
                aria-label={t('chat.interactionPanel.iframeViewportRotate')}
                onClick={handleRotateViewport}
              >
                <span className='material-symbols-rounded' aria-hidden='true'>screen_rotation</span>
              </button>
              <Dropdown
                trigger={['click']}
                open={isViewportMoreOpen}
                menu={{ items: [] }}
                overlayClassName='chat-interaction-panel-viewport-menu-dropdown'
                placement='bottomRight'
                popupRender={() => (
                  <OverlayPanel
                    className='chat-interaction-panel-viewport-menu'
                    onClick={event => event.stopPropagation()}
                    onMouseDown={event => event.stopPropagation()}
                  >
                    <OverlayAction
                      className='chat-interaction-panel-viewport-menu__item'
                      icon='mobile'
                      selected={isViewportDeviceFrameVisible}
                      aria-label={t(
                        isViewportDeviceFrameVisible
                          ? 'chat.interactionPanel.iframeViewportHideDeviceFrame'
                          : 'chat.interactionPanel.iframeViewportShowDeviceFrame'
                      )}
                      onClick={handleToggleViewportDeviceFrame}
                    />
                    <OverlayAction
                      className='chat-interaction-panel-viewport-menu__item'
                      icon='view_timeline'
                      selected={isViewportMediaQueriesVisible}
                      aria-label={t(
                        isViewportMediaQueriesVisible
                          ? 'chat.interactionPanel.iframeViewportHideMediaQueries'
                          : 'chat.interactionPanel.iframeViewportShowMediaQueries'
                      )}
                      onClick={handleToggleViewportMediaQueries}
                    />
                    <OverlayAction
                      className='chat-interaction-panel-viewport-menu__item'
                      icon='rule_settings'
                      selected={isViewportRulersVisible}
                      aria-label={t(
                        isViewportRulersVisible
                          ? 'chat.interactionPanel.iframeViewportHideRulers'
                          : 'chat.interactionPanel.iframeViewportShowRulers'
                      )}
                      onClick={handleToggleViewportRulers}
                    />
                    <OverlayDivider className='chat-interaction-panel-viewport-menu__divider' decorative />
                    <OverlayAction
                      className='chat-interaction-panel-viewport-menu__item'
                      icon='density_medium'
                      selected={isViewportDevicePixelRatioVisible}
                      aria-label={t(
                        isViewportDevicePixelRatioVisible
                          ? 'chat.interactionPanel.iframeViewportRemoveDevicePixelRatio'
                          : 'chat.interactionPanel.iframeViewportAddDevicePixelRatio'
                      )}
                      onClick={handleToggleViewportDevicePixelRatio}
                    />
                    <OverlayAction
                      className='chat-interaction-panel-viewport-menu__item'
                      icon='devices'
                      selected={isViewportDeviceTypeVisible}
                      aria-label={t(
                        isViewportDeviceTypeVisible
                          ? 'chat.interactionPanel.iframeViewportRemoveDeviceType'
                          : 'chat.interactionPanel.iframeViewportAddDeviceType'
                      )}
                      onClick={handleToggleViewportDeviceType}
                    />
                    <OverlayDivider className='chat-interaction-panel-viewport-menu__divider' decorative />
                    <OverlayAction
                      className='chat-interaction-panel-viewport-menu__item'
                      icon='image'
                      aria-label={t('chat.interactionPanel.iframeViewportCaptureScreenshot')}
                      onClick={() => void handleViewportScreenshot(false)}
                    />
                    <OverlayAction
                      className='chat-interaction-panel-viewport-menu__item'
                      icon='fullscreen'
                      aria-label={t('chat.interactionPanel.iframeViewportCaptureFullSizeScreenshot')}
                      onClick={() => void handleViewportScreenshot(true)}
                    />
                    <OverlayDivider className='chat-interaction-panel-viewport-menu__divider' decorative />
                    <OverlayAction
                      className='chat-interaction-panel-viewport-menu__item'
                      icon='restart_alt'
                      aria-label={t('chat.interactionPanel.iframeViewportResetToDefaults')}
                      onClick={handleResetViewportDefaults}
                    />
                  </OverlayPanel>
                )}
                onOpenChange={setIsViewportMoreOpen}
              >
                <button
                  type='button'
                  className={`chat-interaction-panel__iframe-viewport-icon-btn ${isViewportMoreOpen ? 'is-open' : ''}`}
                  aria-label={t('chat.interactionPanel.iframeMore')}
                >
                  <span className='material-symbols-rounded' aria-hidden='true'>more_vert</span>
                </button>
              </Dropdown>
            </div>
          )}
          <InteractionPanelEmbeddedFrame
            frameUrl={embeddedFrameUrl}
            iframeRef={iframeRef}
            page={page}
            reloadVersion={reloadVersion}
            shouldUseWebview={webview.shouldUseWebview}
            t={t}
            isViewportResizing={isViewportResizing}
            showDeviceFrame={isViewportDeviceFrameVisible}
            showMediaQueries={isViewportMediaQueriesVisible}
            showRulers={isViewportRulersVisible}
            viewportScale={resolvedViewportScale}
            viewportSize={iframeViewportSize}
            webviewRef={webviewRef}
            onIframeLoad={handleLoad}
            onSelectMediaQuerySize={handleSelectViewportMediaQuerySize}
            onViewportResizeStart={handleViewportResizeStart}
            onWebviewAttached={handleWebviewAttached}
          />
        </div>
        {isDeveloperToolsOpen && (
          <>
            <div
              className='chat-interaction-panel__iframe-devtools-resizer'
              role='separator'
              aria-label={t('chat.interactionPanel.iframeDebugResizeDeveloperTools')}
              data-dock-panel-no-resize='true'
              onPointerDown={handleDeveloperToolsResizeStart}
            />
            <div
              className='chat-interaction-panel__iframe-devtools-pane'
              style={developerToolsPaneStyle}
            >
              {developerToolsUrl == null
                ? (
                  <InteractionPanelPageDebuggerListView
                    devtoolsDockSide={developerToolsDockSide}
                    isActive={isActive}
                    onOpenDevtoolsUrl={(url) =>
                      setDeveloperToolsUrl(
                        appendDeveloperToolsToolbarMetrics(url, toolbarRef.current)
                      )}
                  />
                )
                : (
                  <iframe
                    ref={developerToolsFrameRef}
                    className='chat-interaction-panel__iframe-devtools-frame'
                    src={developerToolsUrl}
                    title={t('chat.interactionPanel.iframeDebugDeveloperToolsTitle')}
                    onLoad={handleDeveloperToolsFrameLoad}
                  />
                )}
            </div>
          </>
        )}
        {isDeveloperToolsResizing && (
          <div
            className='chat-interaction-panel__iframe-devtools-resize-overlay'
            data-dock-panel-no-resize='true'
          />
        )}
      </div>
    </div>
  )
}
