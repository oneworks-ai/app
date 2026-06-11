import './ConfigView.scss'

import { App, Button, Empty, Space, Spin } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import type { RouteContainerHeaderBreadcrumb } from '@oneworks/components/route-layout'
import type { ConfigSource } from '@oneworks/core'
import type { AboutInfo, ConfigResponse, ConfigUiSection } from '@oneworks/types'

import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteSidebar } from '#~/components/layout/route-sidebar-context'
import type { RouteSidebarListItem } from '#~/components/layout/route-sidebar-context'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import { useRoutePluginChrome } from '#~/plugins/route-plugin-chrome'

import {
  getApiErrorMessage,
  getConfig,
  getConfigSchema,
  listWorkspaceFileOpeners,
  listWorktreeEnvironments,
  updateConfig
} from '../api'
import { useQueryParams } from '../hooks/useQueryParams'
import { resolveWorkspaceFileOpenerSelectModels } from '../utils/workspace-file-openers'
import { AboutSection, ConfigSectionPanel, ConfigSourceSwitch, DisplayValue } from './config'
import { AppSettingsPanel } from './config/AppSettingsPanel'
import { DesktopSettingsPanel } from './config/DesktopSettingsPanel'
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
import { cloneValue, collectUnsetPaths, getValueByPath, isEmptyValue } from './config/configUtils'
import { editableConfigSectionKeys } from './config/editableConfigSections'
import { toDisplayEnvironmentName, toEnvironmentReference } from './config/worktree-environment-panel-model'

interface ConfigDraftConflict {
  draftKey: string
  sectionKey: string
  source: ConfigSource
  remoteValue: unknown
}

interface ConfigQueryParams extends Record<string, string> {
  detail: string
  source: string
  tab: string
}

const configSourceKeys = ['global', 'project', 'user'] as const
const configQueryKeys: string[] = ['tab', 'source', 'detail']
const configQueryDefaults: ConfigQueryParams = { tab: 'general', source: 'project', detail: '' }
const configQueryOmit = {
  detail: (value: string) => value.trim() === ''
}
const CONFIG_ROUTE_SIDEBAR_KEY = 'config-view'

const isConfigSourceKey = (value: string): value is ConfigSource => (
  configSourceKeys.includes(value as ConfigSource)
)

