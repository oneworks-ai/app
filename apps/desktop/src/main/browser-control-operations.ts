/* eslint-disable max-lines -- browser operations share page/ref validation and one serialized dispatch boundary. */
import { createHash, randomBytes } from 'node:crypto'

import type { WebContents } from 'electron'

import { createOneWorksCursorSvg } from '@oneworks/cursor'
import type { BrowserControlPageCommand } from '@oneworks/types'

import {
  applyBrowserControlDeviceEmulation,
  getAppliedBrowserControlDeviceEmulation,
  readBrowserControlDeviceModeState
} from './browser-control-device-emulation'
import type { NativeDeviceEmulationState } from './browser-control-device-emulation'
import { sendBrowserControlPageCommand } from './browser-control-page-commands'
import type { SendBrowserControlPageCommand } from './browser-control-page-commands'
import type { BrowserControlPages } from './browser-control-pages'
import { pageSummary } from './browser-control-pages'
import {
  createElementActionScript,
  createScrollScript,
  createSnapshotScript,
  createWaitProbeScript
} from './browser-control-scripts'
import {
  normalizeBrowserControlText as normalizeText,
  readBrowserControlHttpUrl as readHttpUrl,
  withBrowserControlTimeout as withTimeout
} from './browser-control-utils'
import { BROWSER_CONTROL_OPEN_PAGE_CHANNEL } from './constants'

const defaultWaitTimeoutMs = 10_000
const maxWaitTimeoutMs = 30_000

export interface BrowserControlRequest {
  op?:
    | 'click'
    | 'clear_navigation_history'
    | 'close_page'
    | 'duplicate_page'
    | 'get_navigation_entries'
    | 'get_navigation_state'
    | 'get_page_view_state'
    | 'list_device_presets'
    | 'move_page'
    | 'navigate'
    | 'navigate_history'
    | 'open_page'
    | 'press_key'
    | 'reload'
    | 'scroll'
    | 'select'
    | 'set_device_mode'
    | 'set_devtools'
    | 'set_zoom'
    | 'show_page'
    | 'snapshot'
    | 'screenshot'
    | 'stop_loading'
    | 'type'
    | 'wait'
  page_id?: string
  session_id?: string
  [key: string]: unknown
}

interface BrowserControlOperationOptions {
  delay?: (ms: number) => Promise<void>
  getWorkspaceHostWebContents?: (workspaceFolder: string) => WebContents[]
  now?: () => number
  pages: BrowserControlPages
  sendPageCommand?: SendBrowserControlPageCommand
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)
const normalizeTimeout = (value: unknown) =>
  Math.min(
    maxWaitTimeoutMs,
    Math.max(0, typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : defaultWaitTimeoutMs)
  )
const delay = async (ms: number) => await new Promise(resolve => setTimeout(resolve, ms))
const normalizePlacement = (value: unknown): 'bottom' | 'right' => value === 'bottom' ? 'bottom' : 'right'

const hslToHex = (hue: number, saturation: number, lightness: number) => {
  const saturationRatio = saturation / 100
  const lightnessRatio = lightness / 100
  const chroma = (1 - Math.abs((2 * lightnessRatio) - 1)) * saturationRatio
  const section = ((hue % 360) + 360) % 360 / 60
  const secondary = chroma * (1 - Math.abs((section % 2) - 1))
  const offset = lightnessRatio - (chroma / 2)
  const [red, green, blue] = section < 1
    ? [chroma, secondary, 0]
    : section < 2
    ? [secondary, chroma, 0]
    : section < 3
    ? [0, chroma, secondary]
    : section < 4
    ? [0, secondary, chroma]
    : section < 5
    ? [secondary, 0, chroma]
    : [chroma, 0, secondary]
  return `#${
    [red, green, blue].map(channel => (
      Math.round((channel + offset) * 255).toString(16).padStart(2, '0')
    )).join('').toUpperCase()
  }`
}

const browserCursorColor = (sessionId: string) => {
  const digest = createHash('sha256').update(sessionId).digest()
  return hslToHex(
    digest.readUInt16BE(0) % 360,
    66 + (digest[2] % 20),
    44 + (digest[3] % 14)
  )
}

