/* eslint-disable max-lines -- update manager centralizes updater state, dialogs, and scheduling. */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { BrowserWindow, app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

import { resolvePackagedCliPathEnv } from './cli-path-env'
import { AUTO_UPDATE_CONFIG_FILES } from './constants'
import { builtinPackageCachePath, resolveBundledRuntimeConsumerBootstrapPath } from './paths'
import { writeProcessLine } from './process-utils'
import { resolveDesktopRuntimePackageCacheVersionEnv } from './runtime-cache-version'
import {
  DEFAULT_DESKTOP_AUTO_UPDATE,
  DEFAULT_DESKTOP_UPDATE_CHANNEL,
  normalizeDesktopAutoUpdate,
  normalizeDesktopUpdateChannel
} from './update-types'
import type { DesktopUpdateChannel, DesktopUpdateStatus } from './update-types'

const execFileAsync = promisify(execFile)
const BOOTSTRAP_BUFFER_BYTES = 1024 * 1024
const nodeRequire = createRequire(__filename)

interface RuntimePackageStatus {
  installedVersion?: string
  latestVersion: string
  packageName: string
  updateAvailable: boolean
}

type RuntimePackageTarget = 'cli' | 'client' | 'server'

interface BundledRuntimePackageCacheEntry {
  cacheDir?: string
  packageDir?: string
  seeded?: boolean
}

interface BuiltinPackageCacheModule {
  ensureBuiltinRuntimePackageCache?: (options?: { env?: NodeJS.ProcessEnv }) => BundledRuntimePackageCacheEntry[]
}

let workspaceRuntimeRefreshComplete = false
let workspaceRuntimeRefreshPromise: Promise<void> | undefined

const isAutoUpdateDisabled = () => /^(?:0|false|no|off)$/i.test(process.env.ONEWORKS_DESKTOP_AUTO_UPDATE ?? '')
const isAutoUpdateDownloadDisabled = () => (
  /^(?:0|false|no|off)$/i.test(process.env.ONEWORKS_DESKTOP_AUTO_UPDATE_DOWNLOAD ?? '')
)

const startupUpdateCheckDelayMs = 2000
const periodicUpdateCheckIntervalMs = 4 * 60 * 60 * 1000
const githubReleaseFetchTimeoutMs = 15000
const defaultDesktopReleaseTagPrefix = 'pkg/oneworks-desktop/v'
const githubTokenEnvNames = ['ONEWORKS_DESKTOP_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'] as const

interface GitHubAutoUpdateConfig {
  owner: string
  provider: 'github'
  repo: string
  host?: string
  protocol?: 'http' | 'https'
  tagNamePrefix: string
}

interface GitHubReleaseRecord {
  created_at?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string
  tag_name?: string
}

interface ChannelReleaseInfo {
  downloadBaseUrl: string
  tagName: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const resolveAutoUpdateConfigPath = () => (
  AUTO_UPDATE_CONFIG_FILES
    .map(fileName => path.join(process.resourcesPath, fileName))
    .find(filePath => fs.existsSync(filePath))
)

const hasAutoUpdateConfig = () => resolveAutoUpdateConfigPath() != null

const stripYamlScalarQuotes = (value: string) => {
  const firstChar = value.at(0)
  const lastChar = value.at(-1)
  return (firstChar === '"' || firstChar === "'") && firstChar === lastChar
    ? value.slice(1, -1)
    : value
}

const parseSimpleYamlRecord = (content: string) => (
  Object.fromEntries(
    content
      .split(/\r?\n/u)
      .map((line) => {
        const trimmedLine = line.trim()
        if (trimmedLine === '' || trimmedLine.startsWith('#')) return undefined

        const separatorIndex = trimmedLine.indexOf(':')
        if (separatorIndex < 1) return undefined

        const key = trimmedLine.slice(0, separatorIndex).trim()
        if (!/^[\w-]+$/u.test(key)) return undefined

        const value = trimmedLine.slice(separatorIndex + 1).trim()
        return [key, stripYamlScalarQuotes(value)] as const
      })
      .filter((entry): entry is readonly [string, string] => entry != null)
  )
)

const readGitHubAutoUpdateConfig = (): GitHubAutoUpdateConfig => {
  const configPath = resolveAutoUpdateConfigPath()
  if (configPath == null) {
    throw new Error('Desktop auto-update config is missing.')
  }

  const config = parseSimpleYamlRecord(fs.readFileSync(configPath, 'utf8'))
  if (config.provider !== 'github' || config.owner == null || config.repo == null) {
    throw new Error('Desktop prerelease update channels require a GitHub auto-update config.')
  }

  return {
    host: config.host,
    owner: config.owner,
    protocol: config.protocol === 'http' ? 'http' : 'https',
    provider: 'github',
    repo: config.repo,
    tagNamePrefix: config.tagNamePrefix ?? defaultDesktopReleaseTagPrefix
  }
}

const resolveUnavailableReason = (): DesktopUpdateStatus['reason'] | undefined => {
  if (!app.isPackaged) return 'not-packaged'
  if (isAutoUpdateDisabled()) return 'disabled'
  if (!hasAutoUpdateConfig()) return 'missing-config'
  return undefined
}

const buildUnavailableStatus = (
  reason: NonNullable<DesktopUpdateStatus['reason']>,
  updateChannel: DesktopUpdateChannel,
  autoUpdate: boolean
): DesktopUpdateStatus => ({
  autoUpdate,
  autoDownload: false,
  currentVersion: app.getVersion(),
  enabled: false,
  reason,
  status: 'unavailable',
  updateChannel
})

const buildIdleStatus = (updateChannel: DesktopUpdateChannel, autoUpdate: boolean): DesktopUpdateStatus => ({
  autoUpdate,
  autoDownload: autoUpdate && !isAutoUpdateDownloadDisabled(),
  currentVersion: app.getVersion(),
  enabled: true,
  status: 'idle',
  updateChannel
})

const buildInitialStatus = (updateChannel: DesktopUpdateChannel, autoUpdate: boolean) => {
  const reason = resolveUnavailableReason()
  return reason == null
    ? buildIdleStatus(updateChannel, autoUpdate)
    : buildUnavailableStatus(reason, updateChannel, autoUpdate)
}

const getUpdateVersion = (info: { version?: string }) => (
  typeof info.version === 'string' && info.version.trim() !== '' ? info.version : undefined
)

const getErrorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
)

const showUpdateMessageBox = async (options: Electron.MessageBoxOptions) => {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (focusedWindow == null) {
    return await dialog.showMessageBox(options)
  }

  return await dialog.showMessageBox(focusedWindow, options)
}

const encodePathSegment = (value: string) => encodeURIComponent(value).replace(/%2F/giu, '/')

const buildGitHubApiBaseUrl = (config: GitHubAutoUpdateConfig) => {
  const host = config.host ?? 'github.com'
  if (host === 'github.com' || host === 'api.github.com') {
    return `${config.protocol ?? 'https'}://api.github.com`
  }
  return `${config.protocol ?? 'https'}://${host}/api/v3`
}

const buildGitHubDownloadBaseUrl = (config: GitHubAutoUpdateConfig, tagName: string) => {
  const host = config.host == null || config.host === 'api.github.com' ? 'github.com' : config.host
  return `${config.protocol ?? 'https'}://${host}/${encodePathSegment(config.owner)}/${
    encodePathSegment(config.repo)
  }` +
    `/releases/download/${encodeURIComponent(tagName)}/`
}

const resolveGitHubApiToken = () => (
  githubTokenEnvNames
    .map(envName => process.env[envName]?.trim())
    .find(value => value != null && value !== '')
)

const parseDesktopReleaseTagChannel = (tagName: string, tagNamePrefix: string): DesktopUpdateChannel | undefined => {
  if (!tagName.startsWith(tagNamePrefix)) return undefined
  const version = tagName.slice(tagNamePrefix.length)
  const match = /^\d+\.\d+\.\d+(?:-([0-9A-Za-z]+)(?:[.-][0-9A-Za-z.-]+)?)?$/u.exec(version)
  if (match == null) return undefined
  return match[1] == null
    ? DEFAULT_DESKTOP_UPDATE_CHANNEL
    : normalizeDesktopUpdateChannel(match[1])
}

const fetchLatestDesktopRelease = async (
  updateChannel: DesktopUpdateChannel,
  config: GitHubAutoUpdateConfig
): Promise<ChannelReleaseInfo> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), githubReleaseFetchTimeoutMs)
  try {
    const releasesUrl = `${buildGitHubApiBaseUrl(config)}/repos/${encodeURIComponent(config.owner)}/` +
      `${encodeURIComponent(config.repo)}/releases?per_page=50`
    const token = resolveGitHubApiToken()
    const response = await fetch(releasesUrl, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token == null ? {} : { authorization: `Bearer ${token}` }),
        'user-agent': `OneWorks/${app.getVersion()}`
      },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`GitHub releases request failed with ${response.status}.`)
    }

    const releases = await response.json()
    if (!Array.isArray(releases)) {
      throw new TypeError('GitHub releases response is invalid.')
    }

    const release = releases
      .filter((value): value is GitHubReleaseRecord => isRecord(value))
      .filter(value => value.draft !== true && typeof value.tag_name === 'string')
      .find(value => parseDesktopReleaseTagChannel(value.tag_name ?? '', config.tagNamePrefix) === updateChannel)

    if (release?.tag_name == null) {
      throw new Error(`No ${updateChannel} desktop release was found.`)
    }

    return {
      downloadBaseUrl: buildGitHubDownloadBaseUrl(config, release.tag_name),
      tagName: release.tag_name
    }
  } finally {
    clearTimeout(timeout)
  }
}

