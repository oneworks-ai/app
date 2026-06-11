/* eslint-disable max-lines -- centralizes desktop IPC registration for workspace, launcher, and window actions. */
import { clipboard, ipcMain, nativeImage, session, shell } from 'electron'
import type { WebContents } from 'electron'

import { SERVER_READY_TIMEOUT_MS, WORKSPACE_CONNECTION_CHANNEL, WORKSPACE_STARTUP_READY_CHANNEL } from './constants'
import { openFilesystemFileInExternalOpener } from './filesystem-file-opener'
import { listMobileDebugTargets } from './mobile-debug'
import type {
  DesktopInterfaceLanguageConfig,
  DesktopSettings,
  LauncherWorkspaceResourceSearchResponse,
  WindowRecord,
  WorkspaceResourceTarget,
  WorkspaceSelectorState
} from './types'
import type { DesktopUpdateStatus } from './update-types'
import {
  resolveFilesystemDirectoryPath,
  resolveWorkspaceDirectoryPath,
  searchFilesystemFiles,
  searchWorkspaceFiles
} from './workspace-file-search'
import { createWorkspaceFolderInDirectory } from './workspace-folder-create'
import { cloneGitRepositoryIntoDirectory, isGitAvailable, listCloneDestinationDirectories } from './workspace-git-clone'

const interactionPanelWebviewPartition = 'persist:oneworks-interaction-panel'
const workspaceConnectionPollMs = 50

const clearInteractionPanelWebviewData = async (dataType: unknown) => {
  const webviewSession = session.fromPartition(interactionPanelWebviewPartition)
  if (dataType === 'cookies') {
    await webviewSession.clearStorageData({ storages: ['cookies'] })
    return
  }
  if (dataType === 'cache') {
    await webviewSession.clearCache()
    return
  }

  throw new TypeError('Unsupported interaction panel webview data type.')
}

const writeImageDataUrlToClipboard = (dataUrl: unknown) => {
  if (typeof dataUrl !== 'string' || dataUrl.trim() === '') {
    throw new TypeError('A screenshot data URL is required.')
  }

  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) {
    throw new Error('Screenshot image is empty.')
  }

  clipboard.writeImage(image)
}

const normalizeExternalUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('An external URL is required.')
  }

  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:' && url.protocol !== 'tel:') {
    throw new TypeError('Unsupported external URL protocol.')
  }

  return url.href
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeGlobalAppearancePatch = (
  value: unknown
): Partial<Pick<DesktopSettings, 'primaryColor' | 'themeMode'>> => {
  if (!isRecord(value)) return {}

  return {
    ...(typeof value.primaryColor === 'string'
      ? { primaryColor: value.primaryColor as DesktopSettings['primaryColor'] }
      : {}),
    ...(value.themeMode === 'light' || value.themeMode === 'dark' || value.themeMode === 'system'
      ? { themeMode: value.themeMode }
      : {})
  }
}

const waitForWorkspaceConnection = async (
  windowRecord: WindowRecord,
  isWindowRecordUsable: (windowRecord?: WindowRecord) => boolean
) =>
  new Promise<{ serverBaseUrl: string; workspaceFolder?: string } | undefined>((resolve) => {
    const startedAt = Date.now()
    const poll = () => {
      if (!isWindowRecordUsable(windowRecord) || windowRecord.kind !== 'workspace') {
        resolve(undefined)
        return
      }

      if (windowRecord.workspaceServerUrl != null) {
        resolve({
          serverBaseUrl: windowRecord.workspaceServerUrl,
          workspaceFolder: windowRecord.workspaceFolder
        })
        return
      }

      if (Date.now() - startedAt >= SERVER_READY_TIMEOUT_MS) {
        resolve(undefined)
        return
      }

      setTimeout(poll, workspaceConnectionPollMs)
    }

    poll()
  })

