/* eslint-disable max-lines, node/prefer-global/process -- preload centralizes desktop bridge and first-paint startup UI. */
import { contextBridge, ipcRenderer } from 'electron'

import { mountOneWorksIconLoader } from '@oneworks/icon/loader'
import type { OneWorksIconLoaderHandle } from '@oneworks/icon/loader'

import { WORKSPACE_STARTUP_ICON_SEED } from '../workspace-startup-icon'

const selectorStateChannel = 'desktop:workspace-selector-state'
const desktopSettingsChannel = 'desktop:settings'
const desktopUpdateStatusChannel = 'desktop:update-status'
const globalInterfaceLanguageChannel = 'desktop:global-interface-language'
const interactionPanelWebviewCommentElementChannel = 'desktop:interaction-panel-webview-comment-element'
const toggleSidebarChannel = 'desktop:toggle-sidebar'
const viewShortcutChannel = 'desktop:view-shortcut'
const windowFullscreenStateChannel = 'desktop:window-fullscreen-state'
const workspaceResourceRequestChannel = 'desktop:workspace-resource-request'
const workspaceStartupReadyChannel = 'desktop:workspace-startup-ready'
const workspaceConnectionChannel = 'desktop:workspace-connection'
const workspacePluginSearchChannel = 'desktop:plugins:search-current-workspace'
const workspacePluginInvokeChannel = 'desktop:plugins:invoke-current-workspace-result'
const mobileDeviceVideoFrameChannel = 'desktop:mobile-device-video-frame'
const mobileDeviceVideoStreamStatusChannel = 'desktop:mobile-device-video-stream-status'
const systemLocaleArgPrefix = '--oneworks-system-locale='
const workspaceStartupOverlayId = 'oneworks-desktop-startup-overlay'
const workspaceStartupIconSelector = '[data-oneworks-desktop-startup-icon="true"]'
const workspaceStartupTipSelector = '[data-oneworks-desktop-startup-tip="true"]'
const workspaceStartupTipIntervalMs = 3200
const workspaceStartupExitMs = 420

type WorkspaceStartupAppearance = 'system' | 'light' | 'dark'

const workspaceStartupLocales = {
  en: {
    defaultTip: 'Warming up the project context.',
    tips: [
      'Quick search jumps straight to actions, sessions, and files.',
      'Drop files into the composer to skip typing long paths.',
      'Right-click a session to open it in a new window.',
      'Type / to find common commands and workflows.',
      'The bottom panel keeps terminals and web tabs where you left them.',
      'Referencing exact files means fewer guesses and better context.'
    ]
  },
  zh: {
    defaultTip: '正在把项目上下文铺好。',
    tips: [
      '快捷搜索可以直达动作、会话和文件。',
      '可以把文件拖进对话，少打一段路径。',
      '会话右键可以在新窗口打开。',
      '输入 / 可以找到常用命令和工作流。',
      '底部面板会保留终端和网页。',
      '引用具体文件会让回答少一点猜测。'
    ]
  }
} as const

let workspaceStartupIconHandle: OneWorksIconLoaderHandle | null = null
let workspaceStartupTipInterval: number | null = null
let workspaceStartupDisposeTimer: number | null = null

const runWithDocumentElement = (callback: (root: HTMLElement) => void) => {
  const run = () => {
    const root = document.documentElement
    if (root == null) {
      window.requestAnimationFrame(run)
      return
    }

    callback(root)
  }

  run()
}

const getSystemLocale = () => {
  const rawValue = process.argv.find(value => value.startsWith(systemLocaleArgPrefix))
    ?.slice(systemLocaleArgPrefix.length)
  if (rawValue == null || rawValue.trim() === '') return undefined
  try {
    return decodeURIComponent(rawValue)
  } catch {
    return rawValue
  }
}

const resolveStartupLocale = () => {
  const normalizedLocale = (getSystemLocale() ?? navigator.language ?? '').trim().toLowerCase()
  return normalizedLocale.startsWith('zh') ? workspaceStartupLocales.zh : workspaceStartupLocales.en
}

const isWorkspaceClientDocument = () => {
  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return false
  return !/(?:^|\/)launcher\/?$/.test(window.location.pathname)
}

