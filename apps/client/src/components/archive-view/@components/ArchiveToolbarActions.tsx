import { Button, Popconfirm, Space, Tooltip } from 'antd'
import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'

import { createArchiveKeyboardAction } from '../@utils/archive-view-utils'

interface ArchiveToolbarActionsProps {
  hasPendingDelete: boolean
  isBatchMode: boolean
  onBatchDelete: () => void
  onBatchRestore: () => void
  onCancelBatch: () => void
  onEnterBatch: () => void
  selectedCount: number
  sessionCount: number
  t: TFunction
}

export function ArchiveToolbarActions({
  hasPendingDelete,
  isBatchMode,
  onBatchDelete,
  onBatchRestore,
  onCancelBatch,
  onEnterBatch,
  selectedCount,
  sessionCount,
  t
}: ArchiveToolbarActionsProps) {
  const isBatchActionDisabled = selectedCount === 0 || hasPendingDelete
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)

  useEffect(() => {
    if (!isBatchMode || isBatchActionDisabled) setBatchDeleteOpen(false)
  }, [isBatchActionDisabled, isBatchMode])

  return (
    <Space size={6} className='archive-view__toolbar-actions'>
      {isBatchMode
        ? (
          <>
            <span className='archive-view__batch-info'>
              {t('common.selectedCount', { count: selectedCount })}
            </span>
            <Tooltip title={t('common.cancel')}>
              <Button
                icon={<span className='material-symbols-rounded archive-view__action-icon'>close</span>}
                onClick={onCancelBatch}
                onKeyDown={createArchiveKeyboardAction(hasPendingDelete, onCancelBatch)}
                aria-label={t('common.cancelBatch')}
                disabled={hasPendingDelete}
                className='archive-view__icon-button'
              />
            </Tooltip>
            <Tooltip title={t('common.batchRestore')}>
              <Button
                type='primary'
                icon={<span className='material-symbols-rounded archive-view__action-icon'>unarchive</span>}
                onClick={onBatchRestore}
                onKeyDown={createArchiveKeyboardAction(isBatchActionDisabled, onBatchRestore)}
                aria-label={t('common.batchRestore')}
                disabled={isBatchActionDisabled}
                className='archive-view__icon-button'
              />
            </Tooltip>
            <Popconfirm
              title={t('common.deleteConfirm', { count: selectedCount })}
              open={batchDeleteOpen}
              onOpenChange={setBatchDeleteOpen}
              onCancel={() => setBatchDeleteOpen(false)}
              onConfirm={() => {
                setBatchDeleteOpen(false)
                onBatchDelete()
              }}
              disabled={isBatchActionDisabled}
            >
              <Tooltip title={t('common.batchDelete')}>
                <Button
                  danger
                  icon={<span className='material-symbols-rounded archive-view__action-icon'>delete_sweep</span>}
                  aria-label={t('common.batchDelete')}
                  disabled={isBatchActionDisabled}
                  loading={hasPendingDelete}
                  onKeyDown={createArchiveKeyboardAction(
                    isBatchActionDisabled,
                    () => {
                      if (!batchDeleteOpen) setBatchDeleteOpen(true)
                    }
                  )}
                  className='archive-view__icon-button'
                />
              </Tooltip>
            </Popconfirm>
          </>
        )
        : (
          <Tooltip title={t('common.batchMode')}>
            <Button
              icon={<span className='material-symbols-rounded archive-view__action-icon'>checklist</span>}
              aria-label={t('common.batchMode')}
              onClick={onEnterBatch}
              disabled={sessionCount === 0 || hasPendingDelete}
              onKeyDown={createArchiveKeyboardAction(
                sessionCount === 0 || hasPendingDelete,
                onEnterBatch
              )}
              className='archive-view__icon-button'
            />
          </Tooltip>
        )}
    </Space>
  )
}
