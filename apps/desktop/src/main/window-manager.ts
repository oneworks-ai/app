/* eslint-disable max-lines -- window manager keeps workspace loading and selector-window transitions together. */
import process from 'node:process'

import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'

import { matchesPinyinSearch, normalizePinyinSearchQuery } from '@oneworks/utils/pinyin-search'

import { createWorkspaceSelectorHtml as createWorkspaceSelectorHtmlBase } from '../workspace-selector-page.cjs'
import { normalizeWorkspaceFolder } from '../workspace-state.cjs'
import { createBrowserWindowFactory } from './browser-window-factory'
import { WORKSPACE_RESOURCE_REQUEST_CHANNEL } from './constants'
import type { LauncherClientServiceManager } from './launcher-client-service'
import type {
  DesktopRuntimeState,
  LauncherWorkspacePluginSearchResponse,
  LauncherWorkspaceResourceSearchResponse,
  OpenWorkspaceWindowInput,
  WindowRecord,
  WorkspaceResourceTarget,
  WorkspaceSelectorMode,
  WorkspaceSelectorWindowInput
} from './types'
import { restoreWorkspaceReadyWindowBackground, setWorkspaceLoadingWindowBackground } from './window-chrome-options'
import { isLoadUrlAbortError, showWindowLoadFailureScreen } from './window-load-failure'
import {
  buildLauncherWindowTitle,
  buildWorkspaceSelectorWindowTitle,
  buildWorkspaceWindowTitle,
  ensureTrailingSlash
} from './window-titles'
import { createWorkspaceDialogController } from './workspace-dialogs'
import { searchWorkspaceFiles } from './workspace-file-search'
import { createWorkspaceSelectorStateController } from './workspace-selector-state'
import type { WorkspaceServiceManager } from './workspace-service-manager'

const createWorkspaceSelectorHtml = createWorkspaceSelectorHtmlBase as (input: {
  errorMessage?: string
  mode?: WorkspaceSelectorMode
}) => string

const launcherShowAnimation = {
  distance: 16,
  duration: 180,
  frameMs: 16
}

const easeOutCubic = (progress: number) => 1 - (1 - progress) ** 3

const normalizeWorkspaceClientUrl = (clientUrl: string, rawUrl: string) => {
  const serverClientUrl = new URL(ensureTrailingSlash(clientUrl))
  const targetUrl = new URL(rawUrl, serverClientUrl)
  const clientBasePath = serverClientUrl.pathname.replace(/\/+$/, '')

  const isWithinClientBase = targetUrl.pathname === clientBasePath ||
    targetUrl.pathname.startsWith(`${clientBasePath}/`)
  if (targetUrl.origin !== serverClientUrl.origin || !isWithinClientBase) {
    throw new Error('The requested window URL is outside of this workspace.')
  }

  return targetUrl.toString()
}

const getWorkspaceClientRoutePath = (clientUrl: string, rawUrl?: string) => {
  const routePath = getWorkspaceClientAnyRoutePath(clientUrl, rawUrl)
  return /^\/session\/[^/]+/.test(routePath) ? routePath : '/'
}

const getWorkspaceClientAnyRoutePath = (clientUrl: string, rawUrl?: string) => {
  if (rawUrl == null || rawUrl.trim() === '') return '/'

  try {
    const serverClientUrl = new URL(ensureTrailingSlash(clientUrl))
    const sourceUrl = new URL(rawUrl)
    const clientBasePath = serverClientUrl.pathname.replace(/\/+$/, '')
    const isWithinClientBase = sourceUrl.origin === serverClientUrl.origin &&
      (sourceUrl.pathname === clientBasePath || sourceUrl.pathname.startsWith(`${clientBasePath}/`))
    if (!isWithinClientBase) return '/'

    const routePath = sourceUrl.pathname.slice(clientBasePath.length) || '/'
    return routePath.startsWith('/') ? routePath : `/${routePath}`
  } catch {
    return '/'
  }
}

const isWorkspaceChatRoute = (clientUrl: string, rawUrl?: string) => {
  const routePath = getWorkspaceClientAnyRoutePath(clientUrl, rawUrl)
  return routePath === '/' || /^\/session\/[^/]+/.test(routePath)
}

