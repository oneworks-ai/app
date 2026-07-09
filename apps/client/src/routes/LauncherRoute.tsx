/* eslint-disable max-lines -- launcher route keeps command palette data flow and keyboard handling together. */
import './LauncherRoute.scss'

import { App, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { DEFAULT_ICON_THEME } from '@oneworks/icon/presets'
import { matchesPinyinSearch, normalizePinyinSearchQuery } from '@oneworks/utils/pinyin-search'

import { getApiErrorMessage } from '#~/api'
import {
  createLauncherWorkspaceInDirectory,
  forgetLauncherWorkspace,
  getLauncherManagerServerBaseUrl,
  getLauncherWorkspaceSelectorState,
  listLauncherDirectories,
  openLauncherWorkspace,
  stopLauncherWorkspace
} from '#~/api/launcher'
import {
  createLauncherRelayLoginUrl,
  createLauncherRelayWorkspaceInDirectory,
  getLauncherRelayStatus,
  listLauncherRelayDirectories,
  openLauncherRelayWorkspace
} from '#~/api/launcher-relay'
import { LauncherAboutView } from '#~/components/launcher/LauncherAboutView'
import { LauncherSettingsView } from '#~/components/launcher/LauncherSettingsView'
import type { LauncherKeyboardHint, LauncherSettingsResetAction } from '#~/components/launcher/LauncherSettingsView'
import { WorkspaceOpeningOverlay } from '#~/components/workspace/WorkspaceOpeningOverlay'
import { getProjectFileIconMeta } from '#~/components/workspace/project-file-tree/project-file-tree-icons'
import { useInterfaceLanguageConfig } from '#~/hooks/use-interface-language-config'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { appLanguageOptions, getActiveAppLanguageOption } from '#~/i18n'
import { buildWorkspaceClientBase, getClientBase, isServerManagerRole, mergeRuntimeEnv } from '#~/runtime-config'
import { copyTextWithFeedback } from '#~/utils/copy'
import { deferImeCompositionEnd, isImeCompositionKeyEvent } from '#~/utils/keyboard-events'
import { createOneWorksIconDataUri } from '#~/utils/oneworks-icon'
import { resolveWorkspaceFileOpenerSelectModels } from '#~/utils/workspace-file-openers'
import { rememberWorkspaceConnection } from '#~/workspace-connection-state'
import { shouldShowLauncherCommandSection } from './launcher-command-sections'
import { normalizePluginLauncherSearchResults } from './launcher-plugin-search'
import type {
  LauncherRelayDeviceProject,
  LauncherRelayDeviceProjectGroup,
  LauncherRelayDirectoryTarget
} from './launcher-relay-projects'
import { normalizeLauncherRelayDirectoryTargets, normalizeLauncherRelayProjectGroups } from './launcher-relay-projects'

const emptyWorkspaceSelectorState: DesktopWorkspaceSelectorState = {
  recentProjects: [],
  runningProjects: []
}

const emptyWorkspaceResourceSearchResponse: DesktopWorkspaceResourceSearchResponse = {
  files: [],
  sessions: [],
  terminals: [],
  websites: []
}

const FILE_SEARCH_DEBOUNCE_MS = 160
const FILE_SEARCH_RESULT_LIMIT = 80
const LAUNCHER_SEARCH_HISTORY_LIMIT = 50
const LAUNCHER_RECENT_SELECTION_LIMIT = 24
const LAUNCHER_RECENT_SELECTION_DISPLAY_LIMIT = 3
const LAUNCHER_RECENT_SELECTIONS_STORAGE_KEY = 'oneworks_launcher_recent_selections'
const LAUNCHER_QUERY_SEARCH_PARAM = 'q'
const LAUNCHER_VIEW_SEARCH_PARAM = 'view'
const CLONE_DESTINATION_FAVORITE_LIMIT = 24
const CLONE_DESTINATION_RECENT_LIMIT = 12
const CLONE_DESTINATION_FAVORITES_STORAGE_KEY = 'oneworks_launcher_clone_destination_favorites'
const CLONE_DESTINATION_RECENTS_STORAGE_KEY = 'oneworks_launcher_clone_destination_directories'
const cloneRepositoryMessageKey = 'launcher-clone-repository'

type LauncherDirectoryBrowserMode = 'clone' | 'create-workspace' | 'open-workspace'
type ServerLauncherAvailability = 'available' | 'checking' | 'unavailable'

const getCloneRepositoryUrlCandidate = (value: string) => {
  const trimmedValue = value.trim()
  if (
    /^(?:https?|ssh|git):\/\//iu.test(trimmedValue) ||
    /^[\w.-]+@[\w.-]+:.+/u.test(trimmedValue)
  ) {
    return trimmedValue
  }

  return ''
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

interface LauncherRelayAccount {
  accountKey?: string
  avatarUrl?: string
  email?: string
  enabled?: boolean
  loginId?: string
  name?: string
  role?: string
  serverAlias?: string
  serverId?: string
  serverUrl?: string
  sessionAuthenticated?: boolean
  userId?: string
}

interface LauncherRelayServer {
  active?: boolean
  id?: string
  name?: string
  official?: boolean
  remoteBaseUrl?: string
}

const cleanLauncherText = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? undefined : text
}

const readLauncherRelayAccounts = (status: unknown): LauncherRelayAccount[] => {
  if (!isRecord(status) || !Array.isArray(status.accounts)) return []

  return status.accounts
    .filter(isRecord)
    .map(account => ({
      accountKey: cleanLauncherText(account.accountKey),
      avatarUrl: cleanLauncherText(account.avatarUrl),
      email: cleanLauncherText(account.email),
      enabled: typeof account.enabled === 'boolean' ? account.enabled : undefined,
      loginId: cleanLauncherText(account.loginId),
      name: cleanLauncherText(account.name),
      role: cleanLauncherText(account.role),
      serverAlias: cleanLauncherText(account.serverAlias),
      serverId: cleanLauncherText(account.serverId),
      serverUrl: cleanLauncherText(account.serverUrl),
      sessionAuthenticated: typeof account.sessionAuthenticated === 'boolean'
        ? account.sessionAuthenticated
        : undefined,
      userId: cleanLauncherText(account.userId)
    }))
}

const readLauncherRelayServers = (status: unknown): LauncherRelayServer[] => {
  if (!isRecord(status) || !Array.isArray(status.servers)) return []

  return status.servers
    .filter(isRecord)
    .map(server => ({
      active: typeof server.active === 'boolean' ? server.active : undefined,
      id: cleanLauncherText(server.id),
      name: cleanLauncherText(server.name),
      official: typeof server.official === 'boolean' ? server.official : undefined,
      remoteBaseUrl: cleanLauncherText(server.remoteBaseUrl)
    }))
}

const readLauncherRelayActiveServerId = (status: unknown) => {
  if (!isRecord(status)) return undefined

  const connection = isRecord(status.connection) ? status.connection : {}
  const activeServerId = cleanLauncherText(connection.activeServerId)
  if (activeServerId != null) return activeServerId

  const servers = readLauncherRelayServers(status)
  return cleanLauncherText(servers.find(server => server.active === true)?.id) ?? cleanLauncherText(servers[0]?.id)
}

const normalizeRelayComparableUrl = (value: unknown) => {
  const text = cleanLauncherText(value)
  if (text == null) return undefined

  try {
    const url = new URL(text)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/+$/u, '').toLowerCase()
  } catch {
    return text.replace(/\/+$/u, '').toLowerCase()
  }
}

const getLauncherRelayAccountDisplayName = (account: LauncherRelayAccount) => (
  cleanLauncherText(account.name) ??
    cleanLauncherText(account.loginId) ??
    cleanLauncherText(account.email) ??
    cleanLauncherText(account.userId) ??
    'OneWorks'
)

const getLauncherRelayAccountSubtitle = (account: LauncherRelayAccount) => {
  const name = getLauncherRelayAccountDisplayName(account)
  const meta = [
    cleanLauncherText(account.email),
    cleanLauncherText(account.loginId),
    cleanLauncherText(account.userId)
  ].find(value => value != null && value !== name)
  return meta ?? ''
}

const getLauncherRelayAccountInitials = (name: string) => {
  const segments = name
    .split(/[\s._-]+/u)
    .map(segment => segment.trim())
    .filter(Boolean)
  const initials = segments.length > 1
    ? `${segments[0]?.[0] ?? ''}${segments[1]?.[0] ?? ''}`
    : name.slice(0, 2)
  return initials.toUpperCase()
}

const getLauncherRelayAccountServerKey = (account: LauncherRelayAccount) => (
  cleanLauncherText(account.serverId) ??
    normalizeRelayComparableUrl(account.serverUrl) ??
    cleanLauncherText(account.serverAlias) ??
    'default'
)

const findLauncherRelayServerForAccount = (
  account: LauncherRelayAccount,
  servers: LauncherRelayServer[]
) => {
  const serverId = cleanLauncherText(account.serverId)
  if (serverId != null) {
    const server = servers.find(item => cleanLauncherText(item.id) === serverId)
    if (server != null) return server
  }

  const serverUrl = normalizeRelayComparableUrl(account.serverUrl)
  if (serverUrl == null) return undefined

  return servers.find(item => normalizeRelayComparableUrl(item.remoteBaseUrl) === serverUrl)
}

const buildRelayPluginRoutePath = (suffix = 'accounts') => `/plugins/relay/home/${suffix.replace(/^\/+/u, '')}`

const buildRelayPluginClientUrl = (suffix = 'accounts') => {
  const base = getClientBase().replace(/\/+$/u, '')
  const route = buildRelayPluginRoutePath(suffix)
  return new URL(`${base}${route}`, window.location.origin).toString()
}

const emptyCloneDestinationDirectoryList: DesktopCloneDestinationDirectoryList = {
  currentDirectory: '',
  directories: []
}

const isCloneDestinationDirectory = (value: unknown): value is DesktopCloneDestinationDirectory => (
  isRecord(value) &&
  typeof value.name === 'string' &&
  typeof value.path === 'string'
)

const normalizeCloneDestinationDirectoryList = (value: unknown): DesktopCloneDestinationDirectoryList => {
  if (!isRecord(value) || typeof value.currentDirectory !== 'string') {
    return emptyCloneDestinationDirectoryList
  }

  return {
    currentDirectory: value.currentDirectory,
    directories: Array.isArray(value.directories) ? value.directories.filter(isCloneDestinationDirectory) : [],
    ...(typeof value.parentDirectory === 'string' ? { parentDirectory: value.parentDirectory } : {})
  }
}

const getStoredCloneDestinationDirectoryList = (storageKey: string) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []

    const seenDirectories = new Set<string>()
    return parsed.flatMap((value) => {
      if (typeof value !== 'string') return []
      const normalizedDirectory = value.trim()
      if (normalizedDirectory === '' || seenDirectories.has(normalizedDirectory)) return []

      seenDirectories.add(normalizedDirectory)
      return [normalizedDirectory]
    })
  } catch {
    return []
  }
}

const getStoredCloneDestinationDirectories = () =>
  getStoredCloneDestinationDirectoryList(CLONE_DESTINATION_RECENTS_STORAGE_KEY)

const getStoredCloneDestinationFavoriteDirectories = () =>
  getStoredCloneDestinationDirectoryList(CLONE_DESTINATION_FAVORITES_STORAGE_KEY)

const getStoredLauncherRecentSelectionIds = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAUNCHER_RECENT_SELECTIONS_STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []

    const seenIds = new Set<string>()
    return parsed.flatMap((value) => {
      const id = typeof value === 'string'
        ? value.trim()
        : isRecord(value)
        ? cleanLauncherText(value.id)
        : undefined
      if (id == null || seenIds.has(id)) return []

      seenIds.add(id)
      return [id]
    }).slice(0, LAUNCHER_RECENT_SELECTION_LIMIT)
  } catch {
    return []
  }
}

const persistLauncherRecentSelectionIds = (ids: string[]) => {
  try {
    localStorage.setItem(
      LAUNCHER_RECENT_SELECTIONS_STORAGE_KEY,
      JSON.stringify(ids.slice(0, LAUNCHER_RECENT_SELECTION_LIMIT))
    )
  } catch {}
}

const rememberLauncherRecentSelectionId = (ids: string[], id: string) => {
  const normalizedId = id.trim()
  if (normalizedId === '') return ids

  return [
    normalizedId,
    ...ids.filter(candidate => candidate !== normalizedId)
  ].slice(0, LAUNCHER_RECENT_SELECTION_LIMIT)
}

const persistCloneDestinationDirectories = (directories: string[]) => {
  try {
    localStorage.setItem(
      CLONE_DESTINATION_RECENTS_STORAGE_KEY,
      JSON.stringify(directories.slice(0, CLONE_DESTINATION_RECENT_LIMIT))
    )
  } catch {}
}

const persistCloneDestinationFavoriteDirectories = (directories: string[]) => {
  try {
    localStorage.setItem(
      CLONE_DESTINATION_FAVORITES_STORAGE_KEY,
      JSON.stringify(directories.slice(0, CLONE_DESTINATION_FAVORITE_LIMIT))
    )
  } catch {}
}

const rememberCloneDestinationDirectory = (directories: string[], directory: string) => {
  const normalizedDirectory = directory.trim()
  if (normalizedDirectory === '') return directories

  return [
    normalizedDirectory,
    ...directories.filter(candidate => candidate !== normalizedDirectory)
  ].slice(0, CLONE_DESTINATION_RECENT_LIMIT)
}

const getDirectoryDisplayName = (directory: string) => {
  const normalizedDirectory = directory.replace(/[\\/]+$/u, '')
  const name = normalizedDirectory.split(/[\\/]/u).filter(Boolean).at(-1)
  return name == null || name === '' ? directory : name
}

const isLikelyAbsoluteDirectoryPath = (directory: string) => {
  const trimmedDirectory = directory.trim()
  return trimmedDirectory.startsWith('/') || /^[a-z]:[\\/]/iu.test(trimmedDirectory)
}

const normalizeDirectoryPathKey = (directory: string) => {
  const normalizedDirectory = directory
    .trim()
    .replace(/[\\/]+/gu, '/')
    .replace(/\/+$/u, '') || '/'
  return /^[a-z]:/iu.test(normalizedDirectory) ? normalizedDirectory.toLowerCase() : normalizedDirectory
}

const isDirectoryPathInSameParent = (directory: string, parentDirectory: string) => {
  const normalizedDirectory = directory.trim().replace(/[\\/]+$/u, '')
  const parentBreadcrumb = buildDirectoryBreadcrumbs(normalizedDirectory).at(-2)
  return parentBreadcrumb != null &&
    normalizeDirectoryPathKey(parentBreadcrumb.path) === normalizeDirectoryPathKey(parentDirectory)
}

const buildDirectoryBreadcrumbs = (directory: string) => {
  const trimmedDirectory = directory.trim()
  if (trimmedDirectory === '') return []

  const separator = trimmedDirectory.includes('\\') ? '\\' : '/'
  const windowsDriveMatch = /^([a-z]:)/iu.exec(trimmedDirectory)
  if (windowsDriveMatch != null) {
    const drivePrefix = windowsDriveMatch[1]
    const rootPath = `${drivePrefix}${separator}`
    const segments = trimmedDirectory
      .slice(drivePrefix.length)
      .replace(/^[\\/]+/u, '')
      .split(/[\\/]+/u)
      .filter(Boolean)
    return segments.reduce<Array<{ label: string; path: string }>>((breadcrumbs, segment) => {
      const previousPath = breadcrumbs.at(-1)?.path ?? rootPath
      breadcrumbs.push({
        label: segment,
        path: previousPath.endsWith(separator) ? `${previousPath}${segment}` : `${previousPath}${separator}${segment}`
      })
      return breadcrumbs
    }, [{ label: rootPath, path: rootPath }])
  }

  if (trimmedDirectory.startsWith('/')) {
    const segments = trimmedDirectory.replace(/\/+$/u, '').slice(1).split('/').filter(Boolean)
    return segments.reduce<Array<{ label: string; path: string }>>((breadcrumbs, segment) => {
      const previousPath = breadcrumbs.at(-1)?.path ?? '/'
      breadcrumbs.push({
        label: segment,
        path: previousPath === '/' ? `/${segment}` : `${previousPath}/${segment}`
      })
      return breadcrumbs
    }, [{ label: '/', path: '/' }])
  }

  const segments = trimmedDirectory.replace(/[\\/]+$/u, '').split(/[\\/]+/u).filter(Boolean)
  return segments.reduce<Array<{ label: string; path: string }>>((breadcrumbs, segment) => {
    const previousPath = breadcrumbs.at(-1)?.path
    breadcrumbs.push({
      label: segment,
      path: previousPath == null ? segment : `${previousPath}${separator}${segment}`
    })
    return breadcrumbs
  }, [])
}
interface LauncherFileSearchItem {
  directory: string
  name: string
  path: string
  projectName?: string
  source: 'filesystem' | 'workspace'
  type: 'directory' | 'file'
  workspaceFolder?: string
}

interface LauncherDesktopIconSettings {
  iconAppearance: NonNullable<DesktopSettings['iconAppearance']>
  iconBackground: NonNullable<DesktopSettings['iconBackground']>
  iconTheme: NonNullable<DesktopSettings['iconTheme']>
}

const defaultLauncherIconSettings = {
  iconAppearance: 'system',
  iconBackground: 'solid',
  iconTheme: DEFAULT_ICON_THEME
} satisfies LauncherDesktopIconSettings

const launcherIconAppearances = new Set<LauncherDesktopIconSettings['iconAppearance']>(['system', 'light', 'dark'])
const launcherIconBackgrounds = new Set<LauncherDesktopIconSettings['iconBackground']>([
  'transparent',
  'solid',
  'textured'
])
const launcherIconThemes = new Set<LauncherDesktopIconSettings['iconTheme']>(['industrial', 'metal', 'matrix'])

interface LauncherCommand {
  action: () => Promise<void> | void
  actionLabel?: 'back' | 'clone' | 'create' | 'open'
  avatarInitials?: string
  avatarUrl?: string
  automationPath?: string
  badge?: string
  contextMenuItems?: MenuProps['items']
  favoriteAction?: () => void
  favoriteLabel?: string
  icon: string
  iconTone?: string
  id: string
  isFavorite?: boolean
  keywords: string[]
  removeAction?: () => Promise<void> | void
  removeLabel?: string
  recentSelectionId?: string
  secondaryAction?: () => Promise<void> | void
  subtitle?: string
  title: string
}

interface LauncherCommandSection {
  commands: LauncherCommand[]
  id: string
  title: string
}

type LauncherViewMode = 'about' | 'account' | 'commands' | 'preview' | 'settings'

const launcherUrlViewModes = new Set<LauncherViewMode>(['about', 'account', 'preview', 'settings'])

const readLauncherViewModeFromSearch = (search: string): LauncherViewMode => {
  const mode = new URLSearchParams(search).get(LAUNCHER_VIEW_SEARCH_PARAM) as LauncherViewMode | null
  return mode != null && launcherUrlViewModes.has(mode) ? mode : 'commands'
}

const readLauncherQueryFromSearch = (search: string) => (
  new URLSearchParams(search).get(LAUNCHER_QUERY_SEARCH_PARAM) ?? ''
)

