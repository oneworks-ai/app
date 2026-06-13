/* eslint-disable max-lines -- launcher route keeps command palette data flow and keyboard handling together. */
import './LauncherRoute.scss'

import { App, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_ICON_THEME } from '@oneworks/icon/presets'
import { matchesPinyinSearch, normalizePinyinSearchQuery } from '@oneworks/utils/pinyin-search'

import { getApiErrorMessage } from '#~/api'
import {
  createLauncherWorkspaceInDirectory,
  forgetLauncherWorkspace,
  getLauncherWorkspaceSelectorState,
  listLauncherDirectories,
  openLauncherWorkspace
} from '#~/api/launcher'
import { LauncherAboutView } from '#~/components/launcher/LauncherAboutView'
import { LauncherSettingsView } from '#~/components/launcher/LauncherSettingsView'
import type { LauncherKeyboardHint, LauncherSettingsResetAction } from '#~/components/launcher/LauncherSettingsView'
import { getProjectFileIconMeta } from '#~/components/workspace/project-file-tree/project-file-tree-icons'
import { useInterfaceLanguageConfig } from '#~/hooks/use-interface-language-config'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { appLanguageOptions, getActiveAppLanguageOption } from '#~/i18n'
import { buildWorkspaceClientBase, isServerManagerRole, mergeRuntimeEnv } from '#~/runtime-config'
import { copyTextWithFeedback } from '#~/utils/copy'
import { deferImeCompositionEnd, isImeCompositionKeyEvent } from '#~/utils/keyboard-events'
import { createOneWorksIconDataUri } from '#~/utils/oneworks-icon'
import { resolveWorkspaceFileOpenerSelectModels } from '#~/utils/workspace-file-openers'
import { normalizePluginLauncherSearchResults } from './launcher-plugin-search'

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
const CLONE_DESTINATION_FAVORITE_LIMIT = 24
const CLONE_DESTINATION_RECENT_LIMIT = 12
const CLONE_DESTINATION_FAVORITES_STORAGE_KEY = 'oneworks_launcher_clone_destination_favorites'
const CLONE_DESTINATION_RECENTS_STORAGE_KEY = 'oneworks_launcher_clone_destination_directories'
const cloneRepositoryMessageKey = 'launcher-clone-repository'

type LauncherDirectoryBrowserMode = 'clone' | 'create-workspace' | 'open-workspace'

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
  secondaryAction?: () => Promise<void> | void
  subtitle?: string
  title: string
}

interface LauncherCommandSection {
  commands: LauncherCommand[]
  id: string
  title: string
}

type LauncherViewMode = 'about' | 'commands' | 'settings'

interface LauncherSearchHistoryEntry {
  cloneDestinationDirectory?: string
  directoryBrowserHomeDirectory?: string
  directoryBrowserMode?: LauncherDirectoryBrowserMode
  dismissedProjectContextFolder?: string
  isFileSearchMode: boolean
  launcherViewMode: LauncherViewMode
  query: string
}