const updateWorkspaceStartupText = () => {
  const locale = resolveStartupLocale()
  const tip = document.querySelector<HTMLElement>(workspaceStartupTipSelector)
  if (tip == null) return

  let tipIndex = 0
  tip.textContent = locale.defaultTip
  if (workspaceStartupTipInterval != null) {
    window.clearInterval(workspaceStartupTipInterval)
  }
  workspaceStartupTipInterval = window.setInterval(() => {
    tip.textContent = locale.tips[tipIndex % locale.tips.length] ?? locale.defaultTip
    tipIndex += 1
  }, workspaceStartupTipIntervalMs)
}

const normalizeWorkspaceStartupAppearance = (value: unknown): WorkspaceStartupAppearance => {
  if (value === 'light' || value === 'dark') return value
  return 'system'
}

const recordingThemeMode = normalizeWorkspaceStartupAppearance(process.env.ONEWORKS_DESKTOP_RECORDING_THEME_MODE)

const applyInitialDesktopThemeMode = () => {
  if (recordingThemeMode === 'system') return
  runWithDocumentElement((root) => {
    root.classList.toggle('dark', recordingThemeMode === 'dark')
    root.dataset.oneworksDesktopStartupTheme = recordingThemeMode
  })
}

const resolveWorkspaceStartupAppearance = (): WorkspaceStartupAppearance => {
  return normalizeWorkspaceStartupAppearance(document.documentElement.dataset.oneworksDesktopStartupTheme)
}

const buildWorkspaceStartupIconOptions = () => ({
  appearance: resolveWorkspaceStartupAppearance(),
  background: 'transparent' as const,
  canvasClassName: 'oneworks-desktop-startup-overlay__icon-canvas',
  className: 'oneworks-desktop-startup-overlay__icon-loader',
  motion: true,
  random: false,
  seed: WORKSPACE_STARTUP_ICON_SEED,
  shadow: false,
  theme: 'metal' as const
})

const mountWorkspaceStartupIcon = () => {
  const host = document.querySelector<HTMLElement>(workspaceStartupIconSelector)
  if (host == null || host.dataset.mounted === 'true') return

  host.dataset.mounted = 'true'
  workspaceStartupIconHandle = mountOneWorksIconLoader(host, buildWorkspaceStartupIconOptions())
}

const activateWorkspaceStartupOverlay = () => {
  const overlay = document.getElementById(workspaceStartupOverlayId)
  if (overlay == null) return

  overlay.setAttribute('aria-hidden', 'false')
  overlay.setAttribute('aria-busy', 'true')
  updateWorkspaceStartupText()
  mountWorkspaceStartupIcon()
}

const installWorkspaceStartupOverlay = () => {
  if (!isWorkspaceClientDocument()) return

  runWithDocumentElement((root) => {
    root.dataset.oneworksDesktopStartupScreen = 'true'
    root.dataset.oneworksDesktopStartupReady = 'false'
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', activateWorkspaceStartupOverlay, { once: true })
      return
    }

    activateWorkspaceStartupOverlay()
  })
}

const markWorkspaceStartupReady = () => {
  const overlay = document.getElementById(workspaceStartupOverlayId)
  void ipcRenderer.invoke(workspaceStartupReadyChannel).catch(() => undefined)
  if (document.documentElement != null) {
    document.documentElement.dataset.oneworksDesktopStartupReady = 'true'
  }
  overlay?.setAttribute('aria-busy', 'false')
  overlay?.setAttribute('aria-hidden', 'true')
  if (workspaceStartupTipInterval != null) {
    window.clearInterval(workspaceStartupTipInterval)
    workspaceStartupTipInterval = null
  }
  if (workspaceStartupDisposeTimer != null) {
    window.clearTimeout(workspaceStartupDisposeTimer)
  }
  workspaceStartupDisposeTimer = window.setTimeout(() => {
    workspaceStartupDisposeTimer = null
    workspaceStartupIconHandle?.dispose()
    workspaceStartupIconHandle = null
    overlay?.remove()
    delete document.documentElement.dataset.oneworksDesktopStartupScreen
    delete document.documentElement.dataset.oneworksDesktopStartupReady
  }, workspaceStartupExitMs)
}

applyInitialDesktopThemeMode()
installWorkspaceStartupOverlay()

