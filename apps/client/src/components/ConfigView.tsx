import './ConfigView.scss'

import { App, Spin } from 'antd'
import { useSetAtom } from 'jotai'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import type { RouteContainerHeaderActionItem, RouteContainerHeaderBreadcrumb } from '@oneworks/components/route-layout'
import type { ConfigSource } from '@oneworks/core'
import type {
  AboutInfo,
  AdapterAccountDetailResult,
  AdapterAccountsResult,
  ConfigResponse,
  ConfigUiSection,
  PluginContributionSettingsPage
} from '@oneworks/types'
import type { ConfigDetailRoute } from './config/configDetail'

import { RouteErrorState } from '#~/components/error-state'
import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteSidebar } from '#~/components/layout/route-sidebar-context'
import type { RouteSidebarListItem } from '#~/components/layout/route-sidebar-context'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import {
  pendingSessionCreationContextAtom,
  pendingSessionInitialContentAtom
} from '#~/hooks/chat/session-creation-context'
import { usePluginContext } from '#~/plugins/plugin-context'
import { usePluginSlot } from '#~/plugins/plugin-slots'
import { useRoutePluginChrome } from '#~/plugins/route-plugin-chrome'
import { mergeAppearanceConfigForEditing } from '#~/utils/appearance-config'

import {
  getAdapterAccountDetail,
  getAdapterAccounts,
  getApiErrorMessage,
  getConfig,
  getConfigSchema,
  listWorkspaceFileOpeners,
  listWorktreeEnvironments,
  updateConfig
} from '../api'
import { resolveWorkspaceFileOpenerSelectModels } from '../utils/workspace-file-openers'
import { BrowserActivityPanel } from './browser-activity/BrowserActivityPanel'
import { SavedPasswordManagerPanel } from './browser-data-sync/SavedPasswordManagerPanel'
import { AboutSection, ConfigSectionPanel, DisplayValue } from './config'
import { AppSettingsPanel } from './config/AppSettingsPanel'
import { DesktopSettingsPanel } from './config/DesktopSettingsPanel'
import { ExternalSessionsPanel } from './config/ExternalSessionsPanel'
import {
  ModelServiceProviderPortalBottomPanel,
  addModelServiceProviderPortalTab,
  closeModelServiceProviderPortalTab,
  emptyModelServiceProviderPortalTabsState,
  syncModelServiceProviderPortalTabs
} from './config/ModelServiceProviderPortalBottomPanel'
import type { ModelServiceProviderPortalRequest } from './config/ModelServiceProviderPortalBottomPanel'
import { ThemePackSettingsPanel } from './config/ThemePackSettingsPanel'
import { WorktreeEnvironmentPanel } from './config/WorktreeEnvironmentPanel'
import {
  getConfigDraftKey,
  resolveRemoteConfigChangeAction,
  serializeComparableConfigValue
} from './config/configConflict'
import {
  getSectionFields,
  parseConfigDetailRoute,
  resolveConfigDetailRouteMeta,
  serializeConfigDetailRoute
} from './config/configDetail'
import { getConfigDetailPlaceholderEntries } from './config/configDetailPlaceholders'
import { getPreferredConfigSourceForTab, resolveConfigSourceForMissingQuery } from './config/configSourceDefaults'
import { cloneValue, collectUnsetPaths, getValueByPath, isEmptyValue } from './config/configUtils'
import { editableConfigSectionKeys } from './config/editableConfigSections'
import type { NativeHistoryImportSettings } from './config/external-sessions-panel-model'
import {
  buildModelServiceConfigSessionInitialContent,
  buildModelServiceConfigSessionTitle,
  getModelServiceConfigSessionActionKey
} from './config/modelServiceConfigSession'
import type { ModelServiceConfigSessionRequest } from './config/modelServiceConfigSession'
import { openExternalUrl } from './config/modelServiceProviderActionUtils'
import { modelServiceImportQueryKeys, parseModelServiceQueryImport } from './config/modelServiceQueryImport'
import { toLabel } from './config/record-editors/schemaRecordUtils'
import { toDisplayEnvironmentName, toEnvironmentReference } from './config/worktree-environment-panel-model'
import { PluginSettingsPage } from './plugins/PluginSettingsPage'
import { isPluginSettingsTabKey, resolveSettingsTabKey } from './plugins/plugin-settings-route'

interface ConfigDraftConflict {
  draftKey: string
  sectionKey: string
  source: ConfigSource
  remoteValue: unknown
}

type PluginSettingsPageContribution = PluginContributionSettingsPage & { pluginScope: string }

interface ConfigGroupTab {
  key: string
  label: string
  type: 'group'
}

interface ConfigContentTab {
  icon: string
  key: string
  label: string
  pluginSettingsPage?: PluginSettingsPageContribution
  type?: undefined
  value?: unknown
}

type ConfigTab = ConfigGroupTab | ConfigContentTab

interface ConfigQueryParams extends Record<string, string> {
  detail: string
  section: string
  source: string
  tab: string
}

const configSourceKeys = ['global', 'project', 'user'] as const
const configLegacyRouteQueryKeys = ['tab', 'detail', 'section']
const configQueryDefaults: ConfigQueryParams = { tab: 'general', source: '', detail: '', section: '' }
const CONFIG_ROUTE_SIDEBAR_KEY = 'config-view'
const getPluginSettingsPageKey = (scope: string, id: string) => `plugin:${scope}:${id}`
const modelServiceDetailTabPathSegments = new Set([
  'access',
  'advanced',
  'api-keys',
  'display',
  'management',
  'models',
  'plan',
  'profiles'
])
const isConfigSourceKey = (value: string): value is ConfigSource => (
  configSourceKeys.includes(value as ConfigSource)
)
const isRecordObject = (value: unknown): value is Record<string, unknown> => (
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value)
)
const resolveBrowserActivityRouteContext = (state: unknown) => {
  if (!isRecordObject(state) || !isRecordObject(state.browserActivity)) {
    return {
      projectKeys: [] as string[],
      sessionKey: undefined as string | undefined
    }
  }

  const rawProjectKeys = state.browserActivity.projectKeys
  const rawSessionKey = state.browserActivity.sessionKey
  return {
    projectKeys: Array.isArray(rawProjectKeys)
      ? rawProjectKeys.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      : [],
    sessionKey: typeof rawSessionKey === 'string' && rawSessionKey.trim() !== ''
      ? rawSessionKey
      : undefined
  }
}
const resolveUniqueModelServiceKey = (baseKey: string, modelServices: Record<string, unknown>) => {
  if (!Object.hasOwn(modelServices, baseKey)) return baseKey
  for (let index = 2; index < 1000; index += 1) {
    const nextKey = `${baseKey}-${index}`
    if (!Object.hasOwn(modelServices, nextKey)) return nextKey
  }
  return `${baseKey}-${Date.now()}`
}
const getModelServiceImportClearPatch = () => (
  Object.fromEntries(modelServiceImportQueryKeys.map(key => [key, ''])) as Partial<ConfigQueryParams>
)
const decodeConfigPathSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
const encodeConfigPathSegment = (segment: string) => encodeURIComponent(segment)
const normalizeConfigDetailPath = (detail: string) => {
  const trimmed = detail.trim()
  if (trimmed === '') return ''
  const decoded = (() => {
    try {
      return decodeURIComponent(trimmed)
    } catch {
      return trimmed
    }
  })()
  return decoded
    .split('/')
    .filter(segment => segment !== '')
    .map(encodeConfigPathSegment)
    .join('/')
}
const parseConfigPathState = (pathname: string) => {
  const normalizedPathname = pathname === '/config'
    ? ''
    : pathname.startsWith('/config/')
    ? pathname.slice('/config/'.length)
    : ''
  const segments = normalizedPathname
    .split('/')
    .filter(segment => segment !== '')
    .map(decodeConfigPathSegment)
  const tab = segments[0] ?? ''
  const detail = segments.length > 1
    ? segments.slice(1).map(encodeConfigPathSegment).join('/')
    : ''
  return {
    detail,
    hasDetailPath: segments.length > 1,
    hasTabPath: tab !== '',
    tab
  }
}
const buildConfigPathname = (tab: string, detail: string) => {
  const normalizedTab = tab.trim() === '' ? configQueryDefaults.tab : tab.trim()
  const normalizedDetail = normalizeConfigDetailPath(detail)
  return normalizedDetail === ''
    ? `/config/${encodeConfigPathSegment(normalizedTab)}`
    : `/config/${encodeConfigPathSegment(normalizedTab)}/${normalizedDetail}`
}
const getModelServiceProfileEntry = (
  item: unknown,
  resolvedItem: unknown,
  profileKey: string
) => {
  const localProfiles = getValueByPath(item, ['profiles'])
  const legacyLocalServices = getValueByPath(item, ['services'])
  const resolvedProfiles = getValueByPath(resolvedItem, ['profiles'])
  const legacyResolvedServices = getValueByPath(resolvedItem, ['services'])

  if (isRecordObject(localProfiles) && isRecordObject(localProfiles[profileKey])) return localProfiles[profileKey]
  if (isRecordObject(legacyLocalServices) && isRecordObject(legacyLocalServices[profileKey])) {
    return legacyLocalServices[profileKey]
  }
  if (isRecordObject(resolvedProfiles) && isRecordObject(resolvedProfiles[profileKey])) {
    return resolvedProfiles[profileKey]
  }
  if (isRecordObject(legacyResolvedServices) && isRecordObject(legacyResolvedServices[profileKey])) {
    return legacyResolvedServices[profileKey]
  }
  return undefined
}
const getModelServiceProfileBreadcrumbLabel = (
  item: unknown,
  resolvedItem: unknown,
  profileKey: string
) => {
  const profile = getModelServiceProfileEntry(item, resolvedItem, profileKey)
  const title = profile?.title
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : profileKey
}
const getRecordMapEntryBreadcrumbLabel = (
  collectionKey: string,
  entryKey: string,
  ...items: unknown[]
) => {
  const entries = items.map(item => getValueByPath(item, [collectionKey, entryKey]))
  for (const entry of entries) {
    if (!isRecordObject(entry)) continue
    for (const titleKey of ['title', 'displayName', 'name', 'label']) {
      const title = entry[titleKey]
      if (typeof title === 'string' && title.trim() !== '') return title.trim()
    }
  }
  return undefined
}