const buildLauncherSearchForState = (
  search: string,
  input: {
    mode?: LauncherViewMode
    query?: string
  }
) => {
  const searchParams = new URLSearchParams(search)
  if (input.mode != null) {
    if (input.mode === 'commands') {
      searchParams.delete(LAUNCHER_VIEW_SEARCH_PARAM)
    } else {
      searchParams.set(LAUNCHER_VIEW_SEARCH_PARAM, input.mode)
    }
  }
  if (input.query != null) {
    if (input.query === '') {
      searchParams.delete(LAUNCHER_QUERY_SEARCH_PARAM)
    } else {
      searchParams.set(LAUNCHER_QUERY_SEARCH_PARAM, input.query)
    }
  }

  const nextSearch = searchParams.toString()
  return nextSearch === '' ? '' : `?${nextSearch}`
}

interface LauncherSearchHistoryEntry {
  cloneDestinationDirectory?: string
  directoryBrowserHomeDirectory?: string
  directoryBrowserMode?: LauncherDirectoryBrowserMode
  directoryBrowserTargetId?: string
  dismissedProjectContextFolder?: string
  isFileSearchMode: boolean
  launcherViewMode: LauncherViewMode
  query: string
}

interface LauncherSearchHistoryState {
  entries: LauncherSearchHistoryEntry[]
  index: number
}

interface LauncherOpeningWorkspace {
  name: string
  path: string
}

type LauncherDirectoryBrowserTarget =
  | {
    id: 'local'
    kind: 'local'
    label: string
  }
  | {
    deviceId: string
    deviceName: string
    id: string
    initialDirectory?: string
    kind: 'relay'
    label: string
    serverId: string
    serverName: string
  }

const initialLauncherSearchHistoryEntry: LauncherSearchHistoryEntry = {
  isFileSearchMode: false,
  launcherViewMode: 'commands',
  query: ''
}

const areLauncherSearchHistoryScopesEqual = (
  left: LauncherSearchHistoryEntry,
  right: LauncherSearchHistoryEntry
) => (
  left.launcherViewMode === right.launcherViewMode &&
  left.isFileSearchMode === right.isFileSearchMode &&
  left.directoryBrowserMode === right.directoryBrowserMode &&
  left.directoryBrowserTargetId === right.directoryBrowserTargetId &&
  left.cloneDestinationDirectory === right.cloneDestinationDirectory &&
  left.directoryBrowserHomeDirectory === right.directoryBrowserHomeDirectory &&
  left.dismissedProjectContextFolder === right.dismissedProjectContextFolder
)

const areLauncherSearchHistoryEntriesEqual = (
  left: LauncherSearchHistoryEntry,
  right: LauncherSearchHistoryEntry
) => (
  areLauncherSearchHistoryScopesEqual(left, right) &&
  left.query === right.query
)

const normalizeLauncherIconSettings = (value: unknown): LauncherDesktopIconSettings => {
  const source = isRecord(value) ? value : {}
  const iconBackground = source.iconBackground === false
    ? 'transparent'
    : source.iconBackground === true
    ? defaultLauncherIconSettings.iconBackground
    : typeof source.iconBackground === 'string' &&
        launcherIconBackgrounds.has(source.iconBackground as LauncherDesktopIconSettings['iconBackground'])
    ? source.iconBackground as LauncherDesktopIconSettings['iconBackground']
    : defaultLauncherIconSettings.iconBackground

  return {
    iconAppearance: typeof source.iconAppearance === 'string' &&
        launcherIconAppearances.has(source.iconAppearance as LauncherDesktopIconSettings['iconAppearance'])
      ? source.iconAppearance as LauncherDesktopIconSettings['iconAppearance']
      : defaultLauncherIconSettings.iconAppearance,
    iconBackground,
    iconTheme: typeof source.iconTheme === 'string' &&
        launcherIconThemes.has(source.iconTheme as LauncherDesktopIconSettings['iconTheme'])
      ? source.iconTheme as LauncherDesktopIconSettings['iconTheme']
      : defaultLauncherIconSettings.iconTheme
  }
}

const useLauncherIconSrc = ({
  desktopApi,
  mode
}: {
  desktopApi: Window['oneworksDesktop']
  mode: 'dark' | 'light'
}) => {
  const fallbackIconSrc = useMemo(() =>
    createOneWorksIconDataUri({
      backgroundStyle: defaultLauncherIconSettings.iconBackground,
      mode,
      size: 64,
      theme: defaultLauncherIconSettings.iconTheme,
      title: 'OneWorks'
    }), [mode])
  const [desktopIconSrc, setDesktopIconSrc] = useState<string>()

  useEffect(() => {
    const getDesktopIconPreview = desktopApi?.getDesktopIconPreview
    if (getDesktopIconPreview == null) {
      setDesktopIconSrc(undefined)
      return
    }

    let disposed = false
    const loadDesktopIconSrc = async (settingsValue?: unknown) => {
      try {
        const settingsSource = settingsValue === undefined
          ? await desktopApi?.getDesktopSettings?.().catch(() => undefined)
          : settingsValue
        const src = await getDesktopIconPreview(normalizeLauncherIconSettings(settingsSource))
        if (!disposed) {
          setDesktopIconSrc(src == null || src === '' ? undefined : src)
        }
      } catch (error) {
        if (disposed) return
        console.error('[launcher] failed to load desktop icon preview', error)
        setDesktopIconSrc(undefined)
      }
    }

    void loadDesktopIconSrc()
    const dispose = desktopApi?.onDesktopSettingsChange?.((settings) => {
      void loadDesktopIconSrc(settings)
    })

    return () => {
      disposed = true
      dispose?.()
    }
  }, [desktopApi])

  return desktopIconSrc ?? fallbackIconSrc
}

const isWorkspaceSelectorProject = (value: unknown): value is DesktopWorkspaceSelectorProject => (
  isRecord(value) &&
  typeof value.description === 'string' &&
  typeof value.name === 'string' &&
  typeof value.workspaceFolder === 'string'
)

const isWorkspaceFileSearchResult = (value: unknown): value is DesktopWorkspaceFileSearchResult => (
  isRecord(value) &&
  typeof value.directory === 'string' &&
  typeof value.name === 'string' &&
  typeof value.path === 'string' &&
  (
    value.type == null ||
    value.type === 'directory' ||
    value.type === 'file'
  )
)

const isWorkspaceResourceSearchResult = (value: unknown): value is DesktopWorkspaceResourceSearchResult => (
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.kind === 'string'
)

const normalizeWorkspaceSelectorState = (value: unknown): DesktopWorkspaceSelectorState => {
  if (!isRecord(value)) {
    return emptyWorkspaceSelectorState
  }

  const recentProjects = Array.isArray(value.recentProjects)
    ? value.recentProjects.filter(isWorkspaceSelectorProject)
    : []
  const runningProjects = Array.isArray(value.runningProjects)
    ? value.runningProjects.filter(isWorkspaceSelectorProject)
    : []
  return { recentProjects, runningProjects }
}

const getLauncherPopupContainer = (triggerNode: HTMLElement) => {
  const launcherRoute = triggerNode.closest('.launcher-route')
  return launcherRoute instanceof HTMLElement ? launcherRoute : document.body
}

const normalizeWorkspaceFileSearchResults = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return []
  }
  return value.files.filter(isWorkspaceFileSearchResult).map(file => ({
    ...file,
    type: file.type === 'directory' ? 'directory' : 'file'
  }))
}

const normalizeWorkspaceResourceSearchResults = (value: unknown): DesktopWorkspaceResourceSearchResponse => {
  if (!isRecord(value)) return emptyWorkspaceResourceSearchResponse
  return {
    files: Array.isArray(value.files) ? value.files.filter(isWorkspaceResourceSearchResult) : [],
    sessions: Array.isArray(value.sessions) ? value.sessions.filter(isWorkspaceResourceSearchResult) : [],
    terminals: Array.isArray(value.terminals) ? value.terminals.filter(isWorkspaceResourceSearchResult) : [],
    websites: Array.isArray(value.websites) ? value.websites.filter(isWorkspaceResourceSearchResult) : []
  }
}

const mergeProjects = (state: DesktopWorkspaceSelectorState) => {
  const projectsByFolder = new Map<string, DesktopWorkspaceSelectorProject>()
  for (const project of [...state.runningProjects, ...state.recentProjects]) {
    if (project.workspaceFolder.trim() === '') {
      continue
    }
    projectsByFolder.set(project.workspaceFolder, project)
  }
  return Array.from(projectsByFolder.values())
}

const getRecentProjectFromRunningProject = (
  project: DesktopWorkspaceSelectorProject
): DesktopWorkspaceSelectorProject => {
  const recentProject: DesktopWorkspaceSelectorProject = {
    description: project.description,
    name: project.name,
    workspaceFolder: project.workspaceFolder
  }
  if (project.isCurrent != null) {
    recentProject.isCurrent = project.isCurrent
  }
  if (project.sourceUrl != null) {
    recentProject.sourceUrl = project.sourceUrl
  }
  if (project.workspaceId != null) {
    recentProject.workspaceId = project.workspaceId
  }
  return recentProject
}

const getProjectStatusIcon = (status: DesktopWorkspaceSelectorProject['status']) => {
  if (status === 'ready') return 'radio_button_checked'
  if (status === 'starting') return 'progress_activity'
  if (status === 'stopping') return 'stop_circle'
  return 'history'
}

const getProjectStatusIconTone = (status: DesktopWorkspaceSelectorProject['status']) => {
  if (status === 'ready') return 'project-running'
  if (status === 'starting') return 'project-starting'
  if (status === 'stopping') return 'project-stopping'
  return 'project-recent'
}

export interface LauncherRouteProps {
  active?: boolean
  workspaceContext?: DesktopWorkspaceSelectorProject
  onClose?: () => void
  onOpenWorkspaceResource?: (target: DesktopWorkspaceResourceTarget) => Promise<void> | void
  searchWorkspaceResources?: (query: string) => Promise<DesktopWorkspaceResourceSearchResponse>
}

