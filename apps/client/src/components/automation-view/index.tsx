import './index.scss'

import { App, Button, Tooltip } from 'antd'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import type { AutomationRule, AutomationRun } from '#~/api.js'
import {
  createAutomationRule,
  deleteAutomationRule,
  getApiErrorMessage,
  listAutomationRules,
  listAutomationRuns,
  runAutomationRule,
  updateAutomationRule
} from '#~/api.js'
import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import type { RouteContainerHeaderActionItem } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteSidebar } from '#~/components/layout/route-sidebar-context'
import type { RouteSidebarListItem } from '#~/components/layout/route-sidebar-context'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import { useQueryParams } from '#~/hooks/useQueryParams.js'
import { useRoutePluginChrome } from '#~/plugins/route-plugin-chrome'

import { RuleFormPanel } from './RuleFormPanel.js'
import type { AutomationCreateMode, RuleFormPanelHandle } from './RuleFormPanel.js'
import { RunHistoryPanel } from './RunHistoryPanel.js'

type PanelMode = 'view' | 'create' | 'edit'

interface AutomationQueryParams extends Record<string, string> {
  rule: string
  mode: string
  q: string
  runQ: string
  status: string
  time: string
  sort: string
}

const EMPTY_AUTOMATION_RULES: AutomationRule[] = []
const EMPTY_AUTOMATION_RUNS: AutomationRun[] = []
const AUTOMATION_QUERY_KEYS: Array<Extract<keyof AutomationQueryParams, string>> = [
  'rule',
  'mode',
  'q',
  'runQ',
  'status',
  'time',
  'sort'
]
const AUTOMATION_QUERY_DEFAULTS: Partial<AutomationQueryParams> = {
  rule: '',
  mode: '',
  q: '',
  runQ: '',
  status: 'all',
  time: 'all',
  sort: 'desc'
}
const AUTOMATION_QUERY_OMIT: Partial<Record<Extract<keyof AutomationQueryParams, string>, (value: string) => boolean>> =
  {
    rule: (value: string) => value === '',
    mode: (value: string) => value === '',
    q: (value: string) => value === '',
    runQ: (value: string) => value === '',
    status: (value: string) => value === 'all',
    time: (value: string) => value === 'all',
    sort: (value: string) => value === 'desc'
  }

