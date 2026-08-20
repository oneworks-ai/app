import { Button, Popconfirm, Tooltip } from 'antd'

import type { TranslationFn } from './configUtils'

export const DetailCollectionFieldActions = ({
  actionKind = 'remove',
  index,
  itemCount,
  onMove,
  onRemove,
  t
}: {
  actionKind?: 'remove' | 'reset'
  index: number
  itemCount: number
  onMove?: (direction: -1 | 1) => void
  onRemove: () => void
  t: TranslationFn
}) => {
  const isReset = actionKind === 'reset'
  const actionLabel = isReset
    ? t('config.editor.resetAdapterConfig')
    : t('config.editor.remove')

  return (
    <div className='config-view__record-actions'>
      {onMove != null && (
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
