/* eslint-disable max-lines -- browser activity panel keeps shared filters, history rows, and download rows together. */
import './BrowserActivityPanel.scss'

import type { Session } from '@oneworks/core'
import type { SessionWorkspace } from '@oneworks/types'
import { App, Empty, Pagination, Spin } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { getSessionWorkspace, listSessions } from '#~/api'
import type { ActionSearchToolbarAction } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { InlineActionButton } from '#~/components/inline-action-button'
import type { WorkspaceScopeSelectOption } from '#~/components/workspace-scope-select/WorkspaceScopeSelect'
import {
  WorkspaceProjectSelect,
  WorkspaceSessionSelect
} from '#~/components/workspace-scope-select/WorkspaceScopeSelect'

import { ConfigSectionFrame } from '../config/ConfigSectionFrame'

export type BrowserActivityPanelKind = 'downloads' | 'history'
type BrowserActivityPanelExpandedPanel = 'scope'
type BrowserActivitySessionArchiveFilter = 'active' | 'all' | 'archived'

interface BrowserActivityPanelProps {
  initialProjectKeys?: string[]
  initialSessionKey?: string
  kind: BrowserActivityPanelKind
  showHeader?: boolean
}

const browserActivityPageSize = 18
const emptyBrowserActivityProjectKeys: string[] = []
const emptyBrowserActivitySessions: Session[] = []

const emptyWorkspaceSelectorState: DesktopWorkspaceSelectorState = {
  recentProjects: [],
  runningProjects: []
}
const emptySessionWorkspaceMap = new Map<string, SessionWorkspace>()

const isRecordObject = (value: unknown): value is Record<string, unknown> => (
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value)
)

const normalizeHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.href
  } catch {
    return undefined
  }
}