export interface AutoUpdateManager {
  checkForUpdates: (input?: { interactive?: boolean }) => Promise<DesktopUpdateStatus>
  getStatus: () => DesktopUpdateStatus
  setAutoUpdateEnabled: (autoUpdate: boolean) => DesktopUpdateStatus
  setUpdateChannel: (updateChannel: DesktopUpdateChannel) => DesktopUpdateStatus
  start: () => void
}

export const createAutoUpdateManager = (input: {
  getAutoUpdateEnabled?: () => boolean
  getUpdateChannel?: () => DesktopUpdateChannel
  onStatusChange?: (status: DesktopUpdateStatus) => void
} = {}): AutoUpdateManager => {
  const getAutoUpdateEnabled = () => normalizeDesktopAutoUpdate(input.getAutoUpdateEnabled?.())
  const getUpdateChannel = () => normalizeDesktopUpdateChannel(input.getUpdateChannel?.())
  let status = buildInitialStatus(getUpdateChannel(), getAutoUpdateEnabled())
  let configured = false
  let configuredFeedKey: string | undefined
  let configuredUpdateTag: string | undefined
  let checkingPromise: Promise<DesktopUpdateStatus> | undefined
  let downloadPromise: Promise<DesktopUpdateStatus> | undefined
  let pendingInteractiveCheck = false
  let updateReadyDialogVisible = false
  let started = false
  let startupCheckTimer: ReturnType<typeof setTimeout> | undefined
  let periodicCheckTimer: ReturnType<typeof setInterval> | undefined

  const emitStatus = (nextStatus: DesktopUpdateStatus) => {
    status = {
      ...nextStatus,
      autoUpdate: getAutoUpdateEnabled(),
      updateChannel: getUpdateChannel()
    }
    input.onStatusChange?.(status)
  }

  const patchStatus = (patch: Partial<DesktopUpdateStatus>) => {
    emitStatus({ ...status, ...patch })
  }

  const showUnavailableDialog = async (reason: DesktopUpdateStatus['reason']) => {
    const reasonMessage = reason === 'disabled'
      ? 'Update checks are disabled for this app launch.'
      : 'Updates are available only in packaged release builds with update configuration.'
    await showUpdateMessageBox({
      buttons: ['OK'],
      message: reasonMessage,
      title: 'Updates Unavailable',
      type: 'info'
    })
  }

  const promptToInstallUpdate = async () => {
    if (updateReadyDialogVisible) return

    updateReadyDialogVisible = true
    const updateVersion = status.updateVersion ?? app.getVersion()
    const messageBoxOptions: Electron.MessageBoxOptions = {
      buttons: ['Restart and Update', 'Later'],
      defaultId: 0,
      message:
        `One Works ${updateVersion} has been downloaded and will install automatically when you quit. Restart now to update immediately.`,
      title: 'Update Ready',
      type: 'info'
    }

    try {
      const result = await showUpdateMessageBox(messageBoxOptions)
      if (result.response === 0) {
        autoUpdater.quitAndInstall()
      }
    } catch (error) {
      console.error('[oneworks-update] failed to show update dialog', error)
    } finally {
      updateReadyDialogVisible = false
    }
  }

  const handleUpdateError = (error: unknown) => {
    const errorMessage = getErrorMessage(error)
    console.error('[oneworks-update] update check failed', error)
    patchStatus({
      errorMessage,
      lastCheckedAt: new Date().toISOString(),
      progress: undefined,
      status: 'error'
    })
    if (pendingInteractiveCheck) {
      void showUpdateMessageBox({
        buttons: ['OK'],
        message: errorMessage,
        title: 'Update Check Failed',
        type: 'error'
      })
    }
    pendingInteractiveCheck = false
  }

  const ensureConfigured = () => {
    const updateChannel = getUpdateChannel()
    const reason = resolveUnavailableReason()
    if (reason != null) {
      emitStatus(buildUnavailableStatus(reason, updateChannel, getAutoUpdateEnabled()))
      return false
    }

    if (configured) return true

    autoUpdater.autoDownload = getAutoUpdateEnabled() && !isAutoUpdateDownloadDisabled()
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      patchStatus({
        errorMessage: undefined,
        progress: undefined,
        status: 'checking'
      })
    })
    autoUpdater.on('error', handleUpdateError)
    autoUpdater.on('update-available', (info) => {
      const updateVersion = getUpdateVersion(info)
      writeProcessLine(process.stdout, `[oneworks-update] update available: ${updateVersion ?? 'unknown'}`)
      patchStatus({
        errorMessage: undefined,
        lastCheckedAt: new Date().toISOString(),
        progress: undefined,
        status: autoUpdater.autoDownload ? 'downloading' : 'available',
        updateVersion
      })
      pendingInteractiveCheck = false
    })
    autoUpdater.on('update-not-available', (info) => {
      const updateVersion = getUpdateVersion(info)
      writeProcessLine(process.stdout, `[oneworks-update] already up to date: ${updateVersion ?? app.getVersion()}`)
      patchStatus({
        errorMessage: undefined,
        lastCheckedAt: new Date().toISOString(),
        progress: undefined,
        status: 'idle',
        updateVersion
      })
      if (pendingInteractiveCheck) {
        void showUpdateMessageBox({
          buttons: ['OK'],
          message: `One Works ${app.getVersion()} is up to date.`,
          title: 'No Updates Available',
          type: 'info'
        })
      }
      pendingInteractiveCheck = false
    })
    autoUpdater.on('download-progress', (progress) => {
      patchStatus({
        progress: Number.isFinite(progress.percent) ? progress.percent : undefined,
        status: 'downloading'
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      const updateVersion = getUpdateVersion(info)
      patchStatus({
        errorMessage: undefined,
        lastCheckedAt: new Date().toISOString(),
        progress: 100,
        status: 'downloaded',
        updateVersion
      })
      void promptToInstallUpdate()
    })

    configured = true
    emitStatus(buildIdleStatus(updateChannel, getAutoUpdateEnabled()))
    return true
  }

  const configureFeedForUpdateChannel = async () => {
    const updateChannel = getUpdateChannel()
    const githubConfig = readGitHubAutoUpdateConfig()
    autoUpdater.autoDownload = getAutoUpdateEnabled() && !isAutoUpdateDownloadDisabled()
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = updateChannel !== 'stable'
    autoUpdater.channel = updateChannel === 'stable' ? 'latest' : updateChannel
    autoUpdater.allowDowngrade = updateChannel !== 'stable'

    const release = await fetchLatestDesktopRelease(updateChannel, githubConfig)
    const feedKey = `generic:${updateChannel}:${release.tagName}`
    if (configuredFeedKey !== feedKey) {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: release.downloadBaseUrl,
        channel: updateChannel === 'stable' ? 'latest' : updateChannel
      })
      configuredFeedKey = feedKey
    }
    configuredUpdateTag = release.tagName
    patchStatus({ updateChannel, updateTag: configuredUpdateTag })
  }

  const downloadAvailableUpdate = async (interactive: boolean) => {
    if (downloadPromise != null) {
      pendingInteractiveCheck ||= interactive
      return await downloadPromise
    }

    pendingInteractiveCheck = interactive
    patchStatus({
      errorMessage: undefined,
      progress: undefined,
      status: 'downloading'
    })

    downloadPromise = autoUpdater.downloadUpdate()
      .then(() => status)
      .catch((error) => {
        handleUpdateError(error)
        return status
      })
      .finally(() => {
        downloadPromise = undefined
        pendingInteractiveCheck = false
      })

    return await downloadPromise
  }

  const checkForUpdates: AutoUpdateManager['checkForUpdates'] = async (input) => {
    const interactive = input?.interactive === true
    const updateChannel = getUpdateChannel()
    const reason = resolveUnavailableReason()
    if (reason != null) {
      emitStatus(buildUnavailableStatus(reason, updateChannel, getAutoUpdateEnabled()))
      if (interactive) {
        await showUnavailableDialog(reason)
      }
      return status
    }

    ensureConfigured()

    if (status.status === 'downloaded') {
      if (interactive) {
        await promptToInstallUpdate()
      }
      return status
    }

    if (status.status === 'available') {
      return await downloadAvailableUpdate(interactive)
    }

    if (checkingPromise != null) {
      pendingInteractiveCheck ||= interactive
      return await checkingPromise
    }

    pendingInteractiveCheck = interactive
    patchStatus({
      errorMessage: undefined,
      lastCheckedAt: new Date().toISOString(),
      progress: undefined,
      status: 'checking'
    })

    checkingPromise = configureFeedForUpdateChannel()
      .then(() => autoUpdater.checkForUpdates())
      .then(() => status)
      .catch((error) => {
        handleUpdateError(error)
        return status
      })
      .finally(() => {
        checkingPromise = undefined
        if (status.status === 'checking') {
          patchStatus({ status: 'idle' })
        }
        pendingInteractiveCheck = false
      })

    return await checkingPromise
  }

  const setUpdateChannel: AutoUpdateManager['setUpdateChannel'] = (updateChannel) => {
    configuredFeedKey = undefined
    configuredUpdateTag = undefined
    const reason = resolveUnavailableReason()
    emitStatus(
      reason == null
        ? buildIdleStatus(updateChannel, getAutoUpdateEnabled())
        : buildUnavailableStatus(reason, updateChannel, getAutoUpdateEnabled())
    )
    return status
  }

  const clearAutomaticCheckTimers = () => {
    if (startupCheckTimer != null) {
      clearTimeout(startupCheckTimer)
      startupCheckTimer = undefined
    }
    if (periodicCheckTimer != null) {
      clearInterval(periodicCheckTimer)
      periodicCheckTimer = undefined
    }
  }

  const scheduleAutomaticChecks = () => {
    clearAutomaticCheckTimers()
    if (!started || !getAutoUpdateEnabled()) return
    if (!ensureConfigured()) return

    startupCheckTimer = setTimeout(() => {
      void checkForUpdates().catch(handleUpdateError)
    }, startupUpdateCheckDelayMs)
    startupCheckTimer.unref?.()

    periodicCheckTimer = setInterval(() => {
      void checkForUpdates().catch(handleUpdateError)
    }, periodicUpdateCheckIntervalMs)
    periodicCheckTimer.unref?.()
  }

  const setAutoUpdateEnabled: AutoUpdateManager['setAutoUpdateEnabled'] = (autoUpdate) => {
    const normalizedAutoUpdate = autoUpdate ?? DEFAULT_DESKTOP_AUTO_UPDATE
    clearAutomaticCheckTimers()
    const updateChannel = getUpdateChannel()
    const reason = resolveUnavailableReason()
    emitStatus(
      reason == null
        ? buildIdleStatus(updateChannel, normalizedAutoUpdate)
        : buildUnavailableStatus(reason, updateChannel, normalizedAutoUpdate)
    )
    if (normalizedAutoUpdate) {
      scheduleAutomaticChecks()
    }
    return status
  }

  const start = () => {
    started = true
    scheduleAutomaticChecks()
  }

  app.once('quit', () => {
    clearAutomaticCheckTimers()
  })

  return {
    checkForUpdates,
    getStatus: () => status,
    setAutoUpdateEnabled,
    setUpdateChannel,
    start
  }
}

