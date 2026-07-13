import './ActionSearchToolbar.scss'

import { Input } from 'antd'
import type { ReactNode } from 'react'

import { RouteContainerHeaderActionButton } from '@oneworks/components/route-layout'

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
  inset?: boolean
  onQueryChange: (query: string) => void
  placeholder: string
  query: string
}

export function ActionSearchToolbar({
  actions = [],
  className,
  inset = true,
  onQueryChange,
  placeholder,
  query
}: ActionSearchToolbarProps) {
  return (
    <div
      className={[
        'action-search-toolbar',
        inset ? '' : 'action-search-toolbar--flush',
        className
      ].filter(Boolean).join(' ')}
    >
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
            <span
              key={action.key}
              className={[
                'action-search-toolbar__action',
                action.hasIndicator ? 'has-indicator' : ''
              ].filter(Boolean).join(' ')}
            >
              <RouteContainerHeaderActionButton
                item={{
                  active: action.active ?? action.pressed,
                  disabled: action.disabled,
                  icon: action.icon,
                  key: action.key,
                  label: action.ariaLabel,
                  loading: action.loading,
                  onSelect: action.onClick,
                  title: typeof action.title === 'string' ? action.title : action.ariaLabel
                }}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
