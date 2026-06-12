import './RoomPixelAvatar.scss'

import { createSeededAvatarDataUri, resolveSeededAvatar } from '@oneworks/avatar'
import { useMemo } from 'react'

export function RoomPixelAvatar({
  className,
  label,
  seed
}: {
  className?: string
  label?: string
  seed: string
}) {
  const avatar = useMemo(() => {
    const config = resolveSeededAvatar({ seed })
    return {
      emoticon: config.emoticon,
      uri: createSeededAvatarDataUri({
        seed,
        size: 128,
        title: label ?? `OneWorks ${config.emoticon} avatar`
      })
    }
  }, [label, seed])

  return (
    <span
      className={['room-pixel-avatar', className].filter(Boolean).join(' ')}
      aria-label={label}
      aria-hidden={label == null ? true : undefined}
    >
      <img className='room-pixel-avatar__image' src={avatar.uri} alt='' aria-hidden='true' />
    </span>
  )
}
