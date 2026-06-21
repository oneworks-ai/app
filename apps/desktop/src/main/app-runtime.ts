/* eslint-disable max-lines -- app runtime wires lifecycle hooks and main-process modules in one place. */
import process from 'node:process'

import { BrowserWindow, app, dialog, globalShortcut, nativeTheme, shell } from 'electron'

import {
  rememberRecentWorkspaceFolder,
  removeRecentWorkspaceFolder,
  resolveDesktopLaunchWorkspaceFolder,
  resolveProjectWorkspaceFolder
} from '../workspace-state.cjs'
import { installBrowserActivityDownloadTracking } from './browser-activity'
import { updateSavedPasswordsRuntimeSettings } from './browser-data-sync'
import { readDesktopBuildSource } from './build-source'
import { DESKTOP_SETTINGS_CHANNEL, DESKTOP_UPDATE_STATUS_CHANNEL, GLOBAL_INTERFACE_LANGUAGE_CHANNEL } from './constants'
import { desktopDeepLinkSchemes, findDesktopDeepLinkArg, parseDesktopDeepLinkLaunchRequest } from './deep-link'
import { applyDesktopIconToAllWindows, readDesktopIconPreviewDataUrl } from './desktop-app-icon'
import { normalizeDesktopContextCaptureSettingsPatch } from './context-capture-settings'
import { createDesktopContextCaptureOverlayController } from './context-capture-overlay'
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
import { createLauncherClientServiceManager } from './launcher-client-service'
import { toElectronAccelerator } from './launcher-shortcut'
import { createAppMenuManager } from './menu'
import {
  QUIT_CONFIRMATION_RESPONSE,
  buildQuitConfirmationMessageBoxOptions,
  resolveQuitConfirmationAppName,
  resolveQuitConfirmationLanguage,
  resolveQuitConfirmationSystemLocale
} from './quit-confirmation'
import type { QuitConfirmationLanguage } from './quit-confirmation'
import { createDesktopRuntimeState } from './runtime-state'
import { setDesktopThemeSource } from './theme-source'
import type { DesktopSettings, LaunchRequest, WindowRecord, WorkspaceSelectorWindowInput } from './types'
import { DEFAULT_DESKTOP_AUTO_UPDATE, DEFAULT_DESKTOP_UPDATE_CHANNEL, isDesktopUpdateChannel } from './update-types'
import type { DesktopUpdateStatus } from './update-types'
import { createAutoUpdateManager } from './updates'
import { createWindowManager } from './window-manager'
import type { WindowManager } from './window-manager'
import { createWorkspaceServiceManager } from './workspace-service-manager'

