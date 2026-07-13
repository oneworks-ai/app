import './MarketplaceCard.scss'

import { List, Tag } from 'antd'
import type { KeyboardEvent, ReactNode } from 'react'

export interface MarketplaceCapabilityGroup {
  icon: string
  key: string
  values: string[]
}

export function MarketplaceCapabilityTags({ groups }: { groups: MarketplaceCapabilityGroup[] }) {
  return (
    <div className='marketplace-card__capabilities'>
      {groups.flatMap(group =>
        group.values.map(value => (
          <Tag key={`${group.key}:${value}`} className='marketplace-card__capability'>
            <span className='material-symbols-rounded marketplace-card__capability-icon'>{group.icon}</span>
            <span>{value}</span>
          </Tag>
        ))
      )}
    </div>
  )
}

export function MarketplaceCard({
  actions,
  description,
  footer,
  icon,
  iconBadge,
  onSelect,
  subtitle,
  title,
  titleMeta
}: {
  actions?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  icon: ReactNode
  iconBadge?: ReactNode
  onSelect?: () => void
  subtitle?: ReactNode
  title: ReactNode
  titleMeta?: ReactNode
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (onSelect == null || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onSelect()
  }

  return (
    <List.Item className='marketplace-results__list-item'>
      <article
        className={`marketplace-card${onSelect == null ? '' : ' is-interactive'}`}
        role={onSelect == null ? undefined : 'button'}
        tabIndex={onSelect == null ? undefined : 0}
        onClick={onSelect}
        onKeyDown={handleKeyDown}
      >
        <div className='marketplace-card__main'>
          <div className='marketplace-card__title-row'>
            <div className='marketplace-card__identity'>
              <span className='marketplace-card__icon-shell'>
                <span className='marketplace-card__icon'>{icon}</span>
                {iconBadge}
              </span>
              <span className='marketplace-card__title'>{title}</span>
            </div>
            {titleMeta != null && <div className='marketplace-card__title-meta'>{titleMeta}</div>}
          </div>
          {subtitle != null && <div className='marketplace-card__subtitle'>{subtitle}</div>}
          {description != null && <div className='marketplace-card__description'>{description}</div>}
          {footer}
        </div>
        {actions != null && <div className='marketplace-card__actions'>{actions}</div>}
      </article>
    </List.Item>
  )
}