const getUrlHost = (value: string) => {
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

const formatTimestamp = (value: string, language: string) => {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  return new Intl.DateTimeFormat(language, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(timestamp))
}

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  const maximumFractionDigits = unitIndex === 0 ? 0 : 1
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(size)} ${units[unitIndex]}`
}

const normalizeScopeKey = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : normalized
}

const normalizeScopeKeys = (values: Array<string | undefined>) => (
  Array.from(new Set(values.map(normalizeScopeKey).filter((value): value is string => value != null)))
)

const scopeKeyMatches = (recordKey: string | undefined, expectedKeys: string[]) => {
  const normalizedRecordKey = normalizeScopeKey(recordKey)
  return normalizedRecordKey != null && expectedKeys.includes(normalizedRecordKey)
}

const getScopeKeyDisplayName = (value: string) => {
  try {
    return new URL(value).host || value
  } catch {}

  const normalizedPath = value.replace(/[\\/]+$/u, '')
  const pathName = normalizedPath.split(/[\\/]/u).filter(Boolean).at(-1)
  if (pathName != null && pathName !== '') return pathName
  return value.length <= 24 ? value : `${value.slice(0, 12)}...${value.slice(-8)}`
}

const isWorkspaceSelectorProject = (value: unknown): value is DesktopWorkspaceSelectorProject => (
  isRecordObject(value) &&
  typeof value.description === 'string' &&
  typeof value.name === 'string' &&
  typeof value.workspaceFolder === 'string'
)

const normalizeWorkspaceSelectorState = (value: unknown): DesktopWorkspaceSelectorState => {
  if (!isRecordObject(value)) return emptyWorkspaceSelectorState

  return {
    recentProjects: Array.isArray(value.recentProjects)
      ? value.recentProjects.filter(isWorkspaceSelectorProject)
      : [],
    runningProjects: Array.isArray(value.runningProjects)
      ? value.runningProjects.filter(isWorkspaceSelectorProject)
      : []
  }
}

const mergeWorkspaceProjects = (state: DesktopWorkspaceSelectorState) => {
  const projectsByFolder = new Map<string, DesktopWorkspaceSelectorProject>()
  for (const project of [...state.runningProjects, ...state.recentProjects]) {
    const workspaceFolder = normalizeScopeKey(project.workspaceFolder)
    if (workspaceFolder == null) continue
    projectsByFolder.set(workspaceFolder, project)
  }
  return Array.from(projectsByFolder.values())
}

const buildProjectScopeOptions = ({
  currentProjectKeys,
  currentProjectLabel,
  extraKeys,
  projects
}: {
  currentProjectKeys: string[]
  currentProjectLabel: string
  extraKeys: Array<string | undefined>
  projects: DesktopWorkspaceSelectorProject[]
}): WorkspaceScopeSelectOption[] => {
  const optionsByValue = new Map<string, WorkspaceScopeSelectOption>()
  const currentProjectKeySet = new Set(currentProjectKeys)
  const currentProject = projects.find((project) => {
    const workspaceFolder = normalizeScopeKey(project.workspaceFolder)
    return workspaceFolder != null && currentProjectKeySet.has(workspaceFolder)
  })
  const currentProjectValue = normalizeScopeKey(currentProject?.workspaceFolder) ?? currentProjectKeys[0]

  if (currentProjectValue != null) {
    const currentProjectName = currentProject?.name.trim() || getScopeKeyDisplayName(currentProjectValue)
    const currentProjectPath = normalizeScopeKey(currentProject?.workspaceFolder) ?? currentProjectValue
    optionsByValue.set(currentProjectValue, {
      description: currentProjectName,
      descriptionTooltip: currentProjectPath,
      icon: 'folder_special',
      label: currentProjectLabel,
      selectedLabel: currentProjectLabel,
      title: `${currentProjectLabel}\n${currentProjectName}\n${currentProjectPath}`,
      value: currentProjectValue
    })
  }

  for (const project of projects) {
    const value = normalizeScopeKey(project.workspaceFolder)
    if (value == null) continue
    if (value === currentProjectValue || currentProjectKeySet.has(value)) continue
    const projectName = project.name.trim() || getScopeKeyDisplayName(value)
    const description = project.description.trim()
    optionsByValue.set(value, {
      icon: 'folder_open',
      label: projectName,
      title: description === '' ? value : `${projectName}\n${description}\n${value}`,
      value
    })
  }

  for (const value of normalizeScopeKeys(extraKeys)) {
    if (optionsByValue.has(value)) continue
    if (value === currentProjectValue || currentProjectKeySet.has(value)) continue
    optionsByValue.set(value, {
      icon: 'folder',
      label: getScopeKeyDisplayName(value),
      title: value,
      value
    })
  }

  const currentProjectOption = currentProjectValue == null ? undefined : optionsByValue.get(currentProjectValue)
  const projectOptions = Array.from(optionsByValue.values())
    .filter(option => option.value !== currentProjectValue)
    .sort((left, right) => left.label.localeCompare(right.label))
  return currentProjectOption == null ? projectOptions : [currentProjectOption, ...projectOptions]
}

const buildProjectLabelMap = ({
  extraKeys,
  projects,
  sessionWorkspaces
}: {
  extraKeys: Array<string | undefined>
  projects: DesktopWorkspaceSelectorProject[]
  sessionWorkspaces: SessionWorkspace[]
}) => {
  const labels = new Map<string, string>()

  for (const project of projects) {
    const workspaceFolder = normalizeScopeKey(project.workspaceFolder)
    if (workspaceFolder == null) continue
    labels.set(workspaceFolder, project.name.trim() || getScopeKeyDisplayName(workspaceFolder))
  }

  for (const workspace of sessionWorkspaces) {
    const workspaceFolder = normalizeScopeKey(workspace.workspaceFolder)
    const repositoryRoot = normalizeScopeKey(workspace.repositoryRoot)
    const label = getScopeKeyDisplayName(repositoryRoot ?? workspaceFolder ?? '')
    if (workspaceFolder != null && !labels.has(workspaceFolder)) {
      labels.set(workspaceFolder, label)
    }
    if (repositoryRoot != null && !labels.has(repositoryRoot)) {
      labels.set(repositoryRoot, labels.get(workspaceFolder ?? '') ?? label)
    }
  }

  for (const value of normalizeScopeKeys(extraKeys)) {
    if (!labels.has(value)) {
      labels.set(value, getScopeKeyDisplayName(value))
    }
  }

  return labels
}

const buildProjectPathMap = ({
  extraKeys,
  projects,
  sessionWorkspaces
}: {
  extraKeys: Array<string | undefined>
  projects: DesktopWorkspaceSelectorProject[]
  sessionWorkspaces: SessionWorkspace[]
}) => {
  const paths = new Map<string, string>()

  for (const project of projects) {
    const workspaceFolder = normalizeScopeKey(project.workspaceFolder)
    if (workspaceFolder == null) continue
    paths.set(workspaceFolder, workspaceFolder)
  }

  for (const workspace of sessionWorkspaces) {
    const workspaceFolder = normalizeScopeKey(workspace.workspaceFolder)
    const repositoryRoot = normalizeScopeKey(workspace.repositoryRoot)
    const workspacePath = workspaceFolder ?? repositoryRoot
    if (workspaceFolder != null && workspacePath != null && !paths.has(workspaceFolder)) {
      paths.set(workspaceFolder, workspacePath)
    }
    if (repositoryRoot != null && workspacePath != null && !paths.has(repositoryRoot)) {
      paths.set(repositoryRoot, workspacePath)
    }
  }

  for (const value of normalizeScopeKeys(extraKeys)) {
    if (!paths.has(value)) {
      paths.set(value, value)
    }
  }

  return paths
}

const getWorkspaceProjectKeys = (workspace: SessionWorkspace | undefined) => (
  normalizeScopeKeys([workspace?.repositoryRoot, workspace?.workspaceFolder])
)

const sessionMatchesProject = (
  workspace: SessionWorkspace | undefined,
  selectedProjectKey: string | undefined
) => {
  if (selectedProjectKey == null) return true
  return getWorkspaceProjectKeys(workspace).includes(selectedProjectKey)
}

const sessionMatchesArchiveFilter = (
  sessionId: string | undefined,
  selectedArchiveFilter: BrowserActivitySessionArchiveFilter,
  sessionArchiveById: Map<string, BrowserActivitySessionArchiveFilter>
) => {
  if (selectedArchiveFilter === 'all') return true
  const normalizedSessionId = normalizeScopeKey(sessionId)
  return normalizedSessionId != null && sessionArchiveById.get(normalizedSessionId) === selectedArchiveFilter
}

const mergeSessions = (...sessionLists: Array<Session[] | undefined>) => {
  const sessionsById = new Map<string, Session>()
  for (const session of sessionLists.flatMap(sessionList => sessionList ?? [])) {
    sessionsById.set(session.id, session)
  }
  return Array.from(sessionsById.values())
}

const buildSessionScopeOptions = ({
  archivedLabel,
  extraKeys,
  projectLabel,
  projectLabels,
  projectPaths,
  sessionArchiveById,
  sessions
}: {
  archivedLabel: string
  extraKeys: Array<string | undefined>
  projectLabel: string
  projectLabels: Map<string, string>
  projectPaths: Map<string, string>
  sessionArchiveById: Map<string, BrowserActivitySessionArchiveFilter>
  sessions: Session[]
}): WorkspaceScopeSelectOption[] => {
  const sessionById = new Map(sessions.map(session => [session.id, session]))
  return normalizeScopeKeys([
    ...sessions.map(session => session.id),
    ...extraKeys
  ]).map((value) => {
    const session = sessionById.get(value)
    const sessionProjectLabel = projectLabels.get(value)
    const isArchived = sessionArchiveById.get(value) === 'archived'
    const label = session?.title?.trim() || getScopeKeyDisplayName(value)
    const description = [
      sessionProjectLabel == null ? undefined : `${projectLabel}: ${sessionProjectLabel}`,
      isArchived ? archivedLabel : undefined
    ].filter(Boolean).join(' · ')
    return {
      description: description === '' ? undefined : description,
      descriptionTooltip: projectPaths.get(value),
      icon: isArchived ? 'archive' : 'forum',
      label,
      selectedLabel: label,
      title: [
        session?.title?.trim() || value,
        description === '' ? undefined : description,
        value
      ].filter(Boolean).join('\n'),
      value
    }
  }).sort((left, right) => left.label.localeCompare(right.label))
}

const matchesSelectedScope = (
  record: Pick<DesktopBrowserActivityScope, 'projectKey' | 'sessionKey'>,
  selectedProjectKey: string | undefined,
  selectedSessionKey: string | undefined,
  selectedArchiveFilter: BrowserActivitySessionArchiveFilter,
  sessionArchiveById: Map<string, BrowserActivitySessionArchiveFilter>
) => {
  if (selectedProjectKey != null && !scopeKeyMatches(record.projectKey, [selectedProjectKey])) return false
  if (selectedSessionKey != null && normalizeScopeKey(record.sessionKey) !== selectedSessionKey) return false
  if (!sessionMatchesArchiveFilter(record.sessionKey, selectedArchiveFilter, sessionArchiveById)) return false
  return true
}

const matchesQuery = (query: string, values: Array<string | undefined>) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return true
  return values.some(value => value?.toLowerCase().includes(normalizedQuery))
}

const getDownloadStatusIcon = (state: DesktopBrowserDownloadRecord['state']) => {
  if (state === 'completed') return 'download_done'
  if (state === 'cancelled') return 'block'
  if (state === 'interrupted') return 'error'
  return 'progress_activity'
}

export function BrowserActivityPanel({
  initialProjectKeys = emptyBrowserActivityProjectKeys,
  initialSessionKey,
  kind,
  showHeader = true
}: BrowserActivityPanelProps) {
  const desktopApi = window.oneworksDesktop
  const { message } = App.useApp()
  const { i18n, t } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const [query, setQuery] = useState('')
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | undefined>()
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | undefined>()
  const [selectedArchiveFilter, setSelectedArchiveFilter] = useState<BrowserActivitySessionArchiveFilter>('active')
  const [appliedInitialFilterSignature, setAppliedInitialFilterSignature] = useState('')
  const [expandedPanel, setExpandedPanel] = useState<BrowserActivityPanelExpandedPanel | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [recordsLoaded, setRecordsLoaded] = useState(false)
  const [historyRecords, setHistoryRecords] = useState<DesktopBrowserHistoryRecord[]>([])
  const [downloadRecords, setDownloadRecords] = useState<DesktopBrowserDownloadRecord[]>([])
  const [workspaceProjects, setWorkspaceProjects] = useState<DesktopWorkspaceSelectorProject[]>([])
  const canListHistory = desktopApi?.listBrowserHistory != null
  const canListDownloads = desktopApi?.listBrowserDownloads != null
  const canList = kind === 'history' ? canListHistory : canListDownloads
  const { data: activeSessionsRes } = useSWR(['browser-activity-sessions', 'active'], () => listSessions('active'))
  const { data: archivedSessionsRes } = useSWR(
    ['browser-activity-sessions', 'archived'],
    () => listSessions('archived')
  )
  const activeSessions = activeSessionsRes?.sessions ?? emptyBrowserActivitySessions
  const archivedSessions = archivedSessionsRes?.sessions ?? emptyBrowserActivitySessions
  const normalizedInitialProjectKeys = useMemo(() => normalizeScopeKeys(initialProjectKeys), [initialProjectKeys])
  const normalizedInitialSessionKey = normalizeScopeKey(initialSessionKey)
  const sessionArchiveById = useMemo(() => {
    const statuses = new Map<string, BrowserActivitySessionArchiveFilter>()
    for (const session of activeSessions) {
      statuses.set(session.id, 'active')
    }
    for (const session of archivedSessions) {
      statuses.set(session.id, 'archived')
    }
    return statuses
  }, [activeSessions, archivedSessions])
  const sessions = useMemo(
    () => mergeSessions(activeSessions, archivedSessions),
    [activeSessions, archivedSessions]
  )
  const sessionIds = useMemo(() => sessions.map(session => session.id).sort(), [sessions])
  const { data: sessionWorkspaceMap = emptySessionWorkspaceMap } = useSWR(
    sessionIds.length === 0 ? null : ['browser-activity-session-workspaces', sessionIds.join('\n')],
    async () => {
      const entries = await Promise.allSettled(
        sessionIds.map(async (sessionId) => [sessionId, (await getSessionWorkspace(sessionId)).workspace] as const)
      )
      return new Map(
        entries
          .filter((entry): entry is PromiseFulfilledResult<readonly [string, SessionWorkspace]> =>
            entry.status === 'fulfilled'
          )
          .map(entry => entry.value)
      )
    }
  )
  const initialFilterSignature = useMemo(() =>
    [
      kind,
      ...normalizedInitialProjectKeys,
      normalizedInitialSessionKey ?? ''
    ].join('\n'), [kind, normalizedInitialProjectKeys, normalizedInitialSessionKey])
  const sourceRecords = kind === 'history' ? historyRecords : downloadRecords
  const projectOptions = useMemo(() =>
    buildProjectScopeOptions({
      currentProjectKeys: normalizedInitialProjectKeys,
      currentProjectLabel: t('browserActivity.filters.currentProject'),
      extraKeys: [
        ...sourceRecords.map(record => record.projectKey),
        ...normalizedInitialProjectKeys
      ],
      projects: workspaceProjects
    }), [
    normalizedInitialProjectKeys,
    sourceRecords,
    t,
    workspaceProjects
  ])
  const projectLabelByKey = useMemo(() =>
    buildProjectLabelMap({
      extraKeys: [
        ...sourceRecords.map(record => record.projectKey),
        ...normalizedInitialProjectKeys
      ],
      projects: workspaceProjects,
      sessionWorkspaces: Array.from(sessionWorkspaceMap.values())
    }), [
    normalizedInitialProjectKeys,
    sessionWorkspaceMap,
    sourceRecords,
    workspaceProjects
  ])
  const projectPathByKey = useMemo(() =>
    buildProjectPathMap({
      extraKeys: [
        ...sourceRecords.map(record => record.projectKey),
        ...normalizedInitialProjectKeys
      ],
      projects: workspaceProjects,
      sessionWorkspaces: Array.from(sessionWorkspaceMap.values())
    }), [
    normalizedInitialProjectKeys,
    sessionWorkspaceMap,
    sourceRecords,
    workspaceProjects
  ])
  const recordSessionKeys = useMemo(() => (
    sourceRecords
      .filter(record => selectedProjectKey == null || scopeKeyMatches(record.projectKey, [selectedProjectKey]))
      .filter(record => sessionMatchesArchiveFilter(record.sessionKey, selectedArchiveFilter, sessionArchiveById))
      .map(record => record.sessionKey)
  ), [selectedArchiveFilter, selectedProjectKey, sessionArchiveById, sourceRecords])
  const scopedSessions = useMemo(() => (
    sessions
      .filter(session => sessionMatchesProject(sessionWorkspaceMap.get(session.id), selectedProjectKey))
      .filter(session => sessionMatchesArchiveFilter(session.id, selectedArchiveFilter, sessionArchiveById))
  ), [selectedArchiveFilter, selectedProjectKey, sessionArchiveById, sessionWorkspaceMap, sessions])
  const recordSessionProjectLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const record of sourceRecords) {
      const sessionKey = normalizeScopeKey(record.sessionKey)
      const projectKey = normalizeScopeKey(record.projectKey)
      if (sessionKey == null || projectKey == null || labels.has(sessionKey)) continue
      labels.set(sessionKey, projectLabelByKey.get(projectKey) ?? getScopeKeyDisplayName(projectKey))
    }
    return labels
  }, [projectLabelByKey, sourceRecords])
  const recordSessionProjectPaths = useMemo(() => {
    const paths = new Map<string, string>()
    for (const record of sourceRecords) {
      const sessionKey = normalizeScopeKey(record.sessionKey)
      const projectKey = normalizeScopeKey(record.projectKey)
      if (sessionKey == null || projectKey == null || paths.has(sessionKey)) continue
      paths.set(sessionKey, projectPathByKey.get(projectKey) ?? projectKey)
    }
    return paths
  }, [projectPathByKey, sourceRecords])
  const sessionProjectLabels = useMemo(() => {
    const labels = new Map(recordSessionProjectLabels)
    for (const session of sessions) {
      const projectKeys = getWorkspaceProjectKeys(sessionWorkspaceMap.get(session.id))
      const projectLabel = projectKeys.map(projectKey => projectLabelByKey.get(projectKey)).find(Boolean) ??
        (projectKeys[0] == null ? undefined : getScopeKeyDisplayName(projectKeys[0]))
      if (projectLabel != null) {
        labels.set(session.id, projectLabel)
      }
    }
    return labels
  }, [projectLabelByKey, recordSessionProjectLabels, sessionWorkspaceMap, sessions])
  const sessionProjectPaths = useMemo(() => {
    const paths = new Map(recordSessionProjectPaths)
    for (const session of sessions) {
      const projectKeys = getWorkspaceProjectKeys(sessionWorkspaceMap.get(session.id))
      const projectPath = projectKeys.map(projectKey => projectPathByKey.get(projectKey)).find(Boolean) ??
        projectKeys[0]
      if (projectPath != null) {
        paths.set(session.id, projectPath)
      }
    }
    return paths
  }, [projectPathByKey, recordSessionProjectPaths, sessionWorkspaceMap, sessions])
  const shouldIncludeInitialSession = (
    selectedProjectKey == null || normalizedInitialProjectKeys.includes(selectedProjectKey)
  ) && sessionMatchesArchiveFilter(normalizedInitialSessionKey, selectedArchiveFilter, sessionArchiveById)
  const sessionOptions = useMemo(() =>
    buildSessionScopeOptions({
      archivedLabel: t('browserActivity.filters.archivedSessions'),
      extraKeys: [
        ...recordSessionKeys,
        shouldIncludeInitialSession ? normalizedInitialSessionKey : undefined
      ],
      projectLabel: t('browserActivity.scope.project'),
      projectLabels: sessionProjectLabels,
      projectPaths: sessionProjectPaths,
      sessionArchiveById,
      sessions: scopedSessions
    }), [
    normalizedInitialSessionKey,
    recordSessionKeys,
    scopedSessions,
    sessionArchiveById,
    sessionProjectLabels,
    sessionProjectPaths,
    shouldIncludeInitialSession,
    t
  ])
  const selectedProjectOption = projectOptions.find(option => option.value === selectedProjectKey)
  const selectedSessionOption = sessionOptions.find(option => option.value === selectedSessionKey)
  const selectedArchiveFilterLabel = selectedArchiveFilter === 'all'
    ? undefined
    : t(`browserActivity.filters.${selectedArchiveFilter === 'active' ? 'activeSessions' : 'archivedSessions'}`)
  const activeFilterLabels = [
    selectedProjectOption == null
      ? null
      : t('browserActivity.filters.activeProject', { project: selectedProjectOption.label }),
    selectedSessionOption == null
      ? null
      : t('browserActivity.filters.activeSession', { session: selectedSessionOption.label }),
    selectedArchiveFilterLabel == null
      ? null
      : t('browserActivity.filters.activeSessionStatus', { status: selectedArchiveFilterLabel })
  ].filter((value): value is string => value != null)
  const hasScopeFilter = activeFilterLabels.length > 0
  const activeFilterLabel = activeFilterLabels.join(' / ')

  const loadRecords = useCallback(() => {
    setLoading(true)
    setRecordsLoaded(false)

    if (kind === 'history') {
      if (desktopApi?.listBrowserHistory == null) {
        setHistoryRecords([])
        setLoading(false)
        setRecordsLoaded(true)
        return
      }
      void desktopApi.listBrowserHistory()
        .then(records => setHistoryRecords(records ?? []))
        .catch((error) => {
          console.error('[browser-activity] failed to list browser history', error)
          void message.error(t('browserActivity.history.loadFailed'))
        })
        .finally(() => {
          setLoading(false)
          setRecordsLoaded(true)
        })
      return
    }

    if (desktopApi?.listBrowserDownloads == null) {
      setDownloadRecords([])
      setLoading(false)
      setRecordsLoaded(true)
      return
    }
    void desktopApi.listBrowserDownloads()
      .then(records => setDownloadRecords(records ?? []))
      .catch((error) => {
        console.error('[browser-activity] failed to list browser downloads', error)
        void message.error(t('browserActivity.downloads.loadFailed'))
      })
      .finally(() => {
        setLoading(false)
        setRecordsLoaded(true)
      })
  }, [desktopApi, kind, message, t])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  useEffect(() => {
    if (desktopApi?.getWorkspaceSelectorState == null) {
      setWorkspaceProjects([])
      return undefined
    }

    let disposed = false
    const applyWorkspaceSelectorState = (value: unknown) => {
      if (disposed) return
      setWorkspaceProjects(mergeWorkspaceProjects(normalizeWorkspaceSelectorState(value)))
    }

    void desktopApi.getWorkspaceSelectorState()
      .then(applyWorkspaceSelectorState)
      .catch((error) => {
        if (!disposed) {
          console.warn('[browser-activity] failed to load workspace selector state', error)
          setWorkspaceProjects([])
        }
      })

    const dispose = desktopApi.onWorkspaceSelectorStateChange?.(applyWorkspaceSelectorState)
    return () => {
      disposed = true
      dispose?.()
    }
  }, [desktopApi])

  useEffect(() => {
    setPage(1)
  }, [kind, query, selectedArchiveFilter, selectedProjectKey, selectedSessionKey])

  useEffect(() => {
    if (!recordsLoaded || appliedInitialFilterSignature === initialFilterSignature) return

    const nextProjectKey = projectOptions.find(option => normalizedInitialProjectKeys.includes(option.value))?.value
    const nextSessionKey = normalizedInitialSessionKey != null &&
        sessionOptions.some(option => option.value === normalizedInitialSessionKey)
      ? normalizedInitialSessionKey
      : undefined
    setSelectedProjectKey(nextProjectKey)
    setSelectedSessionKey(nextSessionKey)
    setAppliedInitialFilterSignature(initialFilterSignature)
  }, [
    appliedInitialFilterSignature,
    initialFilterSignature,
    normalizedInitialProjectKeys,
    normalizedInitialSessionKey,
    projectOptions,
    recordsLoaded,
    sessionOptions
  ])

  useEffect(() => {
    if (selectedProjectKey != null && projectOptions.every(option => option.value !== selectedProjectKey)) {
      setSelectedProjectKey(undefined)
    }
  }, [projectOptions, selectedProjectKey])

  useEffect(() => {
    if (selectedSessionKey != null && sessionOptions.every(option => option.value !== selectedSessionKey)) {
      setSelectedSessionKey(undefined)
    }
  }, [selectedSessionKey, sessionOptions])

  const toggleExpandedPanel = useCallback((panel: BrowserActivityPanelExpandedPanel) => {
    setExpandedPanel(current => current === panel ? undefined : panel)
  }, [])

  const toolbarActions = useMemo<ActionSearchToolbarAction[]>(() => [{
    active: expandedPanel === 'scope',
    ariaLabel: t('browserActivity.filters.filter'),
    disabled: !canList,
    hasIndicator: hasScopeFilter,
    icon: 'filter_alt',
    key: 'scope',
    onClick: () => toggleExpandedPanel('scope'),
    pressed: expandedPanel === 'scope',
    title: hasScopeFilter
      ? t('browserActivity.filters.filterActive', { scope: activeFilterLabel })
      : t('browserActivity.filters.filter')
  }], [
    activeFilterLabel,
    canList,
    expandedPanel,
    hasScopeFilter,
    t,
    toggleExpandedPanel
  ])
  const archiveFilterOptions = useMemo<
    Array<{
      icon: string
      label: string
      value: BrowserActivitySessionArchiveFilter
    }>
  >(() => [
    {
      icon: 'select_all',
      label: t('browserActivity.filters.allSessionStatuses'),
      value: 'all'
    },
    {
      icon: 'forum',
      label: t('browserActivity.filters.activeSessions'),
      value: 'active'
    },
    {
      icon: 'archive',
      label: t('browserActivity.filters.archivedSessions'),
      value: 'archived'
    }
  ], [t])

  const filteredHistoryRecords = useMemo(() => (
    historyRecords
      .filter(record =>
        matchesSelectedScope(record, selectedProjectKey, selectedSessionKey, selectedArchiveFilter, sessionArchiveById)
      )
      .filter(record =>
        matchesQuery(query, [
          record.title,
          record.url,
          record.projectKey,
          record.sessionKey
        ])
      )
  ), [historyRecords, query, selectedArchiveFilter, selectedProjectKey, selectedSessionKey, sessionArchiveById])

  const filteredDownloadRecords = useMemo(() => (
    downloadRecords
      .filter(record =>
        matchesSelectedScope(record, selectedProjectKey, selectedSessionKey, selectedArchiveFilter, sessionArchiveById)
      )
      .filter(record =>
        matchesQuery(query, [
          record.fileName,
          record.url,
          record.filePath,
          record.mimeType,
          record.projectKey,
          record.sessionKey
        ])
      )
  ), [downloadRecords, query, selectedArchiveFilter, selectedProjectKey, selectedSessionKey, sessionArchiveById])

  const activeRecords = kind === 'history' ? filteredHistoryRecords : filteredDownloadRecords
  const sourceRecordCount = kind === 'history' ? historyRecords.length : downloadRecords.length
  const visibleHistoryRecords = useMemo(() => {
    const start = (page - 1) * browserActivityPageSize
    return filteredHistoryRecords.slice(start, start + browserActivityPageSize)
  }, [filteredHistoryRecords, page])
  const visibleDownloadRecords = useMemo(() => {
    const start = (page - 1) * browserActivityPageSize
    return filteredDownloadRecords.slice(start, start + browserActivityPageSize)
  }, [filteredDownloadRecords, page])

  const openHistoryRecord = (record: DesktopBrowserHistoryRecord) => {
    const url = normalizeHttpUrl(record.url)
    if (url == null) return
    const title = record.title?.trim() || getUrlHost(record.url)
    if (desktopApi?.openCurrentWorkspaceResource != null) {
      void desktopApi.openCurrentWorkspaceResource({ kind: 'website', title, url })
        .catch((error) => {
          console.error('[browser-activity] failed to open browser history record', error)
          void message.error(t('browserActivity.history.openFailed'))
        })
      return
    }
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      void message.error(t('browserActivity.history.openFailed'))
    }
  }

  const openDownload = (record: DesktopBrowserDownloadRecord) => {
    if (desktopApi?.openBrowserDownload == null) return
    void desktopApi.openBrowserDownload(record.id)
      .catch((error) => {
        console.error('[browser-activity] failed to open download', error)
        void message.error(t('browserActivity.downloads.openFailed'))
      })
  }

  const revealDownload = (record: DesktopBrowserDownloadRecord) => {
    if (desktopApi?.revealBrowserDownload == null) return
    void desktopApi.revealBrowserDownload(record.id)
      .catch((error) => {
        console.error('[browser-activity] failed to reveal download', error)
        void message.error(t('browserActivity.downloads.revealFailed'))
      })
  }

  const renderScopeTags = (record: DesktopBrowserActivityScope) => {
    const tags = [
      record.projectKey == null || record.projectKey.trim() === ''
        ? null
        : t('browserActivity.scope.project'),
      record.sessionKey == null || record.sessionKey.trim() === ''
        ? null
        : t('browserActivity.scope.session')
    ].filter((value): value is string => value != null)
    if (tags.length === 0) return null
    return (
      <span className='browser-activity__scope-tags'>
        {tags.map(tag => (
          <span key={tag} className='browser-activity__scope-tag'>{tag}</span>
        ))}
      </span>
    )
  }

  const renderToolbar = () => (
    <ActionSearchToolbar
      actions={toolbarActions}
      className='browser-activity__toolbar'
      placeholder={t(`browserActivity.${kind}.searchPlaceholder`)}
      query={query}
      onQueryChange={setQuery}
    />
  )

  const renderFilterPanel = () => (
    <div className='browser-activity__filter-panel'>
      <div className='browser-activity__filter-row'>
        <span className='browser-activity__filter-label'>
          <span
            className='browser-activity__filter-label-icon material-symbols-rounded'
            aria-hidden='true'
          >
            folder_open
          </span>
          {t('browserActivity.filters.projectLabel')}
        </span>
        <div className='browser-activity__filter-field'>
          <WorkspaceProjectSelect
            allLabel={t('browserActivity.filters.allProjects')}
            ariaLabel={t('browserActivity.filters.projectLabel')}
            disabled={!canList}
            emptyLabel={t('browserActivity.filters.noProjects')}
            mobileTitle={t('browserActivity.filters.projectLabel')}
            options={projectOptions}
            value={selectedProjectKey}
            onChange={setSelectedProjectKey}
          />
        </div>
      </div>
      <div className='browser-activity__filter-row'>
        <span className='browser-activity__filter-label'>
          <span
            className='browser-activity__filter-label-icon material-symbols-rounded'
            aria-hidden='true'
          >
            inventory_2
          </span>
          {t('browserActivity.filters.sessionStatusLabel')}
        </span>
        <div className='browser-activity__filter-field'>
          <div
            className='browser-activity__status-filter'
            role='radiogroup'
            aria-label={t('browserActivity.filters.sessionStatusLabel')}
          >
            {archiveFilterOptions.map(option => (
              <button
                key={option.value}
                type='button'
                className={[
                  'browser-activity__status-option',
                  selectedArchiveFilter === option.value ? 'is-active' : ''
                ].filter(Boolean).join(' ')}
                disabled={!canList}
                role='radio'
                aria-checked={selectedArchiveFilter === option.value}
                title={option.label}
                onClick={() => setSelectedArchiveFilter(option.value)}
              >
                <span className='browser-activity__status-option-icon material-symbols-rounded' aria-hidden='true'>
                  {option.icon}
                </span>
                <span className='browser-activity__status-option-label'>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className='browser-activity__filter-row'>
        <span className='browser-activity__filter-label'>
          <span
            className='browser-activity__filter-label-icon material-symbols-rounded'
            aria-hidden='true'
          >
            forum
          </span>
          {t('browserActivity.filters.sessionLabel')}
        </span>
        <div className='browser-activity__filter-field'>
          <WorkspaceSessionSelect
            allLabel={t('browserActivity.filters.allSessions')}
            ariaLabel={t('browserActivity.filters.sessionLabel')}
            disabled={!canList}
            emptyLabel={t('browserActivity.filters.noSessions')}
            mobileTitle={t('browserActivity.filters.sessionLabel')}
            options={sessionOptions}
            value={selectedSessionKey}
            onChange={setSelectedSessionKey}
          />
        </div>
      </div>
    </div>
  )

  const renderHistoryRows = () => (
    <div className='config-view__app-settings-list browser-activity__list'>
      {visibleHistoryRecords.map(record => (
        <button
          key={record.id}
          className='config-view__field-row browser-activity__row browser-activity__row-button'
          type='button'
          onClick={() => openHistoryRecord(record)}
        >
          <span className='config-view__field-meta browser-activity__meta'>
            {record.faviconUrl == null || record.faviconUrl.trim() === ''
              ? (
                <span className='material-symbols-rounded config-view__field-icon'>history</span>
              )
              : (
                <img
                  className='browser-activity__favicon'
                  src={record.faviconUrl}
                  alt=''
                  aria-hidden='true'
                />
              )}
            <span className='config-view__field-text browser-activity__text'>
              <span className='config-view__field-title'>{record.title?.trim() || getUrlHost(record.url)}</span>
              <span className='config-view__field-desc'>{record.url}</span>
            </span>
          </span>
          <span className='config-view__field-control browser-activity__control'>
            <span className='browser-activity__details'>
              <span>{formatTimestamp(record.lastVisitedAt, language)}</span>
              {record.visitCount > 1 && (
                <span>{t('browserActivity.history.visitCount', { count: record.visitCount })}</span>
              )}
            </span>
            {renderScopeTags(record)}
            <span className='material-symbols-rounded config-view__select-chevron'>chevron_right</span>
          </span>
        </button>
      ))}
    </div>
  )

  const renderDownloadRows = () => (
    <div className='config-view__app-settings-list browser-activity__list'>
      {visibleDownloadRecords.map(record => {
        const completed = record.state === 'completed'
        const hasFilePath = record.filePath != null && record.filePath.trim() !== ''
        const sizeText = record.state === 'progressing' && record.totalBytes > 0
          ? `${formatBytes(record.receivedBytes)} / ${formatBytes(record.totalBytes)}`
          : formatBytes(record.totalBytes || record.receivedBytes)
        return (
          <div key={record.id} className='config-view__field-row browser-activity__row'>
            <span className='config-view__field-meta browser-activity__meta'>
              <span className='material-symbols-rounded config-view__field-icon'>
                {getDownloadStatusIcon(record.state)}
              </span>
              <span className='config-view__field-text browser-activity__text'>
                <span className='config-view__field-title'>
                  {record.fileName || t('browserActivity.downloads.unknownFile')}
                </span>
                <span className='config-view__field-desc'>{record.filePath || record.url}</span>
              </span>
            </span>
            <span className='config-view__field-control browser-activity__download-control'>
              <span className='browser-activity__details'>
                <span>{t(`browserActivity.downloads.status.${record.state}`)}</span>
                {sizeText !== '' && <span>{sizeText}</span>}
                <span>{formatTimestamp(record.completedAt ?? record.updatedAt ?? record.startedAt, language)}</span>
              </span>
              {renderScopeTags(record)}
              <span className='browser-activity__actions'>
                <InlineActionButton
                  disabled={!completed || !hasFilePath || desktopApi?.openBrowserDownload == null}
                  icon='open_in_new'
                  onClick={() => openDownload(record)}
                >
                  {t('browserActivity.downloads.open')}
                </InlineActionButton>
                <InlineActionButton
                  disabled={!hasFilePath || desktopApi?.revealBrowserDownload == null}
                  icon='folder_open'
                  onClick={() => revealDownload(record)}
                >
                  {t('browserActivity.downloads.reveal')}
                </InlineActionButton>
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )

  const renderBody = () => {
    if (loading) {
      return (
        <div className='config-view__state browser-activity__state'>
          <Spin />
        </div>
      )
    }

    if (activeRecords.length === 0) {
      return (
        <div className='config-view__field-row browser-activity__empty'>
          <Empty
            description={canList
              ? t(
                sourceRecordCount === 0
                  ? `browserActivity.${kind}.empty`
                  : `browserActivity.${kind}.emptyFiltered`
              )
              : t(`browserActivity.${kind}.unavailable`)}
          />
        </div>
      )
    }

    return kind === 'history' ? renderHistoryRows() : renderDownloadRows()
  }

  return (
    <ConfigSectionFrame
      className='browser-activity'
      icon={showHeader ? (kind === 'history' ? 'history' : 'download') : undefined}
      title={showHeader ? t(`browserActivity.${kind}.title`) : undefined}
    >
      <div className='browser-activity__content'>
        {renderToolbar()}
        {expandedPanel === 'scope' && canList && renderFilterPanel()}
        {renderBody()}
        {activeRecords.length > browserActivityPageSize && (
          <Pagination
            className='browser-activity__pagination'
            current={page}
            pageSize={browserActivityPageSize}
            showSizeChanger={false}
            size='small'
            total={activeRecords.length}
            onChange={setPage}
          />
        )}
      </div>
    </ConfigSectionFrame>
  )
}