const appendWorkspaceResourceTargetParams = (url: URL, target: WorkspaceResourceTarget) => {
  url.searchParams.set('launcherAction', target.kind)
  url.searchParams.set('launcherRequestId', `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  if (target.path != null) url.searchParams.set('launcherPath', target.path)
  if (target.sessionId != null) url.searchParams.set('launcherSessionId', target.sessionId)
  if (target.terminalId != null) url.searchParams.set('launcherTerminalId', target.terminalId)
  if (target.title != null) url.searchParams.set('launcherTitle', target.title)
  if (target.url != null) url.searchParams.set('launcherUrl', target.url)
  return url
}

const buildWorkspaceResourceTargetUrl = (
  clientUrl: string,
  target: WorkspaceResourceTarget,
  sourceUrl?: string
) => {
  const routePath = getWorkspaceClientRoutePath(clientUrl, sourceUrl)
  const route = routePath === '/' ? '' : routePath.replace(/^\/+/, '')
  const targetUrl = new URL(route, ensureTrailingSlash(clientUrl))
  return appendWorkspaceResourceTargetParams(targetUrl, target).toString()
}

const WORKSPACE_TERMINAL_SESSION_ID = '__workspace__'
const LAUNCHER_RESOURCE_RESULT_LIMIT = 40

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const unwrapApiData = (value: unknown) => (
  isRecord(value) && value.success === true && 'data' in value ? value.data : value
)

const getErrorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
)

const elapsedMs = (startedAt: number) => `${Date.now() - startedAt}ms`

const logDesktopTiming = (message: string) => {
  process.stdout.write(`[oneworks-desktop] ${message}\n`)
}

const normalizeResourceQuery = normalizePinyinSearchQuery

const matchesResourceQuery = (query: string, values: Array<string | undefined>) => {
  if (query === '') return true
  return matchesPinyinSearch(query, values)
}

const getSessionTitle = (session: Record<string, unknown>) => {
  const title = typeof session.title === 'string' ? session.title.trim() : ''
  if (title !== '') return title
  const lastUserMessage = typeof session.lastUserMessage === 'string' ? session.lastUserMessage.trim() : ''
  if (lastUserMessage !== '') return lastUserMessage
  return typeof session.id === 'string' ? session.id : ''
}

const buildStoredResourcesScript = (terminalSessionId: string) =>
  `(() => {
  const parseJson = value => {
    try {
      return value == null ? null : JSON.parse(value)
    } catch {
      return null
    }
  }
  const asText = value => typeof value === 'string' ? value.trim() : ''
  const websitesByUrl = new Map()
  const addWebsite = value => {
    if (value == null || typeof value !== 'object') return
    const url = asText(value.url)
    if (url === '' || websitesByUrl.has(url)) return
    const title = asText(value.title) || url
    const faviconUrl = asText(value.faviconUrl)
    const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : 0
    websitesByUrl.set(url, {
      id: 'website:' + url,
      kind: 'website',
      title,
      updatedAt,
      url,
      ...(faviconUrl === '' ? {} : { faviconUrl })
    })
  }

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || ''
    const value = parseJson(localStorage.getItem(key))
    if (key.startsWith('chatInteractionUrlHistory:') && Array.isArray(value)) {
      value.forEach(addWebsite)
    }
    if (key.startsWith('chatInteractionIframePages:') && Array.isArray(value)) {
      value.forEach(page => addWebsite({ ...page, updatedAt: Number.MAX_SAFE_INTEGER - index }))
    }
  }

  const terminalPanes = parseJson(localStorage.getItem(${JSON.stringify(`chatTerminalPaneIds:${terminalSessionId}`)}))
  const terminals = Array.isArray(terminalPanes)
    ? terminalPanes.map((pane, index) => {
      if (typeof pane === 'string' && pane.trim() !== '') {
        return { id: 'terminal:' + pane.trim(), kind: 'terminal', terminalId: pane.trim(), title: pane.trim() }
      }
      if (pane == null || typeof pane !== 'object') return null
      const terminalId = asText(pane.id)
      if (terminalId === '') return null
      const title = asText(pane.title) || terminalId
      const shellKind = asText(pane.shellKind)
      return {
        id: 'terminal:' + terminalId,
        kind: 'terminal',
        terminalId,
        title,
        ...(shellKind === '' ? {} : { shellKind })
      }
    }).filter(Boolean)
    : []

  return {
    terminals,
    websites: Array.from(websitesByUrl.values()).sort((left, right) => right.updatedAt - left.updatedAt)
  }
})()`

interface WindowManagerInput {
  ensureLauncherClientService: LauncherClientServiceManager['ensureLauncherClientService']
  ensureWorkspaceService: WorkspaceServiceManager['ensureWorkspaceService']
  forgetWorkspaceFolder: (workspaceFolder: string) => void
  refreshAppMenu: () => void
  rememberWorkspaceFolder: (workspaceFolder: string) => void
  runtimeState: DesktopRuntimeState
  stopWorkspaceService: WorkspaceServiceManager['stopWorkspaceService']
}

export const createWindowManager = ({
  ensureLauncherClientService,
  ensureWorkspaceService,
  forgetWorkspaceFolder,
  refreshAppMenu,
  rememberWorkspaceFolder,
  runtimeState,
  stopWorkspaceService
}: WindowManagerInput) => {
  const getWindowRecords = () => Array.from(runtimeState.windows.values())

  const hasWorkspaceWindowRecord = (workspaceFolder: string) => (
    getWindowRecords()
      .some(candidate => candidate.kind === 'workspace' && candidate.workspaceFolder === workspaceFolder)
  )

  const stopUnusedSourceWorkspaceService = async (
    sourceWorkspaceFolder: string | undefined,
    nextWorkspaceFolder?: string
  ) => {
    if (
      sourceWorkspaceFolder == null ||
      sourceWorkspaceFolder === nextWorkspaceFolder ||
      hasWorkspaceWindowRecord(sourceWorkspaceFolder) ||
      getWindowRecords().some(candidate => candidate.kind === 'launcher')
    ) {
      return
    }

    const sourceService = runtimeState.services.get(sourceWorkspaceFolder)
    if (sourceService != null) {
      await stopWorkspaceService(sourceService)
    }
  }

  const findWindowRecord = (window: BrowserWindow | null) => (
    window == null ? undefined : runtimeState.windows.get(window.id)
  )

  const findWindowRecordForWebContents = (webContents: WebContents) => (
    findWindowRecord(BrowserWindow.fromWebContents(webContents))
  )

  const ensureSharedClientUrl = async () => {
    const service = await ensureLauncherClientService()
    if (service.clientUrl == null) {
      throw new Error('The local One Works client did not publish a URL.')
    }
    return service.clientUrl
  }

  const isWindowRecordUsable = (windowRecord?: WindowRecord) => (
    windowRecord != null &&
    windowRecord.window != null &&
    !windowRecord.window.isDestroyed()
  )

  const focusWindowRecord = (windowRecord: WindowRecord) => {
    if (!isWindowRecordUsable(windowRecord)) return

    if (windowRecord.window.isMinimized()) {
      windowRecord.window.restore()
    }
    windowRecord.window.show()
    windowRecord.window.focus()
  }

  const showLauncherWindowRecord = (windowRecord: WindowRecord) => {
    if (!isWindowRecordUsable(windowRecord)) return

    const { window } = windowRecord
    if (window.isMinimized()) {
      window.restore()
    }
    if (process.platform !== 'darwin') {
      window.show()
      window.focus()
      return
    }

    const [targetX, targetY] = window.getPosition()
    const [width, height] = window.getSize()
    const startY = targetY + launcherShowAnimation.distance
    const startTime = Date.now()
    window.setOpacity(0)
    window.setBounds({ height, width, x: targetX, y: startY }, false)
    window.show()
    window.focus()

    const animate = () => {
      if (!isWindowRecordUsable(windowRecord) || !window.isVisible()) return

      const progress = Math.min(1, (Date.now() - startTime) / launcherShowAnimation.duration)
      const easedProgress = easeOutCubic(progress)
      window.setOpacity(easedProgress)
      window.setPosition(
        targetX,
        Math.round(startY + (targetY - startY) * easedProgress),
        false
      )

      if (progress < 1) {
        setTimeout(animate, launcherShowAnimation.frameMs)
        return
      }

      window.setOpacity(1)
      window.setPosition(targetX, targetY, false)
    }

    setTimeout(animate, launcherShowAnimation.frameMs)
  }

  const findWorkspaceWindowRecord = (workspaceFolder: string) => (
    getWindowRecords()
      .find(candidate => candidate.kind === 'workspace' && candidate.workspaceFolder === workspaceFolder)
  )

  const findReusableStartupWindowRecord = () => (
    getWindowRecords()
      .find(candidate => candidate.kind === 'selector' && candidate.selectorMode === 'initial')
  )

  const findLauncherWindowRecord = () => (
    getWindowRecords().find(candidate => candidate.kind === 'launcher')
  )

  const findWorkspaceSelectorWindowRecord = (mode: WorkspaceSelectorMode) => (
    getWindowRecords().find(candidate => candidate.kind === 'selector' && candidate.selectorMode === mode)
  )

  const selectorStateController = createWorkspaceSelectorStateController({
    getWindowRecords,
    isWindowRecordUsable,
    runtimeState
  })

  const createWindowRecord = createBrowserWindowFactory({
    broadcastWorkspaceSelectorState: selectorStateController.broadcastWorkspaceSelectorState,
    getWindowRecords,
    refreshAppMenu,
    runtimeState,
    stopWorkspaceService
  }).createWindowRecord

  const loadWorkspaceSelectorWindow = async (
    windowRecord: WindowRecord,
    input: WorkspaceSelectorWindowInput = {}
  ) => {
    if (!isWindowRecordUsable(windowRecord)) {
      return
    }

    windowRecord.currentServerUrl = undefined
    windowRecord.workspaceServerUrl = undefined
    windowRecord.kind = 'selector'
    windowRecord.selectorMode = input.mode ?? windowRecord.selectorMode ?? 'dialog'
    windowRecord.workspaceFolder = undefined
    windowRecord.window.setTitle(buildWorkspaceSelectorWindowTitle())
    await windowRecord.window.loadURL(
      `data:text/html;charset=utf-8,${
        encodeURIComponent(createWorkspaceSelectorHtml({
          errorMessage: input.errorMessage,
          mode: windowRecord.selectorMode
        }))
      }`
    )
    selectorStateController.broadcastWorkspaceSelectorState()
  }

  const getFocusedWorkspaceWindowRecord = () => {
    const focusedWindowRecord = findWindowRecord(BrowserWindow.getFocusedWindow())
    return focusedWindowRecord?.kind === 'workspace'
      ? focusedWindowRecord
      : undefined
  }

  const loadLauncherWindow = async (
    windowRecord: WindowRecord,
    input: {
      show?: boolean
      sourceWorkspaceFolder?: string
      sourceUrl?: string
      sourceWindowId?: number
    } = {}
  ) => {
    if (!isWindowRecordUsable(windowRecord)) {
      return
    }

    windowRecord.currentServerUrl = undefined
    windowRecord.workspaceServerUrl = undefined
    windowRecord.kind = 'launcher'
    windowRecord.selectorMode = undefined
    windowRecord.workspaceFolder = input.sourceWorkspaceFolder
    windowRecord.launcherSourceUrl = input.sourceUrl
    windowRecord.launcherSourceWindowId = input.sourceWindowId
    windowRecord.window.setTitle(buildLauncherWindowTitle())

    let service: Awaited<ReturnType<typeof ensureLauncherClientService>>
    try {
      service = await ensureLauncherClientService()
      if (!isWindowRecordUsable(windowRecord)) {
        return
      }
      if (service.clientUrl == null) {
        throw new Error('The local One Works launcher client did not publish a URL.')
      }
    } catch (error) {
      if (!isWindowRecordUsable(windowRecord)) {
        return
      }
      if (input.show === false) {
        console.warn('[oneworks-desktop] failed to preload launcher window', error)
        windowRecord.window.close()
        return
      }
      await loadWorkspaceSelectorWindow(windowRecord, {
        errorMessage: getErrorMessage(error),
        mode: 'initial'
      })
      return
    }

    windowRecord.currentServerUrl = service.clientUrl
    const launcherUrl = `${ensureTrailingSlash(service.clientUrl)}launcher`
    try {
      await windowRecord.window.loadURL(launcherUrl)
      if (input.show !== false) {
        showLauncherWindowRecord(windowRecord)
      } else if (windowRecord.window.isVisible()) {
        windowRecord.window.hide()
      }
      selectorStateController.broadcastWorkspaceSelectorState()
    } catch (error) {
      if (!isWindowRecordUsable(windowRecord)) {
        return
      }
      if (input.show === false) {
        console.warn('[oneworks-desktop] failed to preload launcher window', error)
        windowRecord.window.close()
        return
      }
      await showWindowLoadFailureScreen(windowRecord, {
        errorDescription: getErrorMessage(error),
        targetUrl: launcherUrl
      })
      showLauncherWindowRecord(windowRecord)
    }
  }

  const loadWorkspaceInWindow = async (windowRecord: WindowRecord, workspaceFolder: string) => {
    const startedAt = Date.now()
    const normalizedWorkspaceFolder = normalizeWorkspaceFolder(workspaceFolder)
    if (normalizedWorkspaceFolder == null) {
      throw new Error('The selected workspace is no longer available.')
    }
    logDesktopTiming(`workspace load begin workspace=${normalizedWorkspaceFolder}`)

    const wasLauncherWindow = windowRecord.kind === 'launcher'
    const previousLauncherSourceWorkspaceFolder = wasLauncherWindow ? windowRecord.workspaceFolder : undefined
    const previousSelectorMode = windowRecord.kind === 'selector'
      ? windowRecord.selectorMode
      : wasLauncherWindow
      ? 'initial'
      : 'dialog'
    windowRecord.kind = 'workspace'
    windowRecord.selectorMode = undefined
    windowRecord.workspaceFolder = normalizedWorkspaceFolder
    windowRecord.currentServerUrl = undefined
    windowRecord.workspaceServerUrl = undefined

    let clientUrl: string
    let workspaceService: Awaited<ReturnType<typeof ensureWorkspaceService>>
    try {
      rememberWorkspaceFolder(normalizedWorkspaceFolder)
      logDesktopTiming(`workspace waiting for shared client elapsed=${elapsedMs(startedAt)}`)
      clientUrl = await ensureSharedClientUrl()
      logDesktopTiming(`workspace shared client ready url=${clientUrl} elapsed=${elapsedMs(startedAt)}`)
      if (!isWindowRecordUsable(windowRecord)) {
        return
      }

      windowRecord.workspaceFolder = normalizedWorkspaceFolder
      windowRecord.currentServerUrl = clientUrl
      windowRecord.window.setTitle(buildWorkspaceWindowTitle(normalizedWorkspaceFolder))
      const workspaceUrl = ensureTrailingSlash(clientUrl)
      try {
        setWorkspaceLoadingWindowBackground(windowRecord.window)
        logDesktopTiming(`workspace loadURL begin url=${workspaceUrl} elapsed=${elapsedMs(startedAt)}`)
        await windowRecord.window.loadURL(workspaceUrl)
        logDesktopTiming(`workspace loadURL complete elapsed=${elapsedMs(startedAt)}`)
        focusWindowRecord(windowRecord)
      } catch (error) {
        if (!isWindowRecordUsable(windowRecord)) {
          return
        }
        await showWindowLoadFailureScreen(windowRecord, {
          errorDescription: getErrorMessage(error),
          targetUrl: workspaceUrl
        })
        focusWindowRecord(windowRecord)
        return
      }

      logDesktopTiming(`workspace waiting for server elapsed=${elapsedMs(startedAt)}`)
      workspaceService = await ensureWorkspaceService(normalizedWorkspaceFolder)
      if (workspaceService.serverUrl == null) {
        throw new Error('The local One Works server did not publish a URL.')
      }
      logDesktopTiming(`workspace server ready url=${workspaceService.serverUrl} elapsed=${elapsedMs(startedAt)}`)
      if (!isWindowRecordUsable(windowRecord)) {
        return
      }
    } catch (error) {
      if (!isWindowRecordUsable(windowRecord)) {
        return
      }
      await loadWorkspaceSelectorWindow(windowRecord, {
        errorMessage: getErrorMessage(error),
        mode: previousSelectorMode === 'initial' ? 'initial' : 'dialog'
      })
      return
    }

    windowRecord.workspaceFolder = normalizedWorkspaceFolder
    windowRecord.workspaceServerUrl = workspaceService.serverUrl
    windowRecord.window.setTitle(buildWorkspaceWindowTitle(normalizedWorkspaceFolder))
    if (wasLauncherWindow && getWindowRecords().every(candidate => candidate.kind !== 'launcher')) {
      void stopUnusedSourceWorkspaceService(
        previousLauncherSourceWorkspaceFolder,
        normalizedWorkspaceFolder
      )
    }
  }

  const openWorkspaceWindow = async (workspaceFolder: string, input: OpenWorkspaceWindowInput = {}) => {
    const normalizedWorkspaceFolder = normalizeWorkspaceFolder(workspaceFolder)
    if (normalizedWorkspaceFolder == null) {
      forgetWorkspaceFolder(workspaceFolder)
      throw new Error('The selected workspace is no longer available.')
    }

    const existingWorkspaceWindowRecord = findWorkspaceWindowRecord(normalizedWorkspaceFolder)
    if (existingWorkspaceWindowRecord != null) {
      rememberWorkspaceFolder(normalizedWorkspaceFolder)
      focusWindowRecord(existingWorkspaceWindowRecord)
      return existingWorkspaceWindowRecord
    }

    const targetWindowRecord = input.targetWindowRecord ??
      findReusableStartupWindowRecord() ??
      createWindowRecord({ kind: 'workspace', showOnReady: false })

    await loadWorkspaceInWindow(targetWindowRecord, normalizedWorkspaceFolder)
    return targetWindowRecord
  }

  const openWorkspaceUrlWindow = async (sourceWindowRecord: WindowRecord, url: string) => {
    if (sourceWindowRecord.workspaceFolder == null) {
      throw new Error('A workspace context is required to open this URL.')
    }

    const normalizedWorkspaceFolder = normalizeWorkspaceFolder(sourceWindowRecord.workspaceFolder)
    if (normalizedWorkspaceFolder == null) {
      throw new Error('The selected workspace is no longer available.')
    }

    const clientUrl = await ensureSharedClientUrl()
    const service = await ensureWorkspaceService(normalizedWorkspaceFolder)
    if (service.serverUrl == null) {
      throw new Error('The local One Works server did not publish a URL.')
    }

    const targetUrl = normalizeWorkspaceClientUrl(clientUrl, url)
    const windowRecord = createWindowRecord({ kind: 'workspace' })
    windowRecord.kind = 'workspace'
    windowRecord.selectorMode = undefined
    windowRecord.workspaceFolder = normalizedWorkspaceFolder
    windowRecord.currentServerUrl = clientUrl
    windowRecord.workspaceServerUrl = service.serverUrl
    rememberWorkspaceFolder(normalizedWorkspaceFolder)
    windowRecord.window.setTitle(buildWorkspaceWindowTitle(normalizedWorkspaceFolder))
    setWorkspaceLoadingWindowBackground(windowRecord.window)
    await windowRecord.window.loadURL(targetUrl)
    focusWindowRecord(windowRecord)
    return windowRecord
  }

  const openWorkspaceRouteWindow = async (workspaceFolder: string, routePath: string) => {
    const normalizedWorkspaceFolder = normalizeWorkspaceFolder(workspaceFolder)
    if (normalizedWorkspaceFolder == null) {
      forgetWorkspaceFolder(workspaceFolder)
      throw new Error('The selected workspace is no longer available.')
    }

    const service = await ensureWorkspaceService(normalizedWorkspaceFolder)
    if (service.serverUrl == null) {
      throw new Error('The local One Works server did not publish a URL.')
    }

    const targetUrl = normalizeWorkspaceClientUrl(service.serverUrl, routePath)
    const windowRecord = findWorkspaceWindowRecord(normalizedWorkspaceFolder) ??
      createWindowRecord({ kind: 'workspace' })
    windowRecord.kind = 'workspace'
    windowRecord.selectorMode = undefined
    windowRecord.workspaceFolder = normalizedWorkspaceFolder
    windowRecord.currentServerUrl = service.serverUrl
    rememberWorkspaceFolder(normalizedWorkspaceFolder)
    windowRecord.window.setTitle(buildWorkspaceWindowTitle(normalizedWorkspaceFolder))
    setWorkspaceLoadingWindowBackground(windowRecord.window)
    await windowRecord.window.loadURL(targetUrl)
    focusWindowRecord(windowRecord)
    return windowRecord
  }

  const markWorkspaceStartupWindowReady = (windowRecord: WindowRecord) => {
    if (!isWindowRecordUsable(windowRecord) || windowRecord.kind !== 'workspace') return

    restoreWorkspaceReadyWindowBackground(windowRecord.window)
  }

  const resolveWorkspaceServiceForWorkspace = async (workspaceFolder: string) => {
    const normalizedWorkspaceFolder = normalizeWorkspaceFolder(workspaceFolder)
    if (normalizedWorkspaceFolder == null) {
      throw new Error('The selected workspace is no longer available.')
    }

    const service = await ensureWorkspaceService(normalizedWorkspaceFolder)
    if (service.serverUrl == null) {
      throw new Error('The local One Works server did not publish a URL.')
    }

    return { normalizedWorkspaceFolder, serverUrl: service.serverUrl, service }
  }

  const resolveWorkspaceServiceForWindow = async (windowRecord: WindowRecord) => {
    if (windowRecord.workspaceFolder == null) {
      throw new Error('A current workspace is required.')
    }

    return await resolveWorkspaceServiceForWorkspace(windowRecord.workspaceFolder)
  }

  const fetchWorkspaceApiForWorkspace = async <T>(
    workspaceFolder: string,
    path: string,
    init?: RequestInit
  ): Promise<T> => {
    const { serverUrl } = await resolveWorkspaceServiceForWorkspace(workspaceFolder)
    const url = new URL(path, ensureTrailingSlash(serverUrl)).toString()
    const response = await fetch(url, init)
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const message = isRecord(body) && typeof body.message === 'string'
        ? body.message
        : `Workspace request failed with status ${response.status}`
      throw new Error(message)
    }
    return unwrapApiData(body) as T
  }

  const fetchWorkspaceApi = async <T>(
    windowRecord: WindowRecord,
    path: string,
    init?: RequestInit
  ): Promise<T> => {
    if (windowRecord.workspaceFolder == null) {
      throw new Error('A current workspace is required.')
    }

    return await fetchWorkspaceApiForWorkspace(windowRecord.workspaceFolder, path, init)
  }

  const findLauncherSourceWorkspaceWindowRecord = (launcherWindowRecord: WindowRecord) => {
    const sourceWindowId = launcherWindowRecord.launcherSourceWindowId
    const sourceWindowRecord = sourceWindowId == null ? undefined : runtimeState.windows.get(sourceWindowId)
    if (
      sourceWindowRecord?.kind === 'workspace' &&
      sourceWindowRecord.workspaceFolder === launcherWindowRecord.workspaceFolder &&
      isWindowRecordUsable(sourceWindowRecord)
    ) {
      return sourceWindowRecord
    }

    return launcherWindowRecord.workspaceFolder == null
      ? undefined
      : findWorkspaceWindowRecord(launcherWindowRecord.workspaceFolder)
  }

  const getLauncherSourceTerminalSessionId = (launcherWindowRecord: WindowRecord, clientUrl: string) => {
    const routePath = getWorkspaceClientRoutePath(clientUrl, launcherWindowRecord.launcherSourceUrl)
    const sessionId = routePath.match(/^\/session\/([^/]+)/)?.[1]
    return sessionId == null ? WORKSPACE_TERMINAL_SESSION_ID : decodeURIComponent(sessionId)
  }

  const readLauncherStoredResources = async (
    launcherWindowRecord: WindowRecord,
    clientUrl: string,
    query: string
  ): Promise<Pick<LauncherWorkspaceResourceSearchResponse, 'terminals' | 'websites'>> => {
    const sourceWindowRecord = findLauncherSourceWorkspaceWindowRecord(launcherWindowRecord)
    if (sourceWindowRecord == null || !isWindowRecordUsable(sourceWindowRecord)) {
      return { terminals: [], websites: [] }
    }

    const terminalSessionId = getLauncherSourceTerminalSessionId(launcherWindowRecord, clientUrl)
    const value = await sourceWindowRecord.window.webContents
      .executeJavaScript(buildStoredResourcesScript(terminalSessionId), false)
      .catch(() => null)
    if (!isRecord(value)) {
      return { terminals: [], websites: [] }
    }

    const websites = Array.isArray(value.websites)
      ? value.websites
        .filter((item): item is LauncherWorkspaceResourceSearchResponse['websites'][number] => (
          isRecord(item) &&
          item.kind === 'website' &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          typeof item.url === 'string' &&
          typeof item.updatedAt === 'number'
        ))
        .filter(item => matchesResourceQuery(query, [item.title, item.url]))
        .slice(0, LAUNCHER_RESOURCE_RESULT_LIMIT)
      : []
    const terminals = Array.isArray(value.terminals)
      ? value.terminals
        .filter((item): item is LauncherWorkspaceResourceSearchResponse['terminals'][number] => (
          isRecord(item) &&
          item.kind === 'terminal' &&
          typeof item.id === 'string' &&
          typeof item.terminalId === 'string' &&
          typeof item.title === 'string'
        ))
        .filter(item => matchesResourceQuery(query, [item.title, item.terminalId, item.shellKind]))
        .slice(0, LAUNCHER_RESOURCE_RESULT_LIMIT)
      : []

    return { terminals, websites }
  }

  const searchCurrentWorkspaceResources = async (
    launcherWindowRecord: WindowRecord,
    rawQuery: string
  ): Promise<LauncherWorkspaceResourceSearchResponse> => {
    const query = normalizeResourceQuery(rawQuery)
    const { normalizedWorkspaceFolder, serverUrl } = await resolveWorkspaceServiceForWindow(launcherWindowRecord)
    const clientUrl = launcherWindowRecord.currentServerUrl ?? await ensureSharedClientUrl()
    const [files, sessionsResponse, storedResources] = await Promise.all([
      query === ''
        ? Promise.resolve([])
        : searchWorkspaceFiles({
          query,
          workspaceFolder: normalizedWorkspaceFolder,
          limit: LAUNCHER_RESOURCE_RESULT_LIMIT
        }),
      fetchWorkspaceApi<{ sessions?: unknown[] }>(launcherWindowRecord, '/api/sessions').catch(() => ({
        sessions: []
      })),
      readLauncherStoredResources(launcherWindowRecord, clientUrl, query)
    ])
    const sessionRecords = (Array.isArray(sessionsResponse.sessions) ? sessionsResponse.sessions : [])
      .filter(isRecord)
      .filter(session => typeof session.id === 'string')
    const sessions = sessionRecords
      .map(session => ({
        createdAt: typeof session.createdAt === 'number' ? session.createdAt : 0,
        id: `session:${String(session.id)}`,
        kind: 'session' as const,
        sessionId: String(session.id),
        subtitle: typeof session.lastUserMessage === 'string'
          ? session.lastUserMessage
          : typeof session.lastMessage === 'string'
          ? session.lastMessage
          : undefined,
        title: getSessionTitle(session)
      }))
      .filter(session => matchesResourceQuery(query, [session.title, session.subtitle, session.sessionId]))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, LAUNCHER_RESOURCE_RESULT_LIMIT)

    return {
      files: files.map(file => ({ ...file, id: `file:${file.path}`, kind: 'file' as const })),
      sessions,
      terminals: storedResources.terminals,
      websites: storedResources.websites
    }
  }

  const listCurrentWorkspaceFileOpeners = async (windowRecord: WindowRecord) =>
    await fetchWorkspaceApi(windowRecord, '/api/workspace/file-openers')

  const listWorkspaceFileOpeners = async (workspaceFolder: string) =>
    await fetchWorkspaceApiForWorkspace(workspaceFolder, '/api/workspace/file-openers')

  const searchCurrentWorkspacePlugins = async (
    launcherWindowRecord: WindowRecord,
    rawQuery: string
  ): Promise<LauncherWorkspacePluginSearchResponse> => {
    if (launcherWindowRecord.workspaceFolder == null) {
      return { results: [] }
    }

    return await fetchWorkspaceApi<LauncherWorkspacePluginSearchResponse>(
      launcherWindowRecord,
      '/api/plugins/launcher/search',
      {
        body: JSON.stringify({ query: rawQuery }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      }
    ).catch((error) => {
      console.warn('[oneworks-desktop] failed to search workspace plugins', error)
      return { results: [] }
    })
  }

  const invokeCurrentWorkspacePluginResult = async (
    launcherWindowRecord: WindowRecord,
    resultId: string
  ) => {
    if (launcherWindowRecord.workspaceFolder == null) return undefined

    const response = await fetchWorkspaceApi(
      launcherWindowRecord,
      `/api/plugins/launcher/results/${encodeURIComponent(resultId)}/invoke`,
      {
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      }
    )
    if (launcherWindowRecord.kind === 'launcher' && isWindowRecordUsable(launcherWindowRecord)) {
      launcherWindowRecord.window.hide()
    }
    return response
  }

  const openCurrentWorkspaceFileInExternalOpener = async (
    launcherWindowRecord: WindowRecord,
    path: string,
    opener?: string
  ) => {
    await fetchWorkspaceApi(launcherWindowRecord, '/api/workspace/open-file', {
      body: JSON.stringify({ opener, path }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    if (launcherWindowRecord.kind === 'launcher' && isWindowRecordUsable(launcherWindowRecord)) {
      launcherWindowRecord.window.hide()
    }
  }

  const openWorkspaceFileInExternalOpener = async (
    workspaceFolder: string,
    path: string,
    opener?: string
  ) => {
    await fetchWorkspaceApiForWorkspace(workspaceFolder, '/api/workspace/open-file', {
      body: JSON.stringify({ opener, path }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
  }

  const openCurrentWorkspaceResource = async (launcherWindowRecord: WindowRecord, target: WorkspaceResourceTarget) => {
    if (launcherWindowRecord.workspaceFolder == null) {
      throw new Error('A current workspace is required to open a resource.')
    }

    const normalizedWorkspaceFolder = normalizeWorkspaceFolder(launcherWindowRecord.workspaceFolder)
    if (normalizedWorkspaceFolder == null) {
      throw new Error('The selected workspace is no longer available.')
    }

    const clientUrl = await ensureSharedClientUrl()
    const service = await ensureWorkspaceService(normalizedWorkspaceFolder)
    if (service.serverUrl == null) {
      throw new Error('The local One Works server did not publish a URL.')
    }

    const targetUrl = buildWorkspaceResourceTargetUrl(clientUrl, target, launcherWindowRecord.launcherSourceUrl)
    const sourceWindowRecord = findLauncherSourceWorkspaceWindowRecord(launcherWindowRecord)
    const sourceUrl = launcherWindowRecord.launcherSourceUrl ?? sourceWindowRecord?.window.webContents.getURL()
    if (
      sourceWindowRecord != null &&
      isWindowRecordUsable(sourceWindowRecord) &&
      isWorkspaceChatRoute(clientUrl, sourceUrl)
    ) {
      sourceWindowRecord.kind = 'workspace'
      sourceWindowRecord.selectorMode = undefined
      sourceWindowRecord.workspaceFolder = normalizedWorkspaceFolder
      sourceWindowRecord.currentServerUrl = clientUrl
      sourceWindowRecord.workspaceServerUrl = service.serverUrl
      rememberWorkspaceFolder(normalizedWorkspaceFolder)
      sourceWindowRecord.window.setTitle(buildWorkspaceWindowTitle(normalizedWorkspaceFolder))
      sourceWindowRecord.window.webContents.send(WORKSPACE_RESOURCE_REQUEST_CHANNEL, target)
      focusWindowRecord(sourceWindowRecord)
      return sourceWindowRecord
    }

    const windowRecord = sourceWindowRecord ?? createWindowRecord({ kind: 'workspace' })
    windowRecord.kind = 'workspace'
    windowRecord.selectorMode = undefined
    windowRecord.workspaceFolder = normalizedWorkspaceFolder
    windowRecord.currentServerUrl = clientUrl
    windowRecord.workspaceServerUrl = service.serverUrl
    rememberWorkspaceFolder(normalizedWorkspaceFolder)
    windowRecord.window.setTitle(buildWorkspaceWindowTitle(normalizedWorkspaceFolder))
    setWorkspaceLoadingWindowBackground(windowRecord.window)
    await windowRecord.window.loadURL(targetUrl).catch((error: unknown) => {
      if (isLoadUrlAbortError(error)) {
        console.warn('[oneworks-desktop] workspace resource navigation was interrupted after dispatch', error)
        return
      }
      throw error
    })
    focusWindowRecord(windowRecord)
    return windowRecord
  }

  const createWorkspaceSelectorWindow = async (input: WorkspaceSelectorWindowInput & {
    parentWindow?: WindowRecord
  } = {}) => {
    const existingSelectorWindowRecord = input.mode === 'dialog'
      ? findWorkspaceSelectorWindowRecord('dialog')
      : undefined
    if (existingSelectorWindowRecord != null) {
      focusWindowRecord(existingSelectorWindowRecord)
      return existingSelectorWindowRecord
    }

    const windowRecord = createWindowRecord({
      kind: 'selector',
      parentWindow: input.parentWindow,
      selectorMode: input.mode ?? 'dialog'
    })
    await loadWorkspaceSelectorWindow(windowRecord, {
      errorMessage: input.errorMessage,
      mode: input.mode
    })
    return windowRecord
  }

  const createLauncherWindow = async (
    input: { forceNew?: boolean; show?: boolean; sourceWorkspaceFolder?: string } = {}
  ) => {
    const focusedWorkspaceWindowRecord = input.show === false ? undefined : getFocusedWorkspaceWindowRecord()
    const sourceWorkspaceFolder = input.sourceWorkspaceFolder ??
      focusedWorkspaceWindowRecord?.workspaceFolder
    const sourceUrl = focusedWorkspaceWindowRecord?.window.webContents.getURL()
    const sourceWindowId = focusedWorkspaceWindowRecord?.window.id
    const existingLauncherWindowRecord = findLauncherWindowRecord()
    if (input.forceNew !== true && existingLauncherWindowRecord != null) {
      existingLauncherWindowRecord.workspaceFolder = sourceWorkspaceFolder
      existingLauncherWindowRecord.launcherSourceUrl = sourceUrl
      existingLauncherWindowRecord.launcherSourceWindowId = sourceWindowId
      if (input.show !== false) {
        showLauncherWindowRecord(existingLauncherWindowRecord)
      }
      selectorStateController.broadcastWorkspaceSelectorState()
      return existingLauncherWindowRecord
    }

    const shouldShow = input.show !== false
    const windowRecord = createWindowRecord({ kind: 'launcher', showOnReady: false })
    await loadLauncherWindow(windowRecord, { show: shouldShow, sourceUrl, sourceWindowId, sourceWorkspaceFolder })
    return windowRecord
  }

  const workspaceDialogController = createWorkspaceDialogController({
    loadWorkspaceInWindow,
    openWorkspaceWindow
  })

  return {
    broadcastWorkspaceSelectorState: selectorStateController.broadcastWorkspaceSelectorState,
    buildWorkspaceSelectorState: selectorStateController.buildWorkspaceSelectorState,
    createLauncherWindow,
    createWorkspaceSelectorWindow,
    findWindowRecord,
    findWindowRecordForWebContents,
    findWorkspaceWindowRecord,
    isWindowRecordUsable,
    loadWorkspaceInWindow,
    loadLauncherWindow,
    loadWorkspaceSelectorWindow,
    listCurrentWorkspaceFileOpeners,
    listWorkspaceFileOpeners,
    markWorkspaceStartupWindowReady,
    openCurrentWorkspaceFileInExternalOpener,
    openCurrentWorkspaceResource,
    openWorkspaceFileInExternalOpener,
    openWorkspaceDialog: workspaceDialogController.openWorkspaceDialog,
    openWorkspaceRouteWindow,
    openWorkspaceUrlWindow,
    openWorkspaceWindow,
    promptForNewWorkspaceFolder: workspaceDialogController.promptForNewWorkspaceFolder,
    promptForWorkspaceFolder: workspaceDialogController.promptForWorkspaceFolder,
    invokeCurrentWorkspacePluginResult,
    searchCurrentWorkspacePlugins,
    searchCurrentWorkspaceResources
  }
}

export type WindowManager = ReturnType<typeof createWindowManager>