const showMessageBox = async (options: Electron.MessageBoxOptions) => {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  return focusedWindow == null
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(focusedWindow, options)
}

const runBootstrapRuntimeCommand = async (action: 'check' | 'install', target: RuntimePackageTarget) => {
  const bootstrapPath = resolveBundledRuntimeConsumerBootstrapPath()
  if (bootstrapPath == null) {
    throw new Error('Bundled One Works bootstrap CLI was not found.')
  }
  const runtimePackageCacheVersionEnv = resolveDesktopRuntimePackageCacheVersionEnv()
  const runtimeEnv = {
    ...process.env,
    ...runtimePackageCacheVersionEnv
  }

  const result = await execFileAsync(
    process.execPath,
    [bootstrapPath, 'runtime', action, target, '--json'],
    {
      env: {
        ...runtimeEnv,
        ...resolvePackagedCliPathEnv(runtimeEnv),
        ELECTRON_RUN_AS_NODE: '1'
      },
      maxBuffer: BOOTSTRAP_BUFFER_BYTES
    }
  )

  return JSON.parse(result.stdout.trim()) as RuntimePackageStatus
}

const formatCliRuntimeVersion = (status: RuntimePackageStatus) => (
  status.installedVersion == null
    ? `Latest: ${status.latestVersion}`
    : `Current: ${status.installedVersion}\nLatest: ${status.latestVersion}`
)

