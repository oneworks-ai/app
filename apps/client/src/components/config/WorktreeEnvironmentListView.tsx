import { Button, Empty, Spin, Tooltip } from 'antd'
import { useMemo, useState } from 'react'

import type { WorktreeEnvironmentSummary } from '@oneworks/types'

import { ListSearchInput } from '#~/components/list-search-input'

import { AdapterImportDialog } from './AdapterImportDialog'
import type { AdapterImportAction } from './AdapterImportRow'
import { ConfigRecordList, ConfigRecordRow } from './ConfigRecordList'
import { ConfigSectionFrame } from './ConfigSectionFrame'
import type { TranslationFn } from './configUtils'
import { toDisplayEnvironmentName } from './worktree-environment-panel-model'

export const filterWorktreeEnvironments = (
  environments: WorktreeEnvironmentSummary[],
  searchQuery: string
) => {
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  if (normalizedSearchQuery === '') return environments
  return environments.filter((environment) => {
    const displayName = toDisplayEnvironmentName(environment.id).toLowerCase()
    return displayName.includes(normalizedSearchQuery) ||
      environment.path.toLowerCase().includes(normalizedSearchQuery)
  })
}

export function WorktreeEnvironmentListView({
  isLoading,
  disabled,
  importAction,
  visibleEnvironments,
  onCreate,
  onSelectEnvironment,
  t
}: {
  isLoading: boolean
  disabled?: boolean
  importAction?: AdapterImportAction
  visibleEnvironments: WorktreeEnvironmentSummary[]
  onCreate: () => void
  onSelectEnvironment: (id: string) => void
  t: TranslationFn
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isImportDialogOpen, setImportDialogOpen] = useState(false)
  const filteredEnvironments = useMemo(
    () => filterWorktreeEnvironments(visibleEnvironments, searchQuery),
    [searchQuery, visibleEnvironments]
  )

  return (
    <>
      <ConfigSectionFrame
        className='worktree-env-panel__list-view'
        bodyClassName='worktree-env-panel__list-body'
      >
        <div className='worktree-env-panel__list-main'>
          <div className='config-view__record-add-inputs worktree-env-panel__search-row'>
            <ListSearchInput
              value={searchQuery}
              disabled={disabled}
              onChange={setSearchQuery}
              placeholder={t('config.environments.searchPlaceholder')}
              suffix={
                <>
                  {importAction != null && (
                    <Tooltip title={importAction.title ?? importAction.actionLabel}>
                      <Button
                        size='small'
                        type='text'
                        className='config-view__icon-button config-view__icon-button--compact'
                        aria-label={importAction.actionLabel}
                        aria-expanded={isImportDialogOpen}
                        aria-haspopup='dialog'
                        disabled={importAction.loading}
                        loading={importAction.loading}
                        icon={<span className='material-symbols-rounded'>file_download</span>}
                        onClick={() => setImportDialogOpen(true)}
                      />
                    </Tooltip>
                  )}
                  <Tooltip title={t('config.environments.create')}>
                    <Button
                      size='small'
                      type='text'
                      className='config-view__icon-button config-view__icon-button--compact'
                      aria-label={t('config.environments.create')}
                      disabled={disabled}
                      icon={<span className='material-symbols-rounded'>add</span>}
                      onClick={onCreate}
                    />
                  </Tooltip>
                </>
              }
            />
          </div>
          <div className='worktree-env-panel__list-results'>
            <WorktreeEnvironmentListState
              disabled={disabled}
              isLoading={isLoading}
              emptyDescription={visibleEnvironments.length === 0
                ? t('config.environments.empty')
                : t('config.environments.searchEmpty')}
              visibleEnvironments={filteredEnvironments}
              onSelectEnvironment={onSelectEnvironment}
            />
          </div>
        </div>
      </ConfigSectionFrame>
      {importAction != null && (
        <AdapterImportDialog
          action={importAction}
          cancelLabel={t('common.cancel')}
          open={isImportDialogOpen}
          title={t('config.environments.import.dialogTitle')}
          onClose={() => setImportDialogOpen(false)}
        />
      )}
    </>
  )
}

function WorktreeEnvironmentListState({
  emptyDescription,
  disabled,
  isLoading,
  visibleEnvironments,
  onSelectEnvironment
}: {
  emptyDescription: string
  disabled?: boolean
  isLoading: boolean
  visibleEnvironments: WorktreeEnvironmentSummary[]
  onSelectEnvironment: (id: string) => void
}) {
  if (isLoading) {
    return (
      <div className='worktree-env-panel__state'>
        <Spin />
      </div>
    )
  }

  if (visibleEnvironments.length === 0) {
    return (
      <div className='worktree-env-panel__state'>
        <Empty description={emptyDescription} />
      </div>
    )
  }

  return (
    <ConfigRecordList className='worktree-env-panel__env-list'>
      {visibleEnvironments.map(environment => (
        <ConfigRecordRow
          key={environment.id}
          className={disabled ? 'worktree-env-panel__env-row--disabled' : undefined}
          icon={<span className='material-symbols-rounded config-view__adapter-icon-fallback'>deployed_code</span>}
          title={toDisplayEnvironmentName(environment.id)}
          subtitle={environment.path}
          rightSlot={<span className='material-symbols-rounded worktree-env-panel__row-chevron'>chevron_right</span>}
          onClick={disabled ? undefined : () => onSelectEnvironment(environment.id)}
        />
      ))}
    </ConfigRecordList>
  )
}
