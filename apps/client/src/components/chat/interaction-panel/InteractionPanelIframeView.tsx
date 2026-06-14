/* eslint-disable max-lines -- iframe view coordinates URL state, navigation controls, and webview lifecycle. */
import { App } from 'antd'
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
import { addDesktopViewShortcutListener } from '#~/desktop/view-shortcuts'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'

import { InteractionPanelEmbeddedFrame } from './InteractionPanelEmbeddedFrame'
import type { InteractionPanelEmbeddedFrameViewportSize } from './InteractionPanelEmbeddedFrame'
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
type IframeViewportPresetId = 'desktop' | 'mobile' | 'responsive' | 'tablet'

const IFRAME_VIEWPORT_PRESETS: Array<{
  icon: string
  id: IframeViewportPresetId
  labelKey: string
  size: InteractionPanelEmbeddedFrameViewportSize | null
}> = [
  {
    icon: 'fit_screen',
    id: 'responsive',
    labelKey: 'chat.interactionPanel.iframeViewportResponsive',
    size: null
  },
  {
    icon: 'smartphone',
    id: 'mobile',
    labelKey: 'chat.interactionPanel.iframeViewportMobile',
    size: { height: 844, width: 390 }
  },
  {
    icon: 'tablet_mac',
    id: 'tablet',
    labelKey: 'chat.interactionPanel.iframeViewportTablet',
    size: { height: 1024, width: 768 }
  },
  {
    icon: 'desktop_windows',
    id: 'desktop',
    labelKey: 'chat.interactionPanel.iframeViewportDesktop',
    size: { height: 800, width: 1280 }
  }
]

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
  const [isViewportToolbarOpen, setIsViewportToolbarOpen] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)
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
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<HTMLDivElement | null>(null)
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
  const iframeViewportSize = viewportPresetId === 'responsive' ? null : viewportSize
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
    const presetSize = IFRAME_VIEWPORT_PRESETS.find(preset => preset.id === presetId)?.size
    if (presetSize != null) setViewportSize(presetSize)
  }

  const handleViewportSizeChange = (dimension: keyof InteractionPanelEmbeddedFrameViewportSize, value: string) => {
    const nextValue = Math.min(4096, Math.max(1, Number.parseInt(value, 10) || 1))
    setViewportSize(current => ({ ...current, [dimension]: nextValue }))
  }

  const handleRotateViewport = () => {
    setViewportSize(current => ({ height: current.width, width: current.height }))
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
        <div className='chat-interaction-panel__iframe-page-pane'>
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
            <div className='chat-interaction-panel__iframe-viewport-toolbar' data-dock-panel-no-resize='true'>
              <span className='chat-interaction-panel__iframe-viewport-label'>
                {t('chat.interactionPanel.iframeViewportDimensions')}
              </span>
              <select
                className='chat-interaction-panel__iframe-viewport-select'
                value={viewportPresetId}
                aria-label={t('chat.interactionPanel.iframeViewportPreset')}
                onChange={event => handleViewportPresetChange(event.currentTarget.value as IframeViewportPresetId)}
              >
                {IFRAME_VIEWPORT_PRESETS.map(preset => (
                  <option key={preset.id} value={preset.id}>{t(preset.labelKey)}</option>
                ))}
              </select>
              <input
                className='chat-interaction-panel__iframe-viewport-input'
                type='number'
                min={1}
                max={4096}
                disabled={iframeViewportSize == null}
                value={iframeViewportSize?.width ?? ''}
                aria-label={t('chat.interactionPanel.iframeViewportWidth')}
                onChange={event => handleViewportSizeChange('width', event.currentTarget.value)}
              />
              <span className='chat-interaction-panel__iframe-viewport-cross'>×</span>
              <input
                className='chat-interaction-panel__iframe-viewport-input'
                type='number'
                min={1}
                max={4096}
                disabled={iframeViewportSize == null}
                value={iframeViewportSize?.height ?? ''}
                aria-label={t('chat.interactionPanel.iframeViewportHeight')}
                onChange={event => handleViewportSizeChange('height', event.currentTarget.value)}
              />
              <select
                className='chat-interaction-panel__iframe-viewport-select is-compact'
                value='100'
                aria-label={t('chat.interactionPanel.iframeViewportZoom')}
                disabled
                onChange={() => undefined}
              >
                <option value='100'>100%</option>
              </select>
              <button
                type='button'
                className='chat-interaction-panel__iframe-viewport-icon-btn'
                disabled={iframeViewportSize == null}
                aria-label={t('chat.interactionPanel.iframeViewportRotate')}
                onClick={handleRotateViewport}
              >
                <span className='material-symbols-rounded' aria-hidden='true'>screen_rotation</span>
              </button>
              <select
                className='chat-interaction-panel__iframe-viewport-select'
                value='none'
                aria-label={t('chat.interactionPanel.iframeViewportNetwork')}
                disabled
                onChange={() => undefined}
              >
                <option value='none'>{t('chat.interactionPanel.iframeViewportNoThrottling')}</option>
              </select>
            </div>
          )}
          <InteractionPanelEmbeddedFrame
            frameUrl={embeddedFrameUrl}
            iframeRef={iframeRef}
            page={page}
            reloadVersion={reloadVersion}
            shouldUseWebview={webview.shouldUseWebview}
            t={t}
            viewportSize={iframeViewportSize}
            webviewRef={webviewRef}
            onIframeLoad={handleLoad}
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
