import { Button, Input, Tooltip } from 'antd'
import type { ButtonProps } from 'antd'
import type { ReactNode } from 'react'

export interface ConfigRecordAction {
  ariaLabel: string
  danger?: boolean
  disabled?: boolean
  icon: ReactNode
  key: string
  loading?: boolean
  onClick: () => void
  title: ReactNode
  type?: ButtonProps['type']
}

const cx = (...classes: Array<string | false | null | undefined>) => (
  classes.filter(Boolean).join(' ')
)

const renderRecordAction = (action: ConfigRecordAction) => (
  <Tooltip key={action.key} title={action.title}>
    <Button
      size='small'
      type={action.type ?? 'text'}
      danger={action.danger}
      className='config-view__icon-button config-view__icon-button--compact config-view__detail-action-btn'
      aria-label={action.ariaLabel}
      icon={action.icon}
      loading={action.loading}
      disabled={action.disabled}
      onClick={action.onClick}
    />
  </Tooltip>
)

export const ConfigRecordActions = ({ actions }: { actions: ConfigRecordAction[] }) => {
  if (actions.length === 0) return null
  return (
    <div className='config-view__record-actions'>
      {actions.map(renderRecordAction)}
    </div>
  )
}

export const ConfigRecordList = ({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) => (
  <div className={cx('config-view__record-list', className)}>
    {children}
  </div>
)

export const ConfigRecordCreateRow = ({
  actions,
  className,
  disabled,
  hint,
  onSubmit,
  onValueChange,
  placeholder,
  value
}: {
  actions: ConfigRecordAction[]
  className?: string
  disabled?: boolean
  hint?: ReactNode
  onSubmit: () => void
  onValueChange: (value: string) => void
  placeholder: string
  value: string
}) => (
  <div className='config-view__record-add'>
    <div className={cx('config-view__record-add-inputs', className)}>
      <Input
        value={value}
        disabled={disabled}
        onChange={event => onValueChange(event.target.value)}
        placeholder={placeholder}
        onPressEnter={onSubmit}
      />
      {actions.map(renderRecordAction)}
    </div>
    {hint}
  </div>
)

export const ConfigRecordRow = ({
  actions = [],
  className,
  descriptions = [],
  icon,
  onClick,
  rightSlot,
  subtitle,
  title
}: {
  actions?: ConfigRecordAction[]
  className?: string
  descriptions?: ReactNode[]
  icon?: ReactNode
  onClick?: () => void
  rightSlot?: ReactNode
  subtitle?: ReactNode
  title: ReactNode
}) => {
  const mainContent = (
    <div className={cx('config-view__record-heading', icon != null && 'has-adapter-icon')}>
      {icon}
      <div className='config-view__record-heading-text'>
        <div className='config-view__record-title'>{title}</div>
        {subtitle != null && subtitle !== '' && (
          <div className='config-view__record-subtitle'>{subtitle}</div>
        )}
        {descriptions.map((description, index) => (
          description == null || description === ''
            ? null
            : <div key={index} className='config-view__record-desc'>{description}</div>
        ))}
      </div>
    </div>
  )

  return (
    <div className={cx('config-view__record-card', className)}>
      <div className='config-view__detail-list-row'>
        {onClick == null
          ? <div className='config-view__detail-list-main'>{mainContent}</div>
          : (
            <button type='button' className='config-view__detail-list-main' onClick={onClick}>
              {mainContent}
            </button>
          )}
        {rightSlot}
        <ConfigRecordActions actions={actions} />
      </div>
    </div>
  )
}
