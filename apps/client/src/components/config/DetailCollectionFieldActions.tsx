import { Button, Popconfirm, Tooltip } from 'antd'
import type { ReactNode } from 'react'

import type { TranslationFn } from './configUtils'

export interface DetailCollectionMoveAction {
  className?: string
  direction: -1 | 1
  icon: string
  label: string
}

export const DetailCollectionFieldActions = ({
  actionKind = 'remove',
  className,
  index,
  itemCount,
  leadingAction,
  moveActions,
  onMove,
  onRemove,
  t
}: {
  actionKind?: 'remove' | 'reset'
  className?: string
  index: number
  itemCount: number
  leadingAction?: ReactNode
  moveActions?: DetailCollectionMoveAction[]
  onMove?: (direction: -1 | 1) => void
  onRemove: () => void
  t: TranslationFn
}) => {
  const isReset = actionKind === 'reset'
  const actionLabel = isReset
    ? t('config.editor.resetAdapterConfig')
    : t('config.editor.remove')

  return (
    <div className={['config-view__record-actions', className].filter(Boolean).join(' ')}>
      {leadingAction}
      {moveActions?.map(action => (
        <Tooltip key={action.direction} title={action.label}>
          <Button
            size='small'
            type='text'
            className={[
              'config-view__icon-button',
              'config-view__icon-button--compact',
              action.className
            ].filter(Boolean).join(' ')}
            aria-label={action.label}
            icon={<span className='material-symbols-rounded'>{action.icon}</span>}
            onClick={() => onMove?.(action.direction)}
          />
        </Tooltip>
      ))}
      {moveActions == null && onMove != null && (
        <>
          <Tooltip title={t('config.editor.moveUp')}>
            <Button
              size='small'
              type='text'
              className='config-view__icon-button config-view__icon-button--compact'
              aria-label={t('config.editor.moveUp')}
              icon={<span className='material-symbols-rounded'>keyboard_arrow_up</span>}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            />
          </Tooltip>
          <Tooltip title={t('config.editor.moveDown')}>
            <Button
              size='small'
              type='text'
              className='config-view__icon-button config-view__icon-button--compact'
              aria-label={t('config.editor.moveDown')}
              icon={<span className='material-symbols-rounded'>keyboard_arrow_down</span>}
              disabled={index === itemCount - 1}
              onClick={() => onMove(1)}
            />
          </Tooltip>
        </>
      )}
      <Popconfirm
        title={isReset
          ? t('config.editor.resetAdapterConfigConfirmTitle')
          : t('config.editor.removeItemConfirmTitle')}
        description={isReset ? t('config.editor.resetAdapterConfigConfirmDescription') : undefined}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={onRemove}
      >
        <Tooltip title={actionLabel}>
          <Button
            size='small'
            type='text'
            danger
            className='config-view__icon-button config-view__icon-button--compact'
            aria-label={actionLabel}
            icon={<span className='material-symbols-rounded'>{isReset ? 'settings_backup_restore' : 'delete'}</span>}
          />
        </Tooltip>
      </Popconfirm>
    </div>
  )
}
