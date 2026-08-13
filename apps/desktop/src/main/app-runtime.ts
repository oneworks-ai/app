/* eslint-disable max-lines -- app runtime wires lifecycle hooks and main-process modules in one place. */
import { join } from 'node:path'
import process from 'node:process'

import { BrowserWindow, app, dialog, globalShortcut, nativeTheme, shell } from 'electron'

import { createJavaScriptErrorReport } from '@oneworks/diagnostics'
import type { JavaScriptErrorSource } from '@oneworks/diagnostics'
import { standaloneDevicesRoutePath } from '@oneworks/types'

import {
  rememberRecentWorkspaceFolder,
  removeRecentWorkspaceFolder,
  resolveDesktopLaunchWorkspaceFolder,
  resolveProjectWorkspaceFolder
} from '../workspace-state.cjs'
import { installBrowserActivityDownloadTracking } from './browser-activity'
import { createBrowserControlBroker } from './browser-control-broker'
import { updateSavedPasswordsRuntimeSettings } from './browser-data-sync'
import { readDesktopBuildSource } from './build-source'
import { DESKTOP_SETTINGS_CHANNEL, DESKTOP_UPDATE_STATUS_CHANNEL, GLOBAL_INTERFACE_LANGUAGE_CHANNEL } from './constants'
import { createDesktopContextCaptureOverlayController } from './context-capture-overlay'
import { normalizeDesktopContextCaptureSettingsPatch } from './context-capture-settings'
import { desktopDeepLinkSchemes, findDesktopDeepLinkArg, parseDesktopDeepLinkLaunchRequest } from './deep-link'
import { applyDesktopIconToAllWindows, readDesktopIconPreviewDataUrl } from './desktop-app-icon'
import { normalizeDesktopIconSettingsPatch } from './desktop-icon-settings'
import {
  loadGlobalAppearanceSettings,
  loadGlobalDesktopSettingsState,
  loadProjectDesktopUpdateSettings,
  saveGlobalAppearanceSettingsPatch,
  saveGlobalDesktopSettingsPatch,
  saveProjectDesktopUpdateSettingsPatch
} from './desktop-settings-config'
import { readDesktopState, readLegacyDesktopSettings, saveDesktopState } from './desktop-state-store'
import {
  readGlobalInterfaceLanguageConfig,
  resetGlobalInterfaceLanguageConfig as resetGlobalInterfaceLanguageConfigFile,
  updateGlobalInterfaceLanguageConfig as updateGlobalInterfaceLanguageConfigFile
} from './interface-language-config'
import { registerIpcHandlers } from './ipc-handlers'
import { createDesktopJavaScriptDiagnostics } from './javascript-diagnostics'
import { createLauncherClientServiceManager } from './launcher-client-service'
import { toElectronAccelerator } from './launcher-shortcut'
import { createManagerServiceManager } from './manager-service-manager'
import { createAppMenuManager } from './menu'
import {
  QUIT_CONFIRMATION_RESPONSE,
  buildQuitConfirmationMessageBoxOptions,
  resolveQuitConfirmationAppName,
  resolveQuitConfirmationLanguage,
  resolveQuitConfirmationSystemLocale
} from './quit-confirmation'
import type { QuitConfirmationLanguage } from './quit-confirmation'
import { createDesktopQuitCoordinator } from './quit-coordinator'
import { createDesktopRuntimeState } from './runtime-state'
import { createDesktopStartupDiagnostics, readDesktopDiagnosticReportingEnabled } from './startup-diagnostics'
import type { DesktopStartupDiagnostics } from './startup-diagnostics'
import { formatDesktopSupportBundleFileName, writeDesktopSupportBundle } from './support-bundle'
import { resolveDesktopRecordingThemeSource, setDesktopThemeSource } from './theme-source'
import type { DesktopSettings, LaunchRequest, WindowRecord, WorkspaceSelectorWindowInput } from './types'
import { DEFAULT_DESKTOP_AUTO_UPDATE, isDesktopUpdateChannel, resolveDefaultDesktopUpdateChannel } from './update-types'
import type { DesktopUpdateStatus } from './update-types'
import { createAutoUpdateManager } from './updates'
import { createWindowManager } from './window-manager'
import type { WindowManager } from './window-manager'
import { createWorkspaceRuntimeCacheManager } from './workspace-runtime-cache-manager'
import { refreshWorkspaceRuntimeCache } from './workspace-runtime-cache-refresh'
import { createWorkspaceServiceManager } from './workspace-service-manager'

const elapsedMs = (startedAt: number) => `${Date.now() - startedAt}ms`

const logDesktopStartup = (message: string) => {
  process.stdout.write(`[oneworks-desktop] ${message}\n`)
}

const resolveStandaloneTabLaunchRequest = (rawTab: string | undefined): LaunchRequest | undefined => {
  const tab = rawTab?.trim()
  if (tab == null || tab === '') return undefined
  if (tab === 'devices') return { standaloneRoutePath: standaloneDevicesRoutePath }
  if (tab.startsWith('/standalone/')) return { standaloneRoutePath: tab }
  return undefined
}

