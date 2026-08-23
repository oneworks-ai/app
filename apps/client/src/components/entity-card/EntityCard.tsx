import './EntityCard.scss'

import type { KeyboardEvent } from 'react'

import { getWorkspaceResourceUrl } from '#~/api'
import { GroupAvatar } from '#~/components/group-avatar/GroupAvatar'
import type { GroupAvatarMember } from '#~/components/group-avatar/GroupAvatar'
import { RoomAvatar } from '#~/components/room-avatar/RoomAvatar'

const resolveAvatarUrl = (avatar: string | undefined) => {
  const value = avatar?.trim()
  if (value == null || value === '') return undefined
  return /^(?:blob:|data:|https?:\/\/)/u.test(value) ? value : getWorkspaceResourceUrl(value)
}

export interface EntityCardProps {
  avatar?: string
  description?: string
  entityId: string
  name: string
  relatedEntities?: GroupAvatarMember[]
  relatedEntitiesLabel?: string
  selectionMode?: 'checkbox' | 'radio'
  selected?: boolean
  tabIndex?: number
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void
  onOpenDetails?: () => void
  onSelect?: () => void
}

export function EntityCard({
  avatar,
  description,
  entityId,
  name,
  relatedEntities = [],
  relatedEntitiesLabel,
  selectionMode = 'checkbox',
  selected = false,
  tabIndex = 0,
  onKeyDown,
  onOpenDetails,
  onSelect
}: EntityCardProps) {
  const avatarUrl = resolveAvatarUrl(avatar)
  const selectionLabel = description == null || description === '' ? name : `${name} ${description}`
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect?.()
  }

  return (
    <div
      className={`entity-card ${relatedEntities.length > 0 ? 'has-related-entities' : ''} ${
        selected ? 'is-selected' : ''
      }`}
    >
      <button
        aria-checked={selected}
        aria-label={selectionLabel}
        className='entity-card__selector'
        data-entity-id={entityId}
        role={selectionMode}
        tabIndex={tabIndex}
        type='button'
        onClick={onSelect}
        onKeyDown={handleKeyDown}
      />
      <span className='entity-card__avatar' aria-hidden='true'>
        {avatarUrl == null
          ? <RoomAvatar className='entity-card__avatar-generated' seed={`entity:${entityId}`} />
          : <img alt='' className='entity-card__avatar-image' src={avatarUrl} />}
      </span>
      <span className='entity-card__copy'>
        {onOpenDetails == null
          ? <span className='entity-card__name is-static' title={name}>{name}</span>
          : <button
            className='entity-card__name'
            title={name}
            type='button'
            onClick={(event) => {
              event.stopPropagation()
              onOpenDetails()
            }}
          >
            {name}
          </button>}
        {description == null || description === ''
          ? null
          : <span className='entity-card__description'>{description}</span>}
      </span>
      {relatedEntities.length === 0
        ? null
        : <span
          aria-label={relatedEntitiesLabel}
          className='entity-card__related-entities'
          title={relatedEntitiesLabel}
        >
          {relatedEntities.slice(0, 4).map(entity => (
            <GroupAvatar key={entity.key} members={[entity]} />
          ))}
          {relatedEntities.length > 4
            ? <span className='entity-card__related-count'>+{relatedEntities.length - 4}</span>
            : null}
        </span>}
    </div>
  )
}