export const createDesktopApp = () => {
  const runtimeState = createDesktopRuntimeState()
  const initialWorkspaceFolder = resolveDesktopLaunchWorkspaceFolder({
    env: process.env
  })
  const initialDeepLinkRequest = parseDesktopDeepLinkLaunchRequest(findDesktopDeepLinkArg(process.argv) ?? '')

  let menuManager: ReturnType<typeof createAppMenuManager>
  let windowManager: WindowManager
  let autoUpdateManager: ReturnType<typeof createAutoUpdateManager>
  const contextCaptureOverlayController = createDesktopContextCaptureOverlayController()
  let registeredLauncherAccelerator: string | undefined
  let launcherShortcutError: string | undefined
  let launcherShortcutRegistered = false
  let preserveLegacyDesktopSettings = false
  let quitConfirmationPromise: Promise<void> | undefined

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
      updateChannel: updateSettings.updateChannel ?? DEFAULT_DESKTOP_UPDATE_CHANNEL
    }
    setRuntimeDesktopUpdateSettings(settings)
    return settings
  }

  const buildDesktopSettings = async (
    windowRecord?: WindowRecord,
    options: { applyProjectUpdateChannel?: boolean } = {}
  ): Promise<DesktopSettings> => {
    const buildSource = readDesktopBuildSource()
    const appearanceSettings = await loadGlobalAppearanceSettings().catch((error) => {
      console.warn('[oneworks-desktop] failed to load global appearance config', error)
      return {}
    })
    const updateSettings = await loadWorkspaceDesktopUpdateSettings(windowRecord?.workspaceFolder)
    const desktopUpdateSettings = {
      autoUpdate: updateSettings.autoUpdate ?? DEFAULT_DESKTOP_AUTO_UPDATE,
      updateChannel: updateSettings.updateChannel ?? DEFAULT_DESKTOP_UPDATE_CHANNEL
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
      ...(launchRequest.routePath == null ? {} : { routePath: launchRequest.routePath }),
      ...(workspaceFolder == null ? {} : { workspaceFolder })
    }
  }

  const openLaunchRequest = async (launchRequest: LaunchRequest) => {
    const normalizedLaunchRequest = normalizeLaunchRequest(launchRequest)
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

  const launcherClientServiceManager = createLauncherClientServiceManager({
    getIsQuitting: () => runtimeState.isQuitting,
    runtimeState
  })
  const serviceManager = createWorkspaceServiceManager({
    broadcastWorkspaceSelectorState,
    findWorkspaceWindowRecord: workspaceFolder => windowManager?.findWorkspaceWindowRecord(workspaceFolder),
    getDesktopClientOrigin,
    getIsQuitting: () => runtimeState.isQuitting,
    loadWorkspaceSelectorWindow: (windowRecord, input: WorkspaceSelectorWindowInput) =>
      windowManager?.loadWorkspaceSelectorWindow(windowRecord, input),
    refreshAppMenu,
    runtimeState
  })
  autoUpdateManager = createAutoUpdateManager({
    getAutoUpdateEnabled: () => runtimeState.desktopState.autoUpdate,
    getUpdateChannel: () => runtimeState.desktopState.updateChannel,
    onStatusChange: broadcastUpdateStatus
  })

  windowManager = createWindowManager({
    ensureLauncherClientService: launcherClientServiceManager.ensureLauncherClientService,
    ensureWorkspaceService: serviceManager.ensureWorkspaceService,
    forgetWorkspaceFolder,
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

  menuManager = createAppMenuManager({
    checkForUpdates: autoUpdateManager.checkForUpdates,
    createLauncherWindow: windowManager.createLauncherWindow,
    createWorkspaceSelectorWindow: windowManager.createWorkspaceSelectorWindow,
    findWindowRecord: windowManager.findWindowRecord,
    getQuitConfirmationLanguage,
    handleDesktopError,
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
    const workspaceFolder = resolveProjectWorkspaceFolder(
      (additionalData as { workspaceFolder?: unknown } | undefined)?.workspaceFolder
    )
    const launchRequest = deepLinkRequest ?? { workspaceFolder }

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
      getUpdateStatus: autoUpdateManager.getStatus,
      getGlobalInterfaceLanguageConfig: readGlobalInterfaceLanguageConfig,
      hideDesktopContextCaptureOverlay: contextCaptureOverlayController.hide,
      isWindowRecordUsable: windowManager.isWindowRecordUsable,
      invokeCurrentWorkspacePluginResult: windowManager.invokeCurrentWorkspacePluginResult,
      listCurrentWorkspaceFileOpeners: windowManager.listCurrentWorkspaceFileOpeners,
      listWorkspaceFileOpeners: windowManager.listWorkspaceFileOpeners,
      loadWorkspaceInWindow: windowManager.loadWorkspaceInWindow,
      markWorkspaceStartupWindowReady: windowManager.markWorkspaceStartupWindowReady,
      openKeyboardShortcutsSettings,
      openCurrentWorkspaceFileInExternalOpener: windowManager.openCurrentWorkspaceFileInExternalOpener,
      openCurrentWorkspaceResource: windowManager.openCurrentWorkspaceResource,
      openWorkspaceFileInExternalOpener: windowManager.openWorkspaceFileInExternalOpener,
      openWorkspaceUrlWindow: windowManager.openWorkspaceUrlWindow,
      openWorkspaceWindow: windowManager.openWorkspaceWindow,
      promptForNewWorkspaceFolder: windowManager.promptForNewWorkspaceFolder,
      promptForWorkspaceFolder: windowManager.promptForWorkspaceFolder,
      checkForUpdates: autoUpdateManager.checkForUpdates,
      retryLauncherShortcutRegistration,
      resetGlobalInterfaceLanguageConfig,
      searchCurrentWorkspacePlugins: windowManager.searchCurrentWorkspacePlugins,
      searchCurrentWorkspaceResources: windowManager.searchCurrentWorkspaceResources,
      setThemeSource: setDesktopThemeSource,
      showDesktopContextCaptureOverlay: (input: unknown) => contextCaptureOverlayController.show(input, {
        defaultPlacement: runtimeState.desktopState.contextCapture.overlayPlacement
      }),
      stopWorkspaceFolder,
      updateDesktopSettings,
      updateGlobalAppearanceConfig,
      updateGlobalInterfaceLanguageConfig
    })
  }

  const updateGlobalAppearanceConfig = async (
    appearance: Partial<Pick<DesktopSettings, 'primaryColor' | 'themeMode'>>
  ) => {
    const appearancePatch = {
      ...(appearance.primaryColor == null ? {} : { primaryColor: appearance.primaryColor }),
      ...(appearance.themeMode == null ? {} : { themeMode: appearance.themeMode })
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

  const findLauncherWindowRecord = () => (
    Array.from(runtimeState.windows.values())
      .find(candidate => candidate.kind === 'launcher' && !candidate.window.isDestroyed())
  )

  const preloadLauncherWindow = () => {
    if (process.platform !== 'darwin') return
    void windowManager.createLauncherWindow({ show: false }).catch((error) => {
      console.warn('[oneworks-desktop] failed to preload launcher window', error)
    })
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
    await loadDesktopStateIntoMemory()
    applyDesktopIcon()
    registerDesktopIpcHandlers()
    installBrowserActivityDownloadTracking()
    registerLauncherGlobalShortcut()
    await loadQuitConfirmationLanguage()
    refreshAppMenu()

    const startupWorkspaceFolder = resolveStartupWorkspaceFolder()
    await applyProjectDesktopUpdateSettings(startupWorkspaceFolder)
    const hasPendingWorkspaceLaunch = runtimeState.pendingLaunchRequests.some(request =>
      request.workspaceFolder != null
    )

    if (startupWorkspaceFolder != null && !hasPendingWorkspaceLaunch) {
      try {
        await windowManager.openWorkspaceWindow(startupWorkspaceFolder)
      } catch (error) {
        if (initialWorkspaceFolder != null) {
          throw error
        }
        console.warn('[oneworks-desktop] failed to restore last workspace on startup', error)
        await windowManager.createLauncherWindow()
      }
      preloadLauncherWindow()
    } else if (!hasPendingWorkspaceLaunch) {
      await windowManager.createLauncherWindow()
    }

    autoUpdateManager.start()
    await flushPendingLaunchRequests()
    preloadLauncherWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().some(window => window.isVisible())) {
        return
      }
      void windowManager.createLauncherWindow().catch(handleDesktopError)
    })
  }

  const stopWorkspaceServicesOnQuit = () => {
    for (const service of runtimeState.services.values()) {
      const child = service.serverProcess
      if (child != null && !child.killed) {
        child.kill('SIGTERM')
      }
    }
    void launcherClientServiceManager.stopLauncherClientService(runtimeState.launcherClientService)
  }

  const bootstrap = () => {
    registerDesktopDeepLinkProtocols()
    const hasSingleInstanceLock = app.requestSingleInstanceLock({
      workspaceFolder: initialWorkspaceFolder ?? null
    })

    if (!hasSingleInstanceLock) {
      app.quit()
      return
    }

    if (initialDeepLinkRequest != null) {
      runtimeState.pendingLaunchRequests.push(normalizeLaunchRequest(initialDeepLinkRequest))
    }
    app.on('second-instance', handleSecondInstance)
    app.on('open-url', handleOpenUrl)
    nativeTheme.on('updated', handleNativeThemeUpdated)

    app.whenReady().then(() => {
      void startApp().catch(handleDesktopError)
    })

    app.on('before-quit', () => {
      runtimeState.isQuitting = true
    })

    app.on('will-quit', () => {
      nativeTheme.off('updated', handleNativeThemeUpdated)
      contextCaptureOverlayController.dispose()
      unregisterLauncherGlobalShortcut()
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit()
      }
    })

    app.on('quit', stopWorkspaceServicesOnQuit)
  }

  return {
    bootstrap,
    initialWorkspaceFolder,
    runtimeState
  }
}