export function ConfigView() {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
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
  const { values: queryValues, update: updateQuery, searchParams } = useQueryParams<ConfigQueryParams>({
    defaults: configQueryDefaults,
    keys: configQueryKeys,
    omit: configQueryOmit
  })
  const querySourceKey: ConfigSource = isConfigSourceKey(queryValues.source) ? queryValues.source : 'project'
  const [sourceKey, setSourceKeyState] = useState<ConfigSource>(querySourceKey)
  const [detailQuery, setDetailQueryState] = useState(queryValues.detail)
  const [navSearchQuery, setNavSearchQuery] = useState('')
  const [drafts, setDrafts] = useState<Record<string, unknown>>({})
  const configPresent = data?.meta?.configPresent
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
  const mergedModelServices = useMemo(() => data?.sources?.merged?.modelServices ?? {}, [
    data?.sources?.merged?.modelServices
  ])
  const mergedAdapters = useMemo(() => data?.sources?.merged?.adapters ?? {}, [
    data?.sources?.merged?.adapters
  ])
  const hasDesktopSettings = window.oneworksDesktop?.getDesktopSettings != null &&
    window.oneworksDesktop.updateDesktopSettings != null
  const hasConfigLoadError = !isLoading && data == null && error != null
  const canRenderConfig = !isLoading && data != null

  useEffect(() => {
    if (searchParams.get('source') != null) return
    if (configPresent?.project) {
      updateQuery({ source: 'project' })
    } else if (configPresent?.user) {
      updateQuery({ source: 'user' })
    } else if (configPresent?.global) {
      updateQuery({ source: 'global' })
    }
  }, [configPresent?.global, configPresent?.project, configPresent?.user])

  const configTabKeys = useMemo(() => new Set<string>(editableConfigSectionKeys), [])

  const tabs = useMemo(() => [
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
    { key: 'mcp', icon: 'account_tree', label: t('config.sections.mcp'), value: currentSource?.mcp },
    { key: 'shortcuts', icon: 'keyboard', label: t('config.sections.shortcuts'), value: currentSource?.shortcuts },
    { key: 'group-app', type: 'group', label: t('config.groups.app') },
    ...(hasDesktopSettings
      ? [{ key: 'desktop', icon: 'desktop_windows', label: t('config.sections.desktop') }]
      : []),
    { key: 'appearance', icon: 'tune', label: t('config.sections.appearance'), value: globalSource?.appearance },
    { key: 'experiments', icon: 'science', label: t('config.sections.experiments'), value: currentSource?.experiments },
    { key: 'about', icon: 'info', label: t('config.sections.about'), value: data?.meta?.about }
  ], [currentSource, data?.meta?.about, globalSource?.appearance, hasDesktopSettings, t])
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

  const queryTabKey = tabKeys.has(queryValues.tab) ? queryValues.tab : 'general'
  const [activeTabKey, setActiveTabKeyState] = useState(queryTabKey)
  const setSourceKey = useCallback((next: ConfigSource) => {
    setSourceKeyState(next)
    updateQuery({ source: next })
  }, [updateQuery])
  const setDetailQuery = useCallback((next: string) => {
    setDetailQueryState(next)
    updateQuery({ detail: next })
  }, [updateQuery])
  const setActiveTabKey = useCallback((key: string) => {
    setActiveTabKeyState(key)
    setDetailQueryState('')
    updateQuery({ tab: key, detail: '' })
  }, [updateQuery])
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
  const closeConfigDetail = useCallback(() => {
    const route = activeConfigDetail?.route
    if (route != null && (route.nestedPath?.length ?? 0) > 0) {
      setDetailQuery(serializeConfigDetailRoute({
        ...route,
        nestedPath: route.nestedPath?.slice(0, -1) ?? []
      }))
      return
    }
    setDetailQuery('')
  }, [activeConfigDetail?.route, setDetailQuery])
  const headerBreadcrumb = useMemo<RouteContainerHeaderBreadcrumb | undefined>(() => {
    if (activeConfigDetail == null || activeContentTab == null) return undefined

    return {
      currentTitle: activeConfigDetail.meta.itemLabel,
      parentTitle: activeContentTab.label,
      onBack: closeConfigDetail
    }
  }, [activeConfigDetail, activeContentTab, closeConfigDetail])
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

  const renderTabContent = (tab: typeof tabs[number]) => (
    <div key={`${sourceKey}:${tab.key}`} className='config-view__content'>
      {tab.key === 'about' && (
        <AboutSection value={tab.value as AboutInfo | undefined} />
      )}
      {tab.key === 'appearance' && (
        <AppSettingsPanel
          appearance={(drafts[getDraftKey('appearance', 'global')] ??
            cloneValue({
              ...(globalResolvedSource?.appearance ?? {}),
              ...(globalSource?.appearance ?? {})
            }) ??
            {}) as Record<string, unknown>}
          t={t}
          showHeader={false}
          onAppearanceChange={(next) => handleDraftChange('appearance', next, 'global')}
        />
      )}
      {tab.key === 'desktop' && (
        <DesktopSettingsPanel showHeader={false} t={t} />
      )}
      {tab.key === 'worktreeEnvironments' && (
        <WorktreeEnvironmentPanel t={t} />
      )}
      {tab.key !== 'about' &&
        tab.key !== 'desktop' &&
        tab.key !== 'appearance' &&
        tab.key !== 'worktreeEnvironments' &&
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
          onChange={(next) => handleDraftChange(tab.key, next)}
          mergedModelServices={mergedModelServices as Record<string, unknown>}
          mergedAdapters={mergedAdapters as Record<string, unknown>}
          selectedModelService={selectedModelService}
          worktreeEnvironmentOptions={worktreeEnvironmentOptions}
          workspaceFileOpenerOptions={workspaceFileOpenerOptions}
          detailQuery={activeTabKey === tab.key ? detailQuery : ''}
          onDetailQueryChange={activeTabKey === tab.key ? setDetailQuery : undefined}
          t={t}
          showHeader={false}
        />
      )}
    </div>
  )
  const shouldShowSourceSwitch = activeTabKey !== 'appearance' && configTabKeys.has(activeTabKey)
  const headerActions = shouldShowSourceSwitch
    ? (
      <ConfigSourceSwitch
        value={sourceKey}
        onChange={setSourceKey}
        options={sourceOptions}
      />
    )
    : undefined

  return (
    <RouteContainerLayout
      className={`config-view ${isCompactView ? 'config-view--compact' : ''}`}
      bodyClassName={`config-view__body ${isCompactView ? 'config-view__body--compact' : 'config-view__body--desktop'}`}
      contentInset
      header={
        <RouteContainerHeader
          actionItems={routePluginHeaderActions}
          actions={headerActions}
          breadcrumb={headerBreadcrumb}
          icon={activeContentTab?.icon ?? 'settings'}
          onOpenSidebar={openRouteSidebar}
          title={activeConfigDetail?.meta.itemLabel ?? activeContentTab?.label ?? t('common.settings')}
        />
      }
    >
      {isLoading && (
        <div className='config-view__state'>
          <Spin />
        </div>
      )}
      {hasConfigLoadError && (
        <div className='config-view__state'>
          <div className='config-view__state-content'>
            <Empty description={t('config.loadFailed')} />
            <Space>
              <Button
                type='primary'
                className='config-view__state-action'
                loading={isValidating}
                icon={<span className='material-symbols-rounded'>refresh</span>}
                onClick={() => void mutate()}
              >
                {t('config.reload')}
              </Button>
              <Button
                className='config-view__state-action'
                icon={<span className='material-symbols-rounded'>home</span>}
                onClick={() => void navigate('/')}
              >
                {t('common.backToHome')}
              </Button>
            </Space>
          </div>
        </div>
      )}
      {canRenderConfig && activeTab != null ? renderTabContent(activeTab) : null}
    </RouteContainerLayout>
  )
}