const isModelServiceDetailTabRoute = (
  sectionKey: string | undefined,
  route: ConfigDetailRoute
) => (
  sectionKey === 'modelServices' &&
  route.fieldPath.length === 0 &&
  route.nestedPath?.length === 1 &&
  modelServiceDetailTabPathSegments.has(route.nestedPath[0]!)
)

export function ConfigView() {
  const { i18n, t } = useTranslation()
  const { message, modal } = App.useApp()
  const { pluginSnapshotStatus } = usePluginContext()
  const navigate = useNavigate()
  const location = useLocation()
  const setPendingSessionInitialContent = useSetAtom(pendingSessionInitialContentAtom)
  const setPendingSessionCreationContext = useSetAtom(pendingSessionCreationContextAtom)
  const {
    closeRouteSidebar,
    isCompactView,
    openRouteSidebar
  } = useRouteContainerSidebarOpener()
  const { clearRouteSidebar, hasRouteSidebarProvider, setRouteSidebar } = useRouteSidebar()
  const {
    headerActions: routePluginHeaderActions,
    sidebarContextMenuItems: routePluginSidebarContextMenu
  } = useRoutePluginChrome('config')
  const { data, isLoading, error, mutate, isValidating } = useSWR<ConfigResponse>('/api/config', getConfig, {
    errorRetryInterval: 2_000,
    shouldRetryOnError: true
  })
  const { data: schemaData } = useSWR('/api/config/schema', getConfigSchema)
  const { data: worktreeEnvironmentData } = useSWR('worktree-environments', listWorktreeEnvironments)
  const { data: workspaceFileOpenersData } = useSWR('workspace-file-openers', listWorkspaceFileOpeners)
  const browserActivityRouteContext = useMemo(() => resolveBrowserActivityRouteContext(location.state), [
    location.state
  ])
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const pathValues = useMemo(() => parseConfigPathState(location.pathname), [location.pathname])
  const queryValues = useMemo<ConfigQueryParams>(() => {
    const legacyTab = searchParams.get('tab') ?? ''
    const legacyDetail = searchParams.get('detail') ?? ''
    return {
      detail: pathValues.hasDetailPath
        ? pathValues.detail
        : pathValues.hasTabPath
        ? ''
        : legacyDetail,
      section: searchParams.get('section') ?? configQueryDefaults.section,
      source: searchParams.get('source') ?? configQueryDefaults.source,
      tab: pathValues.hasTabPath ? pathValues.tab : legacyTab || configQueryDefaults.tab
    }
  }, [pathValues.detail, pathValues.hasDetailPath, pathValues.hasTabPath, pathValues.tab, searchParams])
  const configPresent = data?.meta?.configPresent
  const fallbackSourceKey = resolveConfigSourceForMissingQuery(queryValues.tab, configPresent)
  const querySourceKey: ConfigSource = isConfigSourceKey(queryValues.source) ? queryValues.source : fallbackSourceKey
  const [sourceKey, setSourceKeyState] = useState<ConfigSource>(querySourceKey)
  const [detailQuery, setDetailQueryState] = useState(queryValues.detail)
  const [navSearchQuery, setNavSearchQuery] = useState('')
  const [drafts, setDrafts] = useState<Record<string, unknown>>({})
  const [worktreeEnvironmentHeaderActions, setWorktreeEnvironmentHeaderActions] = useState<
    RouteContainerHeaderActionItem[]
  >([])
  const globalSource = data?.sources?.global
  const globalResolvedSource = data?.resolvedSources?.global
  const currentSource = data?.sources?.[sourceKey]
  const currentResolvedSource = data?.resolvedSources?.[sourceKey]
  const draftsRef = useRef<Record<string, unknown>>(drafts)
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const savingRef = useRef<Record<string, boolean>>({})
  const lastSavedRef = useRef<Record<string, string>>({})
  const baseSnapshotsRef = useRef<Record<string, string>>({})
  const blockedDraftKeysRef = useRef<Record<string, boolean>>({})
  const pendingConflictsRef = useRef<Record<string, ConfigDraftConflict>>({})
  const [pendingConflicts, setPendingConflicts] = useState<Record<string, ConfigDraftConflict>>({})
  const [activeConflictKey, setActiveConflictKey] = useState<string | null>(null)
  const [creatingModelServiceSessionKey, setCreatingModelServiceSessionKey] = useState<string | null>(null)
  const [isModelServicePortalPanelOpen, setModelServicePortalPanelOpen] = useState(false)
  const [modelServicePortalTabsState, setModelServicePortalTabsState] = useState(
    emptyModelServiceProviderPortalTabsState
  )
  const [savedPasswordDetailKey, setSavedPasswordDetailKey] = useState<string | null>(null)
  const [savedPasswordDetailTitle, setSavedPasswordDetailTitle] = useState<string | null>(null)
  const [savedPasswordSettingsOpen, setSavedPasswordSettingsOpen] = useState(false)
  const consumedModelServiceImportRef = useRef<string | null>(null)
  const mergedModelServices = useMemo(() => data?.sources?.merged?.modelServices ?? {}, [
    data?.sources?.merged?.modelServices
  ])
  const mergedAdapters = useMemo(() => data?.sources?.merged?.adapters ?? {}, [
    data?.sources?.merged?.adapters
  ])
  const hasDesktopSettings = window.oneworksDesktop?.getDesktopSettings != null &&
    window.oneworksDesktop.updateDesktopSettings != null
  const hasSavedPasswords = window.oneworksDesktop?.listSavedPasswords != null
  const hasBrowserHistory = window.oneworksDesktop?.listBrowserHistory != null
  const hasBrowserDownloads = window.oneworksDesktop?.listBrowserDownloads != null
  const hasConfigLoadError = !isLoading && data == null && error != null
  const canRenderConfig = !isLoading && data != null
  const pluginSettingsPages = usePluginSlot<PluginContributionSettingsPage>('settings.pages')
  const validPluginSettingsPages = useMemo(() =>
    pluginSettingsPages.filter(page => (
      (typeof page.clientView === 'string' && page.clientView.trim() !== '') ||
      (page.schema != null && typeof page.schema === 'object' && !Array.isArray(page.schema))
    )), [pluginSettingsPages])

  const configTabKeys = useMemo(() => new Set<string>(editableConfigSectionKeys), [])

  const tabs = useMemo<ConfigTab[]>(() => [
    { key: 'group-config', type: 'group', label: t('config.groups.config') },
    { key: 'general', icon: 'tune', label: t('config.sections.general'), value: currentSource?.general },
    {
      key: 'conversation',
      icon: 'forum',
      label: t('config.sections.conversation'),
      value: currentSource?.conversation
    },
    {
      key: 'worktreeEnvironments',
      icon: 'deployed_code',
      label: t('config.sections.environments')
    },
    {
      key: 'models',
      icon: 'tune',
      label: t('config.sections.models'),
      value: currentSource?.models
    },
    {
      key: 'modelServices',
      icon: 'model_training',
      label: t('config.sections.modelServices'),
      value: currentSource?.modelServices
    },
    {
      key: 'channels',
      icon: 'campaign',
      label: t('config.sections.channels'),
      value: currentSource?.channels
    },
    {
      key: 'adapters',
      icon: 'settings_input_component',
      label: t('config.sections.adapters'),
      value: currentSource?.adapters
    },
    { key: 'plugins', icon: 'extension', label: t('config.sections.plugins'), value: currentSource?.plugins },
    ...validPluginSettingsPages.map(page => ({
      key: getPluginSettingsPageKey(page.pluginScope, page.id),
      icon: page.icon ?? 'extension',
      label: page.title,
      pluginSettingsPage: page
    })),
    { key: 'mcp', icon: 'account_tree', label: t('config.sections.mcp'), value: currentSource?.mcp },
    { key: 'voice', icon: 'mic', label: t('config.sections.voice'), value: currentSource?.voice },
    { key: 'shortcuts', icon: 'keyboard', label: t('config.sections.shortcuts'), value: currentSource?.shortcuts },
    { key: 'group-app', type: 'group', label: t('config.groups.app') },
    { key: 'externalSessions', icon: 'history', label: t('config.sections.externalSessions') },
    ...(hasDesktopSettings
      ? [{ key: 'desktop', icon: 'desktop_windows', label: t('config.sections.desktop') }]
      : []),
    ...(hasBrowserHistory
      ? [{ key: 'browserHistory', icon: 'history', label: t('config.sections.browserHistory') }]
      : []),
    ...(hasBrowserDownloads
      ? [{ key: 'browserDownloads', icon: 'download', label: t('config.sections.browserDownloads') }]
      : []),
    ...(hasSavedPasswords
      ? [{ key: 'savedPasswords', icon: 'password', label: t('config.sections.savedPasswords') }]
      : []),
    { key: 'themes', icon: 'palette', label: t('config.sections.themes'), value: globalSource?.appearance },
    { key: 'appearance', icon: 'tune', label: t('config.sections.appearance'), value: globalSource?.appearance },
    { key: 'experiments', icon: 'science', label: t('config.sections.experiments'), value: currentSource?.experiments },
    { key: 'about', icon: 'info', label: t('config.sections.about'), value: data?.meta?.about }
  ], [
    currentSource,
    data?.meta?.about,
    globalSource?.appearance,
    hasBrowserDownloads,
    hasBrowserHistory,
    hasDesktopSettings,
    hasSavedPasswords,
    t,
    validPluginSettingsPages
  ])
  const tabKeys = useMemo(() => new Set(tabs.filter(tab => tab.type !== 'group').map(tab => tab.key)), [tabs])
  const desktopNavGroups = useMemo(() => {
    type NavTab = Exclude<(typeof tabs)[number], { type: 'group' }>
    interface NavGroup {
      key: string
      label: string
      tabs: NavTab[]
    }

    const query = navSearchQuery.trim().toLowerCase()
    const groups: NavGroup[] = []
    let currentGroup: NavGroup | null = null

    tabs.forEach((tab) => {
      if (tab.type === 'group') {
        if (currentGroup != null && currentGroup.tabs.length > 0) {
          groups.push(currentGroup)
        }
        currentGroup = { key: tab.key, label: String(tab.label), tabs: [] }
        return
      }

      if (currentGroup == null) {
        currentGroup = { key: 'group-config', label: t('config.groups.config'), tabs: [] }
      }
      const targetGroup = currentGroup
      const navTab = tab as NavTab

      const label = String(tab.label)
      const matches = query === '' ||
        label.toLowerCase().includes(query) ||
        tab.key.toLowerCase().includes(query)

      if (matches) {
        targetGroup.tabs.push(navTab)
      }
    })

    if (currentGroup != null) {
      groups.push(currentGroup)
    }

    return groups.filter(group => group.tabs.length > 0)
  }, [navSearchQuery, t, tabs])

  const sectionAliasTab = queryValues.section === 'voice.speechToText' ? 'voice' : undefined
  const rawTab = searchParams.get('tab')
  const hasExplicitTab = pathValues.hasTabPath || rawTab != null
  const queryTabKey = sectionAliasTab ?? (hasExplicitTab
    ? resolveSettingsTabKey({
      availableTabKeys: tabKeys,
      requestedTabKey: queryValues.tab,
      snapshotStatus: pluginSnapshotStatus
    })
    : 'general')
  const shouldRedirectUnavailablePluginPage = hasExplicitTab &&
    isPluginSettingsTabKey(queryValues.tab) &&
    pluginSnapshotStatus !== 'loading' &&
    !tabKeys.has(queryValues.tab)
  const [activeTabKey, setActiveTabKeyState] = useState(queryTabKey)
  const hasModelServiceImportQuery = useMemo(() => (
    modelServiceImportQueryKeys.some(key => searchParams.has(key))
  ), [searchParams])
  const updateConfigRoute = useCallback((patch: Partial<ConfigQueryParams>, options?: { state?: unknown }) => {
    const nextTab = patch.tab ?? activeTabKey
    const nextDetail = patch.detail ?? detailQuery
    const nextSource = patch.source ?? sourceKey
    const nextSearchParams = new URLSearchParams(location.search)

    configLegacyRouteQueryKeys.forEach(key => nextSearchParams.delete(key))

    const defaultSource = resolveConfigSourceForMissingQuery(nextTab, configPresent)
    if (patch.source != null || nextSearchParams.get('source') === defaultSource) {
      if (nextSource.trim() === '' || nextSource === defaultSource) {
        nextSearchParams.delete('source')
      } else {
        nextSearchParams.set('source', nextSource)
      }
    }

    modelServiceImportQueryKeys.forEach((key) => {
      if (!Object.hasOwn(patch, key)) return
      const value = patch[key] ?? ''
      if (value.trim() === '') {
        nextSearchParams.delete(key)
      } else {
        nextSearchParams.set(key, value)
      }
    })

    const target = {
      pathname: buildConfigPathname(nextTab, nextDetail),
      search: nextSearchParams.toString() === '' ? '' : `?${nextSearchParams.toString()}`,
      hash: location.hash
    }

    if (
      target.pathname === location.pathname &&
      target.search === location.search &&
      target.hash === location.hash
    ) {
      return
    }

    void navigate(target, { replace: true, state: options?.state ?? location.state })
  }, [
    activeTabKey,
    configPresent,
    detailQuery,
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
    sourceKey
  ])
  useEffect(() => {
    if (hasModelServiceImportQuery) return
    if (!configLegacyRouteQueryKeys.some(key => searchParams.has(key))) return
    updateConfigRoute({
      detail: queryValues.detail,
      section: '',
      tab: queryTabKey
    })
  }, [
    hasModelServiceImportQuery,
    queryTabKey,
    queryValues.detail,
    searchParams,
    updateConfigRoute
  ])
  useEffect(() => {
    if (!shouldRedirectUnavailablePluginPage) return
    updateConfigRoute({ detail: '', section: '', tab: 'plugins' })
  }, [shouldRedirectUnavailablePluginPage, updateConfigRoute])
  useEffect(() => {
    if (searchParams.get('source') != null) return
    const preferredSource = getPreferredConfigSourceForTab(activeTabKey)
    if (preferredSource != null) {
      updateConfigRoute({ source: preferredSource })
      return
    }
    if (configPresent == null) return
    updateConfigRoute({ source: resolveConfigSourceForMissingQuery(activeTabKey, configPresent) })
  }, [
    activeTabKey,
    configPresent,
    searchParams,
    updateConfigRoute
  ])
  const setSourceKey = useCallback((next: ConfigSource) => {
    setSourceKeyState(next)
    updateConfigRoute({ source: next })
  }, [updateConfigRoute])
  const setDetailQuery = useCallback((next: string) => {
    setDetailQueryState(next)
    updateConfigRoute({ detail: next })
  }, [updateConfigRoute])
  const setActiveTabKey = useCallback((key: string) => {
    const nextPreferredSource = key !== activeTabKey ? getPreferredConfigSourceForTab(key) : undefined
    setActiveTabKeyState(key)
    if (nextPreferredSource != null) {
      setSourceKeyState(nextPreferredSource)
    }
    setDetailQueryState('')
    updateConfigRoute({
      tab: key,
      detail: '',
      section: '',
      ...(nextPreferredSource != null ? { source: nextPreferredSource } : {})
    })
  }, [activeTabKey, updateConfigRoute])
  const activeTab = useMemo(() => tabs.find(tab => tab.key === activeTabKey), [tabs, activeTabKey])
  const activeContentTab = activeTab != null && activeTab.type !== 'group' ? activeTab : undefined
  const uiSections = schemaData?.workspace.uiSchema?.sections ?? {}
  const sourceOptions = useMemo(() => [
    {
      value: 'global' as const,
      icon: 'home',
      label: configPresent?.global === true
        ? t('config.sources.global')
        : t('config.sources.globalMissing')
    },
    {
      value: 'project' as const,
      icon: 'folder',
      label: configPresent?.project === true
        ? t('config.sources.project')
        : t('config.sources.projectMissing')
    },
    {
      value: 'user' as const,
      icon: 'person',
      label: configPresent?.user === true
        ? t('config.sources.user')
        : t('config.sources.userMissing')
    }
  ], [configPresent?.global, configPresent?.project, configPresent?.user, t])

  useEffect(() => {
    if (activeTab == null) return
    if (activeTab.type === 'group') return
    if (!configTabKeys.has(activeTab.key)) return
    const draftKey = `${sourceKey}:${activeTab.key}`
    setDrafts((prev) => {
      const currentDraft = prev[draftKey]
      const sourceValue = activeTab.value ?? {}
      if (currentDraft !== undefined) {
        if (isEmptyValue(currentDraft) && !isEmptyValue(sourceValue)) {
          return { ...prev, [draftKey]: cloneValue(sourceValue) }
        }
        return prev
      }
      return { ...prev, [draftKey]: cloneValue(sourceValue) }
    })
  }, [activeTab, configTabKeys, sourceKey])

  useEffect(() => {
    setSourceKeyState(querySourceKey)
  }, [querySourceKey])

  useEffect(() => {
    setActiveTabKeyState(queryTabKey)
  }, [queryTabKey])

  useEffect(() => {
    setDetailQueryState(queryValues.detail)
  }, [queryValues.detail])

  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])

  useEffect(() => {
    pendingConflictsRef.current = pendingConflicts
  }, [pendingConflicts])

  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach((timer) => {
        clearTimeout(timer)
      })
    }
  }, [])

  const clearSaveTimer = (draftKey: string) => {
    const timer = saveTimersRef.current[draftKey]
    if (timer == null) return
    clearTimeout(timer)
    delete saveTimersRef.current[draftKey]
  }

  const clearDraftConflict = (draftKey: string) => {
    delete blockedDraftKeysRef.current[draftKey]
    setPendingConflicts((prev) => {
      if (prev[draftKey] == null) return prev
      const next = { ...prev }
      delete next[draftKey]
      return next
    })
    setActiveConflictKey(prev => prev === draftKey ? null : prev)
  }

  const getDraftKey = (sectionKey: string, source = sourceKey) => getConfigDraftKey(sectionKey, source)
  const activeConfigDetail = useMemo(() => {
    if (activeContentTab == null) return null
    if (!configTabKeys.has(activeContentTab.key)) return null

    const fields = getSectionFields(activeContentTab.key)
    const route = parseConfigDetailRoute({
      fields,
      raw: activeTabKey === activeContentTab.key ? detailQuery : ''
    })
    if (route == null) return null

    const draftKey = getConfigDraftKey(activeContentTab.key, sourceKey)
    const value = drafts[draftKey] ?? cloneValue(activeContentTab.value ?? {}) ?? {}
    const resolvedValue = cloneValue(
      currentResolvedSource != null
        ? (currentResolvedSource as Record<string, unknown>)[activeContentTab.key]
        : undefined
    ) ?? {}
    const meta = resolveConfigDetailRouteMeta({
      sectionKey: activeContentTab.key,
      fields,
      value,
      resolvedValue,
      route,
      placeholderEntries: getConfigDetailPlaceholderEntries(activeContentTab.key),
      detailContext: {
        mergedModelServices,
        mergedAdapters,
        t
      },
      t
    })

    return meta == null ? null : { meta, route }
  }, [
    activeContentTab,
    activeTabKey,
    configTabKeys,
    currentResolvedSource,
    detailQuery,
    drafts,
    mergedAdapters,
    mergedModelServices,
    sourceKey,
    t
  ])
  const accountBreadcrumbAdapterKey = activeContentTab?.key === 'adapters' &&
      activeConfigDetail?.route.nestedPath?.[0] === 'accounts'
    ? activeConfigDetail.route.itemKey
    : null
  const { data: breadcrumbAdapterAccountsData } = useSWR<AdapterAccountsResult>(
    accountBreadcrumbAdapterKey != null ? `/api/adapters/${accountBreadcrumbAdapterKey}/accounts` : null,
    () => getAdapterAccounts(accountBreadcrumbAdapterKey!),
    {
      dedupingInterval: 30_000,
      keepPreviousData: true,
      revalidateOnFocus: false
    }
  )
  const accountBreadcrumbAccountKey = (
      accountBreadcrumbAdapterKey != null &&
      activeConfigDetail?.route.nestedPath?.[1] != null
    )
    ? activeConfigDetail.route.nestedPath[1]
    : null
  const { data: breadcrumbAdapterAccountDetailData } = useSWR<AdapterAccountDetailResult>(
    accountBreadcrumbAdapterKey != null && accountBreadcrumbAccountKey != null
      ? `/api/adapters/${accountBreadcrumbAdapterKey}/accounts/${accountBreadcrumbAccountKey}`
      : null,
    () => getAdapterAccountDetail(accountBreadcrumbAdapterKey!, accountBreadcrumbAccountKey!),
    {
      dedupingInterval: 30_000,
      keepPreviousData: true,
      revalidateOnFocus: false
    }
  )
  useEffect(() => {
    if (modelServicePortalTabsState.tabs.length > 0) return
    setModelServicePortalPanelOpen(false)
  }, [modelServicePortalTabsState.tabs.length])

  useEffect(() => {
    if (activeTabKey === 'savedPasswords') return
    setSavedPasswordDetailKey(null)
    setSavedPasswordDetailTitle(null)
    setSavedPasswordSettingsOpen(false)
  }, [activeTabKey])

  const handleOpenModelServicePortal = useCallback((request: ModelServiceProviderPortalRequest) => {
    setModelServicePortalTabsState(current => addModelServiceProviderPortalTab(current, request))
    setModelServicePortalPanelOpen(true)
  }, [])

  const handleCloseModelServicePortalPanel = useCallback(() => {
    setModelServicePortalPanelOpen(false)
  }, [])

  const handleModelServicePortalTabChange = useCallback((tabKey: string | null, openedTabs: string[]) => {
    setModelServicePortalTabsState(current => syncModelServiceProviderPortalTabs(current, tabKey, openedTabs))
  }, [])

  const handleModelServicePortalTabClose = useCallback((tabKey: string) => {
    setModelServicePortalTabsState(current => closeModelServiceProviderPortalTab(current, tabKey))
  }, [])

  const handleOpenModelServicePortalExternal = useCallback(async (url: string) => {
    try {
      await openExternalUrl(url)
    } catch {
      void message.error(t('config.modelServices.results.actionFailed'))
    }
  }, [message, t])
  const closeConfigDetail = useCallback(() => {
    const route = activeConfigDetail?.route
    if (route != null && (route.nestedPath?.length ?? 0) > 0) {
      if (isModelServiceDetailTabRoute(activeContentTab?.key, route)) {
        setDetailQuery('')
        return
      }
      setDetailQuery(serializeConfigDetailRoute({
        ...route,
        nestedPath: route.nestedPath?.slice(0, -1) ?? []
      }))
      return
    }
    setDetailQuery('')
  }, [activeConfigDetail?.route, activeContentTab?.key, setDetailQuery])
  const headerBreadcrumb = useMemo<RouteContainerHeaderBreadcrumb | undefined>(() => {
    if (activeTabKey === 'savedPasswords' && savedPasswordSettingsOpen) {
      return {
        currentTitle: t('browserDataSync.savedPasswords.settingsTitle'),
        parentTitle: t('config.sections.savedPasswords'),
        onBack: () => {
          setSavedPasswordSettingsOpen(false)
          setSavedPasswordDetailTitle(null)
        }
      }
    }
    if (activeTabKey === 'savedPasswords' && savedPasswordDetailTitle != null) {
      return {
        currentTitle: savedPasswordDetailTitle,
        parentTitle: t('config.sections.savedPasswords'),
        onBack: () => {
          setSavedPasswordDetailKey(null)
          setSavedPasswordDetailTitle(null)
          setSavedPasswordSettingsOpen(false)
        }
      }
    }
    if (activeConfigDetail == null || activeContentTab == null) return undefined
    const route = activeConfigDetail.route
    const rawNestedSegments = route.nestedPath ?? []
    const nestedSegments = rawNestedSegments.length === 1 && rawNestedSegments[0] === 'profiles'
      ? []
      : rawNestedSegments
    const getNestedSegmentLabel = (segment: string, index: number) => {
      if (index === 0 && segment === 'accounts') {
        return t('config.accounts.listTitle', {
          defaultValue: t('config.accounts.title')
        })
      }
      if (index === 0 && segment === 'profiles') return t('config.sectionGroups.profiles')
      if (
        index === 1 &&
        nestedSegments[0] === 'profiles' &&
        activeContentTab.key === 'modelServices'
      ) {
        return getModelServiceProfileBreadcrumbLabel(
          activeConfigDetail.meta.item,
          activeConfigDetail.meta.resolvedItem,
          segment
        )
      }
      if (index === 1 && nestedSegments[0] === 'accounts') {
        const detailAccount = breadcrumbAdapterAccountDetailData?.account.key === segment
          ? breadcrumbAdapterAccountDetailData.account
          : undefined
        const detailLabel = detailAccount?.email?.trim() || detailAccount?.title?.trim()
        if (detailLabel != null && detailLabel !== '') return detailLabel
        const runtimeAccount = breadcrumbAdapterAccountsData?.accounts.find(account => account.key === segment)
        if (runtimeAccount?.title != null && runtimeAccount.title.trim() !== '') {
          return runtimeAccount.title.trim()
        }
        const configuredLabel = getRecordMapEntryBreadcrumbLabel(
          'accounts',
          segment,
          activeConfigDetail.meta.item,
          activeConfigDetail.meta.resolvedItem,
          ...configSourceKeys.flatMap(source => [
            getValueByPath(data?.resolvedSources?.[source], [activeContentTab.key, route.itemKey]),
            getValueByPath(data?.sources?.[source], [activeContentTab.key, route.itemKey])
          ])
        )
        if (configuredLabel != null) return configuredLabel
        return toLabel(segment)
      }
      return toLabel(segment)
    }
    const ancestors = nestedSegments.length === 0
      ? []
      : [
        {
          title: activeConfigDetail.meta.itemLabel,
          onSelect: () => {
            setDetailQuery(serializeConfigDetailRoute({
              ...route,
              nestedPath: []
            }))
          }
        },
        ...nestedSegments.slice(0, -1).map((segment, index) => ({
          title: getNestedSegmentLabel(segment, index),
          onSelect: () => {
            setDetailQuery(serializeConfigDetailRoute({
              ...route,
              nestedPath: nestedSegments.slice(0, index + 1)
            }))
          }
        }))
      ]
    const currentTitle = nestedSegments.length > 0
      ? getNestedSegmentLabel(nestedSegments[nestedSegments.length - 1]!, nestedSegments.length - 1)
      : activeConfigDetail.meta.itemLabel

    return {
      ancestors,
      currentTitle,
      parentTitle: activeContentTab.label,
      onBack: closeConfigDetail
    }
  }, [
    activeConfigDetail,
    activeContentTab,
    activeTabKey,
    breadcrumbAdapterAccountDetailData?.account,
    breadcrumbAdapterAccountsData?.accounts,
    closeConfigDetail,
    data?.resolvedSources,
    data?.sources,
    savedPasswordSettingsOpen,
    savedPasswordDetailTitle,
    setDetailQuery,
    t
  ])
  const generalDraftValue = useMemo(() => {
    const draftKey = getDraftKey('general')
    return (drafts[draftKey] ?? cloneValue(currentSource?.general ?? {}) ?? {}) as Record<string, unknown>
  }, [drafts, currentSource?.general, sourceKey])
  const selectedModelService = (() => {
    const value = getValueByPath(generalDraftValue, ['defaultModelService'])
    if (typeof value === 'string' && value !== '') return value
    const fallbackValue = getValueByPath(currentResolvedSource?.general, ['defaultModelService'])
    return typeof fallbackValue === 'string' && fallbackValue !== '' ? fallbackValue : undefined
  })()
  const worktreeEnvironmentOptions = useMemo(() => (
    worktreeEnvironmentData?.environments.map(environment => ({
      value: toEnvironmentReference(environment),
      label: `${toDisplayEnvironmentName(environment.id)} (${
        environment.isLocal
          ? t('config.environments.sources.user')
          : t('config.environments.sources.project')
      })`
    })) ?? []
  ), [t, worktreeEnvironmentData?.environments])
  const workspaceFileOpenerOptions = useMemo(() => (
    resolveWorkspaceFileOpenerSelectModels(workspaceFileOpenersData).map(opener => ({
      value: opener.value,
      label: (
        <span className='config-view__opener-option'>
          <span className='material-symbols-rounded config-view__opener-option-icon'>{opener.icon}</span>
          <span className='config-view__opener-option-label'>
            {opener.kind === 'auto'
              ? opener.defaultOpenerTitle != null
                ? t('config.options.messageLinks.workspaceFileOpener.autoWithDefault', {
                  name: opener.defaultOpenerValue != null
                    ? t(`config.options.messageLinks.workspaceFileOpener.${opener.defaultOpenerValue}`, {
                      defaultValue: opener.defaultOpenerTitle
                    })
                    : opener.defaultOpenerTitle
                })
                : t('config.options.messageLinks.workspaceFileOpener.auto')
              : t(`config.options.messageLinks.workspaceFileOpener.${opener.value}`, {
                defaultValue: opener.title ?? opener.value
              })}
          </span>
        </span>
      )
    }))
  ), [t, workspaceFileOpenersData])

  const persistDraftValue = async ({
    draftKey,
    sectionKey,
    source,
    value
  }: {
    draftKey: string
    sectionKey: string
    source: ConfigSource
    value: unknown
  }) => {
    const serialized = serializeComparableConfigValue(value)

    if (savingRef.current[draftKey]) {
      throw new Error(`config draft ${draftKey} is already saving`)
    }

    savingRef.current[draftKey] = true
    try {
      await updateConfig(source, sectionKey, value, {
        unsetPaths: collectUnsetPaths(value)
      })
      if (
        source === 'global' &&
        sectionKey === 'appearance' &&
        isRecordObject(value) &&
        window.oneworksDesktop?.updateGlobalAppearanceConfig != null
      ) {
        await window.oneworksDesktop.updateGlobalAppearanceConfig({
          ...(typeof value.primaryColor === 'string'
            ? { primaryColor: value.primaryColor as DesktopSettings['primaryColor'] }
            : {}),
          ...(value.themeMode === 'light' || value.themeMode === 'dark' || value.themeMode === 'system'
            ? { themeMode: value.themeMode }
            : {}),
          ...(typeof value.themePack === 'string' ? { themePack: value.themePack } : {}),
          ...(isRecordObject(value.themePacks)
            ? { themePacks: value.themePacks as DesktopSettings['themePacks'] }
            : {})
        })
      }
      lastSavedRef.current[draftKey] = serialized
      baseSnapshotsRef.current[draftKey] = serialized
      await mutate()
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('config.saveFailed')))
      throw error
    } finally {
      savingRef.current[draftKey] = false
    }
  }

  const scheduleSave = (sectionKey: string, source: ConfigSource, nextValue: unknown) => {
    const draftKey = getDraftKey(sectionKey, source)
    if (blockedDraftKeysRef.current[draftKey]) {
      clearSaveTimer(draftKey)
      return
    }

    const serialized = serializeComparableConfigValue(nextValue)
    if (lastSavedRef.current[draftKey] === serialized) {
      return
    }
    clearSaveTimer(draftKey)
    saveTimersRef.current[draftKey] = setTimeout(async () => {
      if (blockedDraftKeysRef.current[draftKey]) return
      if (savingRef.current[draftKey]) return
      const currentValue = draftsRef.current[draftKey] ?? nextValue
      const currentSerialized = serializeComparableConfigValue(currentValue)
      if (lastSavedRef.current[draftKey] === currentSerialized) return
      try {
        await persistDraftValue({
          draftKey,
          sectionKey,
          source,
          value: currentValue
        })
      } catch {}
    }, 800)
  }

  const handleDraftChange = (sectionKey: string, nextValue: unknown, source = sourceKey) => {
    const draftKey = getDraftKey(sectionKey, source)
    setDrafts(prev => ({ ...prev, [draftKey]: nextValue }))
    scheduleSave(sectionKey, source, nextValue)
  }

  useEffect(() => {
    if (!canRenderConfig) return

    const imported = parseModelServiceQueryImport(searchParams)
    if (imported == null) return

    const importSignature = searchParams.toString()
    if (consumedModelServiceImportRef.current === importSignature) return
    consumedModelServiceImportRef.current = importSignature

    const targetSource = isConfigSourceKey(searchParams.get('source') ?? '')
      ? searchParams.get('source') as ConfigSource
      : 'global'
    const draftKey = getConfigDraftKey('modelServices', targetSource)
    const serverValue = data?.sources?.[targetSource]?.modelServices
    const currentValue = draftsRef.current[draftKey] ?? cloneValue(serverValue ?? {}) ?? {}
    const currentModelServices = isRecordObject(currentValue) ? currentValue : {}
    const itemKey = resolveUniqueModelServiceKey(imported.key, currentModelServices)
    const nextModelServices = {
      ...currentModelServices,
      [itemKey]: imported.service
    }
    const detail = serializeConfigDetailRoute({
      kind: 'detailCollectionItem',
      fieldPath: [],
      itemKey
    })

    setSourceKeyState(targetSource)
    setActiveTabKeyState('modelServices')
    setDetailQueryState(detail)
    setDrafts(prev => ({ ...prev, [draftKey]: nextModelServices }))
    scheduleSave('modelServices', targetSource, nextModelServices)
    updateConfigRoute({
      ...getModelServiceImportClearPatch(),
      detail,
      section: '',
      source: targetSource,
      tab: 'modelServices'
    })
    void message.success(t('config.modelServices.import.created', { name: itemKey }))
  }, [
    canRenderConfig,
    data?.sources,
    message,
    searchParams,
    scheduleSave,
    t,
    updateConfigRoute
  ])

  const handleCreateModelServiceSession = useCallback(async (request: ModelServiceConfigSessionRequest) => {
    const actionKey = getModelServiceConfigSessionActionKey(request)
    if (creatingModelServiceSessionKey != null) return

    setCreatingModelServiceSessionKey(actionKey)
    try {
      const language = i18n.resolvedLanguage ?? i18n.language
      const title = buildModelServiceConfigSessionTitle(request, { language })
      const initialContent = buildModelServiceConfigSessionInitialContent(request, {
        language,
        globalConfigPath: data?.meta?.sourceFiles?.global?.writableConfigPath,
        projectConfigPath: data?.meta?.sourceFiles?.project?.writableConfigPath,
        userConfigPath: data?.meta?.sourceFiles?.user?.writableConfigPath
      })
      setPendingSessionCreationContext({
        initialContent,
        tags: ['config', 'model-services'],
        title
      })
      navigate('/')
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('config.actions.modelServiceSessionCreateFailed')))
    } finally {
      setCreatingModelServiceSessionKey(null)
    }
  }, [
    creatingModelServiceSessionKey,
    data?.meta?.sourceFiles?.global?.writableConfigPath,
    data?.meta?.sourceFiles?.project?.writableConfigPath,
    data?.meta?.sourceFiles?.user?.writableConfigPath,
    i18n.language,
    i18n.resolvedLanguage,
    message,
    navigate,
    setPendingSessionCreationContext,
    t
  ])

  useEffect(() => {
    const nextDrafts: Record<string, unknown> = {}
    let hasDraftUpdates = false
    const previousConflicts = pendingConflictsRef.current
    let nextConflicts = previousConflicts
    let conflictsChanged = false
    const ensureMutableConflicts = () => {
      if (!conflictsChanged) {
        nextConflicts = { ...previousConflicts }
        conflictsChanged = true
      }
      return nextConflicts
    }
    configSourceKeys.forEach((source) => {
      const sourceData = data?.sources?.[source]
      if (sourceData == null) return

      configTabKeys.forEach((sectionKey) => {
        const draftKey = getConfigDraftKey(sectionKey, source)
        const serverValue = cloneValue((sourceData as Record<string, unknown>)[sectionKey] ?? {}) ?? {}
        const serverSerialized = serializeComparableConfigValue(serverValue)
        const baseSerialized = baseSnapshotsRef.current[draftKey]

        if (baseSerialized == null) {
          baseSnapshotsRef.current[draftKey] = serverSerialized
          lastSavedRef.current[draftKey] ??= serverSerialized
          return
        }

        const currentDraft = draftsRef.current[draftKey]
        if (currentDraft === undefined) {
          baseSnapshotsRef.current[draftKey] = serverSerialized
          lastSavedRef.current[draftKey] = serverSerialized
          delete blockedDraftKeysRef.current[draftKey]
          if (nextConflicts[draftKey] != null) {
            delete ensureMutableConflicts()[draftKey]
          }
          return
        }

        const draftSerialized = serializeComparableConfigValue(currentDraft)
        const action = resolveRemoteConfigChangeAction({
          baseSerialized,
          draftSerialized,
          serverSerialized
        })

        if (action === 'sync-remote') {
          clearSaveTimer(draftKey)
          delete blockedDraftKeysRef.current[draftKey]
          baseSnapshotsRef.current[draftKey] = serverSerialized
          lastSavedRef.current[draftKey] = serverSerialized
          nextDrafts[draftKey] = serverValue
          hasDraftUpdates = true
          if (nextConflicts[draftKey] != null) {
            delete ensureMutableConflicts()[draftKey]
          }
          return
        }

        if (action === 'conflict') {
          clearSaveTimer(draftKey)
          blockedDraftKeysRef.current[draftKey] = true
          const existingConflict = nextConflicts[draftKey]
          const existingRemoteSerialized = existingConflict == null
            ? undefined
            : serializeComparableConfigValue(existingConflict.remoteValue)
          if (
            existingConflict?.sectionKey !== sectionKey ||
            existingConflict?.source !== source ||
            existingRemoteSerialized !== serverSerialized
          ) {
            ensureMutableConflicts()[draftKey] = {
              draftKey,
              sectionKey,
              source,
              remoteValue: serverValue
            }
          }
          return
        }

        if (draftSerialized === serverSerialized) {
          baseSnapshotsRef.current[draftKey] = serverSerialized
          lastSavedRef.current[draftKey] = serverSerialized
        }

        delete blockedDraftKeysRef.current[draftKey]
        if (nextConflicts[draftKey] != null) {
          delete ensureMutableConflicts()[draftKey]
        }
      })
    })

    if (conflictsChanged) {
      setPendingConflicts(nextConflicts)
    }

    if (!hasDraftUpdates) return

    setDrafts((prev) => {
      let changed = false
      const next = { ...prev }
      Object.entries(nextDrafts).forEach(([draftKey, value]) => {
        const currentSerialized = serializeComparableConfigValue(prev[draftKey])
        const nextSerialized = serializeComparableConfigValue(value)
        if (currentSerialized === nextSerialized) return
        next[draftKey] = value
        changed = true
      })
      return changed ? next : prev
    })
  }, [configTabKeys, data?.sources?.global, data?.sources?.project, data?.sources?.user])

  useEffect(() => {
    if (activeConflictKey != null) return

    const nextConflict = Object.values(pendingConflicts)[0]
    if (nextConflict == null) return

    const draftKey = nextConflict.draftKey
    setActiveConflictKey(draftKey)

    const sourceLabel = t(`config.sources.${nextConflict.source}`)
    const sectionLabel = t(`config.sections.${nextConflict.sectionKey}`, { defaultValue: nextConflict.sectionKey })

    modal.confirm({
      title: t('config.conflict.title'),
      content: (
        <div>
          <div>
            {t('config.conflict.description', {
              source: sourceLabel,
              target: sectionLabel
            })}
          </div>
          <div>{t('config.conflict.instructions')}</div>
        </div>
      ),
      okText: t('config.conflict.keepLocal'),
      cancelText: t('config.conflict.useRemote'),
      cancelButtonProps: { danger: true },
      closable: false,
      keyboard: false,
      maskClosable: false,
      onOk: async () => {
        const currentConflict = pendingConflictsRef.current[draftKey]
        const sectionKey = currentConflict?.sectionKey ?? nextConflict.sectionKey
        const source = currentConflict?.source ?? nextConflict.source
        const currentDraft = cloneValue(
          draftsRef.current[draftKey] ?? currentConflict?.remoteValue ?? nextConflict.remoteValue ?? {}
        ) ?? {}

        await persistDraftValue({
          draftKey,
          sectionKey,
          source,
          value: currentDraft
        })

        clearDraftConflict(draftKey)
      },
      onCancel: () => {
        const currentConflict = pendingConflictsRef.current[draftKey] ?? nextConflict
        const remoteValue = cloneValue(currentConflict.remoteValue ?? {}) ?? {}
        const remoteSerialized = serializeComparableConfigValue(remoteValue)

        clearSaveTimer(draftKey)
        baseSnapshotsRef.current[draftKey] = remoteSerialized
        lastSavedRef.current[draftKey] = remoteSerialized
        setDrafts(prev => ({ ...prev, [draftKey]: remoteValue }))
        clearDraftConflict(draftKey)
      }
    })
  }, [activeConflictKey, modal, pendingConflicts, t])

  const routeSidebarGroups = useMemo(() =>
    desktopNavGroups.map(group => ({
      icon: group.key === 'group-app' ? 'apps' : 'tune',
      key: group.key,
      label: group.label,
      items: group.tabs.map(tab => ({
        icon: tab.icon,
        key: tab.key,
        label: tab.label,
        searchText: `${tab.key} ${String(tab.label)}`
      }))
    })), [desktopNavGroups])

  const handleRouteSidebarSelect = useCallback((item: RouteSidebarListItem) => {
    setActiveTabKey(item.key)
    closeRouteSidebar()
  }, [closeRouteSidebar, setActiveTabKey])

  const handleCreateVoiceSetupSession = useCallback(() => {
    setPendingSessionInitialContent([{ type: 'text', text: t('config.voice.aiAssist.prompt') }])
    void navigate('/')
  }, [navigate, setPendingSessionInitialContent, t])

  useLayoutEffect(() => {
    if (!hasRouteSidebarProvider) return

    setRouteSidebar({
      activeKey: activeTabKey,
      ariaLabel: t('common.settings'),
      contextMenuItems: routePluginSidebarContextMenu,
      emptyText: t('config.navigation.noResults'),
      groups: routeSidebarGroups,
      key: CONFIG_ROUTE_SIDEBAR_KEY,
      search: {
        placeholder: t('config.navigation.search'),
        value: navSearchQuery,
        onChange: setNavSearchQuery
      },
      onSelectItem: handleRouteSidebarSelect
    })

    return () => clearRouteSidebar(CONFIG_ROUTE_SIDEBAR_KEY)
  }, [
    clearRouteSidebar,
    activeTabKey,
    hasRouteSidebarProvider,
    handleRouteSidebarSelect,
    navSearchQuery,
    routePluginSidebarContextMenu,
    routeSidebarGroups,
    setRouteSidebar,
    t
  ])

  const globalAppearanceDraft = (drafts[getDraftKey('appearance', 'global')] ??
    cloneValue(globalSource?.appearance) ??
    {}) as Record<string, unknown>
  const globalAppearanceDisplay = mergeAppearanceConfigForEditing(
    globalResolvedSource?.appearance,
    globalAppearanceDraft
  )

  const renderTabContent = (tab: typeof tabs[number]) => (
    <div key={`${sourceKey}:${tab.key}`} className='config-view__content'>
      {tab.key === 'about' && (
        <AboutSection value={tab.value as AboutInfo | undefined} />
      )}
      {tab.key === 'appearance' && (
        <AppSettingsPanel
          appearance={globalAppearanceDisplay}
          rawAppearance={globalAppearanceDraft}
          t={t}
          showHeader={false}
          onAppearanceChange={(next) => handleDraftChange('appearance', next, 'global')}
        />
      )}
      {tab.key === 'themes' && (
        <ThemePackSettingsPanel
          appearance={globalAppearanceDisplay}
          rawAppearance={globalAppearanceDraft}
          t={t}
          onAppearanceChange={(next) => handleDraftChange('appearance', next, 'global')}
        />
      )}
      {tab.key === 'desktop' && (
        <DesktopSettingsPanel showHeader={false} t={t} />
      )}
      {tab.key === 'browserHistory' && (
        <BrowserActivityPanel
          initialProjectKeys={browserActivityRouteContext.projectKeys}
          initialSessionKey={browserActivityRouteContext.sessionKey}
          kind='history'
          showHeader={false}
        />
      )}
      {tab.key === 'browserDownloads' && (
        <BrowserActivityPanel
          initialProjectKeys={browserActivityRouteContext.projectKeys}
          initialSessionKey={browserActivityRouteContext.sessionKey}
          kind='downloads'
          showHeader={false}
        />
      )}
      {tab.key === 'savedPasswords' && (
        <SavedPasswordManagerPanel
          selectedGroupKey={savedPasswordDetailKey}
          settingsOpen={savedPasswordSettingsOpen}
          showHeader={false}
          onDetailTitleChange={setSavedPasswordDetailTitle}
          onSelectedGroupKeyChange={setSavedPasswordDetailKey}
          onSettingsOpenChange={setSavedPasswordSettingsOpen}
        />
      )}
      {tab.key === 'worktreeEnvironments' && (
        <WorktreeEnvironmentPanel
          t={t}
          onHeaderActionsChange={setWorktreeEnvironmentHeaderActions}
        />
      )}
      {tab.key === 'externalSessions' && (
        <ExternalSessionsPanel
          config={generalDraftValue.nativeHistoryImport as NativeHistoryImportSettings | undefined}
          showHeader={false}
          onConfigChange={(next) => {
            handleDraftChange('general', {
              ...generalDraftValue,
              nativeHistoryImport: next
            })
          }}
        />
      )}
      {'pluginSettingsPage' in tab && tab.pluginSettingsPage != null && (
        <PluginSettingsPage page={tab.pluginSettingsPage} />
      )}
      {tab.key !== 'about' &&
        tab.key !== 'browserDownloads' &&
        tab.key !== 'browserHistory' &&
        tab.key !== 'desktop' &&
        tab.key !== 'savedPasswords' &&
        tab.key !== 'appearance' &&
        tab.key !== 'themes' &&
        tab.key !== 'externalSessions' &&
        tab.key !== 'worktreeEnvironments' &&
        !('pluginSettingsPage' in tab) &&
        !configTabKeys.has(tab.key) && (
          <DisplayValue value={tab.value} sectionKey={tab.key} t={t} />
        )}
      {configTabKeys.has(tab.key) && tab.key !== 'appearance' && (
        <ConfigSectionPanel
          sectionKey={tab.key}
          title={tab.label}
          icon={tab.icon}
          uiSection={uiSections[tab.key] as ConfigUiSection | undefined}
          value={drafts[getDraftKey(tab.key)] ?? cloneValue(tab.value ?? {}) ?? {}}
          resolvedValue={cloneValue(
            currentResolvedSource != null
              ? (currentResolvedSource as Record<string, unknown>)[tab.key]
              : undefined
          ) ?? {}}
          source={sourceKey}
          onChange={(next) => handleDraftChange(tab.key, next)}
          mergedModelServices={mergedModelServices as Record<string, unknown>}
          mergedAdapters={mergedAdapters as Record<string, unknown>}
          selectedModelService={selectedModelService}
          worktreeEnvironmentOptions={worktreeEnvironmentOptions}
          workspaceFileOpenerOptions={workspaceFileOpenerOptions}
          detailQuery={activeTabKey === tab.key ? detailQuery : ''}
          onDetailQueryChange={activeTabKey === tab.key ? setDetailQuery : undefined}
          onOpenModelServicePortal={activeTabKey === tab.key ? handleOpenModelServicePortal : undefined}
          creatingModelServiceSessionKey={creatingModelServiceSessionKey}
          onCreateModelServiceSession={handleCreateModelServiceSession}
          t={t}
          showHeader={false}
        />
      )}
    </div>
  )
  const shouldShowSourceSwitch = activeTabKey !== 'appearance' &&
    (configTabKeys.has(activeTabKey) || activeTabKey === 'externalSessions')
  const shouldShowSavedPasswordSettingsAction = activeTabKey === 'savedPasswords' && !savedPasswordSettingsOpen
  const savedPasswordHeaderTitle = savedPasswordSettingsOpen
    ? t('browserDataSync.savedPasswords.settingsTitle')
    : savedPasswordDetailTitle
  const savedPasswordHeaderActions = useMemo<RouteContainerHeaderActionItem[]>(() => (
    shouldShowSavedPasswordSettingsAction
      ? [{
        icon: 'settings',
        key: 'saved-password-settings',
        label: t('browserDataSync.savedPasswords.settingsTitle'),
        onSelect: () => {
          setSavedPasswordDetailKey(null)
          setSavedPasswordSettingsOpen(true)
        }
      }]
      : []
  ), [shouldShowSavedPasswordSettingsAction, t])
  const headerActionItems = useMemo<RouteContainerHeaderActionItem[]>(() => [
    ...routePluginHeaderActions,
    ...savedPasswordHeaderActions,
    ...(activeTabKey === 'worktreeEnvironments' ? worktreeEnvironmentHeaderActions : []),
    ...(activeTabKey === 'voice'
      ? [{
        icon: 'auto_awesome',
        key: 'voice-ai-assist',
        label: t('config.voice.aiAssist.label'),
        onSelect: handleCreateVoiceSetupSession
      }]
      : []),
    ...(shouldShowSourceSwitch
      ? sourceOptions.map(option => ({
        active: sourceKey === option.value,
        icon: option.icon,
        key: `config-source-${option.value}`,
        label: String(option.label),
        onSelect: () => setSourceKey(option.value)
      }))
      : [])
  ], [
    activeTabKey,
    handleCreateVoiceSetupSession,
    routePluginHeaderActions,
    savedPasswordHeaderActions,
    setSourceKey,
    shouldShowSourceSwitch,
    sourceKey,
    sourceOptions,
    t,
    worktreeEnvironmentHeaderActions
  ])

  return (
    <RouteContainerLayout
      className={`config-view ${isCompactView ? 'config-view--compact' : ''}`}
      bodyClassName={`config-view__body ${isCompactView ? 'config-view__body--compact' : 'config-view__body--desktop'}`}
      bottomPanel={isModelServicePortalPanelOpen && modelServicePortalTabsState.tabs.length > 0
        ? ({ isClosing }) => (
          <ModelServiceProviderPortalBottomPanel
            activeTabKey={modelServicePortalTabsState.activeTabKey}
            isOpen={!isClosing}
            tabs={modelServicePortalTabsState.tabs}
            t={t}
            onClose={handleCloseModelServicePortalPanel}
            onOpenExternal={(url) => void handleOpenModelServicePortalExternal(url)}
            onTabChange={handleModelServicePortalTabChange}
            onTabClose={handleModelServicePortalTabClose}
          />
        )
        : undefined}
      contentInset
      header={
        <RouteContainerHeader
          actionItems={headerActionItems}
          breadcrumb={headerBreadcrumb}
          icon={activeContentTab?.icon ?? 'settings'}
          onOpenSidebar={openRouteSidebar}
          title={savedPasswordHeaderTitle ?? activeConfigDetail?.meta.itemLabel ?? activeContentTab?.label ??
            t('common.settings')}
        />
      }
    >
      {isLoading && (
        <div className='config-view__state'>
          <Spin />
        </div>
      )}
      {hasConfigLoadError && (
        <RouteErrorState
          actions={[
            {
              kind: 'reload',
              loading: isValidating,
              onClick: () => void mutate()
            },
            {
              kind: 'home',
              onClick: () => void navigate('/')
            }
          ]}
          description={t('errorState.configLoadFailedDescription')}
          details={{
            copyText: getApiErrorMessage(error, t('config.loadFailed')),
            items: [{ label: t('errorState.diagnostics'), value: getApiErrorMessage(error, t('config.loadFailed')) }],
            title: t('errorState.diagnostics')
          }}
          mobileDescription={t('config.loadFailed')}
          title={t('config.loadFailed')}
        />
      )}
      {canRenderConfig && activeContentTab != null ? renderTabContent(activeContentTab) : null}
    </RouteContainerLayout>
  )
}