interface LauncherSearchHistoryState {
  entries: LauncherSearchHistoryEntry[]
  index: number
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
  const { message, modal } = App.useApp()
  const [selectorState, setSelectorState] = useState<DesktopWorkspaceSelectorState>(emptyWorkspaceSelectorState)
  const [query, setQuery] = useState('')
  const [activeCommandId, setActiveCommandId] = useState<string>()
  const [canCloneRepository, setCanCloneRepository] = useState(false)
  const [directoryBrowserMode, setDirectoryBrowserMode] = useState<LauncherDirectoryBrowserMode>()
  const [directoryBrowserHomeDirectory, setDirectoryBrowserHomeDirectory] = useState<string>()
  const [cloneDestinationDirectory, setCloneDestinationDirectory] = useState<string>()
  const [cloneDestinationList, setCloneDestinationList] = useState<DesktopCloneDestinationDirectoryList>(
    emptyCloneDestinationDirectoryList
  )
  const [recentCloneDestinationDirectories, setRecentCloneDestinationDirectories] = useState(() =>
    getStoredCloneDestinationDirectories()
  )
  const [favoriteCloneDestinationDirectories, setFavoriteCloneDestinationDirectories] = useState(() =>
    getStoredCloneDestinationFavoriteDirectories()
  )
  const [isCloneDestinationLoading, setIsCloneDestinationLoading] = useState(false)
  const [hasCloneDestinationError, setHasCloneDestinationError] = useState(false)
  const [resourceResults, setResourceResults] = useState<DesktopWorkspaceResourceSearchResponse>(
    emptyWorkspaceResourceSearchResponse
  )
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
  const [launcherViewMode, setLauncherViewMode] = useState<LauncherViewMode>('commands')
  const [settingsOperationHints, setSettingsOperationHints] = useState<LauncherKeyboardHint[]>([])
  const [settingsResetAction, setSettingsResetAction] = useState<LauncherSettingsResetAction>()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const commandListRef = useRef<HTMLDivElement>(null)
  const searchHistoryRef = useRef<LauncherSearchHistoryState>({
    entries: [initialLauncherSearchHistoryEntry],
    index: 0
  })
  const isLauncherActiveRef = useRef(active)
  const isSearchComposingRef = useRef(false)
  const isSearchInputComposing = useCallback(() => isSearchComposingRef.current, [])
  const desktopApi = window.oneworksDesktop
  const canUseServerLauncher = desktopApi == null && isServerManagerRole()
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
  const injectedWorkspaceContext = useMemo(() => {
    if (workspaceContext == null || workspaceContext.workspaceFolder.trim() === '') return undefined

    return {
      ...workspaceContext,
      isCurrent: true,
      status: workspaceContext.status ?? 'ready'
    } satisfies DesktopWorkspaceSelectorProject
  }, [workspaceContext])
  const projects = useMemo(() => {
    const mergedProjects = mergeProjects(selectorState)
    if (injectedWorkspaceContext == null) {
      return mergedProjects
    }

    const injectedWorkspaceKey = normalizeDirectoryPathKey(injectedWorkspaceContext.workspaceFolder)
    return [
      injectedWorkspaceContext,
      ...mergedProjects.filter(project => normalizeDirectoryPathKey(project.workspaceFolder) !== injectedWorkspaceKey)
    ]
  }, [injectedWorkspaceContext, selectorState])
  const currentProject = useMemo(
    () => projects.find(project => project.isCurrent === true),
    [projects]
  )
  const contextProject = useMemo(() => (
    currentProject?.workspaceFolder === dismissedProjectContextFolder ? undefined : currentProject
  ), [currentProject, dismissedProjectContextFolder])
  const currentSearchHistoryEntry = useMemo<LauncherSearchHistoryEntry>(() => ({
    ...(cloneDestinationDirectory == null ? {} : { cloneDestinationDirectory }),
    ...(directoryBrowserHomeDirectory == null ? {} : { directoryBrowserHomeDirectory }),
    ...(directoryBrowserMode == null ? {} : { directoryBrowserMode }),
    ...(dismissedProjectContextFolder == null ? {} : { dismissedProjectContextFolder }),
    isFileSearchMode,
    launcherViewMode,
    query
  }), [
    cloneDestinationDirectory,
    directoryBrowserHomeDirectory,
    directoryBrowserMode,
    dismissedProjectContextFolder,
    isFileSearchMode,
    launcherViewMode,
    query
  ])
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
    let disposed = false
    const statePromise = desktopApi?.getWorkspaceSelectorState?.() ??
      (canUseServerLauncher ? getLauncherWorkspaceSelectorState() : undefined)
    if (statePromise != null) {
      void statePromise.then((state) => {
        if (!disposed) {
          setSelectorState(normalizeWorkspaceSelectorState(state))
          setDismissedProjectContextFolder(undefined)
        }
      })
        .catch((error) => {
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
  }, [canUseServerLauncher, desktopApi])

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
    if (!active) return

    focusSearchInput()
  }, [active, focusSearchInput])

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

    const listCloneDestinationDirectories = desktopApi?.listCloneDestinationDirectories ??
      (canUseServerLauncher ? listLauncherDirectories : undefined)
    if (listCloneDestinationDirectories == null) {
      setCloneDestinationList(emptyCloneDestinationDirectoryList)
      setIsCloneDestinationLoading(false)
      setHasCloneDestinationError(true)
      return
    }

    let disposed = false
    setIsCloneDestinationLoading(true)
    setHasCloneDestinationError(false)
    void listCloneDestinationDirectories(cloneDestinationDirectory)
      .then((value) => {
        if (disposed) return
        const nextList = normalizeCloneDestinationDirectoryList(value)
        setCloneDestinationList(nextList)
        setCloneDestinationDirectory(prev => prev === nextList.currentDirectory ? prev : nextList.currentDirectory)
        setDirectoryBrowserHomeDirectory(prev => prev ?? nextList.currentDirectory)
      })
      .catch((error) => {
        if (disposed) return
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
  }, [canUseServerLauncher, cloneDestinationDirectory, desktopApi, isDirectoryBrowserMode])

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

  const openWorkspace = useCallback(async (workspaceFolder: string) => {
    try {
      if (desktopApi?.openWorkspace != null) {
        await desktopApi.openWorkspace(workspaceFolder)
        return
      }

      if (canUseServerLauncher) {
        const result = await openLauncherWorkspace(workspaceFolder)
        const workspaceClientBase = buildWorkspaceClientBase(result.workspaceId)
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
    } catch (error) {
      console.error('[launcher] failed to open workspace', error)
      void message.error(t('launcher.openWorkspaceFailed'))
    }
  }, [
    canUseServerLauncher,
    desktopApi,
    message,
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

  const enterCloneRepositoryMode = useCallback(() => {
    if (!canCloneRepository || desktopApi?.cloneRepository == null) {
      showDesktopActionUnavailable()
      return
    }

    setLauncherViewMode('commands')
    setDirectoryBrowserMode('clone')
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
    showDesktopActionUnavailable
  ])

  const enterCreateWorkspaceDirectoryMode = useCallback(() => {
    const canCreateWorkspace = desktopApi?.createWorkspaceInDirectory != null || canUseServerLauncher
    const canListDirectories = desktopApi?.listCloneDestinationDirectories != null || canUseServerLauncher
    if (!canListDirectories || !canCreateWorkspace) {
      showDesktopActionUnavailable()
      return
    }

    setLauncherViewMode('commands')
    setDirectoryBrowserMode('create-workspace')
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
    setCloneDestinationDirectory(recentCloneDestinationDirectories[0] ?? projects[0]?.workspaceFolder)
    setActiveCommandId(undefined)
    setIsLauncherMenuOpen(false)
    focusSearchInput()
  }, [
    canUseServerLauncher,
    desktopApi,
    focusSearchInput,
    projects,
    recentCloneDestinationDirectories,
    showDesktopActionUnavailable
  ])

  const enterOpenWorkspaceDirectoryMode = useCallback(() => {
    if (desktopApi?.listCloneDestinationDirectories == null && !canUseServerLauncher) {
      showDesktopActionUnavailable()
      return
    }

    setLauncherViewMode('commands')
    setDirectoryBrowserMode('open-workspace')
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
    setCloneDestinationDirectory(recentCloneDestinationDirectories[0] ?? projects[0]?.workspaceFolder)
    setActiveCommandId(undefined)
    setIsLauncherMenuOpen(false)
    focusSearchInput()
  }, [
    canUseServerLauncher,
    desktopApi,
    focusSearchInput,
    projects,
    recentCloneDestinationDirectories,
    showDesktopActionUnavailable
  ])

  const openCloneDestinationDirectory = useCallback((directory: string | undefined) => {
    if (directory == null || directory.trim() === '') return
    setCloneDestinationDirectory(directory)
    if (directoryBrowserMode === 'open-workspace') {
      setQuery('')
    }
    setActiveCommandId(undefined)
    focusSearchInput()
  }, [directoryBrowserMode, focusSearchInput])

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

  const handleCreateWorkspaceInDirectory = useCallback(async (parentDirectory: string | undefined) => {
    const createWorkspaceInDirectory = desktopApi?.createWorkspaceInDirectory
    if (createWorkspaceInDirectory == null && !canUseServerLauncher) {
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
    canUseServerLauncher,
    desktopApi,
    focusSearchInput,
    message,
    openWorkspace,
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

    setRecentCloneDestinationDirectories((prev) => {
      const next = rememberCloneDestinationDirectory(prev, normalizedDirectory)
      persistCloneDestinationDirectories(next)
      return next
    })

    await openWorkspace(normalizedDirectory)
  }, [focusSearchInput, message, openWorkspace, t])

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
    setQuery('')
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
  }, [contextProject])

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
    const canRemoveProject = project.status == null
    const items: NonNullable<MenuProps['items']> = [
      {
        icon: <span className='material-symbols-rounded launcher-command-menu__icon'>keyboard_return</span>,
        key: 'open-project',
        label: t('launcher.projects.open'),
        onClick: () => void openWorkspace(project.workspaceFolder)
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

    if (canRemoveProject) {
      items.push(
        {
          type: 'divider'
        },
        {
          danger: true,
          icon: <span className='material-symbols-rounded launcher-command-menu__icon'>close</span>,
          key: 'remove-project',
          label: t('launcher.projects.remove'),
          onClick: () => confirmForgetWorkspace(project)
        }
      )
    }

    return items
  }, [
    confirmForgetWorkspace,
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

  const commandSections = useMemo<LauncherCommandSection[]>(() => {
    if (isDirectoryBrowserMode) {
      const currentDirectory = cloneDestinationList.currentDirectory
      if (currentDirectory === '') return []

      const currentDirectoryKey = normalizeDirectoryPathKey(currentDirectory)
      const homeDirectoryKey = directoryBrowserHomeDirectory == null
        ? currentDirectoryKey
        : normalizeDirectoryPathKey(directoryBrowserHomeDirectory)
      const isHomeDirectory = currentDirectoryKey === homeDirectoryKey
      const recentDirectoryIndexes = new Map(
        recentCloneDestinationDirectories.map((directory, index) => [normalizeDirectoryPathKey(directory), index])
      )
      const favoriteDirectoryIndexes = new Map(
        favoriteCloneDestinationDirectories.map((directory, index) => [normalizeDirectoryPathKey(directory), index])
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
        const hasFavoriteAction = showFavoriteAction && !isBackAction
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
          {
            icon: <span className='material-symbols-rounded launcher-command-menu__icon'>folder_open</span>,
            key: 'reveal-directory',
            label: t('launcher.projects.revealInFileManager', { manager: filesystemManagerName }),
            onClick: () => void revealFilesystemPath(path)
          },
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
      const fixedDirectoryKeys = new Set(fixedDirectories.map(directory => normalizeDirectoryPathKey(directory.path)))
      const childDirectoryKeys = new Set(
        cloneDestinationList.directories.map(directory => normalizeDirectoryPathKey(directory.path))
      )
      const favoriteDirectories = favoriteCloneDestinationDirectories
        .filter(directory =>
          isHomeDirectory &&
          !fixedDirectoryKeys.has(normalizeDirectoryPathKey(directory)) &&
          !childDirectoryKeys.has(normalizeDirectoryPathKey(directory))
        )
        .map(directory => ({
          name: getDirectoryDisplayName(directory),
          path: directory
        }))
      const recentDirectories = recentCloneDestinationDirectories
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
      const commands = [
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

    if (contextProject != null) {
      return [
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
      ].filter(section => section.commands.length > 0)
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

    return [
      {
        commands: startCommands,
        id: 'start',
        title: t('launcher.start.title')
      },
      {
        commands: projects.map(project => ({
          action: () => void openWorkspace(project.workspaceFolder),
          contextMenuItems: buildProjectContextMenuItems(project),
          icon: project.status === 'ready' ? 'radio_button_checked' : 'history',
          id: `project:${encodeURIComponent(project.workspaceFolder)}`,
          keywords: [project.name, project.description, project.workspaceFolder],
          removeAction: project.status == null ? () => confirmForgetWorkspace(project) : undefined,
          removeLabel: t('launcher.projects.remove'),
          subtitle: project.description,
          title: project.name
        })),
        id: 'projects',
        title: t('launcher.projects.title')
      }
    ]
  }, [
    buildFileContextMenuItems,
    buildProjectContextMenuItems,
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
    filesystemManagerName,
    message,
    openCloneDestinationDirectory,
    openCurrentWorkspaceFile,
    openCurrentWorkspaceResource,
    openFileSearchItem,
    openWorkspace,
    projects,
    pluginResults,
    recentCloneDestinationDirectories,
    revealFilesystemPath,
    resourceResults.files,
    resourceResults.sessions,
    resourceResults.terminals,
    resourceResults.websites,
    showComingSoon,
    t,
    toggleCloneDestinationFavoriteDirectory
  ])

  const normalizedQuery = normalizePinyinSearchQuery(query)
  const filteredSections = useMemo(() => (
    commandSections
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
    if (launcherViewMode !== 'commands' || activeCommandId == null) return

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
  }, [activeCommandId, flatCommands, launcherViewMode])

  const runCommand = useCallback((command?: LauncherCommand) => {
    if (command == null) return
    void Promise.resolve(command.action()).catch((error) => {
      console.error('[launcher] command failed', error)
      void message.error(t('launcher.commandFailed'))
    })
  }, [message, t])

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

  const openLauncherView = useCallback((mode: LauncherViewMode) => {
    setLauncherViewMode(mode)
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
    setQuery('')
    setIsLauncherMenuOpen(false)
    focusSearchInput()
  }, [focusSearchInput])

  const restoreSearchHistoryEntry = useCallback((entry: LauncherSearchHistoryEntry) => {
    setLauncherViewMode(entry.launcherViewMode)
    setDirectoryBrowserMode(entry.directoryBrowserMode)
    setCloneDestinationDirectory(entry.cloneDestinationDirectory)
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
  }, [focusSearchInput])

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
        setLauncherViewMode('commands')
        setQuery('')
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
    openLauncherView
  ])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeCompositionKeyEvent(event, isSearchInputComposing())) {
      return
    }

    const isEmptyDeleteKey = (event.key === 'Backspace' || event.key === 'Delete') && query === ''
    if (launcherViewMode !== 'commands') {
      if (isEmptyDeleteKey) {
        event.preventDefault()
        setLauncherViewMode('commands')
        setQuery('')
        focusSearchInput()
      }
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
  const emptyMessage = isDirectoryBrowserMode
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
  const viewSearchPlaceholder = launcherViewMode === 'settings'
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
  const viewSearchLabel = launcherViewMode === 'settings'
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
  const viewLeadingIconTooltip = launcherViewMode === 'settings'
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
  const viewLeadingIcon = launcherViewMode === 'settings'
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
    : launcherViewMode === 'settings'
    ? settingsOperationHints
    : [
      { key: 'back', keys: 'Esc', label: t('launcher.footerHints.back') }
    ]

  return (
    <main className='launcher-route'>
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
              onChange={event => setQuery(event.target.value)}
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
          role={launcherViewMode === 'commands' ? 'listbox' : undefined}
          aria-label={launcherViewMode === 'settings'
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
          {launcherViewMode === 'commands' && isDirectoryBrowserMode && directoryBreadcrumbs.length > 0 && (
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
          {launcherViewMode === 'commands' && filteredSections.map(section => (
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
                      aria-selected={command.id === activeCommandId}
                      onMouseDown={(event) => {
                        if (event.button === 0) {
                          event.preventDefault()
                        }
                      }}
                      onClick={() => {
                        if (command.id !== activeCommandId) {
                          setActiveCommandId(command.id)
                          return
                        }

                        runCommand(command)
                      }}
                    >
                      <span
                        className={`material-symbols-rounded launcher-command-item__icon ${
                          command.iconTone == null ? '' : `is-${command.iconTone}`
                        }`}
                      >
                        {command.icon}
                      </span>
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
          {launcherViewMode === 'commands' && flatCommands.length === 0 && (
            <div className='launcher-command-empty'>{emptyMessage}</div>
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
    </main>
  )
}