export function LauncherRoute({
  active = true,
  workspaceContext,
  onClose,
  onOpenWorkspaceResource,
  searchWorkspaceResources
}: LauncherRouteProps = {}) {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { message, modal } = App.useApp()
  const [selectorState, setSelectorState] = useState<DesktopWorkspaceSelectorState>(emptyWorkspaceSelectorState)
  const [query, setQuery] = useState(() => readLauncherQueryFromSearch(location.search))
  const [activeCommandId, setActiveCommandId] = useState<string>()
  const [canCloneRepository, setCanCloneRepository] = useState(false)
  const [directoryBrowserMode, setDirectoryBrowserMode] = useState<LauncherDirectoryBrowserMode>()
  const [directoryBrowserHomeDirectory, setDirectoryBrowserHomeDirectory] = useState<string>()
  const [directoryBrowserTargetId, setDirectoryBrowserTargetId] = useState<string>('local')
  const [directoryBrowserDirectoriesByTarget, setDirectoryBrowserDirectoriesByTarget] = useState<
    Record<string, string>
  >({})
  const [directoryBrowserVisitedTargets, setDirectoryBrowserVisitedTargets] = useState<Record<string, true>>({
    local: true
  })
  const [cloneDestinationDirectory, setCloneDestinationDirectory] = useState<string>()
  const [cloneDestinationList, setCloneDestinationList] = useState<DesktopCloneDestinationDirectoryList>(
    emptyCloneDestinationDirectoryList
  )
  const [recentCloneDestinationDirectories, setRecentCloneDestinationDirectories] = useState(() =>
    getStoredCloneDestinationDirectories()
  )
  const [recentSelectionIds, setRecentSelectionIds] = useState(() => getStoredLauncherRecentSelectionIds())
  const [favoriteCloneDestinationDirectories, setFavoriteCloneDestinationDirectories] = useState(() =>
    getStoredCloneDestinationFavoriteDirectories()
  )
  const [isCloneDestinationLoading, setIsCloneDestinationLoading] = useState(false)
  const [hasCloneDestinationError, setHasCloneDestinationError] = useState(false)
  const [resourceResults, setResourceResults] = useState<DesktopWorkspaceResourceSearchResponse>(
    emptyWorkspaceResourceSearchResponse
  )
  const [relayProjectGroups, setRelayProjectGroups] = useState<LauncherRelayDeviceProjectGroup[]>([])
  const [relayDirectoryTargets, setRelayDirectoryTargets] = useState<LauncherRelayDirectoryTarget[]>([])
  const [relayAccounts, setRelayAccounts] = useState<LauncherRelayAccount[]>([])
  const [relayServers, setRelayServers] = useState<LauncherRelayServer[]>([])
  const [relayActiveServerId, setRelayActiveServerId] = useState<string>()
  const [isRelayAccountLoading, setIsRelayAccountLoading] = useState(false)
  const [hasRelayAccountError, setHasRelayAccountError] = useState(false)
  const [pluginResults, setPluginResults] = useState<DesktopPluginLauncherSearchResult[]>([])
  const [fileSearchResults, setFileSearchResults] = useState<LauncherFileSearchItem[]>([])
  const [fileOpeners, setFileOpeners] = useState<DesktopWorkspaceFileOpenersResponse | null>(null)
  const [isFileSearchMode, setIsFileSearchMode] = useState(false)
  const [isFileSearchLoading, setIsFileSearchLoading] = useState(false)
  const [hasFileSearchError, setHasFileSearchError] = useState(false)
  const [isResourceSearchLoading, setIsResourceSearchLoading] = useState(false)
  const [hasResourceSearchError, setHasResourceSearchError] = useState(false)
  const [dismissedProjectContextFolder, setDismissedProjectContextFolder] = useState<string>()
  const [isLauncherMenuOpen, setIsLauncherMenuOpen] = useState(false)
  const [launcherViewMode, setLauncherViewMode] = useState<LauncherViewMode>(() =>
    readLauncherViewModeFromSearch(location.search)
  )
  const [openingWorkspace, setOpeningWorkspace] = useState<LauncherOpeningWorkspace>()
  const [settingsOperationHints, setSettingsOperationHints] = useState<LauncherKeyboardHint[]>([])
  const [settingsResetAction, setSettingsResetAction] = useState<LauncherSettingsResetAction>()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const commandListRef = useRef<HTMLDivElement>(null)
  const pendingLauncherSearchRef = useRef<string | undefined>(undefined)
  const searchHistoryRef = useRef<LauncherSearchHistoryState>({
    entries: [initialLauncherSearchHistoryEntry],
    index: 0
  })
  const directoryBrowserTargetIdRef = useRef(directoryBrowserTargetId)
  const isLauncherActiveRef = useRef(active)
  const isSearchComposingRef = useRef(false)
  const isSearchInputComposing = useCallback(() => isSearchComposingRef.current, [])
  const desktopApi = window.oneworksDesktop
  const [serverLauncherAvailability, setServerLauncherAvailability] = useState<ServerLauncherAvailability>(() =>
    desktopApi == null ? (isServerManagerRole() ? 'available' : 'checking') : 'unavailable'
  )
  const canUseServerLauncher = desktopApi == null && serverLauncherAvailability !== 'unavailable'
  const { updateGlobalInterfaceLanguage } = useInterfaceLanguageConfig()
  const { resolvedThemeMode } = useResolvedThemeMode()
  const launcherIconSrc = useLauncherIconSrc({ desktopApi, mode: resolvedThemeMode })
  const filesystemManagerName = useMemo(() => {
    if (desktopApi?.platform === 'darwin') return 'Finder'
    if (desktopApi?.platform === 'win32') return t('launcher.projects.fileExplorer')
    return t('launcher.projects.fileManager')
  }, [desktopApi?.platform, t])
  const isCloneRepositoryMode = directoryBrowserMode === 'clone'
  const isCreateWorkspaceDirectoryMode = directoryBrowserMode === 'create-workspace'
  const isOpenWorkspaceDirectoryMode = directoryBrowserMode === 'open-workspace'
  const isDirectoryBrowserMode = directoryBrowserMode != null
  const urlLauncherViewMode = useMemo(
    () => readLauncherViewModeFromSearch(location.search),
    [location.search]
  )
  const urlLauncherQuery = useMemo(
    () => readLauncherQueryFromSearch(location.search),
    [location.search]
  )
  const syncLauncherStateToUrl = useCallback((
    input: {
      mode?: LauncherViewMode
      query?: string
      replace?: boolean
    } = {}
  ) => {
    const nextSearch = buildLauncherSearchForState(location.search, input)
    if (nextSearch === location.search) return

    pendingLauncherSearchRef.current = nextSearch
    void navigate({
      hash: location.hash,
      pathname: location.pathname,
      search: nextSearch
    }, { replace: input.replace === true })
  }, [location.hash, location.pathname, location.search, navigate])
  const setLauncherViewModeWithUrl = useCallback((
    mode: LauncherViewMode,
    input: {
      query?: string
      replace?: boolean
    } = {}
  ) => {
    setLauncherViewMode(mode)
    if (input.query != null) {
      setQuery(input.query)
    }
    syncLauncherStateToUrl({
      mode,
      query: input.query,
      replace: input.replace
    })
  }, [syncLauncherStateToUrl])
  const setLauncherQueryWithUrl = useCallback((
    nextQuery: string,
    input: {
      replace?: boolean
    } = {}
  ) => {
    setQuery(nextQuery)
    if (isDirectoryBrowserMode || isFileSearchMode) return

    syncLauncherStateToUrl({
      query: nextQuery,
      replace: input.replace ?? true
    })
  }, [isDirectoryBrowserMode, isFileSearchMode, syncLauncherStateToUrl])
  const injectedWorkspaceContext = useMemo(() => {
    if (workspaceContext == null || workspaceContext.workspaceFolder.trim() === '') return undefined

    return {
      ...workspaceContext,
      isCurrent: true,
      status: workspaceContext.status ?? 'ready'
    } satisfies DesktopWorkspaceSelectorProject
  }, [workspaceContext])
  const mergedProjects = useMemo(() => mergeProjects(selectorState), [selectorState])
  const currentProject = useMemo(
    () => injectedWorkspaceContext ?? mergedProjects.find(project => project.isCurrent === true),
    [injectedWorkspaceContext, mergedProjects]
  )
  const projects = useMemo(() => {
    if (currentProject == null) {
      return mergedProjects
    }

    const currentProjectKey = normalizeDirectoryPathKey(currentProject.workspaceFolder)
    return mergedProjects.filter(project => normalizeDirectoryPathKey(project.workspaceFolder) !== currentProjectKey)
  }, [currentProject, mergedProjects])
  const contextProject = useMemo(() => (
    currentProject?.workspaceFolder === dismissedProjectContextFolder ? undefined : currentProject
  ), [currentProject, dismissedProjectContextFolder])
  const directoryBrowserTargets = useMemo<LauncherDirectoryBrowserTarget[]>(() => {
    const targets: LauncherDirectoryBrowserTarget[] = [{
      id: 'local',
      kind: 'local',
      label: t('launcher.directoryTargets.local')
    }]
    for (const target of relayDirectoryTargets) {
      targets.push({
        deviceId: target.deviceId,
        deviceName: target.deviceName,
        id: target.id,
        initialDirectory: target.initialDirectory,
        kind: 'relay',
        label: target.deviceName,
        serverId: target.serverId,
        serverName: target.serverName
      })
    }
    return targets
  }, [relayDirectoryTargets, t])
  const visibleDirectoryBrowserTargets = useMemo(
    () =>
      isCloneRepositoryMode
        ? directoryBrowserTargets.filter(target => target.kind === 'local')
        : directoryBrowserTargets,
    [directoryBrowserTargets, isCloneRepositoryMode]
  )
  const localDirectoryBrowserTarget = useMemo(
    () => directoryBrowserTargets.find(target => target.kind === 'local') ?? directoryBrowserTargets[0],
    [directoryBrowserTargets]
  )
  const activeDirectoryBrowserTarget = useMemo(() => (
    visibleDirectoryBrowserTargets.find(target => target.id === directoryBrowserTargetId) ??
      visibleDirectoryBrowserTargets[0] ??
      directoryBrowserTargets[0]
  ), [directoryBrowserTargetId, directoryBrowserTargets, visibleDirectoryBrowserTargets])
  const currentSearchHistoryEntry = useMemo<LauncherSearchHistoryEntry>(() => ({
    ...(cloneDestinationDirectory == null ? {} : { cloneDestinationDirectory }),
    ...(directoryBrowserHomeDirectory == null ? {} : { directoryBrowserHomeDirectory }),
    ...(directoryBrowserMode == null ? {} : { directoryBrowserMode }),
    ...(directoryBrowserMode == null ? {} : { directoryBrowserTargetId }),
    ...(dismissedProjectContextFolder == null ? {} : { dismissedProjectContextFolder }),
    isFileSearchMode,
    launcherViewMode,
    query
  }), [
    cloneDestinationDirectory,
    directoryBrowserHomeDirectory,
    directoryBrowserMode,
    directoryBrowserTargetId,
    dismissedProjectContextFolder,
    isFileSearchMode,
    launcherViewMode,
    query
  ])
  useEffect(() => {
    directoryBrowserTargetIdRef.current = directoryBrowserTargetId
  }, [directoryBrowserTargetId])

  useEffect(() => {
    const wasActive = isLauncherActiveRef.current
    isLauncherActiveRef.current = active
    if (!wasActive && active) {
      setDismissedProjectContextFolder(undefined)
    }
  }, [active])

  const focusSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (!isLauncherActiveRef.current) return
      searchInputRef.current?.focus()
    })
  }, [])

  useEffect(() => {
    const pendingLauncherSearch = pendingLauncherSearchRef.current
    if (pendingLauncherSearch != null) {
      if (pendingLauncherSearch !== location.search) return
      pendingLauncherSearchRef.current = undefined
    }

    const shouldApplyUrlQuery = !isDirectoryBrowserMode && !isFileSearchMode
    const shouldUpdateViewMode = urlLauncherViewMode !== launcherViewMode
    const shouldUpdateQuery = shouldApplyUrlQuery && urlLauncherQuery !== query
    if (!shouldUpdateViewMode && !shouldUpdateQuery) return

    if (shouldUpdateViewMode) {
      setLauncherViewMode(urlLauncherViewMode)
      setDirectoryBrowserMode(undefined)
      setDirectoryBrowserTargetId('local')
      setCloneDestinationDirectory(undefined)
      setDirectoryBrowserHomeDirectory(undefined)
      setCloneDestinationList(emptyCloneDestinationDirectoryList)
      setIsCloneDestinationLoading(false)
      setHasCloneDestinationError(false)
      setIsFileSearchMode(false)
      setFileSearchResults([])
      setIsFileSearchLoading(false)
      setHasFileSearchError(false)
    }
    if (shouldUpdateQuery) {
      setQuery(urlLauncherQuery)
    }
    setActiveCommandId(undefined)
    setIsLauncherMenuOpen(false)
    focusSearchInput()
  }, [
    focusSearchInput,
    isDirectoryBrowserMode,
    isFileSearchMode,
    launcherViewMode,
    location.search,
    query,
    urlLauncherQuery,
    urlLauncherViewMode
  ])

  useEffect(() => {
    if (!active) return

    let disposed = false
    const statePromise = desktopApi?.getWorkspaceSelectorState?.() ??
      (desktopApi == null ? getLauncherWorkspaceSelectorState() : undefined)
    if (desktopApi == null && statePromise != null) {
      setServerLauncherAvailability(current => current === 'available' ? current : 'checking')
    }
    if (statePromise != null) {
      void statePromise.then((state) => {
        if (!disposed) {
          if (desktopApi == null) {
            setServerLauncherAvailability('available')
          }
          setSelectorState(normalizeWorkspaceSelectorState(state))
          setDismissedProjectContextFolder(undefined)
        }
      })
        .catch((error) => {
          if (desktopApi == null && !disposed) {
            setServerLauncherAvailability('unavailable')
          }
          console.error('[launcher] failed to load workspace selector state', error)
        })
    }
    const dispose = desktopApi?.onWorkspaceSelectorStateChange?.((state) => {
      setSelectorState(normalizeWorkspaceSelectorState(state))
      setDismissedProjectContextFolder(undefined)
    })

    return () => {
      disposed = true
      dispose?.()
    }
  }, [active, desktopApi])

  useEffect(() => {
    if (
      dismissedProjectContextFolder != null &&
      dismissedProjectContextFolder !== currentProject?.workspaceFolder
    ) {
      setDismissedProjectContextFolder(undefined)
    }
  }, [currentProject?.workspaceFolder, dismissedProjectContextFolder])

  useEffect(() => {
    const history = searchHistoryRef.current
    const activeEntry = history.entries[history.index]
    if (
      activeEntry != null &&
      areLauncherSearchHistoryEntriesEqual(activeEntry, currentSearchHistoryEntry)
    ) {
      return
    }

    if (
      activeEntry != null &&
      areLauncherSearchHistoryScopesEqual(activeEntry, currentSearchHistoryEntry)
    ) {
      const nextEntries = history.entries.slice(0, history.index + 1)
      nextEntries[history.index] = currentSearchHistoryEntry
      history.entries = nextEntries
      return
    }

    const nextEntries = [
      ...history.entries.slice(0, history.index + 1),
      currentSearchHistoryEntry
    ].slice(-LAUNCHER_SEARCH_HISTORY_LIMIT)
    history.entries = nextEntries
    history.index = nextEntries.length - 1
  }, [currentSearchHistoryEntry])

  useEffect(() => {
    if (!isDirectoryBrowserMode) return
    if (visibleDirectoryBrowserTargets.some(target => target.id === directoryBrowserTargetId)) return
    const fallbackTarget = visibleDirectoryBrowserTargets[0]
    setDirectoryBrowserTargetId(fallbackTarget?.id ?? 'local')
    setCloneDestinationDirectory(fallbackTarget?.kind === 'relay' ? fallbackTarget.initialDirectory : undefined)
    setDirectoryBrowserHomeDirectory(undefined)
  }, [directoryBrowserTargetId, isDirectoryBrowserMode, visibleDirectoryBrowserTargets])

  useEffect(() => {
    if (!active) return

    focusSearchInput()
  }, [active, focusSearchInput])

  useEffect(() => {
    const shouldLoadRelayStatus = active &&
      desktopApi == null &&
      (launcherViewMode === 'commands' || launcherViewMode === 'account')

    if (!shouldLoadRelayStatus) {
      if (desktopApi != null) {
        setRelayProjectGroups([])
        setRelayDirectoryTargets([])
        setRelayAccounts([])
        setRelayServers([])
        setRelayActiveServerId(undefined)
      }
      setIsRelayAccountLoading(false)
      return
    }

    let disposed = false
    if (launcherViewMode === 'account') {
      setIsRelayAccountLoading(true)
      setHasRelayAccountError(false)
    }

    void getLauncherRelayStatus()
      .then((status) => {
        if (disposed) return

        if (launcherViewMode === 'commands') {
          setRelayProjectGroups(normalizeLauncherRelayProjectGroups(status))
          setRelayDirectoryTargets(normalizeLauncherRelayDirectoryTargets(status))
        }
        setRelayAccounts(readLauncherRelayAccounts(status))
        setRelayServers(readLauncherRelayServers(status))
        setRelayActiveServerId(readLauncherRelayActiveServerId(status))
      })
      .catch((error) => {
        if (disposed) return

        console.warn('[launcher] failed to load relay status', error)
        if (launcherViewMode === 'commands') {
          setRelayProjectGroups([])
          setRelayDirectoryTargets([])
        }
        if (launcherViewMode === 'account') {
          setRelayAccounts([])
          setRelayServers([])
          setRelayActiveServerId(undefined)
          setHasRelayAccountError(true)
        }
      })
      .finally(() => {
        if (!disposed && launcherViewMode === 'account') {
          setIsRelayAccountLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [active, desktopApi, launcherViewMode])

  useEffect(() => {
    const checkGitAvailability = desktopApi?.isGitAvailable
    if (checkGitAvailability == null || desktopApi?.cloneRepository == null) {
      setCanCloneRepository(false)
      return
    }

    let disposed = false
    void checkGitAvailability()
      .then((available) => {
        if (!disposed) {
          setCanCloneRepository(available === true)
        }
      })
      .catch((error) => {
        if (!disposed) {
          console.warn('[launcher] failed to check Git availability', error)
          setCanCloneRepository(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [desktopApi])

  useEffect(() => {
    if (!isDirectoryBrowserMode) {
      setCloneDestinationList(emptyCloneDestinationDirectoryList)
      setIsCloneDestinationLoading(false)
      setHasCloneDestinationError(false)
      return
    }

    const listCloneDestinationDirectories = activeDirectoryBrowserTarget?.kind === 'relay'
      ? (directory?: string) =>
        listLauncherRelayDirectories({
          deviceId: activeDirectoryBrowserTarget.deviceId,
          directory,
          serverId: activeDirectoryBrowserTarget.serverId
        })
      : desktopApi?.listCloneDestinationDirectories ??
        (canUseServerLauncher ? listLauncherDirectories : undefined)
    if (listCloneDestinationDirectories == null) {
      setCloneDestinationList(emptyCloneDestinationDirectoryList)
      setIsCloneDestinationLoading(false)
      setHasCloneDestinationError(true)
      return
    }

    const requestTargetId = activeDirectoryBrowserTarget?.id ?? 'local'
    let disposed = false
    setIsCloneDestinationLoading(true)
    setHasCloneDestinationError(false)
    void listCloneDestinationDirectories(cloneDestinationDirectory)
      .then((value) => {
        if (disposed) return
        if (directoryBrowserTargetIdRef.current !== requestTargetId) return
        const nextList = normalizeCloneDestinationDirectoryList(value)
        setCloneDestinationList(nextList)
        setCloneDestinationDirectory(prev => prev === nextList.currentDirectory ? prev : nextList.currentDirectory)
        setDirectoryBrowserDirectoriesByTarget(prev =>
          prev[requestTargetId] === nextList.currentDirectory
            ? prev
            : {
              ...prev,
              [requestTargetId]: nextList.currentDirectory
            }
        )
        setDirectoryBrowserVisitedTargets(prev =>
          prev[requestTargetId] === true ? prev : { ...prev, [requestTargetId]: true }
        )
        setDirectoryBrowserHomeDirectory(prev => prev ?? nextList.currentDirectory)
      })
      .catch((error) => {
        if (disposed) return
        if (directoryBrowserTargetIdRef.current !== requestTargetId) return
        console.error('[launcher] failed to list clone destination directories', error)
        setCloneDestinationList(emptyCloneDestinationDirectoryList)
        setHasCloneDestinationError(true)
      })
      .finally(() => {
        if (!disposed) {
          setIsCloneDestinationLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [
    activeDirectoryBrowserTarget,
    canUseServerLauncher,
    cloneDestinationDirectory,
    desktopApi,
    isDirectoryBrowserMode
  ])

  useEffect(() => {
    const handleWindowFocus = () => {
      focusSearchInput()
    }
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        focusSearchInput()
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [focusSearchInput])

  const showDesktopActionUnavailable = useCallback(() => {
    void message.warning(t('launcher.desktopActionUnavailable'))
  }, [message, t])

  const openWorkspace = useCallback(async (workspaceFolder: string, workspaceName?: string) => {
    const normalizedWorkspaceFolder = workspaceFolder.trim()
    if (normalizedWorkspaceFolder === '') {
      void message.error(t('launcher.openWorkspaceFailed'))
      focusSearchInput()
      return
    }

    setOpeningWorkspace({
      name: workspaceName?.trim() || getDirectoryDisplayName(normalizedWorkspaceFolder),
      path: normalizedWorkspaceFolder
    })

    const clearOpeningWorkspace = () => {
      setOpeningWorkspace(current => current?.path === normalizedWorkspaceFolder ? undefined : current)
    }

    try {
      if (desktopApi?.openWorkspace != null) {
        await desktopApi.openWorkspace(normalizedWorkspaceFolder)
        onClose?.()
        window.setTimeout(clearOpeningWorkspace, 320)
        return
      }

      if (canUseServerLauncher) {
        const result = await openLauncherWorkspace(normalizedWorkspaceFolder)
        const workspaceClientBase = buildWorkspaceClientBase(result.workspaceId)
        rememberWorkspaceConnection(result, 'local', {
          managerServerBaseUrl: getLauncherManagerServerBaseUrl()
        })
        mergeRuntimeEnv({
          __ONEWORKS_PROJECT_CLIENT_BASE__: workspaceClientBase,
          __ONEWORKS_PROJECT_SERVER_BASE_URL__: result.serverBaseUrl,
          __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace',
          __ONEWORKS_PROJECT_WORKSPACE_ID__: result.workspaceId,
          __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: result.workspaceFolder
        })
        window.location.assign(workspaceClientBase)
        return
      }

      showDesktopActionUnavailable()
      clearOpeningWorkspace()
    } catch (error) {
      console.error('[launcher] failed to open workspace', error)
      void message.error(t('launcher.openWorkspaceFailed'))
      clearOpeningWorkspace()
    }
  }, [
    canUseServerLauncher,
    desktopApi,
    focusSearchInput,
    message,
    onClose,
    showDesktopActionUnavailable,
    t
  ])

  const forgetWorkspace = useCallback(async (workspaceFolder: string) => {
    const forgetWorkspaceApi = desktopApi?.forgetWorkspace

    try {
      if (forgetWorkspaceApi != null) {
        await forgetWorkspaceApi(workspaceFolder)
      } else if (canUseServerLauncher) {
        await forgetLauncherWorkspace(workspaceFolder)
      } else {
        showDesktopActionUnavailable()
        return
      }
      const removedWorkspaceKey = normalizeDirectoryPathKey(workspaceFolder)
      setSelectorState(prev => ({
        ...prev,
        recentProjects: prev.recentProjects.filter(project =>
          normalizeDirectoryPathKey(project.workspaceFolder) !== removedWorkspaceKey
        )
      }))
    } catch (error) {
      console.error('[launcher] failed to remove workspace from recents', error)
      void message.error(t('launcher.projects.removeFailed'))
    }
  }, [canUseServerLauncher, desktopApi, message, showDesktopActionUnavailable, t])

  const stopWorkspace = useCallback(async (
    project: DesktopWorkspaceSelectorProject,
    input: {
      forget?: boolean
    } = {}
  ) => {
    const stopWorkspaceApi = desktopApi?.stopWorkspace
    const removed = input.forget === true

    try {
      if (stopWorkspaceApi != null) {
        await stopWorkspaceApi(project.workspaceFolder, { forget: removed })
      } else if (canUseServerLauncher) {
        await stopLauncherWorkspace(project.workspaceFolder, { forget: removed })
      } else {
        showDesktopActionUnavailable()
        return
      }

      const stoppedWorkspaceKey = normalizeDirectoryPathKey(project.workspaceFolder)
      setSelectorState((prev) => {
        const nextRecentProjects = prev.recentProjects.filter(candidate =>
          normalizeDirectoryPathKey(candidate.workspaceFolder) !== stoppedWorkspaceKey
        )
        return {
          ...prev,
          runningProjects: prev.runningProjects.filter(candidate =>
            normalizeDirectoryPathKey(candidate.workspaceFolder) !== stoppedWorkspaceKey
          ),
          recentProjects: removed
            ? nextRecentProjects
            : [
              getRecentProjectFromRunningProject(project),
              ...nextRecentProjects
            ]
        }
      })
      void message.success(t(
        removed
          ? 'launcher.projects.stopAndRemoveSuccess'
          : 'launcher.projects.stopServiceSuccess'
      ))
    } catch (error) {
      console.error('[launcher] failed to stop workspace service', error)
      void message.error(getApiErrorMessage(error, t('launcher.projects.stopFailed')))
    }
  }, [
    canUseServerLauncher,
    desktopApi,
    message,
    showDesktopActionUnavailable,
    t
  ])

  const confirmForgetWorkspace = useCallback((project: DesktopWorkspaceSelectorProject) => {
    modal.confirm({
      cancelText: t('common.cancel'),
      content: t('launcher.projects.removeConfirmDescription'),
      okButtonProps: { danger: true },
      okText: t('launcher.projects.removeConfirmOk'),
      title: t('launcher.projects.removeConfirmTitle', { name: project.name }),
      onOk: () => forgetWorkspace(project.workspaceFolder)
    })
  }, [forgetWorkspace, modal, t])

  const confirmStopWorkspace = useCallback((
    project: DesktopWorkspaceSelectorProject,
    input: {
      forget?: boolean
    } = {}
  ) => {
    const removed = input.forget === true
    modal.confirm({
      cancelText: t('common.cancel'),
      content: t(
        removed
          ? 'launcher.projects.stopAndRemoveConfirmDescription'
          : 'launcher.projects.stopServiceConfirmDescription'
      ),
      okButtonProps: { danger: true },
      okText: t(
        removed
          ? 'launcher.projects.stopAndRemoveConfirmOk'
          : 'launcher.projects.stopServiceConfirmOk'
      ),
      title: t(
        removed
          ? 'launcher.projects.stopAndRemoveConfirmTitle'
          : 'launcher.projects.stopServiceConfirmTitle',
        { name: project.name }
      ),
      onOk: () => stopWorkspace(project, { forget: removed })
    })
  }, [modal, stopWorkspace, t])

  const readDirectoryBrowserInitialDirectory = useCallback((target?: LauncherDirectoryBrowserTarget) => {
    if (target != null && directoryBrowserVisitedTargets[target.id] === true) {
      const rememberedDirectory = directoryBrowserDirectoriesByTarget[target.id]
      if (rememberedDirectory != null && rememberedDirectory.trim() !== '') return rememberedDirectory
    }
    if (target?.kind === 'relay') return target.initialDirectory
    return recentCloneDestinationDirectories[0] ?? projects[0]?.workspaceFolder
  }, [
    directoryBrowserDirectoriesByTarget,
    directoryBrowserVisitedTargets,
    projects,
    recentCloneDestinationDirectories
  ])

  const enterCloneRepositoryMode = useCallback(() => {
    if (!canCloneRepository || desktopApi?.cloneRepository == null) {
      showDesktopActionUnavailable()
      return
    }

    setLauncherViewModeWithUrl('commands', { query: '', replace: true })
    setDirectoryBrowserMode('clone')
    setDirectoryBrowserTargetId('local')
    setDirectoryBrowserHomeDirectory(undefined)
    setIsFileSearchMode(false)
    setFileSearchResults([])
    setIsFileSearchLoading(false)
    setHasFileSearchError(false)
    setResourceResults(emptyWorkspaceResourceSearchResponse)
    setPluginResults([])
    setIsResourceSearchLoading(false)
    setHasResourceSearchError(false)
    setQuery(getCloneRepositoryUrlCandidate(query))
    setCloneDestinationDirectory(recentCloneDestinationDirectories[0])
    setActiveCommandId(undefined)
    setIsLauncherMenuOpen(false)
    focusSearchInput()
  }, [
    canCloneRepository,
    desktopApi,
    focusSearchInput,
    query,
    recentCloneDestinationDirectories,
    setLauncherViewModeWithUrl,
    showDesktopActionUnavailable
  ])

  const enterCreateWorkspaceDirectoryMode = useCallback(() => {
    const hasRelayDirectoryTargets = directoryBrowserTargets.some(target => target.kind === 'relay')
    const canCreateWorkspace = desktopApi?.createWorkspaceInDirectory != null || canUseServerLauncher ||
      hasRelayDirectoryTargets
    const canListDirectories = desktopApi?.listCloneDestinationDirectories != null || canUseServerLauncher ||
      hasRelayDirectoryTargets
    if (!canListDirectories || !canCreateWorkspace) {
      showDesktopActionUnavailable()
      return
    }

    setLauncherViewModeWithUrl('commands', { query: '', replace: true })
    setDirectoryBrowserMode('create-workspace')
    const initialTarget = localDirectoryBrowserTarget ?? activeDirectoryBrowserTarget
    setDirectoryBrowserTargetId(initialTarget?.id ?? 'local')
    setDirectoryBrowserVisitedTargets({ [initialTarget?.id ?? 'local']: true })
    setDirectoryBrowserHomeDirectory(undefined)
    setIsFileSearchMode(false)
    setFileSearchResults([])
    setIsFileSearchLoading(false)
    setHasFileSearchError(false)
    setResourceResults(emptyWorkspaceResourceSearchResponse)
    setPluginResults([])
    setIsResourceSearchLoading(false)
    setHasResourceSearchError(false)
    setQuery('')
    setCloneDestinationDirectory(readDirectoryBrowserInitialDirectory(initialTarget))
    setActiveCommandId(undefined)
    setIsLauncherMenuOpen(false)
    focusSearchInput()
  }, [
    activeDirectoryBrowserTarget,
    canUseServerLauncher,
    desktopApi,
    directoryBrowserTargets,
    focusSearchInput,
    localDirectoryBrowserTarget,
    readDirectoryBrowserInitialDirectory,
    setLauncherViewModeWithUrl,
    showDesktopActionUnavailable
  ])

  const enterOpenWorkspaceDirectoryMode = useCallback(async () => {
    const hasRelayDirectoryTargets = directoryBrowserTargets.some(target => target.kind === 'relay')
    const canListDirectories = desktopApi?.listCloneDestinationDirectories != null || canUseServerLauncher ||
      hasRelayDirectoryTargets
    if (!canListDirectories) {
      if (desktopApi?.chooseWorkspace != null) {
        try {
          const workspaceFolder = await desktopApi.chooseWorkspace()
          if (workspaceFolder == null || workspaceFolder.trim() === '') {
            focusSearchInput()
            return
          }
          await openWorkspace(workspaceFolder)
        } catch (error) {
          console.error('[launcher] failed to choose workspace', error)
          void message.error(t('launcher.openWorkspaceFailed'))
          focusSearchInput()
        }
        return
      }
      showDesktopActionUnavailable()
      return
    }

    setLauncherViewModeWithUrl('commands', { query: '', replace: true })
    setDirectoryBrowserMode('open-workspace')
    const initialTarget = localDirectoryBrowserTarget ?? activeDirectoryBrowserTarget
    setDirectoryBrowserTargetId(initialTarget?.id ?? 'local')
    setDirectoryBrowserVisitedTargets({ [initialTarget?.id ?? 'local']: true })
    setDirectoryBrowserHomeDirectory(undefined)
    setIsFileSearchMode(false)
    setFileSearchResults([])
    setIsFileSearchLoading(false)
    setHasFileSearchError(false)
    setResourceResults(emptyWorkspaceResourceSearchResponse)
    setPluginResults([])
    setIsResourceSearchLoading(false)
    setHasResourceSearchError(false)
    setQuery('')
    setCloneDestinationDirectory(readDirectoryBrowserInitialDirectory(initialTarget))
    setActiveCommandId(undefined)
    setIsLauncherMenuOpen(false)
    focusSearchInput()
  }, [
    activeDirectoryBrowserTarget,
    canUseServerLauncher,
    desktopApi,
    directoryBrowserTargets,
    focusSearchInput,
    localDirectoryBrowserTarget,
    message,
    openWorkspace,
    readDirectoryBrowserInitialDirectory,
    setLauncherViewModeWithUrl,
    showDesktopActionUnavailable,
    t
  ])

  const openCloneDestinationDirectory = useCallback((directory: string | undefined) => {
    if (directory == null || directory.trim() === '') return
    const targetId = activeDirectoryBrowserTarget?.id ?? directoryBrowserTargetId
    setCloneDestinationDirectory(directory)
    setDirectoryBrowserDirectoriesByTarget(prev =>
      prev[targetId] === directory
        ? prev
        : {
          ...prev,
          [targetId]: directory
        }
    )
    if (directoryBrowserMode === 'open-workspace') {
      setQuery('')
    }
    setActiveCommandId(undefined)
    focusSearchInput()
  }, [activeDirectoryBrowserTarget?.id, directoryBrowserMode, directoryBrowserTargetId, focusSearchInput])

  const selectDirectoryBrowserTarget = useCallback((target: LauncherDirectoryBrowserTarget) => {
    const targetChanged = target.id !== directoryBrowserTargetId
    const nextDirectory = target.id !== directoryBrowserTargetId && target.kind === 'relay'
      ? target.initialDirectory
      : readDirectoryBrowserInitialDirectory(target)
    setDirectoryBrowserTargetId(target.id)
    setDirectoryBrowserVisitedTargets(prev => prev[target.id] === true ? prev : { ...prev, [target.id]: true })
    setDirectoryBrowserHomeDirectory(undefined)
    if (targetChanged) {
      setCloneDestinationList(emptyCloneDestinationDirectoryList)
      setHasCloneDestinationError(false)
      setIsCloneDestinationLoading(true)
    }
    setCloneDestinationDirectory(nextDirectory)
    if (nextDirectory != null && nextDirectory.trim() !== '') {
      setDirectoryBrowserDirectoriesByTarget(prev =>
        prev[target.id] === nextDirectory
          ? prev
          : {
            ...prev,
            [target.id]: nextDirectory
          }
      )
    }
    setActiveCommandId(undefined)
    setQuery('')
    focusSearchInput()
  }, [directoryBrowserTargetId, focusSearchInput, readDirectoryBrowserInitialDirectory])

  const toggleCloneDestinationFavoriteDirectory = useCallback((directory: string) => {
    const normalizedDirectory = directory.trim()
    if (normalizedDirectory === '') return

    setFavoriteCloneDestinationDirectories((prev) => {
      const next = prev.includes(normalizedDirectory)
        ? prev.filter(candidate => candidate !== normalizedDirectory)
        : [
          normalizedDirectory,
          ...prev.filter(candidate => candidate !== normalizedDirectory)
        ].slice(0, CLONE_DESTINATION_FAVORITE_LIMIT)
      persistCloneDestinationFavoriteDirectories(next)
      return next
    })
    focusSearchInput()
  }, [focusSearchInput])

  const handleCloneRepository = useCallback(async (destinationDirectory: string | undefined) => {
    const cloneRepository = desktopApi?.cloneRepository
    if (cloneRepository == null) {
      showDesktopActionUnavailable()
      return
    }

    const repositoryUrl = query.trim()
    if (repositoryUrl === '') {
      void message.error(t('launcher.cloneRepositoryUrlRequired'))
      focusSearchInput()
      return
    }

    const normalizedDestinationDirectory = destinationDirectory?.trim()
    if (normalizedDestinationDirectory == null || normalizedDestinationDirectory === '') {
      void message.error(t('launcher.cloneRepositoryDestinationRequired'))
      focusSearchInput()
      return
    }

    setRecentCloneDestinationDirectories((prev) => {
      const next = rememberCloneDestinationDirectory(prev, normalizedDestinationDirectory)
      persistCloneDestinationDirectories(next)
      return next
    })

    void message.open({
      key: cloneRepositoryMessageKey,
      type: 'loading',
      content: t('launcher.cloneRepositoryCloning', { path: normalizedDestinationDirectory }),
      duration: 0
    })

    try {
      const workspaceFolder = await cloneRepository(repositoryUrl, normalizedDestinationDirectory)
      if (workspaceFolder == null) {
        message.destroy(cloneRepositoryMessageKey)
        focusSearchInput()
        return
      }

      void message.open({
        key: cloneRepositoryMessageKey,
        type: 'success',
        content: t('launcher.cloneRepositorySuccess'),
        duration: 2
      })
      await openWorkspace(workspaceFolder)
    } catch (error) {
      console.error('[launcher] failed to clone repository', error)
      void message.open({
        key: cloneRepositoryMessageKey,
        type: 'error',
        content: getApiErrorMessage(error, t('launcher.cloneRepositoryFailed')),
        duration: 4
      })
    }
  }, [
    desktopApi,
    focusSearchInput,
    message,
    openWorkspace,
    query,
    showDesktopActionUnavailable,
    t
  ])

  const openRemoteWorkspaceTarget = useCallback(async (target: {
    deviceId: string
    deviceName: string
    name: string
    serverId: string
    serverName: string
    workspaceFolder: string
  }) => {
    setOpeningWorkspace({
      name: target.name,
      path: `${target.deviceName} · ${target.workspaceFolder}`
    })

    try {
      const result = await openLauncherRelayWorkspace({
        deviceId: target.deviceId,
        deviceName: target.deviceName,
        serverId: target.serverId,
        serverName: target.serverName,
        workspaceFolder: target.workspaceFolder
      })
      const workspaceClientBase = buildWorkspaceClientBase(result.workspaceId)
      rememberWorkspaceConnection(result, 'relay', {
        managerServerBaseUrl: getLauncherManagerServerBaseUrl(),
        relay: {
          deviceId: target.deviceId,
          deviceName: target.deviceName,
          serverId: target.serverId,
          serverName: target.serverName,
          workspaceFolder: result.workspaceFolder
        }
      })
      mergeRuntimeEnv({
        __ONEWORKS_PROJECT_CLIENT_BASE__: workspaceClientBase,
        __ONEWORKS_PROJECT_SERVER_BASE_URL__: result.serverBaseUrl,
        __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace',
        __ONEWORKS_PROJECT_WORKSPACE_ID__: result.workspaceId,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: result.workspaceFolder
      })
      window.location.assign(workspaceClientBase)
    } catch (error) {
      console.error('[launcher] failed to open remote workspace', error)
      void message.error(getApiErrorMessage(error, t('launcher.openWorkspaceFailed')))
      setOpeningWorkspace(current =>
        current?.path === `${target.deviceName} · ${target.workspaceFolder}`
          ? undefined
          : current
      )
    }
  }, [message, t])

  const handleCreateWorkspaceInDirectory = useCallback(async (parentDirectory: string | undefined) => {
    const createWorkspaceInDirectory = desktopApi?.createWorkspaceInDirectory
    if (activeDirectoryBrowserTarget?.kind !== 'relay' && createWorkspaceInDirectory == null && !canUseServerLauncher) {
      showDesktopActionUnavailable()
      return
    }

    const projectName = query.trim()
    if (projectName === '') {
      void message.error(t('launcher.createWorkspaceNameRequired'))
      focusSearchInput()
      return
    }

    const normalizedParentDirectory = parentDirectory?.trim()
    if (normalizedParentDirectory == null || normalizedParentDirectory === '') {
      void message.error(t('launcher.createWorkspaceParentRequired'))
      focusSearchInput()
      return
    }

    try {
      if (activeDirectoryBrowserTarget?.kind === 'relay') {
        const result = await createLauncherRelayWorkspaceInDirectory({
          deviceId: activeDirectoryBrowserTarget.deviceId,
          parentDirectory: normalizedParentDirectory,
          projectName,
          serverId: activeDirectoryBrowserTarget.serverId
        })
        const workspaceFolder = result.workspaceFolder
        if (workspaceFolder == null || workspaceFolder.trim() === '') {
          focusSearchInput()
          return
        }
        await openRemoteWorkspaceTarget({
          deviceId: activeDirectoryBrowserTarget.deviceId,
          deviceName: activeDirectoryBrowserTarget.deviceName,
          name: getDirectoryDisplayName(workspaceFolder),
          serverId: activeDirectoryBrowserTarget.serverId,
          serverName: activeDirectoryBrowserTarget.serverName,
          workspaceFolder
        })
        return
      }

      const workspaceFolder = createWorkspaceInDirectory == null
        ? (await createLauncherWorkspaceInDirectory(normalizedParentDirectory, projectName)).workspaceFolder
        : await createWorkspaceInDirectory(normalizedParentDirectory, projectName)
      if (workspaceFolder == null || workspaceFolder.trim() === '') {
        focusSearchInput()
        return
      }

      setRecentCloneDestinationDirectories((prev) => {
        const next = rememberCloneDestinationDirectory(prev, normalizedParentDirectory)
        persistCloneDestinationDirectories(next)
        return next
      })
      await openWorkspace(workspaceFolder)
    } catch (error) {
      console.error('[launcher] failed to create workspace in directory', error)
      void message.error(getApiErrorMessage(error, t('launcher.createWorkspaceFailed')))
    }
  }, [
    activeDirectoryBrowserTarget,
    canUseServerLauncher,
    desktopApi,
    focusSearchInput,
    message,
    openWorkspace,
    openRemoteWorkspaceTarget,
    query,
    showDesktopActionUnavailable,
    t
  ])

  const handleOpenWorkspaceDirectory = useCallback(async (directory: string | undefined) => {
    const normalizedDirectory = directory?.trim()
    if (normalizedDirectory == null || normalizedDirectory === '') {
      void message.error(t('launcher.openWorkspaceFailed'))
      focusSearchInput()
      return
    }

    if (activeDirectoryBrowserTarget?.kind === 'relay') {
      await openRemoteWorkspaceTarget({
        deviceId: activeDirectoryBrowserTarget.deviceId,
        deviceName: activeDirectoryBrowserTarget.deviceName,
        name: getDirectoryDisplayName(normalizedDirectory),
        serverId: activeDirectoryBrowserTarget.serverId,
        serverName: activeDirectoryBrowserTarget.serverName,
        workspaceFolder: normalizedDirectory
      })
      return
    }

    setRecentCloneDestinationDirectories((prev) => {
      const next = rememberCloneDestinationDirectory(prev, normalizedDirectory)
      persistCloneDestinationDirectories(next)
      return next
    })

    await openWorkspace(normalizedDirectory)
  }, [activeDirectoryBrowserTarget, focusSearchInput, message, openRemoteWorkspaceTarget, openWorkspace, t])

  const openCurrentWorkspaceResource = useCallback(async (target: DesktopWorkspaceResourceTarget) => {
    if (onOpenWorkspaceResource != null) {
      try {
        await onOpenWorkspaceResource(target)
        onClose?.()
      } catch (error) {
        console.error('[launcher] failed to open workspace resource', error)
        void message.error(t('launcher.files.openFailed'))
      }
      return
    }

    if (desktopApi?.openCurrentWorkspaceResource == null) {
      showDesktopActionUnavailable()
      return
    }

    try {
      await desktopApi.openCurrentWorkspaceResource(target)
    } catch (error) {
      console.error('[launcher] failed to open workspace resource', error)
      void message.error(t('launcher.files.openFailed'))
    }
  }, [desktopApi, message, onClose, onOpenWorkspaceResource, showDesktopActionUnavailable, t])

  const openCurrentWorkspaceFile = useCallback(async (path: string) => {
    await openCurrentWorkspaceResource({ kind: 'file', path })
  }, [openCurrentWorkspaceResource])

  const openCurrentWorkspaceFileInExternalOpener = useCallback(async (path: string, opener: string) => {
    if (desktopApi?.openCurrentWorkspaceFileInExternalOpener == null) {
      showDesktopActionUnavailable()
      return
    }

    try {
      await desktopApi.openCurrentWorkspaceFileInExternalOpener(path, opener)
    } catch (error) {
      console.error('[launcher] failed to open workspace file in external opener', error)
      void message.error(t('launcher.files.openFailed'))
    }
  }, [desktopApi, message, showDesktopActionUnavailable, t])

  const openFilesystemFileInExternalOpener = useCallback(async (path: string, opener?: string) => {
    if (desktopApi?.openFilesystemFileInExternalOpener == null) {
      showDesktopActionUnavailable()
      return
    }

    try {
      await desktopApi.openFilesystemFileInExternalOpener(path, opener)
      await desktopApi.hideLauncherWindow?.()
    } catch (error) {
      console.error('[launcher] failed to open filesystem file in external opener', error)
      void message.error(t('launcher.files.openFailed'))
    }
  }, [desktopApi, message, showDesktopActionUnavailable, t])

  const openFilesystemDirectory = useCallback(async (path: string) => {
    if (desktopApi?.openFilesystemDirectory == null) {
      showDesktopActionUnavailable()
      return
    }

    try {
      await desktopApi.openFilesystemDirectory(path)
      await desktopApi.hideLauncherWindow?.()
    } catch (error) {
      console.error('[launcher] failed to open filesystem directory', error)
      void message.error(t('launcher.openWorkspaceFailed'))
    }
  }, [desktopApi, message, showDesktopActionUnavailable, t])

  const revealFilesystemPath = useCallback(async (path: string) => {
    if (desktopApi?.revealFilesystemPath == null) {
      showDesktopActionUnavailable()
      return
    }

    try {
      await desktopApi.revealFilesystemPath(path)
      await desktopApi.hideLauncherWindow?.()
    } catch (error) {
      console.error('[launcher] failed to reveal filesystem path', error)
      void message.error(t('launcher.projects.revealFailed', { manager: filesystemManagerName }))
    }
  }, [
    desktopApi,
    filesystemManagerName,
    message,
    showDesktopActionUnavailable,
    t
  ])

  const showComingSoon = useCallback(() => {
    void message.info(t('launcher.comingSoon'))
  }, [message, t])

  const openRemoteWorkspace = useCallback(async (project: LauncherRelayDeviceProject) => {
    await openRemoteWorkspaceTarget(project)
  }, [openRemoteWorkspaceTarget])

  const exitFileSearchMode = useCallback(() => {
    if (!isFileSearchMode) return false
    setIsFileSearchMode(false)
    setQuery('')
    setFileSearchResults([])
    setPluginResults([])
    setIsFileSearchLoading(false)
    setHasFileSearchError(false)
    return true
  }, [isFileSearchMode])

  const exitDirectoryBrowserMode = useCallback(() => {
    if (!isDirectoryBrowserMode) return false
    setDirectoryBrowserMode(undefined)
    setQuery('')
    setCloneDestinationDirectory(undefined)
    setDirectoryBrowserHomeDirectory(undefined)
    setCloneDestinationList(emptyCloneDestinationDirectoryList)
    setIsCloneDestinationLoading(false)
    setHasCloneDestinationError(false)
    return true
  }, [isDirectoryBrowserMode])

  const exitProjectContext = useCallback(() => {
    if (contextProject == null) {
      return false
    }

    setDismissedProjectContextFolder(contextProject.workspaceFolder)
    setLauncherQueryWithUrl('')
    setIsFileSearchMode(false)
    setFileSearchResults([])
    setIsFileSearchLoading(false)
    setHasFileSearchError(false)
    setResourceResults(emptyWorkspaceResourceSearchResponse)
    setPluginResults([])
    setDirectoryBrowserMode(undefined)
    setCloneDestinationDirectory(undefined)
    setDirectoryBrowserHomeDirectory(undefined)
    setCloneDestinationList(emptyCloneDestinationDirectoryList)
    setIsCloneDestinationLoading(false)
    setHasCloneDestinationError(false)
    setIsResourceSearchLoading(false)
    setHasResourceSearchError(false)
    return true
  }, [contextProject, setLauncherQueryWithUrl])

  useEffect(() => {
    if (contextProject == null) {
      setResourceResults(emptyWorkspaceResourceSearchResponse)
      setPluginResults([])
      setFileOpeners(null)
      setIsResourceSearchLoading(false)
      setHasResourceSearchError(false)
      return
    }

    void desktopApi?.listCurrentWorkspaceFileOpeners?.()
      .then(setFileOpeners)
      .catch((error) => {
        console.error('[launcher] failed to load workspace file openers', error)
        setFileOpeners(null)
      })
  }, [contextProject, desktopApi])

  useEffect(() => {
    if (contextProject == null || isFileSearchMode || isDirectoryBrowserMode) {
      setResourceResults(emptyWorkspaceResourceSearchResponse)
      setPluginResults([])
      setIsResourceSearchLoading(false)
      setHasResourceSearchError(false)
      return
    }

    const searchResources = searchWorkspaceResources ?? desktopApi?.searchCurrentWorkspaceResources
    const searchFiles = desktopApi?.searchCurrentWorkspaceFiles
    const searchPlugins = desktopApi?.plugins?.searchCurrentWorkspace
    const normalizedQuery = query.trim()
    if (searchResources == null && searchPlugins == null && (normalizedQuery === '' || searchFiles == null)) {
      setResourceResults(emptyWorkspaceResourceSearchResponse)
      setPluginResults([])
      setIsResourceSearchLoading(false)
      setHasResourceSearchError(searchFiles == null)
      return
    }

    let isCancelled = false
    setIsResourceSearchLoading(true)
    setHasResourceSearchError(false)
    const timeoutId = window.setTimeout(() => {
      const resourceResultPromise: Promise<DesktopWorkspaceResourceSearchResponse> = searchResources == null
        ? normalizedQuery === '' || searchFiles == null
          ? Promise.resolve(emptyWorkspaceResourceSearchResponse)
          : searchFiles(normalizedQuery).then(result => ({
            ...emptyWorkspaceResourceSearchResponse,
            files: normalizeWorkspaceFileSearchResults(result).map(file => ({
              directory: file.directory,
              id: `file:${file.path}`,
              kind: 'file' as const,
              name: file.name,
              path: file.path,
              title: file.name
            }))
          }))
        : searchResources(normalizedQuery).then(normalizeWorkspaceResourceSearchResults)
      const pluginResultPromise = searchPlugins == null
        ? Promise.resolve<DesktopPluginLauncherSearchResult[]>([])
        : searchPlugins(normalizedQuery)
          .then(result => normalizePluginLauncherSearchResults(result).results)
          .catch((error) => {
            console.warn('[launcher] failed to search workspace plugins', error)
            return []
          })

      void Promise.all([resourceResultPromise, pluginResultPromise])
        .then(([result, plugins]) => {
          if (isCancelled) return
          setResourceResults(result ?? emptyWorkspaceResourceSearchResponse)
          setPluginResults(plugins)
        })
        .catch((error) => {
          if (isCancelled) return
          console.error('[launcher] failed to search workspace resources', error)
          setResourceResults(emptyWorkspaceResourceSearchResponse)
          setPluginResults([])
          setHasResourceSearchError(true)
        })
        .finally(() => {
          if (!isCancelled) setIsResourceSearchLoading(false)
        })
    }, FILE_SEARCH_DEBOUNCE_MS)

    return () => {
      isCancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [contextProject, desktopApi, isDirectoryBrowserMode, isFileSearchMode, query, searchWorkspaceResources])

  useEffect(() => {
    if (!isFileSearchMode) {
      setFileSearchResults([])
      setIsFileSearchLoading(false)
      setHasFileSearchError(false)
      return
    }

    const normalizedFileQuery = query.trim()
    if (normalizedFileQuery === '') {
      setFileSearchResults([])
      setIsFileSearchLoading(false)
      setHasFileSearchError(false)
      return
    }

    const searchFilesystemFiles = desktopApi?.searchFilesystemFiles
    const searchCurrentWorkspaceFiles = desktopApi?.searchCurrentWorkspaceFiles
    if (contextProject == null && searchFilesystemFiles == null) {
      setFileSearchResults([])
      setIsFileSearchLoading(false)
      setHasFileSearchError(true)
      return
    }
    if (contextProject != null && searchCurrentWorkspaceFiles == null) {
      setFileSearchResults([])
      setIsFileSearchLoading(false)
      setHasFileSearchError(true)
      return
    }

    let isCancelled = false
    setIsFileSearchLoading(true)
    setHasFileSearchError(false)
    const timeoutId = window.setTimeout(() => {
      const resultPromise = contextProject == null
        ? searchFilesystemFiles!(normalizedFileQuery, { includeDirectories: true })
          .then(result =>
            normalizeWorkspaceFileSearchResults(result).map(file => ({
              directory: file.directory,
              name: file.name,
              path: file.path,
              projectName: t('launcher.files.rootLabel'),
              source: 'filesystem' as const,
              type: file.type === 'directory' ? 'directory' as const : 'file' as const
            }))
          )
        : searchCurrentWorkspaceFiles!(normalizedFileQuery, { includeDirectories: true })
          .then(result =>
            normalizeWorkspaceFileSearchResults(result).map(file => ({
              directory: file.directory,
              name: file.name,
              path: file.path,
              projectName: contextProject.name,
              source: 'workspace' as const,
              type: file.type === 'directory' ? 'directory' as const : 'file' as const,
              workspaceFolder: contextProject.workspaceFolder
            }))
          )

      void resultPromise
        .then((files) => {
          if (isCancelled) return
          setFileSearchResults(files.slice(0, FILE_SEARCH_RESULT_LIMIT))
        })
        .catch((error) => {
          if (isCancelled) return
          console.error('[launcher] failed to search launcher files', error)
          setFileSearchResults([])
          setHasFileSearchError(true)
        })
        .finally(() => {
          if (!isCancelled) setIsFileSearchLoading(false)
        })
    }, FILE_SEARCH_DEBOUNCE_MS)

    return () => {
      isCancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [contextProject, desktopApi, isFileSearchMode, query, t])

  const fileOpenerOptions = useMemo(() =>
    resolveWorkspaceFileOpenerSelectModels(
      fileOpeners as Parameters<typeof resolveWorkspaceFileOpenerSelectModels>[0]
    ), [fileOpeners])

  const buildFileContextMenuItems = useCallback((path: string): MenuProps['items'] => {
    if (fileOpenerOptions.length === 0) {
      return [{
        disabled: true,
        key: 'loading',
        label: t('launcher.files.loadingOpeners')
      }]
    }

    return fileOpenerOptions.map(opener => ({
      icon: <span className='material-symbols-rounded launcher-command-menu__icon'>{opener.icon}</span>,
      key: `opener:${opener.value}`,
      label: opener.kind === 'auto'
        ? opener.defaultOpenerTitle == null
          ? t('launcher.files.openWithDefault')
          : t('launcher.files.openWithDefaultNamed', { name: opener.defaultOpenerTitle })
        : t('launcher.files.openWithNamed', { name: opener.title ?? opener.value }),
      onClick: () => void openCurrentWorkspaceFileInExternalOpener(path, opener.value)
    }))
  }, [fileOpenerOptions, openCurrentWorkspaceFileInExternalOpener, t])

  const buildProjectContextMenuItems = useCallback((project: DesktopWorkspaceSelectorProject): MenuProps['items'] => {
    const isRunningProject = project.status != null
    const items: NonNullable<MenuProps['items']> = [
      {
        icon: <span className='material-symbols-rounded launcher-command-menu__icon'>keyboard_return</span>,
        key: 'open-project',
        label: t('launcher.projects.open'),
        onClick: () => void openWorkspace(project.workspaceFolder, project.name)
      },
      {
        icon: <span className='material-symbols-rounded launcher-command-menu__icon'>folder_open</span>,
        key: 'open-project-folder',
        label: t('launcher.projects.revealInFileManager', { manager: filesystemManagerName }),
        onClick: () => void revealFilesystemPath(project.workspaceFolder)
      },
      {
        type: 'divider'
      },
      {
        icon: <span className='material-symbols-rounded launcher-command-menu__icon'>badge</span>,
        key: 'copy-project-name',
        label: t('launcher.projects.copyName'),
        onClick: () =>
          void copyTextWithFeedback({
            failureMessage: t('common.copyFailed'),
            messageApi: message,
            successMessage: t('launcher.projects.nameCopied'),
            text: project.name
          })
      },
      {
        icon: <span className='material-symbols-rounded launcher-command-menu__icon'>content_copy</span>,
        key: 'copy-project-path',
        label: t('launcher.projects.copyPath'),
        onClick: () =>
          void copyTextWithFeedback({
            failureMessage: t('common.copyFailed'),
            messageApi: message,
            successMessage: t('launcher.projects.pathCopied'),
            text: project.workspaceFolder
          })
      }
    ]

    items.push({ type: 'divider' })
    if (isRunningProject) {
      items.push(
        {
          danger: true,
          icon: <span className='material-symbols-rounded launcher-command-menu__icon'>stop_circle</span>,
          key: 'stop-project-service',
          label: t('launcher.projects.stopService'),
          onClick: () => confirmStopWorkspace(project)
        },
        {
          danger: true,
          icon: <span className='material-symbols-rounded launcher-command-menu__icon'>delete</span>,
          key: 'stop-and-remove-project',
          label: t('launcher.projects.stopAndRemove'),
          onClick: () => confirmStopWorkspace(project, { forget: true })
        }
      )
    } else {
      items.push({
        danger: true,
        icon: <span className='material-symbols-rounded launcher-command-menu__icon'>close</span>,
        key: 'remove-project',
        label: t('launcher.projects.remove'),
        onClick: () => confirmForgetWorkspace(project)
      })
    }

    return items
  }, [
    confirmForgetWorkspace,
    confirmStopWorkspace,
    filesystemManagerName,
    message,
    openWorkspace,
    revealFilesystemPath,
    t
  ])

  const openFileSearchItem = useCallback((item: LauncherFileSearchItem) => {
    if (item.source === 'filesystem') {
      if (item.type === 'directory') {
        void openFilesystemDirectory(item.path)
        return
      }

      void openFilesystemFileInExternalOpener(item.path)
      return
    }

    void openCurrentWorkspaceResource({
      kind: item.type === 'directory' ? 'directory' : 'file',
      path: item.path
    })
  }, [
    openFilesystemDirectory,
    openFilesystemFileInExternalOpener,
    openCurrentWorkspaceResource
  ])

  const invokePluginLauncherResult = useCallback(async (resultId: string) => {
    const invokeResult = desktopApi?.plugins?.invokeCurrentWorkspaceResult
    if (invokeResult == null) return

    try {
      await invokeResult(resultId)
    } catch (error) {
      console.error('[launcher] failed to invoke workspace plugin result', error)
      void message.error(t('launcher.commandFailed'))
    }
  }, [desktopApi, message, t])

  const openLauncherView = useCallback((mode: LauncherViewMode) => {
    setLauncherViewModeWithUrl(mode, { query: '' })
    setDirectoryBrowserMode(undefined)
    setCloneDestinationDirectory(undefined)
    setDirectoryBrowserHomeDirectory(undefined)
    setCloneDestinationList(emptyCloneDestinationDirectoryList)
    setIsCloneDestinationLoading(false)
    setHasCloneDestinationError(false)
    setIsFileSearchMode(false)
    setFileSearchResults([])
    setIsFileSearchLoading(false)
    setHasFileSearchError(false)
    setActiveCommandId(undefined)
    setIsLauncherMenuOpen(false)
    focusSearchInput()
  }, [focusSearchInput, setLauncherViewModeWithUrl])

  const checkDesktopUpdates = useCallback(() => {
    if (desktopApi?.checkForUpdates == null) {
      void message.warning(t('launcher.desktopActionUnavailable'))
      return
    }

    setIsLauncherMenuOpen(false)
    void desktopApi.checkForUpdates({ interactive: true })
      .catch((error) => {
        console.error('[launcher] failed to check desktop updates', error)
        void message.error(t('config.desktopSettings.updates.checkFailed'))
      })
  }, [desktopApi, message, t])

  const openRelayAccountManagement = useCallback(() => {
    const accountKey = relayAccounts.length === 1 ? cleanLauncherText(relayAccounts[0]?.accountKey) : undefined

    setIsLauncherMenuOpen(false)
    void navigate(buildRelayPluginRoutePath(
      accountKey == null ? 'accounts' : `accounts/${encodeURIComponent(accountKey)}/account`
    ))
  }, [navigate, relayAccounts])

  const openRelayAccountDetail = useCallback((account: LauncherRelayAccount) => {
    const accountKey = cleanLauncherText(account.accountKey)
    if (accountKey == null) {
      openRelayAccountManagement()
      return
    }

    setIsLauncherMenuOpen(false)
    void navigate(buildRelayPluginRoutePath(`accounts/${encodeURIComponent(accountKey)}/account`))
  }, [navigate, openRelayAccountManagement])

  const startRelayAccountLogin = useCallback(async () => {
    const serverId = cleanLauncherText(relayActiveServerId) ?? 'cf'
    const response = await createLauncherRelayLoginUrl({
      redirectUri: buildRelayPluginClientUrl('accounts'),
      serverId
    })
    const loginUrl = cleanLauncherText(response.loginUrl)
    if (loginUrl == null) {
      throw new Error('Relay login URL was not returned.')
    }

    setIsLauncherMenuOpen(false)
    const popup = window.open(loginUrl, '_blank', 'noopener,noreferrer')
    if (popup == null) {
      window.location.href = loginUrl
    }
  }, [relayActiveServerId])

  const getLauncherRelayAccountServerLabel = useCallback((account: LauncherRelayAccount) => {
    const server = findLauncherRelayServerForAccount(account, relayServers)
    const serverId = cleanLauncherText(server?.id ?? account.serverId)
    const serverAlias = cleanLauncherText(account.serverAlias)?.toLowerCase()

    if (
      server?.official === true || serverId === 'cf' || serverId === 'vercel' || serverAlias === 'cf' ||
      serverAlias === 'vercel'
    ) {
      return t('launcher.account.defaultServer')
    }
    if (serverId === 'local' || serverAlias === 'local') {
      return t('launcher.account.localServer')
    }

    const serverName = cleanLauncherText(server?.name)
    if (
      serverName == null || /^https?:\/\//iu.test(serverName) || serverName === cleanLauncherText(server?.remoteBaseUrl)
    ) {
      return t('launcher.account.serverFallback')
    }
    return serverName
  }, [relayServers, t])

  const relayAccountSections = useMemo<LauncherCommandSection[]>(() => {
    const serverKeys = new Set(relayAccounts.map(getLauncherRelayAccountServerKey))
    const shouldGroupByServer = serverKeys.size > 1
    const accountGroups = shouldGroupByServer
      ? [...serverKeys].map((serverKey) => {
        const accounts = relayAccounts.filter(account => getLauncherRelayAccountServerKey(account) === serverKey)
        return {
          accounts,
          id: `account-server:${serverKey}`,
          title: getLauncherRelayAccountServerLabel(accounts[0] ?? {})
        }
      })
      : [{
        accounts: relayAccounts,
        id: 'accounts',
        title: t('launcher.account.title')
      }]

    const accountSections = accountGroups
      .map(group => ({
        commands: group.accounts.map((account, index): LauncherCommand => {
          const name = getLauncherRelayAccountDisplayName(account)
          return {
            action: () => openRelayAccountDetail(account),
            avatarInitials: getLauncherRelayAccountInitials(name),
            avatarUrl: cleanLauncherText(account.avatarUrl),
            badge: account.enabled === false
              ? t('launcher.account.disabled')
              : account.sessionAuthenticated === true
              ? t('launcher.account.signedIn')
              : undefined,
            icon: 'account_circle',
            id: `account:${cleanLauncherText(account.accountKey) ?? index}`,
            keywords: [
              name,
              cleanLauncherText(account.email) ?? '',
              cleanLauncherText(account.loginId) ?? '',
              cleanLauncherText(account.userId) ?? '',
              cleanLauncherText(account.serverAlias) ?? '',
              cleanLauncherText(account.serverId) ?? '',
              t('launcher.account.detailHint')
            ],
            subtitle: getLauncherRelayAccountSubtitle(account),
            title: name
          }
        }),
        id: group.id,
        title: group.title
      }))
      .filter(section => section.commands.length > 0)

    if (accountSections.length === 0) {
      accountSections.push({
        commands: [{
          action: () => void startRelayAccountLogin(),
          icon: hasRelayAccountError ? 'warning' : isRelayAccountLoading ? 'sync' : 'account_circle',
          id: 'account:empty',
          keywords: ['account', 'login', 'user', '账号', '登录'],
          subtitle: hasRelayAccountError
            ? t('launcher.account.loadFailedHint')
            : isRelayAccountLoading
            ? ''
            : t('launcher.account.emptyHint'),
          title: hasRelayAccountError
            ? t('launcher.account.loadFailed')
            : isRelayAccountLoading
            ? t('launcher.account.loading')
            : t('launcher.account.empty')
        }],
        id: 'accounts',
        title: t('launcher.account.title')
      })
    }

    return [
      ...accountSections,
      {
        commands: [
          {
            action: () => void startRelayAccountLogin(),
            icon: 'login',
            id: 'account:login',
            keywords: ['login', 'sign in', 'account', 'user', '登录', '账号', '新增账号'],
            subtitle: t('launcher.account.loginHint'),
            title: t('launcher.account.login')
          },
          {
            action: openRelayAccountManagement,
            icon: 'manage_accounts',
            id: 'account:manage',
            keywords: ['manage', 'account', 'user', 'profile', '管理', '账号', '账户'],
            subtitle: t('launcher.account.manageHint'),
            title: t('launcher.account.manage')
          }
        ],
        id: 'account-actions',
        title: t('launcher.account.actionsTitle')
      }
    ]
  }, [
    getLauncherRelayAccountServerLabel,
    hasRelayAccountError,
    isRelayAccountLoading,
    openRelayAccountDetail,
    openRelayAccountManagement,
    relayAccounts,
    startRelayAccountLogin,
    t
  ])

  const openProjectFromPreview = useCallback(() => {
    setLauncherViewModeWithUrl('commands', { query: '', replace: true })
    enterOpenWorkspaceDirectoryMode()
  }, [enterOpenWorkspaceDirectoryMode, setLauncherViewModeWithUrl])

  const previewSections = useMemo<LauncherCommandSection[]>(() => {
    if (contextProject == null) {
      return [{
        commands: [{
          action: openProjectFromPreview,
          icon: 'folder_open',
          id: 'preview:open-project',
          keywords: ['preview', 'open project', 'website', 'browser', '预览', '打开项目'],
          subtitle: t('launcher.preview.openProjectHint'),
          title: t('launcher.preview.openProject')
        }],
        id: 'preview',
        title: t('launcher.preview.title')
      }]
    }

    return [{
      commands: [
        {
          action: () => void openCurrentWorkspaceResource({ kind: 'new-website' }),
          badge: t('launcher.resource.tabBadge'),
          icon: 'language',
          id: 'preview:new-website',
          keywords: ['preview', 'website', 'browser', 'web', 'url', 'new', 'tab', '预览', '网站', '浏览器'],
          subtitle: t('launcher.preview.newWebsiteHint'),
          title: t('launcher.preview.newWebsite')
        },
        ...resourceResults.websites
          .filter(resource => resource.kind === 'website' && typeof resource.url === 'string')
          .map(resource => ({
            action: () =>
              void openCurrentWorkspaceResource({
                kind: 'website',
                title: resource.title ?? resource.url,
                url: resource.url
              }),
            badge: t('launcher.resource.websiteBadge'),
            icon: 'language',
            id: `preview:${resource.id}`,
            keywords: [resource.title ?? '', resource.url ?? '', 'preview', '预览'],
            subtitle: resource.url,
            title: resource.title ?? resource.url ?? ''
          }))
      ],
      id: 'preview',
      title: t('launcher.preview.title')
    }]
  }, [
    contextProject,
    openCurrentWorkspaceResource,
    openProjectFromPreview,
    resourceResults.websites,
    t
  ])

  const builtinCommands = useMemo<LauncherCommand[]>(() => [
    {
      action: () => openLauncherView('account'),
      icon: 'account_circle',
      id: 'builtin:account',
      keywords: ['account', 'login', 'user', 'profile', '账号', '账户', '登录', '用户'],
      subtitle: t('launcher.builtin.accountHint'),
      title: t('launcher.menu.account')
    },
    {
      action: () => openLauncherView('settings'),
      icon: 'settings',
      id: 'builtin:settings',
      keywords: ['settings', 'preferences', 'config', '设置', '配置'],
      subtitle: t('launcher.builtin.settingsHint'),
      title: t('launcher.menu.settings')
    },
    {
      action: () => openLauncherView('about'),
      icon: 'info',
      id: 'builtin:about',
      keywords: ['about', 'version', 'info', '关于', '版本'],
      subtitle: t('launcher.builtin.aboutHint'),
      title: t('launcher.menu.about')
    },
    {
      action: checkDesktopUpdates,
      icon: 'sync',
      id: 'builtin:check-updates',
      keywords: ['update', 'check update', 'upgrade', '检查更新', '更新'],
      subtitle: t('launcher.builtin.checkUpdateHint'),
      title: t('launcher.menu.checkUpdate')
    },
    {
      action: () => openLauncherView('preview'),
      icon: 'preview',
      id: 'builtin:preview',
      keywords: ['preview', 'website', 'browser', 'web', '预览', '网站', '浏览器'],
      subtitle: t('launcher.builtin.previewHint'),
      title: t('launcher.preview.title')
    }
  ], [checkDesktopUpdates, openLauncherView, t])

  const rememberLauncherSelection = useCallback((command: LauncherCommand) => {
    if (launcherViewMode !== 'commands' || isDirectoryBrowserMode || isFileSearchMode) return

    const id = (command.recentSelectionId ?? command.id).trim()
    if (id === '') return

    setRecentSelectionIds((previousIds) => {
      const nextIds = rememberLauncherRecentSelectionId(previousIds, id)
      persistLauncherRecentSelectionIds(nextIds)
      return nextIds
    })
  }, [isDirectoryBrowserMode, isFileSearchMode, launcherViewMode])

  const commandSections = useMemo<LauncherCommandSection[]>(() => {
    if (launcherViewMode === 'account') {
      return relayAccountSections
    }

    if (launcherViewMode === 'preview') {
      return previewSections
    }

    if (isDirectoryBrowserMode) {
      const currentDirectory = cloneDestinationList.currentDirectory
      if (currentDirectory === '') return []

      const useDirectoryMemory = activeDirectoryBrowserTarget?.kind !== 'relay'
      const currentDirectoryKey = normalizeDirectoryPathKey(currentDirectory)
      const homeDirectoryKey = directoryBrowserHomeDirectory == null
        ? currentDirectoryKey
        : normalizeDirectoryPathKey(directoryBrowserHomeDirectory)
      const isHomeDirectory = currentDirectoryKey === homeDirectoryKey
      const recentDirectoryIndexes = new Map(
        useDirectoryMemory
          ? recentCloneDestinationDirectories.map((directory, index) => [normalizeDirectoryPathKey(directory), index])
          : []
      )
      const favoriteDirectoryIndexes = new Map(
        useDirectoryMemory
          ? favoriteCloneDestinationDirectories.map((directory, index) => [normalizeDirectoryPathKey(directory), index])
          : []
      )
      const favoriteDirectoryKeys = new Set(favoriteDirectoryIndexes.keys())
      const sortByFavoriteAndRecentSelection = (
        left: DesktopCloneDestinationDirectory,
        right: DesktopCloneDestinationDirectory
      ) => {
        const leftKey = normalizeDirectoryPathKey(left.path)
        const rightKey = normalizeDirectoryPathKey(right.path)
        const leftFavoriteIndex = favoriteDirectoryIndexes.get(leftKey) ?? Number.POSITIVE_INFINITY
        const rightFavoriteIndex = favoriteDirectoryIndexes.get(rightKey) ?? Number.POSITIVE_INFINITY
        if (leftFavoriteIndex !== rightFavoriteIndex) return leftFavoriteIndex - rightFavoriteIndex

        const leftIndex = recentDirectoryIndexes.get(leftKey) ?? Number.POSITIVE_INFINITY
        const rightIndex = recentDirectoryIndexes.get(rightKey) ?? Number.POSITIVE_INFINITY
        if (leftIndex !== rightIndex) return leftIndex - rightIndex
        return left.name.localeCompare(right.name, undefined, { numeric: true })
      }
      const toDestinationCommand = ({
        actionLabel = isCloneRepositoryMode ? 'clone' : isCreateWorkspaceDirectoryMode ? 'create' : 'open',
        icon = 'folder',
        name,
        path,
        showFavoriteAction = true,
        showSecondaryAction = true
      }: DesktopCloneDestinationDirectory & {
        actionLabel?: LauncherCommand['actionLabel']
        icon?: string
        showFavoriteAction?: boolean
        showSecondaryAction?: boolean
      }): LauncherCommand => {
        const isBackAction = actionLabel === 'back'
        const hasFavoriteAction = useDirectoryMemory && showFavoriteAction && !isBackAction
        const hasSecondaryAction = showSecondaryAction && !isBackAction
        const isFavorite = favoriteDirectoryKeys.has(normalizeDirectoryPathKey(path))
        const action = isBackAction
          ? () => openCloneDestinationDirectory(path)
          : isCloneRepositoryMode
          ? () => void handleCloneRepository(path)
          : isCreateWorkspaceDirectoryMode
          ? () => void handleCreateWorkspaceInDirectory(path)
          : () => void handleOpenWorkspaceDirectory(path)
        const actionMenuLabel = isBackAction
          ? t('launcher.footerHints.back')
          : actionLabel === 'clone'
          ? t('launcher.footerHints.clone')
          : actionLabel === 'create'
          ? t('launcher.footerHints.create')
          : t('launcher.footerHints.open')
        const contextMenuItems: NonNullable<MenuProps['items']> = [
          {
            icon: <span className='material-symbols-rounded launcher-command-menu__icon'>keyboard_return</span>,
            key: 'primary-action',
            label: actionMenuLabel,
            onClick: action
          },
          ...(hasSecondaryAction
            ? [{
              icon: <span className='material-symbols-rounded launcher-command-menu__icon'>chevron_right</span>,
              key: 'enter-directory',
              label: t('launcher.footerHints.openDirectory'),
              onClick: () => openCloneDestinationDirectory(path)
            }]
            : []),
          ...(useDirectoryMemory
            ? [{
              icon: <span className='material-symbols-rounded launcher-command-menu__icon'>folder_open</span>,
              key: 'reveal-directory',
              label: t('launcher.projects.revealInFileManager', { manager: filesystemManagerName }),
              onClick: () => void revealFilesystemPath(path)
            }]
            : []),
          { type: 'divider' },
          {
            icon: <span className='material-symbols-rounded launcher-command-menu__icon'>badge</span>,
            key: 'copy-directory-name',
            label: t('launcher.projects.copyName'),
            onClick: () =>
              void copyTextWithFeedback({
                failureMessage: t('common.copyFailed'),
                messageApi: message,
                successMessage: t('launcher.directoryNameCopied'),
                text: name
              })
          },
          {
            icon: <span className='material-symbols-rounded launcher-command-menu__icon'>content_copy</span>,
            key: 'copy-directory-path',
            label: t('launcher.projects.copyPath'),
            onClick: () =>
              void copyTextWithFeedback({
                failureMessage: t('common.copyFailed'),
                messageApi: message,
                successMessage: t('launcher.directoryPathCopied'),
                text: path
              })
          },
          ...(hasFavoriteAction
            ? [
              { type: 'divider' as const },
              {
                icon: (
                  <span className='material-symbols-rounded launcher-command-menu__icon'>
                    {isFavorite ? 'star' : 'star_outline'}
                  </span>
                ),
                key: 'favorite-directory',
                label: isFavorite
                  ? t('launcher.unfavoriteDirectory')
                  : t('launcher.favoriteDirectory'),
                onClick: () => toggleCloneDestinationFavoriteDirectory(path)
              }
            ]
            : [])
        ]
        return {
          action,
          actionLabel,
          contextMenuItems,
          favoriteAction: hasFavoriteAction ? () => toggleCloneDestinationFavoriteDirectory(path) : undefined,
          favoriteLabel: !hasFavoriteAction
            ? undefined
            : isFavorite
            ? t('launcher.unfavoriteDirectory')
            : t('launcher.favoriteDirectory'),
          icon,
          id: `clone-destination:${encodeURIComponent(`${name}:${path}`)}`,
          automationPath: path,
          isFavorite,
          keywords: [name, path],
          secondaryAction: hasSecondaryAction ? () => openCloneDestinationDirectory(path) : undefined,
          subtitle: path,
          title: name
        }
      }
      const fixedDirectories: DesktopCloneDestinationDirectory[] = [
        { name: '.', path: currentDirectory },
        ...(cloneDestinationList.parentDirectory == null
          ? []
          : [{ name: '..', path: cloneDestinationList.parentDirectory }])
      ]
      const directQueryDirectory = query.trim()
      const directQueryDirectories: DesktopCloneDestinationDirectory[] = (
          isOpenWorkspaceDirectoryMode &&
          isLikelyAbsoluteDirectoryPath(directQueryDirectory) &&
          normalizeDirectoryPathKey(directQueryDirectory) !== normalizeDirectoryPathKey(currentDirectory)
        )
        ? [{
          name: getDirectoryDisplayName(directQueryDirectory),
          path: directQueryDirectory
        }]
        : []
      const fixedDirectoryKeys = new Set(fixedDirectories.map(directory => normalizeDirectoryPathKey(directory.path)))
      const childDirectoryKeys = new Set(
        cloneDestinationList.directories.map(directory => normalizeDirectoryPathKey(directory.path))
      )
      const favoriteDirectories = useDirectoryMemory
        ? favoriteCloneDestinationDirectories
          .filter(directory =>
            isHomeDirectory &&
            !fixedDirectoryKeys.has(normalizeDirectoryPathKey(directory)) &&
            !childDirectoryKeys.has(normalizeDirectoryPathKey(directory))
          )
          .map(directory => ({
            name: getDirectoryDisplayName(directory),
            path: directory
          }))
        : []
      const recentDirectories = useDirectoryMemory
        ? recentCloneDestinationDirectories
          .filter(directory =>
            (
              isHomeDirectory &&
              !fixedDirectoryKeys.has(normalizeDirectoryPathKey(directory)) &&
              !childDirectoryKeys.has(normalizeDirectoryPathKey(directory)) &&
              !favoriteDirectoryKeys.has(normalizeDirectoryPathKey(directory))
            ) ||
            (
              isDirectoryPathInSameParent(directory, currentDirectory) &&
              !fixedDirectoryKeys.has(normalizeDirectoryPathKey(directory)) &&
              !childDirectoryKeys.has(normalizeDirectoryPathKey(directory)) &&
              !favoriteDirectoryKeys.has(normalizeDirectoryPathKey(directory))
            )
          )
          .map(directory => ({
            name: getDirectoryDisplayName(directory),
            path: directory
          }))
        : []
      const commands = [
        ...directQueryDirectories.map(directory =>
          toDestinationCommand({
            ...directory,
            icon: 'folder_open',
            showFavoriteAction: false,
            showSecondaryAction: false
          })
        ),
        ...fixedDirectories.map(directory =>
          toDestinationCommand({
            ...directory,
            actionLabel: directory.name === '..'
              ? 'back'
              : isCloneRepositoryMode
              ? 'clone'
              : isCreateWorkspaceDirectoryMode
              ? 'create'
              : 'open',
            icon: directory.name === '..' ? 'drive_folder_upload' : 'radio_button_checked',
            showFavoriteAction: false,
            showSecondaryAction: false
          })
        ),
        ...favoriteDirectories.map(directory =>
          toDestinationCommand({
            ...directory,
            icon: 'star'
          })
        ),
        ...recentDirectories.map(directory =>
          toDestinationCommand({
            ...directory,
            icon: isDirectoryPathInSameParent(directory.path, currentDirectory) ? 'folder' : 'history'
          })
        ),
        ...cloneDestinationList.directories
          .slice()
          .sort(sortByFavoriteAndRecentSelection)
          .map(directory => toDestinationCommand(directory))
      ]

      return [
        {
          commands,
          id: 'clone-destinations',
          title: ''
        }
      ]
    }

    if (isFileSearchMode) {
      return [
        {
          commands: fileSearchResults.map((file) => {
            const icon = file.type === 'directory'
              ? { icon: 'folder', tone: 'folder' }
              : getProjectFileIconMeta(file.name)
            const subtitleParts = contextProject == null
              ? [file.projectName, file.directory || file.path]
              : [file.directory]

            return {
              action: () => openFileSearchItem(file),
              badge: file.type === 'directory'
                ? t('launcher.files.folderBadge')
                : contextProject == null
                ? t('launcher.files.externalBadge')
                : t('launcher.resource.fileBadge'),
              contextMenuItems: file.type === 'file' && contextProject != null
                ? buildFileContextMenuItems(file.path)
                : undefined,
              icon: icon.icon,
              iconTone: icon.tone,
              id: `launcher-file:${encodeURIComponent(`${file.source}:${file.workspaceFolder ?? ''}:${file.path}`)}`,
              keywords: [file.name, file.path, file.directory, file.projectName ?? '', file.workspaceFolder ?? ''],
              subtitle: subtitleParts.filter(Boolean).join(' · '),
              title: file.name
            }
          }),
          id: 'files',
          title: contextProject == null ? t('launcher.files.globalTitle') : t('launcher.files.title')
        }
      ].filter(section => section.commands.length > 0)
    }

    const withRecentSelectionsAndBuiltin = (sections: LauncherCommandSection[]) => {
      const availableCommands = new Map<string, LauncherCommand>()
      ;[...sections, { commands: builtinCommands, id: 'builtin', title: t('launcher.builtin.title') }]
        .forEach(section => {
          section.commands.forEach((command) => {
            const id = (command.recentSelectionId ?? command.id).trim()
            if (id !== '' && !availableCommands.has(id)) {
              availableCommands.set(id, command)
            }
          })
        })

      const recentCommands = recentSelectionIds
        .flatMap((id) => {
          const command = availableCommands.get(id)
          if (command == null) return []

          return [{
            ...command,
            id: `recent:${command.recentSelectionId ?? command.id}`,
            recentSelectionId: command.recentSelectionId ?? command.id
          }]
        })
        .slice(0, LAUNCHER_RECENT_SELECTION_DISPLAY_LIMIT)

      return [
        ...(recentCommands.length === 0
          ? []
          : [{
            commands: recentCommands,
            id: 'recent-selections',
            title: t('launcher.recentSelections.title')
          }]),
        ...sections,
        {
          commands: builtinCommands,
          id: 'builtin',
          title: t('launcher.builtin.title')
        }
      ].filter(section => section.commands.length > 0)
    }

    if (contextProject != null) {
      return withRecentSelectionsAndBuiltin([
        {
          commands: [
            {
              action: () => void openCurrentWorkspaceResource({ kind: 'new-session' }),
              badge: t('launcher.resource.tabBadge'),
              icon: 'forum',
              id: 'resource:new-session',
              keywords: ['session', 'chat', 'new', 'tab', '会话', '新建'],
              subtitle: t('launcher.resource.newSessionHint'),
              title: t('launcher.resource.newSession')
            },
            {
              action: () => void openCurrentWorkspaceResource({ kind: 'new-terminal' }),
              badge: t('launcher.resource.tabBadge'),
              icon: 'terminal',
              id: 'resource:new-terminal',
              keywords: ['terminal', 'shell', 'new', 'tab', '终端', '新建'],
              subtitle: t('launcher.resource.newTerminalHint'),
              title: t('launcher.resource.newTerminal')
            },
            {
              action: () => void openCurrentWorkspaceResource({ kind: 'new-website' }),
              badge: t('launcher.resource.tabBadge'),
              icon: 'language',
              id: 'resource:new-website',
              keywords: ['website', 'browser', 'web', 'url', 'new', 'tab', '网站', '浏览器'],
              subtitle: t('launcher.resource.newWebsiteHint'),
              title: t('launcher.resource.newWebsite')
            }
          ],
          id: 'create',
          title: t('launcher.resource.createTitle')
        },
        {
          commands: resourceResults.files
            .filter((file): file is DesktopWorkspaceResourceSearchResult & {
              directory: string
              name: string
              path: string
            } => (
              file.kind === 'file' &&
              typeof file.directory === 'string' &&
              typeof file.name === 'string' &&
              typeof file.path === 'string'
            ))
            .map((file) => {
              const icon = getProjectFileIconMeta(file.name)
              return {
                action: () => void openCurrentWorkspaceFile(file.path),
                badge: t('launcher.resource.fileBadge'),
                contextMenuItems: buildFileContextMenuItems(file.path),
                icon: icon.icon,
                iconTone: icon.tone,
                id: `file:${encodeURIComponent(file.path)}`,
                keywords: [file.name, file.path, file.directory],
                subtitle: file.directory || contextProject.description,
                title: file.name
              }
            }),
          id: 'files',
          title: t('launcher.files.title')
        },
        {
          commands: resourceResults.sessions
            .filter(resource => resource.kind === 'session' && typeof resource.sessionId === 'string')
            .map(resource => ({
              action: () =>
                void openCurrentWorkspaceResource({
                  kind: 'session',
                  sessionId: resource.sessionId,
                  title: resource.title ?? resource.sessionId
                }),
              badge: t('launcher.resource.sessionBadge'),
              icon: 'forum',
              id: resource.id,
              keywords: [resource.title ?? '', resource.subtitle ?? '', resource.sessionId ?? ''],
              subtitle: resource.subtitle ?? resource.sessionId,
              title: resource.title ?? resource.sessionId ?? ''
            })),
          id: 'sessions',
          title: t('launcher.resource.sessionsTitle')
        },
        {
          commands: resourceResults.websites
            .filter(resource => resource.kind === 'website' && typeof resource.url === 'string')
            .map(resource => ({
              action: () =>
                void openCurrentWorkspaceResource({
                  kind: 'website',
                  title: resource.title ?? resource.url,
                  url: resource.url
                }),
              badge: t('launcher.resource.websiteBadge'),
              icon: 'language',
              id: resource.id,
              keywords: [resource.title ?? '', resource.url ?? ''],
              subtitle: resource.url,
              title: resource.title ?? resource.url ?? ''
            })),
          id: 'websites',
          title: t('launcher.resource.websitesTitle')
        },
        {
          commands: resourceResults.terminals
            .filter(resource => resource.kind === 'terminal' && typeof resource.terminalId === 'string')
            .map(resource => ({
              action: () =>
                void openCurrentWorkspaceResource({
                  kind: 'terminal',
                  terminalId: resource.terminalId,
                  title: resource.title ?? resource.terminalId
                }),
              badge: t('launcher.resource.terminalBadge'),
              icon: 'terminal',
              id: resource.id,
              keywords: [resource.title ?? '', resource.terminalId ?? '', resource.shellKind ?? ''],
              subtitle: resource.shellKind ?? resource.terminalId,
              title: resource.title ?? resource.terminalId ?? ''
            })),
          id: 'terminals',
          title: t('launcher.resource.terminalsTitle')
        },
        {
          commands: pluginResults.map(result => ({
            action: () => void invokePluginLauncherResult(result.id),
            badge: result.badge ?? t('config.sections.plugins'),
            icon: result.icon ?? 'layers',
            id: `plugin:${encodeURIComponent(result.id)}`,
            keywords: [
              result.id,
              result.title,
              result.description ?? '',
              result.subtitle ?? '',
              ...(result.keywords ?? [])
            ],
            subtitle: result.description ?? result.subtitle,
            title: result.title
          })),
          id: 'plugins',
          title: t('config.sections.plugins')
        }
      ].filter(section => section.commands.length > 0))
    }

    const startCommands: LauncherCommand[] = [
      {
        action: enterCreateWorkspaceDirectoryMode,
        icon: 'create_new_folder',
        id: 'new-project-folder',
        keywords: ['new', 'create', 'project', 'folder', 'workspace', '新建', '创建', '项目', '文件夹'],
        subtitle: t('launcher.start.newProjectFolderHint'),
        title: t('launcher.start.newProjectFolder')
      },
      {
        action: enterOpenWorkspaceDirectoryMode,
        icon: 'folder_open',
        id: 'open-folder',
        keywords: ['folder', 'workspace', 'local'],
        subtitle: t('launcher.start.openFolderHint'),
        title: t('launcher.start.openFolder')
      }
    ]

    if (canCloneRepository) {
      startCommands.push({
        action: enterCloneRepositoryMode,
        icon: 'cloud_download',
        id: 'clone-repository',
        keywords: ['clone', 'git', 'repository', 'remote'],
        subtitle: t('launcher.start.cloneRepositoryHint'),
        title: t('launcher.start.cloneRepository')
      })
    }

    startCommands.push({
      action: showComingSoon,
      icon: 'hub',
      id: 'connect-remote-service',
      keywords: ['remote', 'service', 'server'],
      subtitle: t('launcher.start.connectRemoteServiceHint'),
      title: t('launcher.start.connectRemoteService')
    })

    const projectCommandEntries = [
      ...projects.map((project, index) => ({
        command: {
          action: () => void openWorkspace(project.workspaceFolder, project.name),
          contextMenuItems: buildProjectContextMenuItems(project),
          icon: getProjectStatusIcon(project.status),
          iconTone: getProjectStatusIconTone(project.status),
          id: `project:${encodeURIComponent(project.workspaceFolder)}`,
          automationPath: project.workspaceFolder,
          keywords: [project.name, project.description, project.workspaceFolder],
          removeAction: project.status == null ? () => confirmForgetWorkspace(project) : undefined,
          removeLabel: t('launcher.projects.remove'),
          subtitle: project.description,
          title: project.name
        } satisfies LauncherCommand,
        index,
        priority: project.status == null ? 1 : 0,
        sourceOrder: 0
      })),
      ...relayProjectGroups.flatMap((group, groupIndex) =>
        group.projects.map((project, projectIndex) => ({
          command: {
            action: () => {
              void openRemoteWorkspace(project)
            },
            icon: 'computer',
            iconTone: 'project-remote',
            id: project.id,
            keywords: [
              project.name,
              project.workspaceFolder,
              project.deviceName,
              project.deviceId,
              project.serverId,
              project.serverName
            ],
            subtitle: t('launcher.remoteProjects.subtitle', {
              device: project.deviceName,
              path: project.workspaceFolder
            }),
            title: project.name
          } satisfies LauncherCommand,
          index: projects.length + groupIndex * 1000 + projectIndex,
          priority: 0,
          sourceOrder: 1
        }))
      )
    ]
    const projectCommands = projectCommandEntries
      .sort((left, right) => {
        if (left.priority !== right.priority) return left.priority - right.priority
        const titleDelta = left.command.title.localeCompare(right.command.title, undefined, {
          numeric: true,
          sensitivity: 'base'
        })
        if (titleDelta !== 0) return titleDelta
        if (left.sourceOrder !== right.sourceOrder) return left.sourceOrder - right.sourceOrder
        const subtitleDelta = (left.command.subtitle ?? '').localeCompare(right.command.subtitle ?? '', undefined, {
          numeric: true,
          sensitivity: 'base'
        })
        if (subtitleDelta !== 0) return subtitleDelta
        return left.index - right.index
      })
      .map(entry => entry.command)

    return withRecentSelectionsAndBuiltin([
      {
        commands: startCommands,
        id: 'start',
        title: t('launcher.start.title')
      },
      {
        commands: projectCommands,
        id: 'projects',
        title: t('launcher.projects.title')
      }
    ])
  }, [
    activeDirectoryBrowserTarget,
    buildFileContextMenuItems,
    buildProjectContextMenuItems,
    builtinCommands,
    canCloneRepository,
    cloneDestinationList.currentDirectory,
    cloneDestinationList.directories,
    cloneDestinationList.parentDirectory,
    confirmForgetWorkspace,
    contextProject,
    directoryBrowserHomeDirectory,
    enterCloneRepositoryMode,
    enterCreateWorkspaceDirectoryMode,
    enterOpenWorkspaceDirectoryMode,
    favoriteCloneDestinationDirectories,
    fileSearchResults,
    handleCreateWorkspaceInDirectory,
    handleCloneRepository,
    handleOpenWorkspaceDirectory,
    invokePluginLauncherResult,
    isCreateWorkspaceDirectoryMode,
    isDirectoryBrowserMode,
    isCloneRepositoryMode,
    isFileSearchMode,
    launcherViewMode,
    isOpenWorkspaceDirectoryMode,
    filesystemManagerName,
    message,
    openCloneDestinationDirectory,
    openCurrentWorkspaceFile,
    openCurrentWorkspaceResource,
    openFileSearchItem,
    openWorkspace,
    projects,
    pluginResults,
    previewSections,
    query,
    recentCloneDestinationDirectories,
    recentSelectionIds,
    relayAccountSections,
    relayProjectGroups,
    revealFilesystemPath,
    resourceResults.files,
    resourceResults.sessions,
    resourceResults.terminals,
    resourceResults.websites,
    showComingSoon,
    openRemoteWorkspace,
    t,
    toggleCloneDestinationFavoriteDirectory
  ])

  const normalizedQuery = normalizePinyinSearchQuery(query)
  const filteredSections = useMemo(() => (
    commandSections
      .filter(section => shouldShowLauncherCommandSection(section.id, normalizedQuery))
      .map(section => ({
        ...section,
        commands: normalizedQuery === '' || isFileSearchMode || isCloneRepositoryMode
          ? section.commands
          : section.commands.filter((command) => {
            if (isDirectoryBrowserMode && (command.title === '.' || command.title === '..')) {
              return true
            }

            return matchesPinyinSearch(normalizedQuery, [
              command.title,
              command.subtitle ?? '',
              ...command.keywords
            ])
          })
      }))
      .filter(section => section.commands.length > 0)
  ), [commandSections, isCloneRepositoryMode, isDirectoryBrowserMode, isFileSearchMode, normalizedQuery])
  const flatCommands = useMemo(
    () => filteredSections.flatMap(section => section.commands),
    [filteredSections]
  )
  const activeCommand = useMemo(
    () => flatCommands.find(command => command.id === activeCommandId),
    [activeCommandId, flatCommands]
  )
  const isLauncherCommandListView = launcherViewMode === 'commands' ||
    launcherViewMode === 'account' ||
    launcherViewMode === 'preview'
  const directoryBreadcrumbs = useMemo(() => (
    isDirectoryBrowserMode
      ? buildDirectoryBreadcrumbs(cloneDestinationList.currentDirectory)
      : []
  ), [cloneDestinationList.currentDirectory, isDirectoryBrowserMode])

  useEffect(() => {
    if (flatCommands.length === 0) {
      setActiveCommandId(undefined)
      return
    }
    if (activeCommandId == null || !flatCommands.some(command => command.id === activeCommandId)) {
      setActiveCommandId(flatCommands[0]?.id)
    }
  }, [activeCommandId, flatCommands])

  useEffect(() => {
    if (!isLauncherCommandListView || activeCommandId == null) return

    const animationFrameId = window.requestAnimationFrame(() => {
      const listElement = commandListRef.current
      const activeElement = document.getElementById(activeCommandId)
      if (
        listElement == null ||
        !(activeElement instanceof HTMLElement) ||
        !listElement.contains(activeElement)
      ) {
        return
      }

      const listRect = listElement.getBoundingClientRect()
      const activeRect = activeElement.getBoundingClientRect()
      const scrollPadding = 6
      if (activeRect.top < listRect.top + scrollPadding) {
        listElement.scrollTop -= listRect.top + scrollPadding - activeRect.top
        return
      }
      if (activeRect.bottom > listRect.bottom - scrollPadding) {
        listElement.scrollTop += activeRect.bottom - listRect.bottom + scrollPadding
      }
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [activeCommandId, flatCommands, isLauncherCommandListView])

  const runCommand = useCallback((command?: LauncherCommand) => {
    if (command == null || openingWorkspace != null) return
    rememberLauncherSelection(command)
    void Promise.resolve(command.action()).catch((error) => {
      console.error('[launcher] command failed', error)
      void message.error(t('launcher.commandFailed'))
    })
  }, [message, openingWorkspace, rememberLauncherSelection, t])

  const runCommandAndSelect = useCallback((command?: LauncherCommand) => {
    if (command == null) return
    setActiveCommandId(command.id)
    runCommand(command)
  }, [runCommand])

  const runSecondaryCommandAndSelect = useCallback((command?: LauncherCommand) => {
    if (command?.secondaryAction == null) return
    setActiveCommandId(command.id)
    void Promise.resolve(command.secondaryAction()).catch((error) => {
      console.error('[launcher] secondary command failed', error)
      void message.error(t('launcher.commandFailed'))
    })
  }, [message, t])

  const getCommandActionLabel = useCallback((command: LauncherCommand) => {
    if (command.actionLabel === 'back') return t('launcher.footerHints.back')
    if (command.actionLabel === 'clone') return t('launcher.footerHints.clone')
    if (command.actionLabel === 'create') return t('launcher.footerHints.create')
    return t('launcher.footerHints.open')
  }, [t])

  const hideLauncherWindow = useCallback(() => {
    if (onClose != null) {
      onClose()
      return
    }

    void desktopApi?.hideLauncherWindow?.().catch((error) => {
      console.error('[launcher] failed to hide launcher window', error)
    })
  }, [desktopApi, onClose])

  const restoreSearchHistoryEntry = useCallback((entry: LauncherSearchHistoryEntry) => {
    const urlQuery = entry.directoryBrowserMode == null && !entry.isFileSearchMode ? entry.query : ''
    setLauncherViewModeWithUrl(entry.launcherViewMode, { query: urlQuery, replace: true })
    setDirectoryBrowserMode(entry.directoryBrowserMode)
    setDirectoryBrowserTargetId(entry.directoryBrowserTargetId ?? 'local')
    setCloneDestinationDirectory(entry.cloneDestinationDirectory)
    const historyDirectoryTargetId = entry.directoryBrowserTargetId
    const historyCloneDestinationDirectory = entry.cloneDestinationDirectory
    if (
      historyDirectoryTargetId != null &&
      historyCloneDestinationDirectory != null &&
      historyCloneDestinationDirectory.trim() !== ''
    ) {
      setDirectoryBrowserDirectoriesByTarget(prev =>
        prev[historyDirectoryTargetId] === historyCloneDestinationDirectory
          ? prev
          : {
            ...prev,
            [historyDirectoryTargetId]: historyCloneDestinationDirectory
          }
      )
    }
    setDirectoryBrowserHomeDirectory(entry.directoryBrowserHomeDirectory)
    if (entry.directoryBrowserMode == null) {
      setCloneDestinationList(emptyCloneDestinationDirectoryList)
      setIsCloneDestinationLoading(false)
      setHasCloneDestinationError(false)
    }
    setIsFileSearchMode(entry.isFileSearchMode)
    if (!entry.isFileSearchMode) {
      setFileSearchResults([])
      setIsFileSearchLoading(false)
      setHasFileSearchError(false)
    }
    setDismissedProjectContextFolder(entry.dismissedProjectContextFolder)
    setQuery(entry.query)
    setActiveCommandId(undefined)
    setIsLauncherMenuOpen(false)
    focusSearchInput()
  }, [focusSearchInput, setLauncherViewModeWithUrl])

  const navigateSearchHistory = useCallback((direction: -1 | 1) => {
    const history = searchHistoryRef.current
    const nextIndex = history.index + direction
    const nextEntry = history.entries[nextIndex]
    if (nextEntry == null) return false

    history.index = nextIndex
    restoreSearchHistoryEntry(nextEntry)
    return true
  }, [restoreSearchHistoryEntry])

  const currentLanguage = i18n.resolvedLanguage ?? i18n.language
  const activeLanguage = getActiveAppLanguageOption(currentLanguage)
  const menuIcon = (icon: string, isActive = false) => (
    <span className={`material-symbols-rounded launcher-command-menu__icon ${isActive ? 'is-active' : ''}`}>
      {icon}
    </span>
  )
  const launcherMenuItems = useMemo<MenuProps['items']>(() => [
    {
      icon: menuIcon('account_circle'),
      key: 'account',
      label: t('launcher.menu.account'),
      onClick: () => {
        openLauncherView('account')
      }
    },
    { type: 'divider' },
    {
      icon: menuIcon('settings'),
      key: 'settings',
      label: t('launcher.menu.settings'),
      onClick: () => {
        openLauncherView('settings')
      }
    },
    {
      icon: menuIcon('info'),
      key: 'about',
      label: t('launcher.menu.about'),
      onClick: () => {
        openLauncherView('about')
      }
    },
    {
      disabled: desktopApi?.checkForUpdates == null,
      icon: menuIcon('sync'),
      key: 'check-updates',
      label: t('launcher.menu.checkUpdate'),
      onClick: checkDesktopUpdates
    },
    { type: 'divider' },
    {
      icon: menuIcon('language'),
      key: 'language',
      label: t('launcher.menu.language'),
      popupClassName: 'launcher-command-dropdown launcher-command-menu-submenu',
      children: appLanguageOptions.map(option => ({
        icon: activeLanguage?.value === option.value
          ? menuIcon('check', true)
          : <span className='launcher-command-menu__icon-placeholder' />,
        key: `language:${option.value}`,
        label: option.label,
        onClick: () => {
          void updateGlobalInterfaceLanguage(option.value)
        }
      }))
    }
  ], [
    activeLanguage?.value,
    checkDesktopUpdates,
    desktopApi?.checkForUpdates,
    openLauncherView,
    t,
    updateGlobalInterfaceLanguage
  ])

  useEffect(() => {
    const unsubscribeViewShortcut = desktopApi?.onViewShortcut?.((action) => {
      if (isSearchInputComposing()) return
      if (action !== 'back' && action !== 'forward') return

      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement && activeElement.closest('.config-shortcut-input') != null) {
        return
      }

      navigateSearchHistory(action === 'forward' ? 1 : -1)
    })

    return () => {
      unsubscribeViewShortcut?.()
    }
  }, [
    desktopApi,
    isSearchInputComposing,
    navigateSearchHistory
  ])

  useEffect(() => {
    if (!active) return

    const handleLauncherKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isImeCompositionKeyEvent(event, isSearchInputComposing())) {
        return
      }

      if (openingWorkspace != null) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (
          event.key === '[' ||
          event.key === ']' ||
          event.code === 'BracketLeft' ||
          event.code === 'BracketRight'
        )
      ) {
        const target = event.target
        if (target instanceof HTMLElement && target.closest('.config-shortcut-input') != null) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        navigateSearchHistory(
          event.key === ']' || event.code === 'BracketRight' ? 1 : -1
        )
        return
      }

      if ((event.metaKey && (event.key === ',' || event.code === 'Comma'))) {
        const target = event.target
        if (target instanceof HTMLElement && target.closest('.config-shortcut-input') != null) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        openLauncherView('settings')
        return
      }

      if (event.key !== 'Escape') return

      event.preventDefault()
      if (exitDirectoryBrowserMode()) {
        event.stopPropagation()
        return
      }

      if (exitFileSearchMode()) {
        event.stopPropagation()
        return
      }

      if (launcherViewMode !== 'commands') {
        setLauncherViewModeWithUrl('commands', { query: '', replace: true })
        focusSearchInput()
        event.stopPropagation()
        return
      }
      if (exitProjectContext()) {
        event.stopPropagation()
        return
      }
      hideLauncherWindow()
    }

    window.addEventListener('keydown', handleLauncherKeyDown)
    return () => {
      window.removeEventListener('keydown', handleLauncherKeyDown)
    }
  }, [
    exitFileSearchMode,
    exitDirectoryBrowserMode,
    exitProjectContext,
    focusSearchInput,
    hideLauncherWindow,
    active,
    isSearchInputComposing,
    launcherViewMode,
    navigateSearchHistory,
    openLauncherView,
    setLauncherViewModeWithUrl,
    openingWorkspace
  ])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeCompositionKeyEvent(event, isSearchInputComposing())) {
      return
    }

    if (openingWorkspace != null) {
      event.preventDefault()
      return
    }

    const isEmptyDeleteKey = (event.key === 'Backspace' || event.key === 'Delete') && query === ''
    if (!isLauncherCommandListView) {
      if (isEmptyDeleteKey) {
        event.preventDefault()
        setLauncherViewModeWithUrl('commands', { query: '', replace: true })
        focusSearchInput()
      }
      return
    }

    if (launcherViewMode !== 'commands') {
      if (isEmptyDeleteKey) {
        event.preventDefault()
        setLauncherViewModeWithUrl('commands', { query: '', replace: true })
        focusSearchInput()
        return
      }

      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Enter'
      ) {
        return
      }

      event.preventDefault()
      if (flatCommands.length === 0) return

      const activeIndex = Math.max(0, flatCommands.findIndex(command => command.id === activeCommandId))
      if (event.key === 'Enter') {
        runCommand(flatCommands[activeIndex])
        return
      }

      const offset = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = (activeIndex + offset + flatCommands.length) % flatCommands.length
      setActiveCommandId(flatCommands[nextIndex]?.id)
      return
    }

    const hasTextSelection = event.currentTarget.selectionStart !== event.currentTarget.selectionEnd
    if (
      event.key === '/' &&
      query === '' &&
      !isFileSearchMode &&
      !isDirectoryBrowserMode &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !hasTextSelection
    ) {
      event.preventDefault()
      setIsFileSearchMode(true)
      setActiveCommandId(undefined)
      setResourceResults(emptyWorkspaceResourceSearchResponse)
      setIsResourceSearchLoading(false)
      setHasResourceSearchError(false)
      return
    }

    if (isEmptyDeleteKey) {
      if (exitDirectoryBrowserMode() || exitFileSearchMode() || exitProjectContext()) {
        event.preventDefault()
        return
      }
    }

    if (
      isDirectoryBrowserMode &&
      event.key === 'ArrowLeft' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      const parentDirectory = cloneDestinationList.parentDirectory?.trim()
      if (
        parentDirectory == null ||
        parentDirectory === '' ||
        normalizeDirectoryPathKey(parentDirectory) === normalizeDirectoryPathKey(cloneDestinationList.currentDirectory)
      ) {
        return
      }

      event.preventDefault()
      openCloneDestinationDirectory(parentDirectory)
      return
    }

    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Enter' &&
      !(isDirectoryBrowserMode && event.key === 'ArrowRight')
    ) {
      return
    }

    event.preventDefault()
    if (flatCommands.length === 0) return

    const activeIndex = Math.max(0, flatCommands.findIndex(command => command.id === activeCommandId))
    if (event.key === 'Enter') {
      runCommand(flatCommands[activeIndex])
      return
    }
    if (event.key === 'ArrowRight') {
      runSecondaryCommandAndSelect(flatCommands[activeIndex])
      return
    }

    const offset = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (activeIndex + offset + flatCommands.length) % flatCommands.length
    setActiveCommandId(flatCommands[nextIndex]?.id)
  }
  const emptyMessage = launcherViewMode === 'account'
    ? hasRelayAccountError
      ? t('launcher.account.loadFailed')
      : isRelayAccountLoading
      ? t('launcher.account.loading')
      : t('launcher.account.empty')
    : launcherViewMode === 'preview'
    ? t('launcher.preview.empty')
    : isDirectoryBrowserMode
    ? hasCloneDestinationError
      ? t('launcher.directoryBrowserFailed')
      : isCloneDestinationLoading
      ? t('launcher.directoryBrowserLoading')
      : t('launcher.directoryBrowserEmpty')
    : isFileSearchMode
    ? hasFileSearchError
      ? t('launcher.files.searchFailed')
      : isFileSearchLoading
      ? t('launcher.files.searching')
      : normalizedQuery === ''
      ? contextProject == null
        ? t('launcher.files.globalInputHint')
        : t('launcher.files.inputHint')
      : t('launcher.files.noResults')
    : contextProject == null
    ? t('launcher.noResults')
    : hasResourceSearchError
    ? t('launcher.files.searchFailed')
    : isResourceSearchLoading
    ? t('launcher.files.searching')
    : normalizedQuery === ''
    ? t('launcher.files.inputHint')
    : t('launcher.files.noResults')
  const searchPlaceholder = contextProject == null
    ? t('launcher.searchPlaceholder')
    : t('launcher.resource.searchPlaceholder', { project: contextProject.name })
  const viewSearchPlaceholder = launcherViewMode === 'account'
    ? t('launcher.account.searchPlaceholder')
    : launcherViewMode === 'preview'
    ? t('launcher.preview.searchPlaceholder')
    : launcherViewMode === 'settings'
    ? t('launcher.settings.searchPlaceholder')
    : launcherViewMode === 'about'
    ? t('launcher.about.searchPlaceholder')
    : isCloneRepositoryMode
    ? t('launcher.cloneRepositoryUrlPlaceholder')
    : isCreateWorkspaceDirectoryMode
    ? t('launcher.createWorkspaceNamePlaceholder')
    : isOpenWorkspaceDirectoryMode
    ? t('launcher.openWorkspaceSearchPlaceholder')
    : isFileSearchMode
    ? contextProject == null
      ? t('launcher.files.globalSearchPlaceholder')
      : t('launcher.files.searchPlaceholder', { project: contextProject.name })
    : searchPlaceholder
  const viewSearchLabel = launcherViewMode === 'account'
    ? t('launcher.account.searchLabel')
    : launcherViewMode === 'preview'
    ? t('launcher.preview.searchLabel')
    : launcherViewMode === 'settings'
    ? t('launcher.settings.searchLabel')
    : launcherViewMode === 'about'
    ? t('launcher.about.searchLabel')
    : isCloneRepositoryMode
    ? t('launcher.cloneRepositorySearchLabel')
    : isCreateWorkspaceDirectoryMode
    ? t('launcher.createWorkspaceNameSearchLabel')
    : isOpenWorkspaceDirectoryMode
    ? t('launcher.openWorkspaceSearchLabel')
    : isFileSearchMode
    ? t('launcher.files.searchLabel')
    : t('launcher.searchLabel')
  const viewLeadingIconTooltip = launcherViewMode === 'account'
    ? t('launcher.account.title')
    : launcherViewMode === 'preview'
    ? t('launcher.preview.title')
    : launcherViewMode === 'settings'
    ? t('launcher.settings.title')
    : launcherViewMode === 'about'
    ? t('launcher.about.title')
    : isDirectoryBrowserMode
    ? t('launcher.directoryBrowserTooltip', { path: cloneDestinationList.currentDirectory })
    : isFileSearchMode
    ? contextProject == null
      ? t('launcher.files.globalTitle')
      : contextProject.name
    : contextProject?.name
  const viewLeadingIcon = launcherViewMode === 'account'
    ? 'account_circle'
    : launcherViewMode === 'preview'
    ? 'preview'
    : launcherViewMode === 'settings'
    ? 'settings'
    : launcherViewMode === 'about'
    ? 'info'
    : isCloneRepositoryMode
    ? 'cloud_download'
    : isCreateWorkspaceDirectoryMode
    ? 'create_new_folder'
    : isOpenWorkspaceDirectoryMode
    ? 'folder_open'
    : isFileSearchMode
    ? '/'
    : contextProject == null
    ? undefined
    : 'folder'
  const operationHints = launcherViewMode === 'commands'
    ? isDirectoryBrowserMode
      ? [
        flatCommands.length > 1 ? { key: 'move', keys: '↑↓', label: t('launcher.footerHints.move') } : undefined,
        activeCommand != null
          ? {
            key: 'primary-action',
            keys: 'Enter',
            label: activeCommand.actionLabel === 'back'
              ? t('launcher.footerHints.back')
              : activeCommand.actionLabel === 'clone'
              ? t('launcher.footerHints.clone')
              : activeCommand.actionLabel === 'create'
              ? t('launcher.footerHints.create')
              : t('launcher.footerHints.open')
          }
          : undefined,
        activeCommand?.secondaryAction != null
          ? { key: 'secondary-action', keys: '→', label: t('launcher.footerHints.openDirectory') }
          : undefined,
        { key: 'escape-back', keys: 'Esc', label: t('launcher.footerHints.back') }
      ].filter((hint): hint is { key: string; keys: string; label: string } => hint != null)
      : [
        flatCommands.length > 1 ? { key: 'move', keys: '↑↓', label: t('launcher.footerHints.move') } : undefined,
        activeCommand != null
          ? { key: 'primary-action', keys: 'Enter', label: t('launcher.footerHints.open') }
          : undefined,
        activeCommand?.contextMenuItems != null
          ? { key: 'context', keys: t('launcher.footerHints.contextKey'), label: t('launcher.footerHints.context') }
          : undefined,
        !isFileSearchMode ? { key: 'files', keys: '/', label: t('launcher.footerHints.fileSearch') } : undefined,
        {
          key: 'escape',
          keys: 'Esc',
          label: isFileSearchMode || contextProject != null
            ? t('launcher.footerHints.back')
            : t('launcher.footerHints.close')
        }
      ].filter((hint): hint is { key: string; keys: string; label: string } => hint != null)
    : launcherViewMode === 'account' || launcherViewMode === 'preview'
    ? [
      flatCommands.length > 1 ? { key: 'move', keys: '↑↓', label: t('launcher.footerHints.move') } : undefined,
      activeCommand != null
        ? { key: 'open', keys: 'Enter', label: t('launcher.footerHints.open') }
        : undefined,
      { key: 'back', keys: 'Esc', label: t('launcher.footerHints.back') }
    ].filter((hint): hint is { key: string; keys: string; label: string } => hint != null)
    : launcherViewMode === 'settings'
    ? settingsOperationHints
    : [
      { key: 'back', keys: 'Esc', label: t('launcher.footerHints.back') }
    ]

  return (
    <main
      className={`launcher-route ${openingWorkspace != null ? 'is-opening-workspace' : ''}`}
      aria-busy={openingWorkspace != null}
    >
      <div className='launcher-command-shell'>
        <div className='launcher-command-search'>
          <div className='launcher-command-search__input-row'>
            {viewLeadingIcon != null && (
              <Tooltip
                align={{ offset: [-10, 6] }}
                autoAdjustOverflow
                classNames={{ root: 'launcher-command-tooltip launcher-command-search__icon-tooltip' }}
                getPopupContainer={getLauncherPopupContainer}
                placement='bottomLeft'
                title={viewLeadingIconTooltip}
              >
                <span
                  className={[
                    'launcher-command-search__file-icon',
                    isFileSearchMode ? 'launcher-command-search__slash-icon' : 'material-symbols-rounded'
                  ].join(' ')}
                  aria-label={viewLeadingIconTooltip}
                >
                  {viewLeadingIcon}
                </span>
              </Tooltip>
            )}
            <input
              ref={searchInputRef}
              aria-activedescendant={activeCommandId}
              aria-label={viewSearchLabel}
              className='launcher-command-search__input'
              placeholder={viewSearchPlaceholder}
              value={query}
              onChange={event => setLauncherQueryWithUrl(event.target.value)}
              onCompositionEnd={() =>
                deferImeCompositionEnd((active) => {
                  isSearchComposingRef.current = active
                })}
              onCompositionStart={() => {
                isSearchComposingRef.current = true
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>

        <div
          ref={commandListRef}
          className='launcher-command-list'
          role={isLauncherCommandListView ? 'listbox' : undefined}
          aria-label={launcherViewMode === 'account'
            ? t('launcher.account.listLabel')
            : launcherViewMode === 'preview'
            ? t('launcher.preview.listLabel')
            : launcherViewMode === 'settings'
            ? t('launcher.settings.listLabel')
            : launcherViewMode === 'about'
            ? t('launcher.about.listLabel')
            : t('launcher.commandListLabel')}
        >
          {launcherViewMode === 'settings' && (
            <LauncherSettingsView
              query={query}
              isSearchInputComposing={isSearchInputComposing}
              onKeyboardHintsChange={setSettingsOperationHints}
              onResetActionChange={setSettingsResetAction}
            />
          )}
          {launcherViewMode === 'about' && (
            <LauncherAboutView />
          )}
          {isLauncherCommandListView && isDirectoryBrowserMode && visibleDirectoryBrowserTargets.length > 1 && (
            <div
              className='launcher-directory-target-tabs'
              role='tablist'
              aria-label={t('launcher.directoryTargets.label')}
            >
              {visibleDirectoryBrowserTargets.map(target => {
                const isActive = target.id === activeDirectoryBrowserTarget?.id
                return (
                  <button
                    key={target.id}
                    type='button'
                    role='tab'
                    aria-selected={isActive}
                    className={`launcher-directory-target-tab ${isActive ? 'is-active' : ''}`}
                    title={target.kind === 'relay'
                      ? `${target.deviceName} · ${target.serverName}`
                      : target.label}
                    onClick={() => selectDirectoryBrowserTarget(target)}
                  >
                    <span className='material-symbols-rounded' aria-hidden='true'>
                      {target.kind === 'relay' ? 'computer' : 'radio_button_checked'}
                    </span>
                    <span className='launcher-directory-target-tab__label'>{target.label}</span>
                  </button>
                )
              })}
            </div>
          )}
          {isLauncherCommandListView && isDirectoryBrowserMode && directoryBreadcrumbs.length > 0 && (
            <nav className='launcher-directory-breadcrumb' aria-label={t('launcher.directoryBreadcrumbLabel')}>
              {cloneDestinationList.parentDirectory != null && (
                <Tooltip
                  classNames={{ root: 'launcher-command-tooltip' }}
                  getPopupContainer={getLauncherPopupContainer}
                  placement='bottomLeft'
                  title={t('launcher.footerHints.back')}
                >
                  <button
                    type='button'
                    className='launcher-directory-breadcrumb__back'
                    title={cloneDestinationList.parentDirectory}
                    aria-label={t('launcher.footerHints.back')}
                    onClick={() => openCloneDestinationDirectory(cloneDestinationList.parentDirectory)}
                  >
                    <span className='material-symbols-rounded' aria-hidden='true'>arrow_back</span>
                  </button>
                </Tooltip>
              )}
              {directoryBreadcrumbs.map((breadcrumb, index) => {
                const isCurrent = index === directoryBreadcrumbs.length - 1
                return (
                  <span className='launcher-directory-breadcrumb__part' key={`${breadcrumb.path}:${index}`}>
                    <button
                      type='button'
                      className={`launcher-directory-breadcrumb__button ${isCurrent ? 'is-current' : ''}`}
                      title={breadcrumb.path}
                      aria-current={isCurrent ? 'location' : undefined}
                      onClick={() => openCloneDestinationDirectory(breadcrumb.path)}
                    >
                      {breadcrumb.label}
                    </button>
                    {!isCurrent && (
                      <span
                        className='material-symbols-rounded launcher-directory-breadcrumb__separator'
                        aria-hidden='true'
                      >
                        chevron_right
                      </span>
                    )}
                  </span>
                )
              })}
            </nav>
          )}
          {isLauncherCommandListView && filteredSections.map(section => (
            <section className='launcher-command-section' key={section.id}>
              {section.title !== '' && (
                <h2 className='launcher-command-section__title'>{section.title}</h2>
              )}
              <div className='launcher-command-section__items'>
                {section.commands.map(command => {
                  const commandActionLabel = getCommandActionLabel(command)
                  const commandSecondaryActionLabel = t('launcher.footerHints.openDirectory')
                  const commandItem = (
                    <div
                      className={`launcher-command-item ${command.id === activeCommandId ? 'is-active' : ''}`}
                      id={command.id}
                      key={command.id}
                      role='option'
                      data-launcher-command-action-label={command.actionLabel}
                      data-launcher-command-id={command.id}
                      data-launcher-command-path={command.automationPath}
                      data-launcher-command-title={command.title}
                      aria-selected={command.id === activeCommandId}
                      onMouseDown={(event) => {
                        if (event.button === 0) {
                          event.preventDefault()
                        }
                      }}
                      onClick={() => {
                        setActiveCommandId(command.id)
                      }}
                    >
                      {command.avatarUrl != null || command.avatarInitials != null
                        ? (
                          <span className='launcher-command-item__avatar' aria-hidden='true'>
                            {command.avatarUrl != null && (
                              <img src={command.avatarUrl} alt='' />
                            )}
                            {command.avatarUrl == null && command.avatarInitials != null && (
                              <span>{command.avatarInitials}</span>
                            )}
                          </span>
                        )
                        : (
                          <span
                            className={`material-symbols-rounded launcher-command-item__icon ${
                              command.iconTone == null ? '' : `is-${command.iconTone}`
                            }`}
                          >
                            {command.icon}
                          </span>
                        )}
                      <span className='launcher-command-item__content'>
                        <span className='launcher-command-item__title'>{command.title}</span>
                        {command.subtitle != null && command.subtitle !== '' && (
                          <span className='launcher-command-item__subtitle'>{command.subtitle}</span>
                        )}
                      </span>
                      {command.badge != null && command.badge !== '' && (
                        <span className='launcher-command-item__badge'>{command.badge}</span>
                      )}
                      {command.removeAction != null && (
                        <Tooltip
                          classNames={{ root: 'launcher-command-tooltip' }}
                          getPopupContainer={getLauncherPopupContainer}
                          placement='left'
                          title={command.removeLabel}
                        >
                          <button
                            type='button'
                            className='launcher-command-item__remove'
                            aria-label={command.removeLabel}
                            tabIndex={-1}
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setActiveCommandId(command.id)
                              void Promise.resolve(command.removeAction?.()).catch((error) => {
                                console.error('[launcher] remove command failed', error)
                                void message.error(t('launcher.commandFailed'))
                              })
                            }}
                          >
                            <span className='material-symbols-rounded'>close</span>
                          </button>
                        </Tooltip>
                      )}
                      {command.favoriteAction != null && (
                        <Tooltip
                          classNames={{ root: 'launcher-command-tooltip' }}
                          getPopupContainer={getLauncherPopupContainer}
                          placement='left'
                          title={command.favoriteLabel}
                        >
                          <button
                            type='button'
                            className={[
                              'launcher-command-item__favorite',
                              command.isFavorite === true ? 'is-active' : ''
                            ].filter(Boolean).join(' ')}
                            aria-label={command.favoriteLabel}
                            aria-pressed={command.isFavorite === true}
                            tabIndex={-1}
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              command.favoriteAction?.()
                            }}
                          >
                            <span className='material-symbols-rounded'>
                              {command.isFavorite === true ? 'star' : 'star_outline'}
                            </span>
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip
                        classNames={{ root: 'launcher-command-tooltip' }}
                        getPopupContainer={getLauncherPopupContainer}
                        placement='left'
                        title={commandActionLabel}
                      >
                        <button
                          type='button'
                          className='launcher-command-item__action launcher-command-item__enter'
                          aria-label={commandActionLabel}
                          tabIndex={-1}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            runCommandAndSelect(command)
                          }}
                        >
                          <span className='material-symbols-rounded'>keyboard_return</span>
                        </button>
                      </Tooltip>
                      {command.secondaryAction != null && (
                        <Tooltip
                          classNames={{ root: 'launcher-command-tooltip' }}
                          getPopupContainer={getLauncherPopupContainer}
                          placement='left'
                          title={commandSecondaryActionLabel}
                        >
                          <button
                            type='button'
                            className='launcher-command-item__action launcher-command-item__secondary'
                            aria-label={commandSecondaryActionLabel}
                            tabIndex={-1}
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              runSecondaryCommandAndSelect(command)
                            }}
                          >
                            <span className='material-symbols-rounded'>chevron_right</span>
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  )

                  if (command.contextMenuItems == null) {
                    return commandItem
                  }

                  return (
                    <Dropdown
                      key={command.id}
                      trigger={['contextMenu']}
                      menu={{ items: command.contextMenuItems }}
                      overlayClassName='launcher-command-dropdown launcher-command-context-menu'
                      getPopupContainer={getLauncherPopupContainer}
                    >
                      {commandItem}
                    </Dropdown>
                  )
                })}
              </div>
            </section>
          ))}
          {isLauncherCommandListView && flatCommands.length === 0 && (
            <div
              className='launcher-command-empty'
              role='status'
              aria-atomic='true'
              aria-live='polite'
            >
              {emptyMessage}
            </div>
          )}
        </div>

        <div className='launcher-command-footer'>
          <div className='launcher-command-footer__group'>
            <Dropdown
              trigger={['click']}
              placement='topLeft'
              menu={{ items: launcherMenuItems, triggerSubMenuAction: 'click' }}
              overlayClassName='launcher-command-dropdown launcher-command-brand-menu'
              getPopupContainer={getLauncherPopupContainer}
              open={isLauncherMenuOpen}
              onOpenChange={setIsLauncherMenuOpen}
            >
              <button
                className={`launcher-command-footer__brand ${isLauncherMenuOpen ? 'is-open' : ''}`}
                type='button'
                aria-label={t('launcher.menu.open')}
                aria-haspopup='menu'
                aria-expanded={isLauncherMenuOpen}
              >
                <img
                  className='launcher-command-footer__brand-image'
                  src={launcherIconSrc}
                  alt=''
                  aria-hidden='true'
                  draggable={false}
                />
              </button>
            </Dropdown>
          </div>
          <div className='launcher-command-footer__right'>
            <div className='launcher-command-footer__hints' aria-label={t('launcher.footerHints.label')}>
              {operationHints.map(hint => (
                <span className='launcher-command-footer__hint' key={hint.key}>
                  <kbd>{hint.keys}</kbd>
                  <span>{hint.label}</span>
                </span>
              ))}
            </div>
            {launcherViewMode === 'settings' && settingsResetAction != null && (
              <button
                type='button'
                className='launcher-command-footer__hint launcher-command-footer__reset-section'
                disabled={settingsResetAction.disabled}
                aria-label={settingsResetAction.ariaLabel}
                title={settingsResetAction.ariaLabel}
                onClick={settingsResetAction.onClick}
              >
                <kbd>
                  <span className='material-symbols-rounded' aria-hidden='true'>refresh</span>
                </kbd>
                <span>{settingsResetAction.label}</span>
              </button>
            )}
          </div>
        </div>
      </div>
      {openingWorkspace != null && (
        <WorkspaceOpeningOverlay
          appearance={resolvedThemeMode}
          subtitle={openingWorkspace.path}
          title={t('launcher.openingProjectTitle', { name: openingWorkspace.name })}
        />
      )}
    </main>
  )
}
