import { Button, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

interface AutomationPanelTitleActionsProps {
  collapsed: boolean
  defaultIcon?: string
  defaultIconClassName?: string
  isCreating: boolean
  onCreateRule?: () => void
}

export function AutomationPanelTitleActions({
  collapsed,
  defaultIcon,
  defaultIconClassName,
  isCreating,
  onCreateRule
}: AutomationPanelTitleActionsProps) {
  const { t } = useTranslation()

  if (!collapsed) {
    if (!defaultIcon) return null
    return (
      <span className={`material-symbols-rounded ${defaultIconClassName ?? ''}`.trim()}>
        {defaultIcon}
      </span>
    )
  }

  return (
    <span className='automation-view__title-leading-actions'>
      <Tooltip title={isCreating ? t('automation.creatingRule') : t('automation.newTask')}>
        <Button
          className={[
            'automation-view__title-action-button',
            'automation-view__title-action-button--create',
            isCreating ? 'is-active' : ''
          ].filter(Boolean).join(' ')}
          type='text'
          aria-label={isCreating ? t('automation.creatingRule') : t('automation.newTask')}
          disabled={isCreating}
          icon={
            <span
              className={`material-symbols-rounded automation-view__title-action-icon ${isCreating ? 'filled' : ''}`
                .trim()}
            >
              {isCreating ? 'progress_activity' : 'add'}
            </span>
          }
          onClick={onCreateRule}
        />
      </Tooltip>
    </span>
  )
}
