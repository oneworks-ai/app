import './RoomAvatar.scss'

import { createSeededAvatarDefinition } from '@oneworks/avatar'
import { Avatar } from '@oneworks/avatar-react'
import { useMemo } from 'react'

export function RoomAvatar({
  className,
  label,
  seed
}: {
  className?: string
  label?: string
  seed: string
}) {
  const definition = useMemo(() =>
    createSeededAvatarDefinition({
      name: label,
      seed
    }), [label, seed])

  return (
    <span
      className={['room-avatar', className].filter(Boolean).join(' ')}
      aria-label={label}
      aria-hidden={label == null ? true : undefined}
    >
      <Avatar
        aria-hidden='true'
        className='room-avatar__model'
        definition={definition}
      />
    </span>
  )
}