interface IpcHandlersInput {
  buildWorkspaceSelectorState: (windowRecord?: WindowRecord) => WorkspaceSelectorState
  checkForUpdates: (input?: { interactive?: boolean }) => Promise<DesktopUpdateStatus>
  findWindowRecordForWebContents: (webContents: WebContents) => WindowRecord | undefined
  forgetWorkspaceFolder: (workspaceFolder: string) => void
  getDesktopIconPreviewDataUrl: (settings: Partial<DesktopSettings>) => string | undefined
  getDesktopSettings: (windowRecord?: WindowRecord) => Promise<DesktopSettings>
  getUpdateStatus: () => DesktopUpdateStatus
  getGlobalInterfaceLanguageConfig: () => Promise<DesktopInterfaceLanguageConfig>
  isWindowRecordUsable: (windowRecord?: WindowRecord) => boolean
  invokeCurrentWorkspacePluginResult: (windowRecord: WindowRecord, resultId: string) => Promise<unknown>
  listCurrentWorkspaceFileOpeners: (windowRecord: WindowRecord) => Promise<unknown>
  listWorkspaceFileOpeners: (workspaceFolder: string) => Promise<unknown>
  markWorkspaceStartupWindowReady: (windowRecord: WindowRecord) => void
  openKeyboardShortcutsSettings: () => Promise<void>
  openCurrentWorkspaceResource: (windowRecord: WindowRecord, target: WorkspaceResourceTarget) => Promise<WindowRecord>
  openCurrentWorkspaceFileInExternalOpener: (
    windowRecord: WindowRecord,
    path: string,
    opener?: string
  ) => Promise<void>
  openWorkspaceFileInExternalOpener: (workspaceFolder: string, path: string, opener?: string) => Promise<void>
  loadWorkspaceInWindow: (windowRecord: WindowRecord, workspaceFolder: string) => Promise<void>
  openWorkspaceUrlWindow: (sourceWindowRecord: WindowRecord, url: string) => Promise<WindowRecord>
  openWorkspaceWindow: (workspaceFolder: string) => Promise<WindowRecord>
  promptForNewWorkspaceFolder: (windowRecord?: WindowRecord) => Promise<string | undefined>
  promptForWorkspaceFolder: (windowRecord?: WindowRecord) => Promise<string | undefined>
  retryLauncherShortcutRegistration: () => Promise<DesktopSettings>
  resetGlobalInterfaceLanguageConfig: () => Promise<DesktopInterfaceLanguageConfig>
  searchCurrentWorkspaceResources: (
    windowRecord: WindowRecord,
    query: string
  ) => Promise<LauncherWorkspaceResourceSearchResponse>
  searchCurrentWorkspacePlugins: (windowRecord: WindowRecord, query: string) => Promise<unknown>
  setThemeSource: (themeSource: unknown) => string
  updateDesktopSettings: (settings: Partial<DesktopSettings>, windowRecord?: WindowRecord) => Promise<DesktopSettings>
  updateGlobalAppearanceConfig: (
    appearance: Partial<Pick<DesktopSettings, 'primaryColor' | 'themeMode'>>
  ) => Promise<DesktopSettings>
  updateGlobalInterfaceLanguageConfig: (language: unknown) => Promise<DesktopInterfaceLanguageConfig>
}

