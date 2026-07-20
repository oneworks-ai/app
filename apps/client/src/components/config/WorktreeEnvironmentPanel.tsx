import './WorktreeEnvironmentPanel.scss'

import { App } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'

import type { RouteContainerHeaderActionItem } from '@oneworks/components/route-layout'
import type { ConfigSource } from '@oneworks/core'
import type { WorktreeEnvironmentScriptKey, WorktreeEnvironmentSummary } from '@oneworks/types'

import { getApiErrorMessage, getWorktreeEnvironment, listWorktreeEnvironments, saveWorktreeEnvironment } from '#~/api'

import { WorktreeEnvironmentDetailView } from './WorktreeEnvironmentDetailView'
import { WorktreeEnvironmentListView } from './WorktreeEnvironmentListView'
import type { TranslationFn } from './configUtils'
import { useWorktreeEnvironmentAutoSave } from './use-worktree-environment-auto-save'
import { buildDefaultEnvironmentScripts, buildDraftScripts } from './worktree-environment-panel-model'

type WorktreeEnvironmentConfigSource = Extract<ConfigSource, 'project' | 'user'>

const getEnvironmentSource = (
  environment: WorktreeEnvironmentSummary | undefined
): WorktreeEnvironmentConfigSource => (
  environment?.isLocal === true ? 'user' : 'project'
)

export function WorktreeEnvironmentPanel({
  onHeaderActionsChange,
  t
}: {
  onHeaderActionsChange?: (items: RouteContainerHeaderActionItem[]) => void
  t: TranslationFn
}) {
  const { message, modal } = App.useApp()
  const [sourceKey, setSourceKey] = useState<WorktreeEnvironmentConfigSource>('project')
  const [selectedId, setSelectedId] = useState<string>()
  const [nameDraft, setNameDraft] = useState('')
  const [draftEnvironmentId, setDraftEnvironmentId] = useState<string>()
  const [draftScripts, setDraftScripts] = useState<Record<WorktreeEnvironmentScriptKey, string>>(
    () => buildDraftScripts()
  )
  const { data, isLoading, mutate } = useSWR('worktree-environments', listWorktreeEnvironments)
  const environments = data?.environments ?? []
  const selectedSummary = environments.find(environment => (
    environment.id === selectedId && getEnvironmentSource(environment) === sourceKey
  ))
  const { data: detailData, isLoading: isDetailLoading, mutate: mutateDetail } = useSWR(
    selectedId != null ? ['worktree-environment', sourceKey, selectedId] : null,
    ([, source, id]) => getWorktreeEnvironment(id, source)
  )
  const selectedEnvironment = detailData?.environment
  const visibleEnvironments = useMemo(() => (
    environments.filter(environment => (
      sourceKey === 'user' ? environment.isLocal : !environment.isLocal
    ))
  ), [environments, sourceKey])

  useEffect(() => {
    if (selectedSummary == null) return
    setSourceKey(getEnvironmentSource(selectedSummary))
  }, [selectedSummary])

  useWorktreeEnvironmentAutoSave({
    draftEnvironmentId,
    draftScripts,
    environments,
    message,
    modal,
    nameDraft,
    selectedEnvironment,
    selectedId,
    sourceKey,
    refreshDetail: mutateDetail,
    refreshEnvironments: mutate,
    setDraftEnvironmentId,
    setDraftScripts,
    setNameDraft,
    setSelectedId,
    t
  })

  const getNextEnvironmentId = () => {
    const baseId = 'new-environment'
    const sourceEnvironmentIds = new Set(
      environments
        .filter(environment => getEnvironmentSource(environment) === sourceKey)
        .map(environment => environment.id)
    )
    if (!sourceEnvironmentIds.has(baseId)) return baseId

    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${baseId}-${index}`
      if (!sourceEnvironmentIds.has(candidate)) return candidate
    }

    return `${baseId}-${Date.now()}`
  }

  const handleCreate = async () => {
    const environmentId = getNextEnvironmentId()

    try {
      await saveWorktreeEnvironment(environmentId, { scripts: buildDefaultEnvironmentScripts() }, sourceKey)
      setSelectedId(environmentId)
      await mutate()
      await mutateDetail()
      void message.success(t('config.environments.created'))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('config.environments.createFailed')))
    }
  }

  const headerActionItems = useMemo<RouteContainerHeaderActionItem[]>(() => [
    {
      active: sourceKey === 'project',
      icon: 'folder',
      key: 'worktree-environment-source-project',
      label: t('config.environments.sources.project'),
      onSelect: () => {
        setSourceKey('project')
        setSelectedId(undefined)
      }
    },
    {
      active: sourceKey === 'user',
      icon: 'person',
      key: 'worktree-environment-source-user',
      label: t('config.environments.sources.user'),
      onSelect: () => {
        setSourceKey('user')
        setSelectedId(undefined)
      }
    }
  ], [sourceKey, t])

  useEffect(() => {
    onHeaderActionsChange?.(headerActionItems)
    return () => onHeaderActionsChange?.([])
  }, [headerActionItems, onHeaderActionsChange])

  return (
    <div className='worktree-env-panel'>
      {selectedId == null
        ? (
          <WorktreeEnvironmentListView
            isLoading={isLoading}
            visibleEnvironments={visibleEnvironments}
            onCreate={() => void handleCreate()}
            onSelectEnvironment={setSelectedId}
            t={t}
          />
        )
        : (
          <WorktreeEnvironmentDetailView
            draftScripts={draftScripts}
            isDetailLoading={isDetailLoading}
            nameDraft={nameDraft}
            selectedEnvironment={selectedEnvironment}
            onBack={() => setSelectedId(undefined)}
            onNameDraftChange={setNameDraft}
            onScriptChange={(key, content) => {
              setDraftScripts(prev => ({ ...prev, [key]: content }))
            }}
            t={t}
          />
        )}
    </div>
  )
}