export const checkCliRuntimeUpdates = async () => {
  const status = await runBootstrapRuntimeCommand('check', 'cli')
  const message = status.updateAvailable
    ? `${status.packageName} has an update available.\n\n${formatCliRuntimeVersion(status)}`
    : `${status.packageName} is up to date.\n\n${formatCliRuntimeVersion(status)}`

  const result = await showMessageBox({
    buttons: status.updateAvailable ? ['Install', 'Later'] : ['OK'],
    defaultId: 0,
    message,
    title: 'CLI Runtime Updates',
    type: status.updateAvailable ? 'info' : 'none'
  })

  if (status.updateAvailable && result.response === 0) {
    await installCliRuntimeUpdates()
  }
}

export const installCliRuntimeUpdates = async () => {
  const status = await runBootstrapRuntimeCommand('install', 'cli')
  await showMessageBox({
    buttons: ['OK'],
    message: `${status.packageName} ${status.latestVersion} is installed in the bootstrap cache.`,
    title: 'CLI Runtime Update Installed',
    type: 'info'
  })
}

const refreshBundledWorkspaceRuntimeCache = () => {
  if (!app.isPackaged) return false

  const runtimePackageCacheVersionEnv = resolveDesktopRuntimePackageCacheVersionEnv()
  if (Object.keys(runtimePackageCacheVersionEnv).length === 0) return false

  const runtimeEnv = {
    ...process.env,
    ...runtimePackageCacheVersionEnv
  }
  const cacheModule = nodeRequire(builtinPackageCachePath) as BuiltinPackageCacheModule
  const entries = cacheModule.ensureBuiltinRuntimePackageCache?.({ env: runtimeEnv }) ?? []
  if (entries.length === 0) return false

  const seededCount = entries.filter(entry => entry.seeded === true).length
  writeProcessLine(
    process.stdout,
    `[oneworks-runtime] refreshed bundled workspace runtime cache (${seededCount}/${entries.length} changed)`
  )
  return true
}

export const refreshWorkspaceRuntimeCacheInBackground = () => {
  if (workspaceRuntimeRefreshComplete || workspaceRuntimeRefreshPromise != null) return

  workspaceRuntimeRefreshPromise = Promise.resolve()
    .then(() => {
      if (refreshBundledWorkspaceRuntimeCache()) {
        workspaceRuntimeRefreshComplete = true
        return
      }
      return Promise.all([
        runBootstrapRuntimeCommand('install', 'server'),
        runBootstrapRuntimeCommand('install', 'client')
      ]).then((statuses) => {
        const summary = statuses
          .map(status => `${status.packageName}@${status.latestVersion}`)
          .join(', ')
        writeProcessLine(
          process.stdout,
          `[oneworks-runtime] cached ${summary} for future workspace launches`
        )
      })
    })
    .then(() => {
      workspaceRuntimeRefreshComplete = true
    })
    .catch(error => console.error('[oneworks-runtime] failed to refresh workspace runtime cache', error))
    .finally(() => {
      workspaceRuntimeRefreshPromise = undefined
    })
}