export const createDesktopApp = () => {
  const runtimeState = createDesktopRuntimeState()
  const defaultDesktopUpdateChannel = resolveDefaultDesktopUpdateChannel(app.getVersion())
  runtimeState.desktopState.updateChannel = defaultDesktopUpdateChannel
  const initialWorkspaceFolder = resolveDesktopLaunchWorkspaceFolder({
    env: process.env
  })
  const initialDeepLinkRequest = parseDesktopDeepLinkLaunchRequest(findDesktopDeepLinkArg(process.argv) ?? '')
  const initialStandaloneLaunchRequest = resolveStandaloneTabLaunchRequest(process.env.ONEWORKS_DESKTOP_STANDALONE_TAB)
  const recordingThemeSource = resolveDesktopRecordingThemeSource()

  let menuManager: ReturnType<typeof createAppMenuManager>
  let windowManager: WindowManager
  let autoUpdateManager: ReturnType<typeof createAutoUpdateManager>
  let startupDiagnostics: DesktopStartupDiagnostics | undefined
  let javascriptDiagnostics: ReturnType<typeof createDesktopJavaScriptDiagnostics> | undefined
  const contextCaptureOverlayController = createDesktopContextCaptureOverlayController()
  const browserControlBroker = createBrowserControlBroker({
    getWorkspaceHostWebContents: workspaceFolder => (
      [...runtimeState.windows.values()]
        .filter(record => record.workspaceFolder === workspaceFolder && !record.window.isDestroyed())
        .map(record => record.window.webContents)
    )
  })
  let registeredLauncherAccelerator: string | undefined
  let launcherShortcutError: string | undefined
  let launcherShortcutRegistered = false
  let preserveLegacyDesktopSettings = false
  let quitConfirmationPromise: Promise<void> | undefined
  let desktopClientOrigin: string | undefined
  let resolveDesktopClientOrigin: ((origin: string) => void) | undefined
  const desktopClientOriginPromise = new Promise<string>((resolve) => {
    resolveDesktopClientOrigin = resolve
  })

  const publishDesktopClientOrigin = (origin: string) => {
    if (desktopClientOrigin != null) return
    desktopClientOrigin = origin
    resolveDesktopClientOrigin?.(origin)
    resolveDesktopClientOrigin = undefined
  }

  const resolveDesktopSystemLocale = () =>
    resolveQuitConfirmationSystemLocale({
      appLocale: app.getLocale(),
      preferredSystemLanguages: app.getPreferredSystemLanguages()
    })

  const resolveDesktopAppLocale = () => app.getLocale()

  let quitConfirmationLanguage: QuitConfirmationLanguage = resolveQuitConfirmationLanguage({})

  const refreshAppMenu = () => {
    menuManager?.refreshAppMenu()
  }

  const broadcastWorkspaceSelectorState = () => {
    windowManager?.broadcastWorkspaceSelectorState()
  }

  const loadWorkspaceDesktopUpdateSettings = async (workspaceFolder?: string) => {
    try {
      return await loadProjectDesktopUpdateSettings(workspaceFolder)
    } catch (error) {
      console.warn('[oneworks-desktop] failed to load project desktop update settings', error)
      return {}
    }
  }

  const setRuntimeDesktopUpdateSettings = (
    settings: Pick<DesktopSettings, 'autoUpdate' | 'updateChannel'>
  ) => {
    const updateChannelChanged = settings.updateChannel !== runtimeState.desktopState.updateChannel
    const autoUpdateChanged = settings.autoUpdate !== runtimeState.desktopState.autoUpdate
    if (!updateChannelChanged && !autoUpdateChanged) return

    runtimeState.desktopState = {
      ...runtimeState.desktopState,
      autoUpdate: settings.autoUpdate,
      updateChannel: settings.updateChannel
    }
    if (autoUpdateChanged) {
      autoUpdateManager.setAutoUpdateEnabled(settings.autoUpdate)
    }
    if (updateChannelChanged) {
      autoUpdateManager.setUpdateChannel(settings.updateChannel)
    }
  }

  const applyProjectDesktopUpdateSettings = async (workspaceFolder?: string) => {
    const updateSettings = await loadWorkspaceDesktopUpdateSettings(workspaceFolder)
    const settings = {
      autoUpdate: updateSettings.autoUpdate ?? DEFAULT_DESKTOP_AUTO_UPDATE,
      updateChannel: updateSettings.updateChannel ?? defaultDesktopUpdateChannel
    }
    setRuntimeDesktopUpdateSettings(settings)
    return settings
  }

  const buildDesktopSettings = async (
    windowRecord?: WindowRecord,
    options: { applyProjectUpdateChannel?: boolean } = {}
  ): Promise<DesktopSettings> => {
    const buildSource = readDesktopBuildSource()
    const globalAppearanceSettings = await loadGlobalAppearanceSettings().catch((error) => {
      console.warn('[oneworks-desktop] failed to load global appearance config', error)
      return {}
    })
    const appearanceSettings = {
      ...globalAppearanceSettings,
      ...(recordingThemeSource == null ? {} : { themeMode: recordingThemeSource })
    }
    const updateSettings = await loadWorkspaceDesktopUpdateSettings(windowRecord?.workspaceFolder)
    const desktopUpdateSettings = {
      autoUpdate: updateSettings.autoUpdate ?? DEFAULT_DESKTOP_AUTO_UPDATE,
      updateChannel: updateSettings.updateChannel ?? defaultDesktopUpdateChannel
    }
    if (options.applyProjectUpdateChannel === true) {
      setRuntimeDesktopUpdateSettings(desktopUpdateSettings)
    }

    return {
      ...(buildSource != null ? { buildSource } : {}),
      ...appearanceSettings,
      contextCapture: runtimeState.desktopState.contextCapture,
      iconAppearance: runtimeState.desktopState.iconAppearance,
      iconBackground: runtimeState.desktopState.iconBackground,
      syncAppIcon: runtimeState.desktopState.syncAppIcon,
      iconTheme: runtimeState.desktopState.iconTheme,
      launcherShortcut: runtimeState.desktopState.launcherShortcut,
      launcherShortcutError,
      launcherShortcutRegistered,
      autoUpdate: desktopUpdateSettings.autoUpdate,
      openLastWorkspaceOnStartup: runtimeState.desktopState.openLastWorkspaceOnStartup,
      savedPasswordsAutoSignIn: runtimeState.desktopState.savedPasswordsAutoSignIn,
      savedPasswordsOfferToSave: runtimeState.desktopState.savedPasswordsOfferToSave,
      savedPasswordsRequireAuth: runtimeState.desktopState.savedPasswordsRequireAuth,
      updateChannel: desktopUpdateSettings.updateChannel
    }
  }

  const broadcastDesktopSettings = () => {
    for (const windowRecord of runtimeState.windows.values()) {
      if (windowRecord.window.isDestroyed()) continue

      void buildDesktopSettings(windowRecord)
        .then((settings) => {
          if (!windowRecord.window.isDestroyed()) {
            windowRecord.window.webContents.send(DESKTOP_SETTINGS_CHANNEL, settings)
          }
        })
        .catch((error) => {
          console.warn('[oneworks-desktop] failed to broadcast desktop settings', error)
        })
    }
  }

  const broadcastUpdateStatus = (status: DesktopUpdateStatus) => {
    for (const windowRecord of runtimeState.windows.values()) {
      if (!windowRecord.window.isDestroyed()) {
        windowRecord.window.webContents.send(DESKTOP_UPDATE_STATUS_CHANNEL, status)
      }
    }
  }

  const broadcastGlobalInterfaceLanguageConfig = (
    config: Awaited<ReturnType<typeof readGlobalInterfaceLanguageConfig>>
  ) => {
    for (const windowRecord of runtimeState.windows.values()) {
      if (!windowRecord.window.isDestroyed()) {
        windowRecord.window.webContents.send(GLOBAL_INTERFACE_LANGUAGE_CHANNEL, config)
      }
    }
  }

  const handleDesktopError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('One Works failed to open the workspace', message)
  }

  const reportDesktopJavaScriptError = (
    error: unknown,
    source: JavaScriptErrorSource,
    input: { fingerprintMaterial?: string; type?: string } = {}
  ) => {
    const report = createJavaScriptErrorReport(error, {
      ...input,
      serviceVersion: app.getVersion(),
      source,
      surface: 'desktop'
    })
    void javascriptDiagnostics?.record(report).catch((recordError) => {
      const name = recordError instanceof Error ? recordError.name : 'UnknownError'
      console.warn(`[oneworks-desktop] failed to record JavaScript diagnostic (${name})`)
    })
  }

  const handleUncaughtExceptionMonitor = (error: Error, origin: string) => {
    reportDesktopJavaScriptError(
      error,
      origin === 'unhandledRejection'
        ? 'electron.main_unhandled_rejection'
        : 'electron.main_uncaught_exception'
    )
  }

  const loadQuitConfirmationLanguage = async () => {
    try {
      const languageConfig = await readGlobalInterfaceLanguageConfig()
      quitConfirmationLanguage = resolveQuitConfirmationLanguage({
        appLocale: resolveDesktopAppLocale(),
        configuredLanguage: languageConfig.effectiveLanguage,
        systemLocale: resolveDesktopSystemLocale()
      })
      return quitConfirmationLanguage
    } catch (error) {
      console.warn('[oneworks-desktop] failed to load interface language for quit confirmation', error)
      quitConfirmationLanguage = resolveQuitConfirmationLanguage({
        appLocale: resolveDesktopAppLocale(),
        systemLocale: resolveDesktopSystemLocale()
      })
      return quitConfirmationLanguage
    }
  }

  const refreshQuitConfirmationLanguageFromConfig = (
    config: Awaited<ReturnType<typeof readGlobalInterfaceLanguageConfig>>
  ) => {
    quitConfirmationLanguage = resolveQuitConfirmationLanguage({
      appLocale: resolveDesktopAppLocale(),
      configuredLanguage: config.effectiveLanguage,
      systemLocale: resolveDesktopSystemLocale()
    })
    refreshAppMenu()
  }

  const getQuitConfirmationLanguage = () => quitConfirmationLanguage

  const showQuitConfirmationDialog = async () => {
    const language = await loadQuitConfirmationLanguage()
    const options = buildQuitConfirmationMessageBoxOptions({
      appName: resolveQuitConfirmationAppName(app.name),
      language
    })
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const result = focusedWindow == null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(focusedWindow, options)

    return result.response === QUIT_CONFIRMATION_RESPONSE.quit
  }

  const requestQuitConfirmation = () => {
    if (runtimeState.isQuitting) return
    if (quitConfirmationPromise != null) return

    quitConfirmationPromise = showQuitConfirmationDialog()
      .then((confirmed) => {
        if (!confirmed) return
        runtimeState.isQuitting = true
        app.quit()
      })
      .catch((error) => {
        console.warn('[oneworks-desktop] failed to show quit confirmation', error)
      })
      .finally(() => {
        quitConfirmationPromise = undefined
      })
  }

  const getDesktopClientOrigin = () => {
    if (desktopClientOrigin != null) return desktopClientOrigin
    const clientUrl = runtimeState.launcherClientService?.clientUrl
    if (clientUrl == null) return undefined
    try {
      return new URL(clientUrl).origin
    } catch {
      return undefined
    }
  }

  const normalizeLaunchRequest = (launchRequest: LaunchRequest): LaunchRequest => {
    const workspaceFolder = resolveProjectWorkspaceFolder(launchRequest.workspaceFolder)
    return {
      ...(launchRequest.launcherRoutePath == null ? {} : { launcherRoutePath: launchRequest.launcherRoutePath }),
      ...(launchRequest.standaloneRoutePath == null ? {} : { standaloneRoutePath: launchRequest.standaloneRoutePath }),
      ...(launchRequest.routePath == null ? {} : { routePath: launchRequest.routePath }),
      ...(workspaceFolder == null ? {} : { workspaceFolder })
    }
  }

  const openLaunchRequest = async (launchRequest: LaunchRequest) => {
    const normalizedLaunchRequest = normalizeLaunchRequest(launchRequest)
    if (normalizedLaunchRequest.standaloneRoutePath != null) {
      await windowManager.openStandaloneTabWindow(normalizedLaunchRequest.standaloneRoutePath)
      return
    }
    if (normalizedLaunchRequest.launcherRoutePath != null) {
      await windowManager.openLauncherRouteWindow(normalizedLaunchRequest.launcherRoutePath)
      return
    }
    if (normalizedLaunchRequest.workspaceFolder != null && normalizedLaunchRequest.routePath != null) {
      await windowManager.openWorkspaceRouteWindow(
        normalizedLaunchRequest.workspaceFolder,
        normalizedLaunchRequest.routePath
      )
      return
    }
    if (normalizedLaunchRequest.workspaceFolder != null) {
      await windowManager.openWorkspaceWindow(normalizedLaunchRequest.workspaceFolder)
      return
    }
    await windowManager.createLauncherWindow()
  }

  const queueOrOpenLaunchRequest = (launchRequest: LaunchRequest) => {
    const normalizedLaunchRequest = normalizeLaunchRequest(launchRequest)
    if (!app.isReady()) {
      runtimeState.pendingLaunchRequests.push(normalizedLaunchRequest)
      return
    }
    void openLaunchRequest(normalizedLaunchRequest).catch(handleDesktopError)
  }

  const rememberWorkspaceFolder = (workspaceFolder: string) => {
    runtimeState.desktopState = {
      ...runtimeState.desktopState,
      recentWorkspaces: rememberRecentWorkspaceFolder(
        runtimeState.desktopState.recentWorkspaces,
        workspaceFolder
      )
    }
    saveDesktopState(runtimeState.desktopState, { preserveLegacySettings: preserveLegacyDesktopSettings })
    void applyProjectDesktopUpdateSettings(workspaceFolder)
    refreshAppMenu()
    broadcastWorkspaceSelectorState()
  }

  const forgetWorkspaceFolder = (workspaceFolder: string) => {
    runtimeState.desktopState = {
      ...runtimeState.desktopState,
      recentWorkspaces: removeRecentWorkspaceFolder(
        runtimeState.desktopState.recentWorkspaces,
        workspaceFolder
      )
    }
    saveDesktopState(runtimeState.desktopState, { preserveLegacySettings: preserveLegacyDesktopSettings })
    refreshAppMenu()
    broadcastWorkspaceSelectorState()
  }

  const managerServiceManager = createManagerServiceManager({
    getClientOrigin: async () => desktopClientOrigin ?? await desktopClientOriginPromise,
    getIsQuitting: () => runtimeState.isQuitting,
    runtimeState
  })

  const exportDiagnosticSupportBundle = async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const defaultPath = join(app.getPath('downloads'), formatDesktopSupportBundleFileName())
    const result = focusedWindow == null
      ? await dialog.showSaveDialog({
        defaultPath,
        filters: [{ extensions: ['json'], name: 'JSON diagnostic bundle' }],
        title: 'Export Diagnostic Support Bundle'
      })
      : await dialog.showSaveDialog(focusedWindow, {
        defaultPath,
        filters: [{ extensions: ['json'], name: 'JSON diagnostic bundle' }],
        title: 'Export Diagnostic Support Bundle'
      })
    if (result.canceled || result.filePath == null) return

    await writeDesktopSupportBundle({
      architecture: process.arch,
      destinationPath: result.filePath,
      platform: process.platform,
      productName: app.name,
      productVersion: app.getVersion(),
      userDataDirectory: app.getPath('userData')
    })
    const messageBoxOptions = {
      message: 'Diagnostic support bundle exported.',
      detail:
        'The bundle contains pseudonymized diagnostic facts and excludes prompts, credentials, paths, and raw logs.',
      type: 'info' as const
    }
    if (focusedWindow == null) {
      await dialog.showMessageBox(messageBoxOptions)
    } else {
      await dialog.showMessageBox(focusedWindow, messageBoxOptions)
    }
  }
  const launcherClientServiceManager = createLauncherClientServiceManager({
    getIsQuitting: () => runtimeState.isQuitting,
    onClientOriginAvailable: publishDesktopClientOrigin,
    runtimeState
  })
  const workspaceRuntimeCacheManager = createWorkspaceRuntimeCacheManager({
    onError: error => console.error('[oneworks-runtime] failed to refresh workspace runtime cache', error),
    runRefresh: refreshWorkspaceRuntimeCache
  })
  const serviceManager = createWorkspaceServiceManager({
    broadcastWorkspaceSelectorState,
    findWorkspaceWindowRecord: workspaceFolder => windowManager?.findWorkspaceWindowRecord(workspaceFolder),
    getBrowserControlEnv: workspaceFolder => browserControlBroker.getWorkspaceEnv(workspaceFolder),
    getDesktopClientOrigin,
    getIsQuitting: () => runtimeState.isQuitting,
    loadWorkspaceSelectorWindow: (windowRecord, input: WorkspaceSelectorWindowInput) =>
      windowManager?.loadWorkspaceSelectorWindow(windowRecord, input),
    refreshAppMenu,
    runtimeState
  })
  const runPackagedManagerSmoke = async () => {
    try {
      const [launcherClientService, managerService, cacheSnapshot] = await Promise.all([
        launcherClientServiceManager.ensureLauncherClientService(),
        managerServiceManager.ensureManagerService(),
        workspaceRuntimeCacheManager.refresh()
      ])
      if (launcherClientService.clientUrl == null || managerService.serverUrl == null) {
        throw new Error('The packaged desktop services did not publish their ready URLs.')
      }
      if (cacheSnapshot.status !== 'ready' || cacheSnapshot.result == null) {
        throw new Error('The packaged workspace runtime cache did not finish refreshing.')
      }
      return {
        cacheSource: cacheSnapshot.result.source,
        clientUrl: launcherClientService.clientUrl,
        managerUrl: managerService.serverUrl
      }
    } finally {
      runtimeState.isQuitting = true
      await Promise.all([
        workspaceRuntimeCacheManager.stop(),
        launcherClientServiceManager.stopLauncherClientService(runtimeState.launcherClientService),
        managerServiceManager.stopManagerService(runtimeState.managerService)
      ])
    }
  }
  const quitCoordinator = createDesktopQuitCoordinator({
    onShutdownError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[oneworks-desktop] failed to stop local services before quit', error)
      dialog.showErrorBox('One Works could not quit cleanly', message)
    },
    quit: () => app.quit(),
    setIsQuitting: isQuitting => {
      runtimeState.isQuitting = isQuitting
    },
    shutdown: async () => {
      await workspaceRuntimeCacheManager.stop()
      await serviceManager.stopAllWorkspaceServices()
      await Promise.all([
        browserControlBroker.stop(),
        launcherClientServiceManager.stopLauncherClientService(runtimeState.launcherClientService),
        managerServiceManager.stopManagerService(runtimeState.managerService)
      ])
    }
  })
  autoUpdateManager = createAutoUpdateManager({
    getAutoUpdateEnabled: () => runtimeState.desktopState.autoUpdate,
    getUpdateChannel: () => runtimeState.desktopState.updateChannel,
    onStatusChange: broadcastUpdateStatus
  })

  const findLauncherWindowRecord = () => (
    Array.from(runtimeState.windows.values())
      .find(candidate => candidate.kind === 'launcher' && !candidate.window.isDestroyed())
  )

  const preloadLauncherWindow = () => {
    if (process.platform !== 'darwin') return
    if (process.env.ONEWORKS_DESKTOP_SHOW_LAUNCHER_ON_STARTUP === '1') return
    void windowManager.createLauncherWindow({ show: false }).catch((error) => {
      console.warn('[oneworks-desktop] failed to preload launcher window', error)
    })
  }

  let launcherPreloadScheduled = false
  const scheduleLauncherPreloadAfterStartupReady = () => {
    if (launcherPreloadScheduled || runtimeState.isQuitting || findLauncherWindowRecord() != null) return
    launcherPreloadScheduled = true
    const timer = setTimeout(() => {
      if (runtimeState.isQuitting || findLauncherWindowRecord() != null) return
      preloadLauncherWindow()
    }, 1_000)
    timer.unref()
  }

  windowManager = createWindowManager({
    ensureLauncherClientService: launcherClientServiceManager.ensureLauncherClientService,
    ensureManagerService: managerServiceManager.ensureManagerService,
    ensureWorkspaceService: serviceManager.ensureWorkspaceService,
    forgetWorkspaceFolder,
    onStartupDegraded: (error, input) => startupDiagnostics?.degrade(error, input),
    onStartupStage: name => startupDiagnostics?.stage(name),
    onStartupWindowReady: (readiness) => {
      if (readiness === 'editable') {
        startupDiagnostics?.ready()
        scheduleLauncherPreloadAfterStartupReady()
      } else {
        startupDiagnostics?.degrade(new Error('Workspace opened with a degraded renderer surface.'), {
          code: 'workspace.renderer_surface_degraded',
          domain: 'renderer',
          retryable: true
        })
      }
    },
    onRendererGone: details =>
      reportDesktopJavaScriptError(undefined, 'electron.renderer_gone', {
        fingerprintMaterial: details.reason,
        type: 'RendererProcessGone'
      }),
    refreshAppMenu,
    rememberWorkspaceFolder,
    runtimeState,
    stopWorkspaceService: serviceManager.stopWorkspaceService
  })

  const stopWorkspaceFolder = async (
    workspaceFolder: string,
    input: {
      forget?: boolean
    } = {}
  ) => {
    const workspaceFolderCandidate = workspaceFolder.trim()
    const normalizedWorkspaceFolder = resolveProjectWorkspaceFolder(workspaceFolderCandidate) ??
      workspaceFolderCandidate
    const service = runtimeState.services.get(normalizedWorkspaceFolder)
    const stopped = service != null
    if (service != null) {
      await serviceManager.stopWorkspaceService(service)
    }

    const removed = input.forget === true
    if (removed) {
      forgetWorkspaceFolder(normalizedWorkspaceFolder)
    } else if (stopped) {
      rememberWorkspaceFolder(normalizedWorkspaceFolder)
    }

    return {
      ok: true,
      removed,
      stopped,
      workspaceFolder: normalizedWorkspaceFolder
    }
  }

  const getManagerConnection = async () => {
    const service = await managerServiceManager.ensureManagerService()
    if (service.serverUrl == null) {
      throw new Error('The local One Works manager server did not publish a URL.')
    }
    return { serverBaseUrl: service.serverUrl }
  }

  menuManager = createAppMenuManager({
    checkForUpdates: autoUpdateManager.checkForUpdates,
    createLauncherWindow: windowManager.createLauncherWindow,
    createWorkspaceSelectorWindow: windowManager.createWorkspaceSelectorWindow,
    exportDiagnosticSupportBundle,
    findWindowRecord: windowManager.findWindowRecord,
    getQuitConfirmationLanguage,
    handleDesktopError,
    openStandaloneTabWindow: windowManager.openStandaloneTabWindow,
    openWorkspaceDialog: windowManager.openWorkspaceDialog,
    openWorkspaceWindow: windowManager.openWorkspaceWindow,
    requestQuitConfirmation,
    runtimeState
  })

  const loadDesktopStateIntoMemory = async () => {
    const desktopState = readDesktopState()
    const desktopSettingsState = await loadGlobalDesktopSettingsState(readLegacyDesktopSettings())
    preserveLegacyDesktopSettings = !desktopSettingsState.legacyMigrationSucceeded
    runtimeState.desktopState = {
      ...desktopState,
      ...desktopSettingsState.settings
    }
    updateSavedPasswordsRuntimeSettings({
      autoSignIn: runtimeState.desktopState.savedPasswordsAutoSignIn,
      requireAuth: runtimeState.desktopState.savedPasswordsRequireAuth
    })
  }

  const resolveStartupWorkspaceFolder = () => (
    initialWorkspaceFolder ??
      (
        runtimeState.desktopState.openLastWorkspaceOnStartup
          ? runtimeState.desktopState.recentWorkspaces[0]
          : undefined
      )
  )

  const applyDesktopIcon = () => {
    if (!runtimeState.desktopState.syncAppIcon) return
    applyDesktopIconToAllWindows(runtimeState.desktopState)
  }

  const getDesktopIconPreviewDataUrl = (settings: Partial<DesktopSettings>) => {
    const iconSettings = {
      ...runtimeState.desktopState,
      ...normalizeDesktopIconSettingsPatch(settings)
    }
    return readDesktopIconPreviewDataUrl(iconSettings)
  }

  const handleNativeThemeUpdated = () => {
    if (!runtimeState.desktopState.syncAppIcon) return
    if (runtimeState.desktopState.iconAppearance !== 'system') return
    applyDesktopIcon()
  }

  const flushPendingLaunchRequests = async () => {
    const pendingLaunchRequests = [...runtimeState.pendingLaunchRequests]
    runtimeState.pendingLaunchRequests = []

    for (const launchRequest of pendingLaunchRequests) {
      await openLaunchRequest(launchRequest)
    }
  }

  const handleSecondInstance = (
    _event: Electron.Event,
    _argv: string[],
    _workingDirectory: string,
    additionalData: unknown
  ) => {
    const deepLinkRequest = parseDesktopDeepLinkLaunchRequest(findDesktopDeepLinkArg(_argv) ?? '')
    const additionalStandaloneRoutePath = (additionalData as { standaloneRoutePath?: unknown } | undefined)
      ?.standaloneRoutePath
    const workspaceFolder = resolveProjectWorkspaceFolder(
      (additionalData as { workspaceFolder?: unknown } | undefined)?.workspaceFolder
    )
    const launchRequest = deepLinkRequest ??
      (typeof additionalStandaloneRoutePath === 'string'
        ? { standaloneRoutePath: additionalStandaloneRoutePath }
        : { workspaceFolder })

    queueOrOpenLaunchRequest(launchRequest)
  }

  const handleOpenUrl = (event: Electron.Event, url: string) => {
    event.preventDefault()
    const launchRequest = parseDesktopDeepLinkLaunchRequest(url)
    if (launchRequest == null) return
    queueOrOpenLaunchRequest(launchRequest)
  }

  const registerDesktopDeepLinkProtocols = () => {
    for (const scheme of desktopDeepLinkSchemes) {
      app.setAsDefaultProtocolClient(scheme)
    }
  }

  const registerDesktopIpcHandlers = () => {
    registerIpcHandlers({
      buildWorkspaceSelectorState: windowManager.buildWorkspaceSelectorState,
      findWindowRecordForWebContents: windowManager.findWindowRecordForWebContents,
      forgetWorkspaceFolder,
      getDesktopIconPreviewDataUrl,
      getDesktopSettings: (windowRecord?: WindowRecord) =>
        buildDesktopSettings(windowRecord, { applyProjectUpdateChannel: true }),
      getManagerConnection,
      getUpdateStatus: autoUpdateManager.getStatus,
      getGlobalInterfaceLanguageConfig: readGlobalInterfaceLanguageConfig,
      hideDesktopContextCaptureOverlay: contextCaptureOverlayController.hide,
      isWindowRecordUsable: windowManager.isWindowRecordUsable,
      invokeCurrentWorkspacePluginResult: windowManager.invokeCurrentWorkspacePluginResult,
      listCurrentWorkspaceFileOpeners: windowManager.listCurrentWorkspaceFileOpeners,
      listWorkspaceFileOpeners: windowManager.listWorkspaceFileOpeners,
      loadWorkspaceInWindow: windowManager.loadWorkspaceInWindow,
      markDesktopCoreReady: () => {
        startupDiagnostics?.stage('core.ready')
      },
      markDesktopUiReady: () => startupDiagnostics?.stage('ui.ready'),
      markWorkspaceStartupWindowReady: windowManager.markWorkspaceStartupWindowReady,
      openKeyboardShortcutsSettings,
      openCurrentWorkspaceFileInExternalOpener: windowManager.openCurrentWorkspaceFileInExternalOpener,
      openCurrentWorkspaceResource: windowManager.openCurrentWorkspaceResource,
      openWorkspaceFileInExternalOpener: windowManager.openWorkspaceFileInExternalOpener,
      openWorkspaceUrlWindow: windowManager.openWorkspaceUrlWindow,
      openWorkspaceWindow: windowManager.openWorkspaceWindow,
      promptForNewWorkspaceFolder: windowManager.promptForNewWorkspaceFolder,
      promptForWorkspaceFolder: windowManager.promptForWorkspaceFolder,
      reportJavaScriptError: report =>
        javascriptDiagnostics?.record(report) ?? Promise.resolve({
          recordedLocally: false,
          reported: false
        }),
      checkForUpdates: autoUpdateManager.checkForUpdates,
      retryLauncherShortcutRegistration,
      resetGlobalInterfaceLanguageConfig,
      searchCurrentWorkspacePlugins: windowManager.searchCurrentWorkspacePlugins,
      searchCurrentWorkspaceResources: windowManager.searchCurrentWorkspaceResources,
      setThemeSource: setDesktopThemeSource,
      showDesktopContextCaptureOverlay: (input: unknown) =>
        contextCaptureOverlayController.show(input, {
          defaultPlacement: runtimeState.desktopState.contextCapture.overlayPlacement
        }),
      stopWorkspaceFolder,
      updateDesktopSettings,
      updateGlobalAppearanceConfig,
      updateGlobalInterfaceLanguageConfig
    })
  }

  const updateGlobalAppearanceConfig = async (
    appearance: Partial<Pick<DesktopSettings, 'primaryColor' | 'themeMode' | 'themePack' | 'themePacks'>>
  ) => {
    const appearancePatch = {
      ...(appearance.primaryColor == null ? {} : { primaryColor: appearance.primaryColor }),
      ...(appearance.themeMode == null ? {} : { themeMode: appearance.themeMode }),
      ...(appearance.themePack == null ? {} : { themePack: appearance.themePack }),
      ...(appearance.themePacks == null ? {} : { themePacks: appearance.themePacks })
    }
    await saveGlobalAppearanceSettingsPatch(appearancePatch)
    broadcastDesktopSettings()
    return buildDesktopSettings()
  }

  const updateGlobalInterfaceLanguageConfig = async (language: unknown) => {
    const config = await updateGlobalInterfaceLanguageConfigFile(language)
    refreshQuitConfirmationLanguageFromConfig(config)
    broadcastGlobalInterfaceLanguageConfig(config)
    return config
  }

  const resetGlobalInterfaceLanguageConfig = async () => {
    const config = await resetGlobalInterfaceLanguageConfigFile()
    refreshQuitConfirmationLanguageFromConfig(config)
    broadcastGlobalInterfaceLanguageConfig(config)
    return config
  }

  const openKeyboardShortcutsSettings = async () => {
    if (process.platform !== 'darwin') return
    await shell.openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension')
  }

  const warmWorkspaceRuntimeCacheSoon = () => {
    if (!app.isPackaged) return
    workspaceRuntimeCacheManager.schedule(30_000)
  }

  const toggleLauncherFromShortcut = () => {
    const launcherWindowRecord = findLauncherWindowRecord()
    if (launcherWindowRecord != null && launcherWindowRecord.window.isVisible()) {
      launcherWindowRecord.window.hide()
      return
    }

    void windowManager.createLauncherWindow().catch(handleDesktopError)
  }

  const unregisterLauncherGlobalShortcut = () => {
    if (registeredLauncherAccelerator != null) {
      globalShortcut.unregister(registeredLauncherAccelerator)
      registeredLauncherAccelerator = undefined
    }
  }

  const registerLauncherGlobalShortcut = (launcherShortcut = runtimeState.desktopState.launcherShortcut) => {
    unregisterLauncherGlobalShortcut()
    launcherShortcutError = undefined
    launcherShortcutRegistered = false

    const shortcut = launcherShortcut.trim()
    if (shortcut === '') {
      return true
    }

    const accelerator = toElectronAccelerator(shortcut)
    if (accelerator == null) {
      launcherShortcutError = `Invalid launcher shortcut: ${shortcut}`
      console.warn(`[oneworks-desktop] ${launcherShortcutError}`)
      return false
    }

    const registered = globalShortcut.register(accelerator, toggleLauncherFromShortcut)
    if (!registered) {
      launcherShortcutError = `Failed to register launcher shortcut ${accelerator}. It may be reserved by the system.`
      console.warn(`[oneworks-desktop] ${launcherShortcutError}`)
      return false
    }

    registeredLauncherAccelerator = accelerator
    launcherShortcutRegistered = true
    return true
  }

  const retryLauncherShortcutRegistration = async () => {
    registerLauncherGlobalShortcut()
    refreshAppMenu()
    broadcastDesktopSettings()
    return await buildDesktopSettings()
  }

  const updateDesktopSettings = async (nextSettings: Partial<DesktopSettings>, windowRecord?: WindowRecord) => {
    if (
      typeof nextSettings.launcherShortcut === 'string' &&
      nextSettings.launcherShortcut.trim() !== '' &&
      toElectronAccelerator(nextSettings.launcherShortcut) == null
    ) {
      throw new Error('Invalid launcher shortcut')
    }

    const updateChannelPatch = isDesktopUpdateChannel(nextSettings.updateChannel)
      ? nextSettings.updateChannel
      : undefined
    const autoUpdatePatch = typeof nextSettings.autoUpdate === 'boolean'
      ? nextSettings.autoUpdate
      : undefined
    const desktopSettingsPatch = {
      ...(typeof nextSettings.launcherShortcut === 'string'
        ? { launcherShortcut: nextSettings.launcherShortcut }
        : {}),
      ...(typeof nextSettings.openLastWorkspaceOnStartup === 'boolean'
        ? { openLastWorkspaceOnStartup: nextSettings.openLastWorkspaceOnStartup }
        : {}),
      ...(typeof nextSettings.savedPasswordsAutoSignIn === 'boolean'
        ? { savedPasswordsAutoSignIn: nextSettings.savedPasswordsAutoSignIn }
        : {}),
      ...(typeof nextSettings.savedPasswordsOfferToSave === 'boolean'
        ? { savedPasswordsOfferToSave: nextSettings.savedPasswordsOfferToSave }
        : {}),
      ...(typeof nextSettings.savedPasswordsRequireAuth === 'boolean'
        ? { savedPasswordsRequireAuth: nextSettings.savedPasswordsRequireAuth }
        : {}),
      ...normalizeDesktopContextCaptureSettingsPatch(nextSettings, runtimeState.desktopState.contextCapture),
      ...normalizeDesktopIconSettingsPatch(nextSettings)
    }
    const hasDesktopSettingsPatch = Object.keys(desktopSettingsPatch).length > 0
    const nextDesktopState = {
      ...runtimeState.desktopState,
      ...desktopSettingsPatch,
      ...(autoUpdatePatch == null ? {} : { autoUpdate: autoUpdatePatch }),
      ...(updateChannelPatch == null ? {} : { updateChannel: updateChannelPatch })
    }

    const previousLauncherShortcut = runtimeState.desktopState.launcherShortcut
    const shouldUpdateLauncherShortcut = nextDesktopState.launcherShortcut !== previousLauncherShortcut
    const shouldUpdateIcon = nextDesktopState.syncAppIcon && (
      nextDesktopState.syncAppIcon !== runtimeState.desktopState.syncAppIcon ||
      nextDesktopState.iconAppearance !== runtimeState.desktopState.iconAppearance ||
      nextDesktopState.iconBackground !== runtimeState.desktopState.iconBackground ||
      nextDesktopState.iconTheme !== runtimeState.desktopState.iconTheme
    )
    if (shouldUpdateLauncherShortcut) {
      registerLauncherGlobalShortcut(nextDesktopState.launcherShortcut)
    }

    const previousDesktopState = runtimeState.desktopState
    runtimeState.desktopState = nextDesktopState
    updateSavedPasswordsRuntimeSettings({
      autoSignIn: nextDesktopState.savedPasswordsAutoSignIn,
      requireAuth: nextDesktopState.savedPasswordsRequireAuth
    })
    try {
      if (hasDesktopSettingsPatch) {
        await saveGlobalDesktopSettingsPatch(desktopSettingsPatch)
        preserveLegacyDesktopSettings = false
      }
      if (autoUpdatePatch != null || updateChannelPatch != null) {
        await saveProjectDesktopUpdateSettingsPatch(windowRecord?.workspaceFolder, {
          ...(autoUpdatePatch == null ? {} : { autoUpdate: autoUpdatePatch }),
          ...(updateChannelPatch == null ? {} : { updateChannel: updateChannelPatch })
        })
      }
    } catch (error) {
      runtimeState.desktopState = previousDesktopState
      updateSavedPasswordsRuntimeSettings({
        autoSignIn: previousDesktopState.savedPasswordsAutoSignIn,
        requireAuth: previousDesktopState.savedPasswordsRequireAuth
      })
      if (shouldUpdateLauncherShortcut) {
        registerLauncherGlobalShortcut(previousDesktopState.launcherShortcut)
      }
      throw error
    }
    if (shouldUpdateIcon) {
      applyDesktopIcon()
    }
    if (autoUpdatePatch != null) {
      autoUpdateManager.setAutoUpdateEnabled(autoUpdatePatch)
    }
    if (updateChannelPatch != null) {
      autoUpdateManager.setUpdateChannel(updateChannelPatch)
    }
    refreshAppMenu()
    broadcastDesktopSettings()
    return buildDesktopSettings(windowRecord)
  }

  const startApp = async () => {
    const startedAt = Date.now()
    logDesktopStartup('startup begin')
    await browserControlBroker.start()
    await loadDesktopStateIntoMemory()
    startupDiagnostics?.stage('desktop.state.ready')
    logDesktopStartup(`startup desktop state ready elapsed=${elapsedMs(startedAt)}`)
    applyDesktopIcon()
    registerDesktopIpcHandlers()
    installBrowserActivityDownloadTracking()
    registerLauncherGlobalShortcut()
    startupDiagnostics?.stage('shell.registered')
    logDesktopStartup(`startup shell services registered elapsed=${elapsedMs(startedAt)}`)
    const quitConfirmationLanguagePromise = loadQuitConfirmationLanguage()
      .then(() => {
        refreshAppMenu()
        logDesktopStartup(`startup quit language ready elapsed=${elapsedMs(startedAt)}`)
      })
      .catch((error) => {
        console.warn('[oneworks-desktop] failed to initialize quit confirmation language', error)
      })
    refreshAppMenu()

    const startupWorkspaceFolder = resolveStartupWorkspaceFolder()
    const projectDesktopUpdateSettingsPromise = applyProjectDesktopUpdateSettings(startupWorkspaceFolder)
      .then(() => {
        logDesktopStartup(`startup update settings ready elapsed=${elapsedMs(startedAt)}`)
      })
      .catch((error) => {
        console.warn('[oneworks-desktop] failed to initialize project desktop update settings', error)
      })
    const hasPendingLaunchRequest = runtimeState.pendingLaunchRequests.length > 0

    if (startupWorkspaceFolder == null) {
      warmWorkspaceRuntimeCacheSoon()
      logDesktopStartup(`startup workspace package cache warm scheduled elapsed=${elapsedMs(startedAt)}`)
    }

    if (startupWorkspaceFolder != null && !hasPendingLaunchRequest) {
      try {
        await windowManager.openWorkspaceWindow(startupWorkspaceFolder)
      } catch (error) {
        if (initialWorkspaceFolder != null) {
          throw error
        }
        console.warn('[oneworks-desktop] failed to restore last workspace on startup', error)
        await windowManager.createLauncherWindow()
      }
    } else if (!hasPendingLaunchRequest) {
      await windowManager.createLauncherWindow()
    }

    if (startupWorkspaceFolder != null) {
      warmWorkspaceRuntimeCacheSoon()
      logDesktopStartup(`startup workspace package cache warm scheduled elapsed=${elapsedMs(startedAt)}`)
    }
    await projectDesktopUpdateSettingsPromise
    await quitConfirmationLanguagePromise
    startupDiagnostics?.stage('settings.ready')
    autoUpdateManager.start()
    await flushPendingLaunchRequests()
    startupDiagnostics?.stage('launch.requests.ready')
    if (startupWorkspaceFolder == null) {
      preloadLauncherWindow()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().some(window => window.isVisible())) {
        return
      }
      void windowManager.createLauncherWindow().catch(handleDesktopError)
    })
  }

  const bootstrap = () => {
    registerDesktopDeepLinkProtocols()
    const hasSingleInstanceLock = app.requestSingleInstanceLock({
      standaloneRoutePath: initialStandaloneLaunchRequest?.standaloneRoutePath ?? null,
      workspaceFolder: initialWorkspaceFolder ?? null
    })

    if (!hasSingleInstanceLock) {
      app.quit()
      return
    }

    try {
      startupDiagnostics = createDesktopStartupDiagnostics({
        architecture: process.arch,
        directory: join(app.getPath('userData'), 'diagnostics', 'startup'),
        environment: app.isPackaged ? 'production' : 'development',
        otlpExporter: readDesktopDiagnosticReportingEnabled() ? undefined : false,
        platform: process.platform,
        serviceVersion: app.getVersion()
      })
      startupDiagnostics.stage('electron.instance.owner')
    } catch (error) {
      console.warn('[oneworks-desktop] failed to initialize startup diagnostics', error)
    }

    try {
      javascriptDiagnostics = createDesktopJavaScriptDiagnostics({
        architecture: process.arch,
        directory: join(app.getPath('userData'), 'diagnostics', 'javascript'),
        environment: app.isPackaged ? 'production' : 'development',
        getReportingEnabled: readDesktopDiagnosticReportingEnabled,
        platform: process.platform,
        serviceVersion: app.getVersion()
      })
      process.on('uncaughtExceptionMonitor', handleUncaughtExceptionMonitor)
    } catch (error) {
      console.warn('[oneworks-desktop] failed to initialize JavaScript diagnostics', error)
    }

    if (initialDeepLinkRequest != null) {
      runtimeState.pendingLaunchRequests.push(normalizeLaunchRequest(initialDeepLinkRequest))
    } else if (initialStandaloneLaunchRequest != null) {
      runtimeState.pendingLaunchRequests.push(normalizeLaunchRequest(initialStandaloneLaunchRequest))
    }
    app.on('second-instance', handleSecondInstance)
    app.on('open-url', handleOpenUrl)
    nativeTheme.on('updated', handleNativeThemeUpdated)

    app.whenReady().then(() => {
      startupDiagnostics?.stage('electron.ready')
      void startApp().catch((error) => {
        startupDiagnostics?.fail(error, {
          code: 'desktop.startup_failed',
          domain: 'process',
          retryable: true
        })
        handleDesktopError(error)
      })
    })

    app.on('before-quit', quitCoordinator.handleBeforeQuit)

    app.on('will-quit', () => {
      void workspaceRuntimeCacheManager.stop()
      startupDiagnostics?.cancel()
      void startupDiagnostics?.flush().catch((error) => {
        console.warn('[oneworks-desktop] failed to flush startup diagnostics', error)
      })
      process.off('uncaughtExceptionMonitor', handleUncaughtExceptionMonitor)
      void javascriptDiagnostics?.flush().catch((error) => {
        const name = error instanceof Error ? error.name : 'UnknownError'
        console.warn(`[oneworks-desktop] failed to flush JavaScript diagnostics (${name})`)
      })
      nativeTheme.off('updated', handleNativeThemeUpdated)
      contextCaptureOverlayController.dispose()
      unregisterLauncherGlobalShortcut()
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit()
      }
    })
  }

  return {
    bootstrap,
    initialWorkspaceFolder,
    runPackagedManagerSmoke,
    runtimeState
  }
}
