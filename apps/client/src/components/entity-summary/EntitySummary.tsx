import './EntitySummary.scss'

import { getWorkspaceResourceUrl } from '#~/api'
import { RoomAvatar } from '#~/components/room-avatar/RoomAvatar'

const resolveAvatarUrl = (avatar: string | undefined) => {
  const value = avatar?.trim()
  if (value == null || value === '') return undefined
  return /^(?:blob:|data:|https?:\/\/)/u.test(value) ? value : getWorkspaceResourceUrl(value)
}

export interface EntitySummaryItem {
  icon?: string
  label: string
  value: string
}

export interface EntitySummaryProps {
  avatar?: string
  contextLabel?: string
  description?: string
  entityId: string
  items?: EntitySummaryItem[]
  name: string
  onBack?: () => void
  onOpenDetails?: () => void
  openDetailsLabel?: string
  variant?: 'compact' | 'detail'
}

export function EntitySummary({
  avatar,
  contextLabel,
  description,
  entityId,
  items = [],
  name,
  onBack,
  onOpenDetails,
  openDetailsLabel = 'View entity details',
  variant = 'compact'
}: EntitySummaryProps) {
  const avatarUrl = resolveAvatarUrl(avatar)
  const identityContent = (
    <>
      <span className='entity-summary__avatar' aria-hidden='true'>
        {avatarUrl == null
          ? <RoomAvatar className='entity-summary__avatar-generated' seed={`entity:${entityId}`} />
          : <img alt='' className='entity-summary__avatar-image' src={avatarUrl} />}
      </span>
      <span className='entity-summary__copy'>
        <strong>{name}</strong>
        {description == null || description === '' ? null : <span>{description}</span>}
      </span>
      {onOpenDetails == null
        ? null
        : <span aria-hidden='true' className='material-symbols-rounded entity-summary__open'>chevron_right</span>}
    </>
  )

  return (
    <section className={`entity-summary entity-summary--${variant}`}>
      {onBack == null
        ? null
        : (
          <div className='entity-summary__toolbar'>
            <button aria-label='Back' className='entity-summary__back' title='Back' type='button' onClick={onBack}>
              <span aria-hidden='true' className='material-symbols-rounded'>arrow_back</span>
            </button>
            {contextLabel == null || contextLabel === ''
              ? null
              : <strong className='entity-summary__context'>{contextLabel}</strong>}
          </div>
        )}
      {onOpenDetails == null
        ? <div className='entity-summary__identity'>{identityContent}</div>
        : (
          <button
            aria-label={openDetailsLabel}
            className='entity-summary__identity'
            title={openDetailsLabel}
            type='button'
            onClick={onOpenDetails}
          >
            {identityContent}
          </button>
        )}
      {items.length === 0
        ? null
        : (
          <div className='entity-summary__facts'>
            {items.map(item => (
              <div className='entity-summary__fact' key={`${item.label}:${item.value}`}>
                {item.icon == null || item.icon === ''
                  ? null
                  : <span aria-hidden='true' className='material-symbols-rounded entity-summary__fact-icon'>
                    {item.icon}
                  </span>}
                <span className='entity-summary__fact-copy'>
                  <small>{item.label}</small>
                  <span>{item.value}</span>
                </span>
              </div>
            ))}
          </div>
        )}
    </section>
  )
}
