import './ActionSearchToolbar.scss'

import { Button, Input, Tooltip } from 'antd'
import type { ReactNode } from 'react'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'

export interface ActionSearchToolbarAction {
  active?: boolean
  ariaLabel: string
  disabled?: boolean
  hasIndicator?: boolean
  icon: ReactNode | string
  key: string
  loading?: boolean
  onClick: () => void
  pressed?: boolean
  title?: ReactNode
}

export interface ActionSearchToolbarProps {
  actions?: ActionSearchToolbarAction[]
  className?: string
  onQueryChange: (query: string) => void
  placeholder: string
  query: string
}

const renderActionIcon = (icon: ReactNode | string) => (
  typeof icon === 'string' ? <MaterialSymbol name={icon} /> : icon
)

export function ActionSearchToolbar({
  actions = [],
  className,
  onQueryChange,
  placeholder,
  query
}: ActionSearchToolbarProps) {
  return (
    <div className={['action-search-toolbar', className].filter(Boolean).join(' ')}>
      <Input
        className='action-search-toolbar__search'
        allowClear={query !== ''}
        prefix={<MaterialSymbol name='search' />}
        placeholder={placeholder}
        value={query}
        onChange={event => onQueryChange(event.target.value)}
      />
      {actions.length > 0 && (
        <div className='action-search-toolbar__actions'>
          {actions.map(action => (
            <Tooltip key={action.key} title={action.title}>
              <Button
                className={[
                  'action-search-toolbar__button',
                  action.active ? 'is-active' : '',
                  action.hasIndicator ? 'has-indicator' : ''
                ].filter(Boolean).join(' ')}
                type='text'
                aria-label={action.ariaLabel}
                aria-pressed={action.pressed}
                disabled={action.disabled}
                loading={action.loading}
                icon={renderActionIcon(action.icon)}
                onClick={action.onClick}
              />
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
}