export function AutomationView() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const {
    closeRouteSidebar,
    isCompactView,
    isSidebarCollapsed,
    openRouteSidebar
  } = useRouteContainerSidebarOpener()
  const { clearRouteSidebar, hasRouteSidebarProvider, setRouteSidebar } = useRouteSidebar()
  const {
    headerActions: routePluginHeaderActions,
    sidebarContextMenuItems: routePluginSidebarContextMenu
  } = useRoutePluginChrome('automation')
  const navigate = useNavigate()
  const { data, mutate } = useSWR<{ rules: AutomationRule[] }>(
    '/api/automation/rules',
    listAutomationRules
  )
  const rules = data?.rules ?? EMPTY_AUTOMATION_RULES
  const [panelMode, setPanelMode] = useState<PanelMode>('create')
  const [submitting, setSubmitting] = useState(false)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem('automationRuleFavorites')
      if (!raw) return []
      const parsed = JSON.parse(raw) as string[]
      if (!Array.isArray(parsed)) return []
      return parsed
    } catch {
      return []
    }
  })
  const { values, update } = useQueryParams<AutomationQueryParams>({
    keys: AUTOMATION_QUERY_KEYS,
    defaults: AUTOMATION_QUERY_DEFAULTS,
    omit: AUTOMATION_QUERY_OMIT
  })

  const selectedRuleId = useMemo(() => {
    const fromUrl = values.rule
    if (fromUrl && rules.some(rule => rule.id === fromUrl)) return fromUrl
    return null
  }, [rules, values.rule])

  const selectedRule = useMemo(
    () => rules.find(rule => rule.id === selectedRuleId) ?? null,
    [rules, selectedRuleId]
  )

  const { data: runsData, mutate: mutateRuns } = useSWR<{ runs: AutomationRun[] }>(
    selectedRuleId ? `/api/automation/rules/${selectedRuleId}/runs` : null,
    () => listAutomationRuns(selectedRuleId ?? '')
  )
  const runs = runsData?.runs ?? EMPTY_AUTOMATION_RUNS
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const formPanelRef = useRef<RuleFormPanelHandle | null>(null)
  const [createMode, setCreateMode] = useState<AutomationCreateMode>('chat')

  useEffect(() => {
    window.localStorage.setItem('automationRuleFavorites', JSON.stringify(favorites))
  }, [favorites])

  useEffect(() => {
    if (!values.rule) return
    if (rules.some(rule => rule.id === values.rule)) return
    update({ rule: '' })
  }, [rules, update, values.rule])

  useEffect(() => {
    if (values.mode === 'create') {
      if (panelMode !== 'create') {
        setPanelMode('create')
        setCreateMode('chat')
      }
      if (isCompactView) {
        closeRouteSidebar()
      }
      return
    }

    if (selectedRuleId != null && panelMode === 'create') {
      setPanelMode('view')
      setCreateMode('form')
    }
  }, [closeRouteSidebar, isCompactView, panelMode, selectedRuleId, values.mode])

  const handleSelectRule = useCallback((ruleId: string) => {
    setPanelMode('view')
    if (panelMode === 'view' && selectedRuleId === ruleId) {
      update({ rule: '', mode: '' })
      if (isCompactView) {
        closeRouteSidebar()
      }
      return
    }
    update({ rule: ruleId, mode: '' })
    if (isCompactView) {
      closeRouteSidebar()
    }
  }, [closeRouteSidebar, isCompactView, panelMode, selectedRuleId, update])

  const handleCreateRule = useCallback(() => {
    setPanelMode('create')
    setCreateMode('chat')
    update({ rule: '', mode: 'create' })
    if (isCompactView) {
      closeRouteSidebar()
    }
  }, [closeRouteSidebar, isCompactView, update])

  const handleEditRule = useCallback((rule: AutomationRule) => {
    setPanelMode('edit')
    setCreateMode('form')
    update({ rule: rule.id, mode: '' })
    if (isCompactView) {
      closeRouteSidebar()
    }
  }, [closeRouteSidebar, isCompactView, update])

  const handleCancelForm = useCallback(() => {
    setPanelMode('view')
    setCreateMode('form')
    update({ mode: '' })
    if (isCompactView) {
      closeRouteSidebar()
    }
  }, [closeRouteSidebar, isCompactView, update])

  const detailsShouldShowRulePanelAction = isCompactView || (!isCompactView && isSidebarCollapsed)

  const handleSubmit = useCallback(async (
    payload: Partial<AutomationRule>,
    immediateRun: boolean
  ) => {
    try {
      setSubmitting(true)
      if (panelMode === 'create') {
        const res = await createAutomationRule({ ...payload, immediateRun })
        await mutate()
        if (res.rule?.id) {
          update({ rule: res.rule.id, mode: '' })
        }
        setPanelMode('view')
        return
      }
      if (panelMode === 'edit' && selectedRule) {
        await updateAutomationRule(selectedRule.id, { ...payload, immediateRun })
        await mutate()
        void mutateRuns()
        setPanelMode('view')
      }
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('automation.saveFailed')))
    } finally {
      setSubmitting(false)
    }
  }, [message, mutate, mutateRuns, panelMode, selectedRule, t, update])

  const handleDelete = useCallback(async (rule: AutomationRule) => {
    try {
      await deleteAutomationRule(rule.id)
      if (selectedRuleId === rule.id) {
        update({ rule: '', mode: '' })
        setPanelMode('view')
      }
      void mutate()
      void message.success(t('automation.deleted'))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('automation.deleteFailed')))
    }
  }, [message, mutate, selectedRuleId, t, update])

  const handleRun = useCallback(async (rule: AutomationRule) => {
    try {
      const res = await runAutomationRule(rule.id)
      const nextSessionId = res.sessionIds?.[0]
      if (nextSessionId) {
        void message.success(t('automation.runStarted'))
        void mutateRuns()
        void navigate(`/session/${nextSessionId}`)
      }
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('automation.runFailed')))
    }
  }, [message, mutateRuns, navigate, t])

  const handleToggleFavorite = useCallback((ruleId: string) => {
    setFavorites(prev => prev.includes(ruleId) ? prev.filter(id => id !== ruleId) : [...prev, ruleId])
  }, [])

  const activeRuleTriggerType = selectedRule?.triggers?.[0]?.type ?? selectedRule?.type
  const activeRuleIcon = activeRuleTriggerType === 'interval'
    ? 'timer'
    : activeRuleTriggerType === 'cron'
    ? 'schedule'
    : selectedRule == null
    ? 'event_repeat'
    : 'webhook'
  const isChatCreateMode = panelMode === 'create' && createMode === 'chat'
  const headerTitle = panelMode === 'create'
    ? t('automation.newTask')
    : panelMode === 'edit'
    ? t('automation.editRule')
    : selectedRule?.name ?? t('common.scheduledTasks')
  const headerIcon = panelMode === 'create'
    ? 'add_task'
    : panelMode === 'edit'
    ? 'edit_square'
    : activeRuleIcon

  const createModeSwitch = panelMode === 'create'
    ? (
      <div className='automation-view__create-mode-switch' role='tablist' aria-label={t('automation.createMode')}>
        <Tooltip title={t('automation.createModeForm')}>
          <Button
            className={`automation-view__create-mode-button ${createMode === 'form' ? 'is-active' : ''}`.trim()}
            type='text'
            role='tab'
            aria-label={t('automation.createModeForm')}
            aria-selected={createMode === 'form'}
            icon={<span className='material-symbols-rounded automation-view__create-mode-icon'>edit_note</span>}
            onClick={() => setCreateMode('form')}
          />
        </Tooltip>
        <Tooltip title={t('automation.createModeChat')}>
          <Button
            className={`automation-view__create-mode-button ${createMode === 'chat' ? 'is-active' : ''}`.trim()}
            type='text'
            role='tab'
            aria-label={t('automation.createModeChat')}
            aria-selected={createMode === 'chat'}
            icon={<span className='material-symbols-rounded automation-view__create-mode-icon'>forum</span>}
            onClick={() => setCreateMode('chat')}
          />
        </Tooltip>
      </div>
    )
    : null

  const automationHeaderActions = useMemo<RouteContainerHeaderActionItem[]>(() => {
    const actions: RouteContainerHeaderActionItem[] = []

    if (panelMode !== 'create') {
      actions.push({
        icon: 'add_task',
        key: 'automation-create',
        label: t('automation.newTask'),
        onSelect: handleCreateRule
      })
    }

    if (panelMode === 'edit') {
      actions.push({
        icon: 'close',
        key: 'automation-cancel',
        label: t('common.cancel'),
        onSelect: handleCancelForm
      })
    }

    if (!isChatCreateMode) {
      actions.push({
        disabled: submitting,
        icon: 'check',
        key: 'automation-confirm',
        label: t('common.confirm'),
        loading: submitting,
        onSelect: () => formPanelRef.current?.submit()
      })
    }

    return [...actions, ...routePluginHeaderActions]
  }, [
    handleCancelForm,
    handleCreateRule,
    isChatCreateMode,
    panelMode,
    routePluginHeaderActions,
    submitting,
    t
  ])

  const sidebarRules = useMemo(() => {
    const keyword = values.q.trim().toLowerCase()
    const filtered = keyword === ''
      ? rules
      : rules.filter(rule => {
        const nameMatch = rule.name.toLowerCase().includes(keyword)
        const descMatch = (rule.description ?? '').toLowerCase().includes(keyword)
        return nameMatch || descMatch
      })

    return [...filtered].sort((a, b) => {
      const favA = favoriteSet.has(a.id) ? 1 : 0
      const favB = favoriteSet.has(b.id) ? 1 : 0
      if (favA !== favB) return favB - favA
      return b.createdAt - a.createdAt
    })
  }, [favoriteSet, rules, values.q])

  const routeSidebarGroups = useMemo(() => {
    const ruleItems = sidebarRules.map(rule => {
      const primaryType = rule.triggers?.[0]?.type ?? rule.type ?? 'interval'
      const icon = primaryType === 'interval' ? 'timer' : primaryType === 'cron' ? 'schedule' : 'webhook'
      return {
        icon,
        key: rule.id,
        label: rule.name,
        searchText: `${rule.name} ${rule.description ?? ''}`
      }
    })

    return [{
      icon: 'schedule',
      key: 'automation',
      label: t('common.scheduledTasks'),
      items: ruleItems
    }]
  }, [sidebarRules, t])

  const handleRouteSidebarSelect = useCallback((item: RouteSidebarListItem) => {
    handleSelectRule(item.key)
  }, [handleSelectRule])

  useLayoutEffect(() => {
    if (!hasRouteSidebarProvider) return undefined

    setRouteSidebar({
      activeKey: selectedRuleId ?? undefined,
      ariaLabel: t('common.scheduledTasks'),
      contextMenuItems: routePluginSidebarContextMenu,
      emptyText: t('automation.emptyRules'),
      groups: routeSidebarGroups,
      key: 'automation-view',
      search: {
        placeholder: t('automation.searchRule'),
        value: values.q,
        onChange: (value: string) => update({ q: value })
      },
      onSelectItem: handleRouteSidebarSelect
    })

    return () => clearRouteSidebar('automation-view')
  }, [
    clearRouteSidebar,
    handleRouteSidebarSelect,
    hasRouteSidebarProvider,
    panelMode,
    routePluginSidebarContextMenu,
    routeSidebarGroups,
    selectedRuleId,
    setRouteSidebar,
    t,
    update,
    values.q
  ])

  return (
    <RouteContainerLayout
      className={[
        'automation-view',
        isCompactView ? 'automation-view--compact' : ''
      ].filter(Boolean).join(' ')}
      bodyClassName='automation-view__body'
      contentInset
      header={
        <RouteContainerHeader
          actions={createModeSwitch}
          actionItems={automationHeaderActions}
          icon={headerIcon}
          onOpenSidebar={openRouteSidebar}
          title={headerTitle}
        />
      }
    >
      {panelMode === 'create' && (
        <RuleFormPanel
          ref={formPanelRef}
          createMode={createMode}
          mode='create'
          rule={null}
          onSubmit={handleSubmit}
        />
      )}
      {panelMode === 'edit' && (
        <RuleFormPanel
          ref={formPanelRef}
          createMode={createMode}
          mode='edit'
          rule={selectedRule}
          onSubmit={handleSubmit}
        />
      )}
      {panelMode === 'view' && (
        <RunHistoryPanel
          compact={isCompactView}
          isRulePanelCollapsed={detailsShouldShowRulePanelAction}
          rule={selectedRule}
          runs={runs}
          runQuery={values.runQ}
          statusFilter={values.status}
          timeFilter={values.time}
          sortOrder={values.sort}
          onCreateRule={handleCreateRule}
          onEditRule={handleEditRule}
          onRunRule={handleRun}
          onDeleteRule={handleDelete}
          isFavorite={selectedRule != null && favoriteSet.has(selectedRule.id)}
          onToggleFavorite={handleToggleFavorite}
          onRunQueryChange={(value: string) => update({ runQ: value })}
          onStatusFilterChange={(value: string) => update({ status: value })}
          onTimeFilterChange={(value: string) => update({ time: value })}
          onSortOrderChange={(value: string) => update({ sort: value })}
        />
      )}
    </RouteContainerLayout>
  )
}