export const registerIpcHandlers = ({
  buildWorkspaceSelectorState,
  checkForUpdates,
  findWindowRecordForWebContents,
  forgetWorkspaceFolder,
  getDesktopIconPreviewDataUrl,
  getDesktopSettings,
  getUpdateStatus,
  getGlobalInterfaceLanguageConfig,
  isWindowRecordUsable,
  invokeCurrentWorkspacePluginResult,
  listCurrentWorkspaceFileOpeners,
  listWorkspaceFileOpeners,
  markWorkspaceStartupWindowReady,
  openKeyboardShortcutsSettings,
  openCurrentWorkspaceFileInExternalOpener,
  openCurrentWorkspaceResource,
  openWorkspaceFileInExternalOpener,
  loadWorkspaceInWindow,
  openWorkspaceUrlWindow,
  openWorkspaceWindow,
  promptForNewWorkspaceFolder,
  promptForWorkspaceFolder,
  retryLauncherShortcutRegistration,
  resetGlobalInterfaceLanguageConfig,
  searchCurrentWorkspaceResources,
  searchCurrentWorkspacePlugins,
  setThemeSource,
  updateDesktopSettings,
  updateGlobalAppearanceConfig,
  updateGlobalInterfaceLanguageConfig
}: IpcHandlersInput) => {
  ipcMain.handle('desktop:get-settings', (event) => getDesktopSettings(findWindowRecordForWebContents(event.sender)))
  ipcMain.handle('desktop:get-update-status', () => getUpdateStatus())
  ipcMain.handle('desktop:check-for-updates', (_event, input: unknown) => (
    checkForUpdates({
      interactive: isRecord(input) && input.interactive === true
    })
  ))
  ipcMain.handle('desktop:is-git-available', () => isGitAvailable())
  ipcMain.handle(
    'desktop:list-clone-destination-directories',
    (_event, directory: unknown) => listCloneDestinationDirectories(directory)
  )
  ipcMain.handle('desktop:get-global-interface-language-config', () => getGlobalInterfaceLanguageConfig())

  ipcMain.handle(WORKSPACE_STARTUP_READY_CHANNEL, (event) => {
    const windowRecord = findWindowRecordForWebContents(event.sender)
    if (windowRecord == null || !isWindowRecordUsable(windowRecord)) return

    markWorkspaceStartupWindowReady(windowRecord)
  })

  ipcMain.handle(WORKSPACE_CONNECTION_CHANNEL, async (event) => {
    const windowRecord = findWindowRecordForWebContents(event.sender)
    if (
      windowRecord == null ||
      !isWindowRecordUsable(windowRecord) ||
      windowRecord.kind !== 'workspace'
    ) {
      return undefined
    }

    return await waitForWorkspaceConnection(windowRecord, isWindowRecordUsable)
  })

  ipcMain.handle(
    'desktop:get-icon-preview',
    (_event, settings: unknown) =>
      getDesktopIconPreviewDataUrl(isRecord(settings) ? settings as Partial<DesktopSettings> : {})
  )

  ipcMain.handle('desktop:open-keyboard-shortcuts-settings', () => openKeyboardShortcutsSettings())

  ipcMain.handle(
    'desktop:clear-interaction-panel-webview-data',
    (_event, dataType: unknown) => clearInteractionPanelWebviewData(dataType)
  )

  ipcMain.handle(
    'desktop:write-image-data-url-to-clipboard',
    (_event, dataUrl: unknown) => writeImageDataUrlToClipboard(dataUrl)
  )

  ipcMain.handle('desktop:open-external-url', async (_event, url: unknown) => {
    await shell.openExternal(normalizeExternalUrl(url))
  })

  ipcMain.handle('desktop:list-mobile-debug-targets', (_event, config: unknown) => listMobileDebugTargets(config))

  ipcMain.handle('desktop:retry-launcher-shortcut-registration', () => retryLauncherShortcutRegistration())

  ipcMain.handle('desktop:set-theme-source', (_event, themeSource: unknown) => setThemeSource(themeSource))

  ipcMain.handle(
    'desktop:update-global-appearance-config',
    (_event, appearance: unknown) => updateGlobalAppearanceConfig(normalizeGlobalAppearancePatch(appearance))
  )

  ipcMain.handle(
    'desktop:update-global-interface-language-config',
    (_event, language: unknown) => updateGlobalInterfaceLanguageConfig(language)
  )

  ipcMain.handle('desktop:reset-global-interface-language-config', () => resetGlobalInterfaceLanguageConfig())

  ipcMain.handle('desktop:update-settings', (event, settings: unknown) =>
    updateDesktopSettings(
      isRecord(settings)
        ? settings as Partial<DesktopSettings>
        : {},
      findWindowRecordForWebContents(event.sender)
    ))

  ipcMain.handle('desktop:get-workspace-selector-state', (event) => (
    buildWorkspaceSelectorState(findWindowRecordForWebContents(event.sender))
  ))

  ipcMain.handle('desktop:forget-workspace', (_event, workspaceFolder: unknown) => {
    if (typeof workspaceFolder !== 'string' || workspaceFolder.trim() === '') return

    forgetWorkspaceFolder(workspaceFolder)
  })

  const normalizeFileSearchOptions = (value: unknown) => ({
    includeDirectories: isRecord(value) && value.includeDirectories === true
  })

  ipcMain.handle('desktop:search-current-workspace-files', async (event, query: unknown, options: unknown) => {
    const windowRecord = findWindowRecordForWebContents(event.sender)
    const workspaceFolder = windowRecord?.workspaceFolder
    if (workspaceFolder == null || workspaceFolder.trim() === '') {
      return { files: [] }
    }

    return {
      files: await searchWorkspaceFiles({
        ...normalizeFileSearchOptions(options),
        query: typeof query === 'string' ? query : '',
        workspaceFolder
      })
    }
  })

  ipcMain.handle('desktop:search-workspace-files', async (
    _event,
    workspaceFolder: unknown,
    query: unknown,
    options: unknown
  ) => {
    if (typeof workspaceFolder !== 'string' || workspaceFolder.trim() === '') {
      throw new TypeError('Workspace folder is required.')
    }

    return {
      files: await searchWorkspaceFiles({
        ...normalizeFileSearchOptions(options),
        query: typeof query === 'string' ? query : '',
        workspaceFolder
      })
    }
  })

  ipcMain.handle('desktop:search-filesystem-files', async (_event, query: unknown, options: unknown) => {
    return {
      files: await searchFilesystemFiles({
        ...normalizeFileSearchOptions(options),
        query: typeof query === 'string' ? query : ''
      })
    }
  })

  const requireCurrentWorkspaceWindowRecord = (webContents: WebContents) => {
    const windowRecord = findWindowRecordForWebContents(webContents)
    if (windowRecord?.workspaceFolder == null || windowRecord.workspaceFolder.trim() === '') {
      throw new Error('A current workspace is required.')
    }
    return windowRecord
  }

  ipcMain.handle('desktop:search-current-workspace-resources', async (event, query: unknown) => {
    const windowRecord = requireCurrentWorkspaceWindowRecord(event.sender)
    return await searchCurrentWorkspaceResources(windowRecord, typeof query === 'string' ? query : '')
  })

  ipcMain.handle('desktop:plugins:search-current-workspace', async (event, query: unknown) => {
    const windowRecord = findWindowRecordForWebContents(event.sender)
    if (windowRecord == null) {
      return { results: [] }
    }

    return await searchCurrentWorkspacePlugins(windowRecord, typeof query === 'string' ? query : '')
  })

  ipcMain.handle('desktop:plugins:invoke-current-workspace-result', async (event, resultId: unknown) => {
    if (typeof resultId !== 'string' || resultId.trim() === '') {
      throw new TypeError('Plugin launcher result id is required.')
    }

    const windowRecord = findWindowRecordForWebContents(event.sender)
    if (windowRecord == null) return undefined

    return await invokeCurrentWorkspacePluginResult(windowRecord, resultId)
  })

  ipcMain.handle('desktop:list-current-workspace-file-openers', async (event) => {
    const windowRecord = requireCurrentWorkspaceWindowRecord(event.sender)
    return await listCurrentWorkspaceFileOpeners(windowRecord)
  })

  ipcMain.handle('desktop:list-workspace-file-openers', async (_event, workspaceFolder: unknown) => {
    if (typeof workspaceFolder !== 'string' || workspaceFolder.trim() === '') {
      throw new TypeError('Workspace folder is required.')
    }

    return await listWorkspaceFileOpeners(workspaceFolder)
  })

  ipcMain.handle('desktop:open-current-workspace-file-external', async (event, path: unknown, opener: unknown) => {
    if (typeof path !== 'string') {
      throw new TypeError('Workspace file path is required.')
    }

    const windowRecord = requireCurrentWorkspaceWindowRecord(event.sender)
    await openCurrentWorkspaceFileInExternalOpener(
      windowRecord,
      path,
      typeof opener === 'string' ? opener : undefined
    )
  })

  ipcMain.handle('desktop:open-workspace-file-external', async (
    _event,
    workspaceFolder: unknown,
    path: unknown,
    opener: unknown
  ) => {
    if (typeof workspaceFolder !== 'string' || workspaceFolder.trim() === '') {
      throw new TypeError('Workspace folder is required.')
    }
    if (typeof path !== 'string') {
      throw new TypeError('Workspace file path is required.')
    }

    await openWorkspaceFileInExternalOpener(
      workspaceFolder,
      path,
      typeof opener === 'string' ? opener : undefined
    )
  })

  ipcMain.handle('desktop:open-current-workspace-file', async (event, path: unknown) => {
    if (typeof path !== 'string') {
      throw new TypeError('Workspace file path is required.')
    }

    return await openCurrentWorkspaceResourceFromEvent(event.sender, { kind: 'file', path })
  })

  const openCurrentWorkspaceResourceFromEvent = async (webContents: WebContents, target: WorkspaceResourceTarget) => {
    const windowRecord = requireCurrentWorkspaceWindowRecord(webContents)

    await openCurrentWorkspaceResource(windowRecord, target)
    if (windowRecord.kind === 'launcher' && isWindowRecordUsable(windowRecord)) {
      windowRecord.window.hide()
    }
  }

  ipcMain.handle('desktop:open-current-workspace-resource', async (event, target: unknown) => {
    if (target == null || typeof target !== 'object' || Array.isArray(target)) {
      throw new TypeError('Workspace resource target is required.')
    }
    const candidate = target as Partial<WorkspaceResourceTarget>
    const allowedKinds = new Set<WorkspaceResourceTarget['kind']>([
      'file',
      'directory',
      'new-session',
      'new-terminal',
      'new-website',
      'session',
      'terminal',
      'website'
    ])
    if (candidate.kind == null || !allowedKinds.has(candidate.kind)) {
      throw new TypeError('Unsupported workspace resource target.')
    }

    await openCurrentWorkspaceResourceFromEvent(event.sender, {
      kind: candidate.kind,
      ...(typeof candidate.path === 'string' ? { path: candidate.path } : {}),
      ...(typeof candidate.sessionId === 'string' ? { sessionId: candidate.sessionId } : {}),
      ...(typeof candidate.terminalId === 'string' ? { terminalId: candidate.terminalId } : {}),
      ...(typeof candidate.title === 'string' ? { title: candidate.title } : {}),
      ...(typeof candidate.url === 'string' ? { url: candidate.url } : {})
    })
  })

  ipcMain.handle('desktop:open-workspace-path', async (_event, workspaceFolder: unknown, path: unknown) => {
    if (typeof workspaceFolder !== 'string' || workspaceFolder.trim() === '') {
      throw new TypeError('Workspace folder is required.')
    }
    if (typeof path !== 'string') {
      throw new TypeError('Workspace directory path is required.')
    }

    await openWorkspaceWindow(await resolveWorkspaceDirectoryPath(workspaceFolder, path))
  })

  ipcMain.handle('desktop:open-filesystem-directory', async (_event, path: unknown) => {
    if (typeof path !== 'string') {
      throw new TypeError('Filesystem directory path is required.')
    }

    await openWorkspaceWindow(await resolveFilesystemDirectoryPath(path))
  })

  ipcMain.handle('desktop:reveal-filesystem-path', async (_event, path: unknown) => {
    if (typeof path !== 'string') {
      throw new TypeError('Filesystem path is required.')
    }

    shell.showItemInFolder(await resolveFilesystemDirectoryPath(path))
  })

  ipcMain.handle('desktop:open-filesystem-file-external', async (_event, path: unknown, opener: unknown) => {
    if (typeof path !== 'string') {
      throw new TypeError('Filesystem file path is required.')
    }

    await openFilesystemFileInExternalOpener(path, opener)
  })

  ipcMain.handle('desktop:get-window-fullscreen-state', (event) => (
    findWindowRecordForWebContents(event.sender)?.window.isFullScreen() ?? false
  ))

  ipcMain.handle('desktop:hide-launcher-window', (event) => {
    const windowRecord = findWindowRecordForWebContents(event.sender)
    if (windowRecord?.kind === 'launcher' && isWindowRecordUsable(windowRecord)) {
      windowRecord.window.hide()
    }
  })

  ipcMain.handle('desktop:choose-workspace', async (event) => {
    const windowRecord = findWindowRecordForWebContents(event.sender)
    return await promptForWorkspaceFolder(windowRecord)
  })

  ipcMain.handle('desktop:create-workspace', async (event) => {
    const windowRecord = findWindowRecordForWebContents(event.sender)
    return await promptForNewWorkspaceFolder(windowRecord)
  })

  ipcMain.handle(
    'desktop:create-workspace-in-directory',
    async (_event, parentDirectory: unknown, projectName: unknown) =>
      await createWorkspaceFolderInDirectory({ parentDirectory, projectName })
  )

  ipcMain.handle(
    'desktop:clone-repository',
    async (_event, repositoryUrl: unknown, destinationDirectory: unknown) =>
      await cloneGitRepositoryIntoDirectory({ destinationDirectory, repositoryUrl })
  )

  ipcMain.handle('desktop:open-workspace', async (event, workspaceFolder: string) => {
    const windowRecord = findWindowRecordForWebContents(event.sender)
    if (windowRecord?.kind === 'launcher') {
      await openWorkspaceWindow(workspaceFolder)
      if (isWindowRecordUsable(windowRecord)) {
        windowRecord.window.hide()
      }
      return
    }

    if (windowRecord?.kind === 'selector' && windowRecord.selectorMode === 'initial') {
      await loadWorkspaceInWindow(windowRecord, workspaceFolder)
      return
    }

    await openWorkspaceWindow(workspaceFolder)
    if (windowRecord?.kind === 'selector' && isWindowRecordUsable(windowRecord)) {
      windowRecord.window.close()
    }
  })

  ipcMain.handle('desktop:open-current-workspace-window', async (event, url: string) => {
    const windowRecord = findWindowRecordForWebContents(event.sender)
    if (windowRecord == null || windowRecord.workspaceFolder == null) {
      throw new Error('A workspace context is required to open this URL.')
    }

    await openWorkspaceUrlWindow(windowRecord, url)
    if (windowRecord.kind === 'launcher' && isWindowRecordUsable(windowRecord)) {
      windowRecord.window.hide()
    }
  })
}