export const createBrowserControlOperations = (options: BrowserControlOperationOptions) => {
  const pause = options.delay ?? delay
  const now = options.now ?? Date.now
  const hostOpenTails = new Map<number, Promise<void>>()
  const snapshotGenerations = new Map<number, number>()
  const dispatchPageCommand = options.sendPageCommand ?? sendBrowserControlPageCommand

  const enqueueHostOpen = async <T>(hostWebContentsId: number, action: () => Promise<T>): Promise<T> => {
    const previous = hostOpenTails.get(hostWebContentsId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(action)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    hostOpenTails.set(hostWebContentsId, tail)
    void tail.finally(() => {
      if (hostOpenTails.get(hostWebContentsId) === tail) hostOpenTails.delete(hostWebContentsId)
    })
    return await result
  }

  const navigationError = (message: string, code: string, statusCode = 409) =>
    Object.assign(new Error(message), { code, statusCode })

  const waitForNavigation = async (
    contents: WebContents,
    action: () => void,
    timeoutMs: number
  ) =>
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        contents.off('destroyed', handleDestroyed)
        contents.off('did-fail-load', handleFailure)
        contents.off('did-finish-load', handleSuccess)
        contents.off('did-navigate', handleSuccess)
        contents.off('did-navigate-in-page', handleSuccess)
        contents.off('did-stop-loading', handleSuccess)
        clearTimeout(timer)
      }
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }
      const handleDestroyed = () =>
        finish(() =>
          reject(navigationError(
            'The internal browser page closed while navigating.',
            'PAGE_CLOSED'
          ))
        )
      const handleFailure = (
        _event: Electron.Event,
        errorCode: number,
        errorDescription: string,
        _validatedURL: string,
        isMainFrame: boolean
      ) => {
        if (!isMainFrame) return
        finish(() =>
          reject(navigationError(
            errorDescription || `Navigation failed (${errorCode}).`,
            'PAGE_NAVIGATION_FAILED',
            502
          ))
        )
      }
      const handleSuccess = () => finish(resolve)
      const timer = setTimeout(() =>
        finish(() =>
          reject(navigationError(
            'Timed out waiting for the internal browser page navigation.',
            'PAGE_NAVIGATION_TIMEOUT',
            408
          ))
        ), timeoutMs)
      contents.once('destroyed', handleDestroyed)
      contents.on('did-fail-load', handleFailure)
      contents.once('did-finish-load', handleSuccess)
      contents.once('did-navigate', handleSuccess)
      contents.once('did-navigate-in-page', handleSuccess)
      contents.once('did-stop-loading', handleSuccess)
      try {
        action()
      } catch (error) {
        finish(() => reject(error))
      }
    })

  const executePageCommand = async (
    workspaceFolder: string,
    page: ReturnType<BrowserControlPages['resolvePage']>,
    command: BrowserControlPageCommand
  ) => {
    const host = (options.getWorkspaceHostWebContents?.(workspaceFolder) ?? [])
      .find(contents => !contents.isDestroyed() && contents.id === page.hostWebContentsId)
    if (host == null || page.panelPageId == null) {
      throw Object.assign(new Error('The internal browser page cannot be controlled in its host window.'), {
        code: 'PAGE_NOT_SHOWABLE',
        statusCode: 409
      })
    }
    return await dispatchPageCommand(host, {
      command,
      pageId: page.id,
      panelPageId: page.panelPageId,
      ...(page.session_id == null ? {} : { sessionId: page.session_id })
    })
  }

  const waitForPanelPage = async (
    workspaceFolder: string,
    sessionId: string | undefined,
    panelPageId: string,
    previousWebContentsId: number,
    waitOptions: { requirePreviousGone?: boolean; timeoutMs?: number } = {}
  ) => {
    const startedAt = now()
    const timeoutMs = waitOptions.timeoutMs ?? defaultWaitTimeoutMs
    while (now() - startedAt <= timeoutMs) {
      const currentPages = options.pages.listPages(workspaceFolder, sessionId)
      const nextPage = currentPages.find(candidate => (
        candidate.panelPageId === panelPageId && candidate.webContents.id !== previousWebContentsId
      ))
      const previousGone = currentPages.every(candidate => candidate.webContents.id !== previousWebContentsId)
      if (nextPage != null && (waitOptions.requirePreviousGone !== true || previousGone)) return nextPage
      await pause(100)
    }
    throw Object.assign(new Error('Timed out waiting for the internal browser tab to become controllable.'), {
      code: 'PAGE_RECREATE_TIMEOUT',
      statusCode: 408
    })
  }

  const waitForPageGone = async (
    workspaceFolder: string,
    sessionId: string | undefined,
    pageId: string,
    timeoutMs: number
  ) => {
    const startedAt = now()
    while (now() - startedAt <= timeoutMs) {
      if (options.pages.listPages(workspaceFolder, sessionId).every(candidate => candidate.id !== pageId)) return
      await pause(100)
    }
    throw Object.assign(new Error('Timed out waiting for the internal browser tab to close.'), {
      code: 'PAGE_CLOSE_TIMEOUT',
      statusCode: 408
    })
  }

  const openPage = async (workspaceFolder: string, input: BrowserControlRequest) => {
    const target = readHttpUrl(input.url)
    const sessionId = normalizeText(input.session_id)
    if (sessionId === '') {
      throw Object.assign(new Error('A OneWorks session id is required.'), { code: 'SESSION_REQUIRED' })
    }
    const availableHosts = (options.getWorkspaceHostWebContents?.(workspaceFolder) ?? [])
      .filter(contents => !contents.isDestroyed())
    if (availableHosts.length === 0) {
      throw Object.assign(new Error('The OneWorks workspace window is unavailable.'), {
        code: 'WORKSPACE_WINDOW_UNAVAILABLE',
        statusCode: 409
      })
    }
    const scopedHostIds = new Set(
      options.pages.listScopes()
        .filter(scope => scope.workspaceFolder === workspaceFolder && scope.sessionKey === sessionId)
        .map(scope => scope.hostWebContentsId)
        .filter((id): id is number => typeof id === 'number')
    )
    const matchingHosts = availableHosts.filter(host => scopedHostIds.has(host.id))
    const hosts = matchingHosts.length > 0 ? matchingHosts : availableHosts
    if (hosts.length !== 1) {
      throw Object.assign(
        new Error(
          matchingHosts.length > 1
            ? 'The OneWorks session is open in multiple workspace windows; select a unique session window first.'
            : 'The target OneWorks session window cannot be identified while multiple workspace windows are open.'
        ),
        {
          code: 'SESSION_HOST_AMBIGUOUS',
          statusCode: 409
        }
      )
    }
    const host = hosts[0]
    return await enqueueHostOpen(host.id, async () => {
      if (host.isDestroyed()) {
        throw Object.assign(new Error('The OneWorks workspace window is unavailable.'), {
          code: 'WORKSPACE_WINDOW_UNAVAILABLE',
          statusCode: 409
        })
      }
      const existingPageIds = new Set(
        options.pages.listPages(workspaceFolder, sessionId)
          .filter(page => page.url === target.href)
          .map(page => page.id)
      )
      const startedAt = now()
      const requestId = randomBytes(12).toString('hex')
      const request = {
        openMode: input.open_mode === 'new-tab' ? 'new-tab' : 'reuse-or-create',
        placement: normalizePlacement(input.placement),
        requestId,
        sessionId,
        title: normalizeText(input.title) || undefined,
        url: target.href
      }
      host.send(BROWSER_CONTROL_OPEN_PAGE_CHANNEL, request)
      const timeoutMs = normalizeTimeout(input.timeout_ms)
      while (now() - startedAt <= timeoutMs) {
        const page = options.pages.listPages(workspaceFolder, sessionId).find(candidate => (
          options.pages.listScopes().some(scope => (
            scope.webContentsId === candidate.webContents.id && scope.controlRequestId === requestId
          ))
        ))
        if (page != null) return { ok: true, page: pageSummary(page), reused: existingPageIds.has(page.id) }
        await pause(100)
      }
      throw Object.assign(new Error('Timed out waiting for the internal browser page to open.'), {
        code: 'OPEN_PAGE_TIMEOUT',
        statusCode: 408
      })
    })
  }

  const execute = async (workspaceFolder: string, input: BrowserControlRequest): Promise<unknown> => {
    if (input.op === 'open_page') return await openPage(workspaceFolder, input)
    const page = options.pages.resolvePage(workspaceFolder, input)
    if (input.op === 'show_page') {
      await executePageCommand(workspaceFolder, page, { type: 'show' })
      return { ok: true, page: pageSummary(page) }
    }
    if (input.op === 'close_page' || input.op === 'duplicate_page' || input.op === 'move_page') {
      const replacementState = input.op === 'close_page'
        ? undefined
        : {
          entries: page.webContents.navigationHistory.getAllEntries().map(entry => ({ ...entry })),
          index: page.webContents.navigationHistory.getActiveIndex(),
          zoomFactor: page.webContents.getZoomFactor()
        }
      const command: BrowserControlPageCommand = input.op === 'close_page'
        ? { type: 'close' }
        : input.op === 'duplicate_page'
        ? {
          type: 'duplicate',
          ...(input.placement === 'bottom' || input.placement === 'right' ? { placement: input.placement } : {})
        }
        : input.placement === 'bottom' || input.placement === 'right'
        ? { type: 'move', placement: input.placement }
        : (() => {
          throw Object.assign(new Error('A target placement is required.'), { code: 'INVALID_ARGUMENT' })
        })()
      const result = await executePageCommand(workspaceFolder, page, command)
      const timeoutMs = normalizeTimeout(input.timeout_ms)
      if (input.op === 'close_page') {
        await waitForPageGone(workspaceFolder, page.session_id, page.id, timeoutMs)
        return { ok: true, closed_page_id: page.id, result }
      }
      const resultRecord = isRecord(result) ? result : {}
      if (input.op === 'move_page' && resultRecord.page_id_changed !== true) {
        return {
          ok: true,
          page: pageSummary(page),
          previous_page_id: page.id,
          replacement_page_id: page.id,
          result
        }
      }
      const panelPageId = normalizeText(resultRecord.panel_page_id) || page.panelPageId
      if (panelPageId == null) {
        throw Object.assign(new Error('The recreated browser tab did not return a panel page id.'), {
          code: 'PAGE_RECREATE_FAILED',
          statusCode: 409
        })
      }
      const recreatedPage = await waitForPanelPage(
        workspaceFolder,
        page.session_id,
        panelPageId,
        page.webContents.id,
        {
          requirePreviousGone: input.op === 'move_page',
          timeoutMs
        }
      )
      const restoreErrors: Array<{
        code: string
        message: string
        state: 'navigation_history' | 'zoom'
      }> = []
      let navigationHistoryRestore: 'failed' | 'restored' | 'skipped' = 'skipped'
      let zoomRestore: 'failed' | 'restored' = 'restored'
      if (replacementState != null) {
        if (replacementState.entries.length > 0) {
          try {
            await withTimeout(
              recreatedPage.webContents.navigationHistory.restore({
                entries: replacementState.entries,
                index: replacementState.index
              }),
              timeoutMs
            )
            navigationHistoryRestore = 'restored'
          } catch (error) {
            navigationHistoryRestore = 'failed'
            const record = isRecord(error) ? error : {}
            restoreErrors.push({
              code: normalizeText(record.code) || 'NAVIGATION_HISTORY_RESTORE_FAILED',
              message: error instanceof Error ? error.message : String(error),
              state: 'navigation_history'
            })
          }
        }
        try {
          recreatedPage.webContents.setZoomFactor(replacementState.zoomFactor)
        } catch (error) {
          zoomRestore = 'failed'
          const record = isRecord(error) ? error : {}
          restoreErrors.push({
            code: normalizeText(record.code) || 'PAGE_ZOOM_RESTORE_FAILED',
            message: error instanceof Error ? error.message : String(error),
            state: 'zoom'
          })
        }
      }
      return {
        ok: true,
        page: pageSummary(recreatedPage),
        previous_page_id: page.id,
        replacement_page_id: recreatedPage.id,
        result,
        state_restore: {
          navigation_history: navigationHistoryRestore,
          zoom: zoomRestore,
          ...(restoreErrors.length === 0 ? {} : { errors: restoreErrors })
        }
      }
    }
    if (input.op === 'get_navigation_state') {
      const navigationHistory = page.webContents.navigationHistory
      return {
        page_id: page.id,
        url: page.webContents.getURL(),
        title: page.webContents.getTitle(),
        is_loading: page.webContents.isLoadingMainFrame(),
        can_go_back: navigationHistory.canGoBack(),
        can_go_forward: navigationHistory.canGoForward(),
        current_index: navigationHistory.getActiveIndex(),
        total_entries: navigationHistory.getAllEntries().length
      }
    }
    if (input.op === 'get_navigation_entries') {
      const offset = typeof input.offset === 'number' && Number.isFinite(input.offset)
        ? Math.max(0, Math.round(input.offset))
        : 0
      const limit = typeof input.limit === 'number' && Number.isFinite(input.limit)
        ? Math.min(100, Math.max(1, Math.round(input.limit)))
        : 20
      const navigationHistory = page.webContents.navigationHistory
      const currentIndex = navigationHistory.getActiveIndex()
      const allEntries = navigationHistory.getAllEntries()
      return {
        page_id: page.id,
        current_index: currentIndex,
        entries: allEntries.slice(offset, offset + limit).map((entry, index) => ({
          index: offset + index,
          is_current: offset + index === currentIndex,
          title: entry.title,
          url: entry.url
        })),
        limit,
        offset,
        total_entries: allEntries.length
      }
    }
    if (input.op === 'list_device_presets') {
      return await executePageCommand(workspaceFolder, page, { type: 'list_device_presets' })
    }
    if (input.op === 'get_page_view_state') {
      const result = await executePageCommand(workspaceFolder, page, { type: 'get_page_view_state' })
      const navigationHistory = page.webContents.navigationHistory
      const nativeDeviceEmulation = getAppliedBrowserControlDeviceEmulation(page.webContents.id)
      return {
        ...(isRecord(result) ? result : {}),
        is_loading: page.webContents.isLoadingMainFrame(),
        native_device_emulation: nativeDeviceEmulation ?? { enabled: false },
        native_zoom_factor: page.webContents.getZoomFactor(),
        navigation: {
          can_go_back: navigationHistory.canGoBack(),
          can_go_forward: navigationHistory.canGoForward(),
          current_index: navigationHistory.getActiveIndex(),
          total_entries: navigationHistory.getAllEntries().length
        }
      }
    }
    if (input.op === 'set_device_mode') {
      if (typeof input.enabled !== 'boolean') {
        throw Object.assign(new Error('A device-mode enabled flag is required.'), { code: 'INVALID_ARGUMENT' })
      }
      for (const field of ['width', 'height', 'device_pixel_ratio'] as const) {
        if (input[field] != null && (typeof input[field] !== 'number' || !Number.isFinite(input[field]))) {
          throw Object.assign(new Error(`${field} must be a finite number.`), { code: 'INVALID_ARGUMENT' })
        }
      }
      if (
        input.zoom != null && input.zoom !== 'auto' && (
          typeof input.zoom !== 'number' || !Number.isFinite(input.zoom)
        )
      ) {
        throw Object.assign(new Error('zoom must be auto or a finite number.'), { code: 'INVALID_ARGUMENT' })
      }
      const command: BrowserControlPageCommand = {
        type: 'set_device_mode',
        enabled: input.enabled === true,
        ...(input.preset_id == null ? {} : { preset_id: normalizeText(input.preset_id) }),
        ...(typeof input.width === 'number' ? { width: input.width } : {}),
        ...(typeof input.height === 'number' ? { height: input.height } : {}),
        ...(typeof input.device_pixel_ratio === 'number'
          ? { device_pixel_ratio: input.device_pixel_ratio }
          : {}),
        ...(input.device_type === 'desktop' || input.device_type === 'mobile'
          ? { device_type: input.device_type }
          : {}),
        ...(input.zoom === 'auto' || typeof input.zoom === 'number' ? { zoom: input.zoom } : {})
      }
      const previousState = getAppliedBrowserControlDeviceEmulation(page.webContents.id)
      const result = await executePageCommand(workspaceFolder, page, command)
      const deviceMode = readBrowserControlDeviceModeState(result)
      if (deviceMode == null || deviceMode.enabled !== (input.enabled === true)) {
        try {
          await executePageCommand(
            workspaceFolder,
            page,
            previousState == null
              ? { enabled: false, type: 'set_device_mode' }
              : { ...previousState, type: 'set_device_mode' }
          )
        } catch {}
        throw Object.assign(new Error('The browser page returned an invalid device-mode state.'), {
          code: 'INVALID_DEVICE_MODE_STATE',
          statusCode: 409
        })
      }
      const nextState = deviceMode.enabled
        ? deviceMode as NativeDeviceEmulationState
        : undefined
      try {
        applyBrowserControlDeviceEmulation(page.webContents, nextState)
      } catch (error) {
        const rollbackCommand: BrowserControlPageCommand = previousState == null
          ? { enabled: false, type: 'set_device_mode' }
          : { ...previousState, type: 'set_device_mode' }
        try {
          await executePageCommand(workspaceFolder, page, rollbackCommand)
          applyBrowserControlDeviceEmulation(page.webContents, previousState)
        } catch {}
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { code: 'DEVICE_EMULATION_FAILED', statusCode: 409 }
        )
      }
      return {
        ...(isRecord(result) ? result : {}),
        native_device_emulation: nextState ?? { enabled: false }
      }
    }
    if (input.op === 'set_devtools') {
      return await executePageCommand(workspaceFolder, page, {
        type: 'set_devtools',
        enabled: input.enabled === true,
        ...(input.dock_side === 'bottom' || input.dock_side === 'left' || input.dock_side === 'right'
          ? { dock_side: input.dock_side }
          : {})
      })
    }
    if (input.op === 'reload') {
      await waitForNavigation(
        page.webContents,
        () =>
          input.ignore_cache === true
            ? page.webContents.reloadIgnoringCache()
            : page.webContents.reload(),
        normalizeTimeout(input.timeout_ms)
      )
      return { ok: true, page: pageSummary(page), ignore_cache: input.ignore_cache === true }
    }
    if (input.op === 'stop_loading') {
      page.webContents.stop()
      return { ok: true, page: pageSummary(page) }
    }
    if (input.op === 'clear_navigation_history') {
      const result = await executePageCommand(workspaceFolder, page, { type: 'clear_navigation_history' })
      page.webContents.navigationHistory.clear()
      return {
        ok: true,
        page: pageSummary(page),
        persisted: true,
        result
      }
    }
    if (input.op === 'set_zoom') {
      const factor = typeof input.factor === 'number' && Number.isFinite(input.factor)
        ? Math.min(5, Math.max(0.25, input.factor))
        : undefined
      if (factor == null) {
        throw Object.assign(new Error('A finite zoom factor is required.'), { code: 'INVALID_ARGUMENT' })
      }
      page.webContents.setZoomFactor(factor)
      return { ok: true, page_id: page.id, factor: page.webContents.getZoomFactor() }
    }
    if (input.op === 'navigate_history') {
      const navigationHistory = page.webContents.navigationHistory
      const currentIndex = navigationHistory.getActiveIndex()
      const entries = navigationHistory.getAllEntries()
      const requestedIndex = typeof input.index === 'number' && Number.isFinite(input.index)
        ? Math.round(input.index)
        : undefined
      const requestedOffset = typeof input.offset === 'number' && Number.isFinite(input.offset)
        ? Math.round(input.offset)
        : input.direction === 'forward'
        ? 1
        : -1
      const targetIndex = requestedIndex ?? currentIndex + requestedOffset
      const canNavigate = targetIndex >= 0 && targetIndex < entries.length && targetIndex !== currentIndex && (
        requestedIndex != null || navigationHistory.canGoToOffset(requestedOffset)
      )
      let persistedResult: unknown
      if (canNavigate) {
        await waitForNavigation(
          page.webContents,
          () => {
            if (requestedIndex != null) navigationHistory.goToIndex(targetIndex)
            else navigationHistory.goToOffset(requestedOffset)
          },
          normalizeTimeout(input.timeout_ms)
        )
        const authoritativeEntries = navigationHistory.getAllEntries()
        const authoritativeIndex = navigationHistory.getActiveIndex()
        persistedResult = await executePageCommand(workspaceFolder, page, {
          type: 'sync_navigation_history',
          active_index: authoritativeIndex,
          current_url: authoritativeEntries[authoritativeIndex]?.url ?? page.webContents.getURL(),
          entries: authoritativeEntries.map(entry => ({
            title: entry.title,
            url: entry.url
          }))
        })
      }
      return {
        ok: true,
        page_id: page.id,
        from_index: currentIndex,
        target_index: targetIndex,
        navigated: canNavigate,
        current_index: navigationHistory.getActiveIndex(),
        url: page.webContents.getURL(),
        ...(canNavigate ? { persisted: true, persistence_result: persistedResult } : {})
      }
    }
    if (input.op === 'snapshot') {
      const generation = (snapshotGenerations.get(page.webContents.id) ?? 0) + 1
      snapshotGenerations.set(page.webContents.id, generation)
      return {
        page: pageSummary(page),
        snapshot: await withTimeout(
          page.webContents.executeJavaScript(createSnapshotScript(generation), true)
        )
      }
    }
    if (input.op === 'screenshot') {
      const image = await withTimeout(page.webContents.capturePage())
      return { page: pageSummary(page), mime_type: 'image/png', data_base64: image.toPNG().toString('base64') }
    }
    if (input.op === 'navigate') {
      await withTimeout(page.webContents.loadURL(readHttpUrl(input.url).href))
      return {
        ok: true,
        page: pageSummary({ ...page, title: page.webContents.getTitle(), url: page.webContents.getURL() })
      }
    }
    if (input.op === 'click' || input.op === 'type' || input.op === 'select') {
      const ref = normalizeText(input.ref)
      const match = /^s(\d+)e\d+$/u.exec(ref)
      if (match == null) {
        throw Object.assign(new Error('An element ref from in_app_browser_snapshot is required.'), {
          code: 'INVALID_ARGUMENT'
        })
      }
      if (Number.parseInt(match[1], 10) !== snapshotGenerations.get(page.webContents.id)) {
        throw Object.assign(new Error('The element reference is stale. Take a new snapshot.'), {
          code: 'TARGET_NOT_FOUND',
          statusCode: 409
        })
      }
      const result = await withTimeout(page.webContents.executeJavaScript(
        createElementActionScript(
          input.op,
          ref,
          input.op === 'select'
            ? typeof input.value === 'string' ? input.value : ''
            : typeof input.text === 'string'
            ? input.text
            : '',
          (() => {
            const color = browserCursorColor((page.session_id ?? normalizeText(input.session_id)) || page.id)
            return { color, svg: createOneWorksCursorSvg({ color, size: 64 }) }
          })()
        ),
        true
      ))
      if (isRecord(result) && result.ok === false) {
        throw Object.assign(
          new Error(normalizeText(result.message) || 'Browser action failed.'),
          { code: normalizeText(result.code) || 'BROWSER_ACTION_FAILED', statusCode: 409 }
        )
      }
      await pause(input.op === 'click' ? 280 : 200)
      return {
        ok: true,
        page_id: page.id,
        ref,
        ...(
          input.op === 'select' && isRecord(result)
            ? { label: result.label, value: result.value }
            : {}
        )
      }
    }
    if (input.op === 'press_key') {
      const key = normalizeText(input.key)
      if (key === '') throw Object.assign(new Error('A key is required.'), { code: 'INVALID_ARGUMENT' })
      page.webContents.focus()
      page.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
      page.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
      return { ok: true, page_id: page.id, key }
    }
    if (input.op === 'scroll') {
      const x = typeof input.x === 'number' && Number.isFinite(input.x) ? Math.round(input.x) : 0
      const y = typeof input.y === 'number' && Number.isFinite(input.y) ? Math.round(input.y) : 0
      return {
        page_id: page.id,
        ...(await withTimeout(page.webContents.executeJavaScript(createScrollScript(x, y), true)))
      }
    }
    if (input.op === 'wait') return await wait(page, input)
    throw Object.assign(new Error('Unknown browser control operation.'), { code: 'METHOD_NOT_FOUND', statusCode: 404 })
  }

  const wait = async (page: ReturnType<BrowserControlPages['resolvePage']>, input: BrowserControlRequest) => {
    const duration = typeof input.duration_ms === 'number' && Number.isFinite(input.duration_ms)
      ? Math.min(maxWaitTimeoutMs, Math.max(0, Math.round(input.duration_ms)))
      : undefined
    if (duration != null) {
      await pause(duration)
      return { ok: true, page_id: page.id, elapsed_ms: duration }
    }
    const startedAt = now()
    const timeout = normalizeTimeout(input.timeout_ms)
    const probe = { ref: normalizeText(input.ref) || undefined, text: normalizeText(input.text) || undefined }
    if (probe.ref != null && !/^s\d+e\d+$/u.test(probe.ref)) {
      throw Object.assign(
        new Error('A valid element ref from in_app_browser_snapshot is required.'),
        { code: 'INVALID_ARGUMENT' }
      )
    }
    while (now() - startedAt <= timeout) {
      if (await withTimeout(page.webContents.executeJavaScript(createWaitProbeScript(probe), true))) {
        return { ok: true, page_id: page.id, elapsed_ms: now() - startedAt }
      }
      await pause(100)
    }
    throw Object.assign(new Error('Browser wait timed out.'), { code: 'WAIT_TIMEOUT', statusCode: 408 })
  }

  return { execute }
}
