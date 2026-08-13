import './EntityCard.scss'

import type { KeyboardEvent } from 'react'

import { getWorkspaceResourceUrl } from '#~/api'
import { RoomPixelAvatar } from '#~/components/room-pixel-avatar/RoomPixelAvatar'

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
  selected?: boolean
  onOpenDetails?: () => void
  onSelect?: () => void
}

export function EntityCard({
  avatar,
  description,
  entityId,
  name,
  selected = false,
  onOpenDetails,
  onSelect
}: EntityCardProps) {
  const avatarUrl = resolveAvatarUrl(avatar)
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect?.()
  }

  return (
    <div
      aria-checked={selected}
      className={`entity-card ${selected ? 'is-selected' : ''}`}
      role='checkbox'
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <span className='entity-card__avatar' aria-hidden='true'>
        {avatarUrl == null
          ? <RoomPixelAvatar className='entity-card__avatar-pixel' seed={`entity:${entityId}`} />
          : <img alt='' className='entity-card__avatar-image' src={avatarUrl} />}
      </span>
      <span className='entity-card__copy'>
        <button
          className='entity-card__name'
          title={name}
          type='button'
          onClick={(event) => {
            event.stopPropagation()
            onOpenDetails?.()
          }}
        >
          {name}
        </button>
        {description == null || description === ''
          ? null
          : <span className='entity-card__description'>{description}</span>}
      </span>
    </div>
  )
}