contextBridge.exposeInMainWorld('oneworksDesktop', {
  chooseWorkspace: () => ipcRenderer.invoke('desktop:choose-workspace'),
  checkForUpdates: (input?: { interactive?: boolean }) => ipcRenderer.invoke('desktop:check-for-updates', input),
  cloneRepository: (repositoryUrl: string, destinationDirectory: string) =>
    ipcRenderer.invoke('desktop:clone-repository', repositoryUrl, destinationDirectory),
  clearInteractionPanelWebviewData: (dataType: unknown) =>
    ipcRenderer.invoke('desktop:clear-interaction-panel-webview-data', dataType),
  createWorkspace: () => ipcRenderer.invoke('desktop:create-workspace'),
  createWorkspaceInDirectory: (parentDirectory: string, projectName: string) =>
    ipcRenderer.invoke('desktop:create-workspace-in-directory', parentDirectory, projectName),
  forgetWorkspace: (workspaceFolder: string) => ipcRenderer.invoke('desktop:forget-workspace', workspaceFolder),
  stopWorkspace: (workspaceFolder: string, input?: { forget?: boolean }) =>
    ipcRenderer.invoke('desktop:stop-workspace', workspaceFolder, input),
  getDesktopIconPreview: (settings: unknown) => ipcRenderer.invoke('desktop:get-icon-preview', settings),
  getDesktopSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  initialThemeMode: recordingThemeMode === 'system' ? undefined : recordingThemeMode,
  getBrowserDataSyncState: () => ipcRenderer.invoke('desktop:get-browser-data-sync-state'),
  getCurrentWindowPresentationState: () => ipcRenderer.invoke('desktop:get-current-window-presentation-state'),
  listBrowserHistory: (input?: unknown) => ipcRenderer.invoke('desktop:list-browser-history', input),
  recordBrowserHistory: (input: unknown) => ipcRenderer.invoke('desktop:record-browser-history', input),
  registerInteractionPanelWebviewScope: (input: unknown) =>
    ipcRenderer.invoke('desktop:register-interaction-panel-webview-scope', input),
  listBrowserDownloads: (input?: unknown) => ipcRenderer.invoke('desktop:list-browser-downloads', input),
  openBrowserDownload: (id: string) => ipcRenderer.invoke('desktop:open-browser-download', id),
  revealBrowserDownload: (id: string) => ipcRenderer.invoke('desktop:reveal-browser-download', id),
  getUpdateStatus: () => ipcRenderer.invoke('desktop:get-update-status'),
  getGlobalInterfaceLanguageConfig: () => ipcRenderer.invoke('desktop:get-global-interface-language-config'),
  getWindowFullscreenState: () => ipcRenderer.invoke('desktop:get-window-fullscreen-state'),
  getWorkspaceConnection: () => ipcRenderer.invoke(workspaceConnectionChannel),
  getWorkspaceSelectorState: () => ipcRenderer.invoke('desktop:get-workspace-selector-state'),
  hideDesktopContextCaptureOverlay: () => ipcRenderer.invoke('desktop:context-capture:hide-overlay'),
  hideLauncherWindow: () => ipcRenderer.invoke('desktop:hide-launcher-window'),
  importAuthenticatorBackup: () => ipcRenderer.invoke('desktop:import-authenticator-backup'),
  importBrowserPasswords: (input?: unknown) => ipcRenderer.invoke('desktop:import-browser-passwords', input),
  importChromePasswords: (input?: unknown) => ipcRenderer.invoke('desktop:import-chrome-passwords', input),
  importPasswordCsv: (input?: unknown) => ipcRenderer.invoke('desktop:import-password-csv', input),
  listBrowserPasswordImportSources: () => ipcRenderer.invoke('desktop:list-browser-password-import-sources'),
  listSavedPasswords: (query?: string) => ipcRenderer.invoke('desktop:list-saved-passwords', query),
  authenticateSavedPasswordsAccess: (reason?: string) =>
    ipcRenderer.invoke('desktop:authenticate-saved-passwords-access', reason),
  revealSavedPassword: (id: string) => ipcRenderer.invoke('desktop:reveal-saved-password', id),
  copySavedPasswordField: (id: string, field: 'username' | 'password') =>
    ipcRenderer.invoke('desktop:copy-saved-password-field', id, field),
  updateSavedPassword: (id: string, input: unknown) => ipcRenderer.invoke('desktop:update-saved-password', id, input),
  deleteSavedPassword: (id: string) => ipcRenderer.invoke('desktop:delete-saved-password', id),
  isGitAvailable: () => ipcRenderer.invoke('desktop:is-git-available'),
  listCloneDestinationDirectories: (directory?: string) =>
    ipcRenderer.invoke('desktop:list-clone-destination-directories', directory),
  listCurrentWorkspaceFileOpeners: () => ipcRenderer.invoke('desktop:list-current-workspace-file-openers'),
  listWorkspaceFileOpeners: (workspaceFolder: string) =>
    ipcRenderer.invoke('desktop:list-workspace-file-openers', workspaceFolder),
  listMobileDebugTargets: (config: unknown) => ipcRenderer.invoke('desktop:list-mobile-debug-targets', config),
  captureMobileDeviceScreenshot: (deviceId: string) =>
    ipcRenderer.invoke('desktop:capture-mobile-device-screenshot', deviceId),
  startMobileDeviceVideoStream: (deviceId: string) =>
    ipcRenderer.invoke('desktop:start-mobile-device-video-stream', deviceId),
  stopMobileDeviceVideoStream: (streamId: string) =>
    ipcRenderer.invoke('desktop:stop-mobile-device-video-stream', streamId),
  dumpMobileElementTree: (deviceId: string) => ipcRenderer.invoke('desktop:dump-mobile-element-tree', deviceId),
  sendMobileDeviceInput: (deviceId: string, input: unknown) =>
    ipcRenderer.invoke('desktop:send-mobile-device-input', deviceId, input),
  onMobileDeviceVideoFrame: (listener: (value: unknown) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(value)
    }
    ipcRenderer.on(mobileDeviceVideoFrameChannel, wrappedListener)
    return () => {
      ipcRenderer.off(mobileDeviceVideoFrameChannel, wrappedListener)
    }
  },
  onMobileDeviceVideoStreamStatus: (listener: (value: unknown) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(value)
    }
    ipcRenderer.on(mobileDeviceVideoStreamStatusChannel, wrappedListener)
    return () => {
      ipcRenderer.off(mobileDeviceVideoStreamStatusChannel, wrappedListener)
    }
  },
  markWorkspaceStartupReady,
  onDesktopSettingsChange: (listener: (value: unknown) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(value)
    }
    ipcRenderer.on(desktopSettingsChannel, wrappedListener)
    return () => {
      ipcRenderer.off(desktopSettingsChannel, wrappedListener)
    }
  },
  onUpdateStatusChange: (listener: (value: unknown) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(value)
    }
    ipcRenderer.on(desktopUpdateStatusChannel, wrappedListener)
    return () => {
      ipcRenderer.off(desktopUpdateStatusChannel, wrappedListener)
    }
  },
  onGlobalInterfaceLanguageConfigChange: (listener: (value: unknown) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(value)
    }
    ipcRenderer.on(globalInterfaceLanguageChannel, wrappedListener)
    return () => {
      ipcRenderer.off(globalInterfaceLanguageChannel, wrappedListener)
    }
  },
  onInteractionPanelWebviewElementCommentRequest: (listener: (value: unknown) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(value)
    }
    ipcRenderer.on(interactionPanelWebviewCommentElementChannel, wrappedListener)
    return () => {
      ipcRenderer.off(interactionPanelWebviewCommentElementChannel, wrappedListener)
    }
  },
  onToggleSidebarShortcut: (listener: () => void) => {
    const wrappedListener = () => {
      listener()
    }
    ipcRenderer.on(toggleSidebarChannel, wrappedListener)
    return () => {
      ipcRenderer.off(toggleSidebarChannel, wrappedListener)
    }
  },
  onViewShortcut: (listener: (action: string) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: string) => {
      listener(action)
    }
    ipcRenderer.on(viewShortcutChannel, wrappedListener)
    return () => {
      ipcRenderer.off(viewShortcutChannel, wrappedListener)
    }
  },
  onWindowFullscreenChange: (listener: (isFullscreen: boolean) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, isFullscreen: unknown) => {
      listener(isFullscreen === true)
    }
    ipcRenderer.on(windowFullscreenStateChannel, wrappedListener)
    return () => {
      ipcRenderer.off(windowFullscreenStateChannel, wrappedListener)
    }
  },
  onWorkspaceResourceRequest: (listener: (target: unknown) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, target: unknown) => {
      listener(target)
    }
    ipcRenderer.on(workspaceResourceRequestChannel, wrappedListener)
    return () => {
      ipcRenderer.off(workspaceResourceRequestChannel, wrappedListener)
    }
  },
  onWorkspaceSelectorStateChange: (listener: (value: unknown) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(value)
    }
    ipcRenderer.on(selectorStateChannel, wrappedListener)
    return () => {
      ipcRenderer.off(selectorStateChannel, wrappedListener)
    }
  },
  openCurrentWorkspaceWindow: (url: string) => ipcRenderer.invoke('desktop:open-current-workspace-window', url),
  openCurrentWorkspaceFileInExternalOpener: (path: string, opener?: string) =>
    ipcRenderer.invoke('desktop:open-current-workspace-file-external', path, opener),
  openWorkspaceFileInExternalOpener: (workspaceFolder: string, path: string, opener?: string) =>
    ipcRenderer.invoke('desktop:open-workspace-file-external', workspaceFolder, path, opener),
  openFilesystemFileInExternalOpener: (path: string, opener?: string) =>
    ipcRenderer.invoke('desktop:open-filesystem-file-external', path, opener),
  openFilesystemDirectory: (path: string) => ipcRenderer.invoke('desktop:open-filesystem-directory', path),
  revealFilesystemPath: (path: string) => ipcRenderer.invoke('desktop:reveal-filesystem-path', path),
  openCurrentWorkspaceFile: (path: string) => ipcRenderer.invoke('desktop:open-current-workspace-file', path),
  openCurrentWorkspaceResource: (target: unknown) =>
    ipcRenderer.invoke('desktop:open-current-workspace-resource', target),
  openExternalUrl: (url: string) => ipcRenderer.invoke('desktop:open-external-url', url),
  openKeyboardShortcutsSettings: () => ipcRenderer.invoke('desktop:open-keyboard-shortcuts-settings'),
  openWorkspace: (workspaceFolder: string) => ipcRenderer.invoke('desktop:open-workspace', workspaceFolder),
  openWorkspacePath: (workspaceFolder: string, path: string) =>
    ipcRenderer.invoke('desktop:open-workspace-path', workspaceFolder, path),
  platform: process.platform,
  plugins: {
    invokeCurrentWorkspaceResult: (resultId: string) => ipcRenderer.invoke(workspacePluginInvokeChannel, resultId),
    searchCurrentWorkspace: (query: string) => ipcRenderer.invoke(workspacePluginSearchChannel, query)
  },
  retryLauncherShortcutRegistration: () => ipcRenderer.invoke('desktop:retry-launcher-shortcut-registration'),
  resetGlobalInterfaceLanguageConfig: () => ipcRenderer.invoke('desktop:reset-global-interface-language-config'),
  searchCurrentWorkspaceFiles: (query: string, options?: unknown) =>
    ipcRenderer.invoke('desktop:search-current-workspace-files', query, options),
  searchWorkspaceFiles: (workspaceFolder: string, query: string, options?: unknown) =>
    ipcRenderer.invoke('desktop:search-workspace-files', workspaceFolder, query, options),
  searchFilesystemFiles: (query: string, options?: unknown) =>
    ipcRenderer.invoke('desktop:search-filesystem-files', query, options),
  searchCurrentWorkspaceResources: (query: string) =>
    ipcRenderer.invoke('desktop:search-current-workspace-resources', query),
  setCurrentWindowAlwaysOnTop: (value: boolean) =>
    ipcRenderer.invoke('desktop:set-current-window-always-on-top', value),
  setCurrentWindowAspectRatio: (input: { aspectRatio: number; extraSize?: { height: number; width: number } }) =>
    ipcRenderer.invoke('desktop:set-current-window-aspect-ratio', input),
  setCurrentWindowContentSize: (size: { height: number; width: number }) =>
    ipcRenderer.invoke('desktop:set-current-window-content-size', size),
  setCurrentWindowOpacity: (value: number) => ipcRenderer.invoke('desktop:set-current-window-opacity', value),
  setThemeSource: (themeSource: unknown) => ipcRenderer.invoke('desktop:set-theme-source', themeSource),
  showDesktopContextCaptureOverlay: (input: unknown) =>
    ipcRenderer.invoke('desktop:context-capture:show-overlay', input),
  supportsWebviewTag: true,
  systemLocale: getSystemLocale(),
  updateDesktopSettings: (settings: unknown) => ipcRenderer.invoke('desktop:update-settings', settings),
  updateGlobalAppearanceConfig: (appearance: unknown) =>
    ipcRenderer.invoke('desktop:update-global-appearance-config', appearance),
  updateGlobalInterfaceLanguageConfig: (language: unknown) =>
    ipcRenderer.invoke('desktop:update-global-interface-language-config', language),
  writeImageDataUrlToClipboard: (dataUrl: string) =>
    ipcRenderer.invoke('desktop:write-image-data-url-to-clipboard', dataUrl)
})
